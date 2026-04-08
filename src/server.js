const express = require("express");
const {
  attachUser,
  clearDevCookie,
  clearRoleOverrideCookie,
  getExternalBaseUrl,
  requireAuth,
  requireInstructor,
  serializeDevCookie,
  serializeRoleOverride
} = require("./auth");
const { initDb } = require("./db");
const {
  cancelEntry,
  completeEntry,
  getActiveQueue,
  getDashboardStats,
  getStudentActiveEntry,
  joinQueue,
  leaveQueue
} = require("./queueService");
const { escapeHtml, formatDuration } = require("./utils");

const app = express();
const port = Number(process.env.PORT || 3000);
const trustProxyAuth = String(process.env.TRUST_PROXY_AUTH || "").toLowerCase() === "true";

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(attachUser);

const queueTitle = process.env.QUEUE_TITLE || "STOR 113 Office hours queue";
const testLoginEnabled = String(process.env.TEST_LOGIN_ENABLED || "").toLowerCase() === "true";
const studentViewKey = String(process.env.STUDENT_VIEW_KEY || "").trim();
const instructorViewKey = String(process.env.INSTRUCTOR_VIEW_KEY || "").trim();

function getTestAccount(kind) {
  if (kind === "instructor") {
    return {
      displayName: process.env.TEST_INSTRUCTOR_NAME || "Test Instructor",
      email: process.env.TEST_INSTRUCTOR_EMAIL || "test.instructor@unc.edu",
      role: "instructor",
      userId: process.env.TEST_INSTRUCTOR_ONYEN || "testinstructor"
    };
  }

  return {
    displayName: process.env.TEST_STUDENT_NAME || "Test Student",
    email: process.env.TEST_STUDENT_EMAIL || "test.student@unc.edu",
    role: "student",
    userId: process.env.TEST_STUDENT_ONYEN || "teststudent"
  };
}

function activateTestLogin(res, kind) {
  const payload = getTestAccount(kind);
  res.setHeader("Set-Cookie", serializeDevCookie(payload));
  return redirectWithMessage(res, kind === "instructor" ? "/instructor" : "/", {
    notice: `Test ${kind} login active.`
  });
}

function hasRoleAccessKeys() {
  return Boolean(studentViewKey || instructorViewKey);
}

function matchesRoleAccessKey(role, providedKey) {
  const expectedKey = role === "instructor" ? instructorViewKey : studentViewKey;
  return Boolean(expectedKey) && String(providedKey || "").trim() === expectedKey;
}

function normalizeMeetingLocation(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }

  if (/^in[\s-]?person$/i.test(value)) {
    return "In person";
  }

  try {
    const url = new URL(value);
    const isHttps = url.protocol === "https:";
    const isUncZoom = url.hostname === "unc.zoom.us" || url.hostname.endsWith(".unc.zoom.us");
    if (isHttps && isUncZoom) {
      return url.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function renderMeetingLocation(location) {
  const value = String(location || "").trim();
  if (!value) {
    return "";
  }

  if (/^https:\/\/(?:[\w-]+\.)*unc\.zoom\.us\//i.test(value)) {
    const safeUrl = escapeHtml(value);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
  }

  return escapeHtml(value);
}

function renderLayout({ title, body, notice = "", error = "" }) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)}</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <main class="page-shell">
        <section class="hero-card">
          <div class="brand-row">
            <div>
              <p class="eyebrow">UNC Office Hours</p>
              <h1>${escapeHtml(queueTitle)}</h1>
            </div>
            <a class="ghost-button" href="/">Home</a>
          </div>
          ${notice ? `<div class="alert success">${escapeHtml(notice)}</div>` : ""}
          ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ""}
          ${body}
        </section>
      </main>
    </body>
  </html>`;
}

function buildRoleSwitchPanel(user) {
  if (!user || (!user.canSwitchRoles && !hasRoleAccessKeys())) {
    return "";
  }

  return `
    <div class="panel">
      <h2>Role switch</h2>
      <p>Signed in as <strong>${escapeHtml(user.userId)}</strong>. Current role: <strong>${escapeHtml(user.role)}</strong>.</p>
      ${
        user.canSwitchRoles
          ? `
            <div class="button-row">
              <form method="post" action="/session/role">
                <input type="hidden" name="role" value="student">
                <button class="secondary-button" type="submit">Use student view</button>
              </form>
              <form method="post" action="/session/role">
                <input type="hidden" name="role" value="instructor">
                <button class="secondary-button" type="submit">Use instructor view</button>
              </form>
            </div>
          `
          : ""
      }
      ${
        hasRoleAccessKeys()
          ? `
            <form class="stack-form" method="post" action="/session/role">
              <label>
                Role
                <select name="role">
                  ${studentViewKey ? '<option value="student">Student view</option>' : ""}
                  ${instructorViewKey ? '<option value="instructor">Instructor view</option>' : ""}
                </select>
              </label>
              <label>
                Access key
                <input name="accessKey" type="password" placeholder="Enter role key" required>
              </label>
              <button class="secondary-button" type="submit">Switch with key</button>
            </form>
          `
          : ""
      }
    </div>
  `;
}

function buildStatusPanel(user, activeEntry) {
  if (!user) {
    return `
      <div class="panel">
        <h2>Sign in</h2>
        <p>This application expects UNC SSO/Shibboleth to authenticate the user before they join the queue.</p>
        ${
          trustProxyAuth
            ? `<p><strong>CloudApps diagnostic:</strong> if this page appears after UNC login, the Shibboleth proxy is likely not forwarding <code>HTTP_UID</code> to the app yet.</p>`
            : ""
        }
        <div class="button-row">
          <a class="primary-button" href="/auth/login">Sign in with UNC SSO</a>
        </div>
      </div>
    `;
  }

  if (activeEntry) {
    const peopleAhead = Math.max(0, Number(activeEntry.queue_position || 1) - 1);
    return `
      <div class="panel">
        <h2>Your place in line</h2>
        <div class="stat-grid">
          <div class="stat-card">
            <span class="stat-label">Position</span>
            <span class="stat-value">#${activeEntry.queue_position}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">Waiting</span>
            <span class="stat-value">${formatDuration(activeEntry.wait_seconds)}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">People ahead</span>
            <span class="stat-value">${peopleAhead}</span>
          </div>
        </div>
        <p>You can only see your own queue position. Other students are not shown.</p>
        <p><strong>${escapeHtml(activeEntry.course_context)}</strong><br>${escapeHtml(activeEntry.help_topic)}</p>
        <p><strong>Location:</strong> ${renderMeetingLocation(activeEntry.meeting_location)}</p>
        <form method="post" action="/queue/leave">
          <button class="secondary-button" type="submit">Leave queue</button>
        </form>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h2>Join the queue</h2>
      <p>Students only see their own position and how many people are ahead of them.</p>
      <form class="stack-form" method="post" action="/queue/join">
        <label>
          Course or section
          <input name="courseContext" maxlength="120" value="STOR113" placeholder="STOR113" required>
        </label>
        <label>
          What do you need help with?
          <textarea name="helpTopic" rows="4" maxlength="500" placeholder="Describe the issue or question." required></textarea>
        </label>
        <label>
          Location
          <input name="meetingLocation" maxlength="500" placeholder="In person or https://unc.zoom.us/j/..." required>
        </label>
        <button class="primary-button" type="submit">Join queue</button>
      </form>
    </div>
  `;
}

function renderHomePage({ user, activeEntry, notice, error }) {
  const signedInCard = user
    ? `
      <div class="panel">
        <h2>Student view</h2>
        <p><strong>${escapeHtml(user.displayName)}</strong><br>${escapeHtml(user.email || user.userId)}</p>
        ${
          user.baseRole && user.baseRole !== user.role
            ? `<p><strong>Role override active:</strong> base role is ${escapeHtml(user.baseRole)}.</p>`
            : ""
        }
      </div>
    `
    : `
      <div class="panel">
        <h2>Authentication</h2>
        <p>UNC SSO should provide the user identity to this app after login.</p>
        ${
          trustProxyAuth
            ? `<p><strong>CloudApps diagnostic:</strong> the public route should be protected by the UNC Shibboleth Proxy and the proxy should forward <code>HTTP_UID</code>.</p>`
            : ""
        }
        <div class="button-row">
          <a class="primary-button" href="/auth/login">Sign in with UNC SSO</a>
        </div>
        ${
          String(process.env.ALLOW_DEV_AUTH || "").toLowerCase() === "true"
            ? `
              <form class="stack-form dev-form" method="post" action="/dev/login">
                <label>
                  Name
                  <input name="displayName" placeholder="Pat Instructor" required>
                </label>
                <label>
                  ONYEN / user id
                  <input name="userId" placeholder="onyen" required>
                </label>
                <label>
                  Email
                  <input name="email" placeholder="onyen@unc.edu" required>
                </label>
                <label>
                  Role
                  <select name="role">
                    <option value="student">Student</option>
                    <option value="instructor">Instructor</option>
                  </select>
                </label>
                <button class="secondary-button" type="submit">Use dev login</button>
              </form>
            `
            : ""
        }
        ${
          testLoginEnabled
            ? `
              <div class="panel inset-panel">
                <h3>Test accounts</h3>
                <p>These accounts bypass UNC SSO and are intended only for controlled testing.</p>
                <p><code>/test-login/student</code> and <code>/test-login/instructor</code> are also available when enabled.</p>
                <div class="button-row">
                  <form method="post" action="/test-login">
                    <input type="hidden" name="kind" value="student">
                    <button class="secondary-button" type="submit">Test student</button>
                  </form>
                  <form method="post" action="/test-login">
                    <input type="hidden" name="kind" value="instructor">
                    <button class="secondary-button" type="submit">Test instructor</button>
                  </form>
                </div>
              </div>
            `
            : ""
        }
      </div>
    `;

  const body = `
    <div class="content-single">
      ${signedInCard}
      ${buildRoleSwitchPanel(user)}
      ${buildStatusPanel(user, activeEntry)}
    </div>
  `;

  return renderLayout({
    title: queueTitle,
    body,
    notice,
    error
  });
}

function renderInstructorPage({ user, activeQueue, dashboard, notice, error }) {
  const queueRows =
    activeQueue.length === 0
      ? '<tr><td colspan="7">No active students in the queue.</td></tr>'
      : activeQueue
          .map(
            (entry, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(entry.student_name)}</td>
                <td>${escapeHtml(entry.course_context)}</td>
                <td>${escapeHtml(entry.help_topic)}</td>
                <td>${renderMeetingLocation(entry.meeting_location)}</td>
                <td>${formatDuration(entry.wait_seconds)}</td>
                <td class="action-cell">
                  <form method="post" action="/instructor/entries/${entry.id}/complete">
                    <button class="primary-button compact-button" type="submit">Mark helped</button>
                  </form>
                  <form method="post" action="/instructor/entries/${entry.id}/cancel">
                    <button class="ghost-button compact-button" type="submit">Remove</button>
                  </form>
                </td>
              </tr>
            `
          )
          .join("");

  const completedRows =
    dashboard.completedToday.length === 0
      ? '<tr><td colspan="6">No completed visits yet today.</td></tr>'
      : dashboard.completedToday
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.student_name)}</td>
                <td>${escapeHtml(entry.course_context)}</td>
                <td>${escapeHtml(entry.help_topic)}</td>
                <td>${renderMeetingLocation(entry.meeting_location)}</td>
                <td>${formatDuration(entry.wait_seconds)}</td>
                <td>${new Date(entry.completed_at).toLocaleTimeString()}</td>
              </tr>
            `
          )
          .join("");

  const body = `
    <div class="panel">
      <h2>Instructor dashboard</h2>
      <p>Signed in as ${escapeHtml(user.displayName)}.</p>
      ${
        user.baseRole && user.baseRole !== user.role
          ? `<p><strong>Role override active:</strong> base role is ${escapeHtml(user.baseRole)}.</p>`
          : ""
      }
    </div>

    ${buildRoleSwitchPanel(user)}

    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-label">Waiting now</span>
        <span class="stat-value">${dashboard.summary.waiting_now}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Helped today</span>
        <span class="stat-value">${dashboard.summary.helped_today}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Avg wait today</span>
        <span class="stat-value">${formatDuration(dashboard.summary.avg_wait_seconds_today)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Longest wait today</span>
        <span class="stat-value">${formatDuration(dashboard.summary.longest_wait_seconds_today)}</span>
      </div>
    </div>

    <div class="panel">
      <h2>Active queue</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Student</th>
            <th>Course</th>
            <th>Help topic</th>
            <th>Location</th>
            <th>Waiting</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${queueRows}</tbody>
      </table>
    </div>

    <div class="panel">
      <h2>Completed today</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Course</th>
            <th>Help topic</th>
            <th>Location</th>
            <th>Wait time</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>${completedRows}</tbody>
      </table>
    </div>
  `;

  return renderLayout({
    title: `${queueTitle} - Instructor`,
    body,
    notice,
    error
  });
}

function redirectWithMessage(res, path, params) {
  const search = new URLSearchParams(params);
  const suffix = search.size ? `?${search.toString()}` : "";
  return res.redirect(`${path}${suffix}`);
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/auth/login", (req, res) => {
  if (req.user) {
    return redirectWithMessage(res, "/", {
      notice: "You are already signed in."
    });
  }

  res.redirect(req.loginUrl);
});

app.get("/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", [clearDevCookie(), clearRoleOverrideCookie()]);
  if (req.user?.authSource === "dev") {
    return redirectWithMessage(res, "/", { notice: "Signed out." });
  }
  res.redirect(req.logoutUrl);
});

app.post("/session/role", requireAuth, (req, res) => {
  const role = req.body.role === "instructor" ? "instructor" : "student";
  const allowedByIdentity = Boolean(req.user?.canSwitchRoles);
  const allowedByKey = matchesRoleAccessKey(role, req.body.accessKey);

  if (!allowedByIdentity && !allowedByKey) {
    return redirectWithMessage(res, req.user?.role === "instructor" ? "/instructor" : "/", {
      error: "Role switching is not allowed for this account or the access key was invalid."
    });
  }

  res.setHeader("Set-Cookie", serializeRoleOverride(role));
  return redirectWithMessage(res, role === "instructor" ? "/instructor" : "/", {
    notice: `Role switched to ${role}.`
  });
});

app.post("/dev/login", (req, res) => {
  if (String(process.env.ALLOW_DEV_AUTH || "").toLowerCase() !== "true") {
    return res.status(404).send("Dev auth is disabled.");
  }

  const payload = {
    displayName: req.body.displayName,
    email: req.body.email,
    role: req.body.role,
    userId: req.body.userId
  };

  res.setHeader("Set-Cookie", serializeDevCookie(payload));
  return redirectWithMessage(res, "/", { notice: "Dev login active." });
});

app.post("/test-login", (req, res) => {
  if (!testLoginEnabled) {
    return res.status(404).send("Test login is disabled.");
  }

  const kind = req.body.kind === "instructor" ? "instructor" : "student";
  return activateTestLogin(res, kind);
});

app.get("/test-login/student", (_req, res) => {
  if (!testLoginEnabled) {
    return res.status(404).send("Test login is disabled.");
  }

  return activateTestLogin(res, "student");
});

app.get("/test-login/instructor", (_req, res) => {
  if (!testLoginEnabled) {
    return res.status(404).send("Test login is disabled.");
  }

  return activateTestLogin(res, "instructor");
});

app.get("/", async (req, res, next) => {
  try {
    if (req.user?.role === "instructor") {
      return res.redirect("/instructor");
    }

    const activeEntry = req.user ? await getStudentActiveEntry(req.user.userId) : null;

    res.send(
      renderHomePage({
        user: req.user,
        activeEntry,
        notice: req.query.notice,
        error: req.query.error
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/queue/join", requireAuth, async (req, res, next) => {
  const courseContext = String(req.body.courseContext || "").trim();
  const helpTopic = String(req.body.helpTopic || "").trim();
  const meetingLocation = normalizeMeetingLocation(req.body.meetingLocation);

  if (!courseContext || !helpTopic || !meetingLocation) {
    return redirectWithMessage(res, "/", {
      error: "Course, help topic, and a location of either In person or a valid UNC Zoom link are required."
    });
  }

  try {
    await joinQueue({
      studentId: req.user.userId,
      studentName: req.user.displayName,
      studentEmail: req.user.email,
      courseContext,
      helpTopic,
      meetingLocation
    });

    return redirectWithMessage(res, "/", { notice: "You joined the queue." });
  } catch (error) {
    if (error?.code === "23505") {
      return redirectWithMessage(res, "/", {
        error: "You already have an active queue entry."
      });
    }
    next(error);
  }
});

app.post("/queue/leave", requireAuth, async (req, res, next) => {
  try {
    await leaveQueue(req.user.userId);
    return redirectWithMessage(res, "/", { notice: "You left the queue." });
  } catch (error) {
    next(error);
  }
});

app.get("/instructor", requireInstructor, async (req, res, next) => {
  try {
    const [activeQueue, dashboard] = await Promise.all([getActiveQueue(), getDashboardStats()]);
    res.send(
      renderInstructorPage({
        user: req.user,
        activeQueue,
        dashboard,
        notice: req.query.notice,
        error: req.query.error
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/entries/:entryId/complete", requireInstructor, async (req, res, next) => {
  try {
    await completeEntry(req.params.entryId);
    return redirectWithMessage(res, "/instructor", { notice: "Queue entry marked complete." });
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/entries/:entryId/cancel", requireInstructor, async (req, res, next) => {
  try {
    await cancelEntry(req.params.entryId);
    return redirectWithMessage(res, "/instructor", { notice: "Queue entry removed." });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).send(
    renderLayout({
      title: "Application error",
      body: `
        <div class="panel">
          <h2>Application error</h2>
          <p>The request could not be completed.</p>
          <p><strong>Base URL:</strong> ${escapeHtml(getExternalBaseUrl(req))}</p>
        </div>
      `,
      error: error.message || "Unknown error."
    })
  );
});

async function start() {
  await initDb();
  app.listen(port, () => {
    console.log(`Student queue listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start application", error);
  process.exit(1);
});
