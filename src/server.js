const express = require("express");
const {
  attachUser,
  clearDevCookie,
  getExternalBaseUrl,
  requireAuth,
  requireInstructor,
  serializeDevCookie
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

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(attachUser);

const queueTitle = process.env.QUEUE_TITLE || "Student Queue";

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

function buildStatusPanel(user, activeEntry) {
  if (!user) {
    return `
      <div class="panel">
        <h2>Sign in</h2>
        <p>This application expects UNC SSO/Shibboleth to authenticate the user before they join the queue.</p>
        <div class="button-row">
          <a class="primary-button" href="/auth/login">Sign in with UNC SSO</a>
        </div>
      </div>
    `;
  }

  if (activeEntry) {
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
        </div>
        <p><strong>${escapeHtml(activeEntry.course_context)}</strong><br>${escapeHtml(activeEntry.help_topic)}</p>
        <form method="post" action="/queue/leave">
          <button class="secondary-button" type="submit">Leave queue</button>
        </form>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h2>Join the queue</h2>
      <form class="stack-form" method="post" action="/queue/join">
        <label>
          Course or section
          <input name="courseContext" maxlength="120" placeholder="COMP 423 - Section 001" required>
        </label>
        <label>
          What do you need help with?
          <textarea name="helpTopic" rows="4" maxlength="500" placeholder="Describe the issue or question." required></textarea>
        </label>
        <button class="primary-button" type="submit">Join queue</button>
      </form>
    </div>
  `;
}

function buildQueueList(activeQueue) {
  if (activeQueue.length === 0) {
    return `<div class="panel"><h2>Live queue</h2><p>No one is waiting right now.</p></div>`;
  }

  const items = activeQueue
    .map(
      (entry, index) => `
        <li class="queue-item">
          <div>
            <p class="queue-name">#${index + 1} ${escapeHtml(entry.student_name)}</p>
            <p class="queue-meta">${escapeHtml(entry.course_context)} · ${escapeHtml(entry.help_topic)}</p>
          </div>
          <span class="pill">${formatDuration(entry.wait_seconds)}</span>
        </li>
      `
    )
    .join("");

  return `
    <div class="panel">
      <h2>Live queue</h2>
      <ul class="queue-list">${items}</ul>
    </div>
  `;
}

function buildInstructorPanel(user) {
  if (user?.role !== "instructor") {
    return "";
  }

  return `
    <div class="panel">
      <h2>Instructor controls</h2>
      <p>Signed in as ${escapeHtml(user.displayName)}.</p>
      <div class="button-row">
        <a class="primary-button" href="/instructor">Open dashboard</a>
      </div>
    </div>
  `;
}

function renderHomePage({ user, activeEntry, activeQueue, notice, error }) {
  const signedInCard = user
    ? `
      <div class="panel">
        <h2>Signed in</h2>
        <p><strong>${escapeHtml(user.displayName)}</strong><br>${escapeHtml(user.email || user.userId)}</p>
        <div class="button-row">
          ${user.role === "instructor" ? '<a class="ghost-button" href="/instructor">Instructor dashboard</a>' : ""}
          <a class="ghost-button" href="/auth/logout">Sign out</a>
        </div>
      </div>
    `
    : `
      <div class="panel">
        <h2>Authentication</h2>
        <p>UNC SSO should provide the user identity to this app after login.</p>
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
      </div>
    `;

  const body = `
    <div class="content-grid">
      <div class="content-stack">
        ${signedInCard}
        ${buildStatusPanel(user, activeEntry)}
        ${buildInstructorPanel(user)}
      </div>
      <div class="content-stack">
        ${buildQueueList(activeQueue)}
      </div>
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
      ? '<tr><td colspan="6">No active students in the queue.</td></tr>'
      : activeQueue
          .map(
            (entry, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(entry.student_name)}</td>
                <td>${escapeHtml(entry.course_context)}</td>
                <td>${escapeHtml(entry.help_topic)}</td>
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
      ? '<tr><td colspan="5">No completed visits yet today.</td></tr>'
      : dashboard.completedToday
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.student_name)}</td>
                <td>${escapeHtml(entry.course_context)}</td>
                <td>${escapeHtml(entry.help_topic)}</td>
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
      <div class="button-row">
        <a class="ghost-button" href="/">Student view</a>
        <a class="ghost-button" href="/auth/logout">Sign out</a>
      </div>
    </div>

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
  res.redirect(req.loginUrl);
});

app.get("/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", clearDevCookie());
  if (req.user?.authSource === "dev") {
    return redirectWithMessage(res, "/", { notice: "Signed out." });
  }
  res.redirect(req.logoutUrl);
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

app.get("/", async (req, res, next) => {
  try {
    const [activeQueue, activeEntry] = await Promise.all([
      getActiveQueue(),
      req.user ? getStudentActiveEntry(req.user.userId) : Promise.resolve(null)
    ]);

    res.send(
      renderHomePage({
        user: req.user,
        activeEntry,
        activeQueue,
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

  if (!courseContext || !helpTopic) {
    return redirectWithMessage(res, "/", { error: "Course and help topic are required." });
  }

  try {
    await joinQueue({
      studentId: req.user.userId,
      studentName: req.user.displayName,
      studentEmail: req.user.email,
      courseContext,
      helpTopic
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
