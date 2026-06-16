const express = require("express");
const {
  attachUser,
  clearDevCookie,
  clearRoleOverrideCookie,
  getExternalBaseUrl,
  requireAuth,
  serializeDevCookie,
  serializeRoleOverride
} = require("./auth");
const { initDb } = require("./db");
const { sendQueueJoinNotification } = require("./emailService");
const {
  cancelEntry,
  completeEntry,
  getActiveQueue,
  getDashboardStats,
  getStudentActiveEntry,
  joinQueue,
  leaveQueue
} = require("./queueService");
const { buildQueueTitle, getStudentCourseName, getStudentCourseNames, setStudentCourseName } = require("./settingsService");
const {
  addCourseTa,
  getCourseTas,
  getNotificationEmailsForCourse,
  getTaCoursesForUser,
  groupTasByCourse,
  removeCourseTa
} = require("./taService");
const { escapeHtml, formatDuration } = require("./utils");

const app = express();
const port = Number(process.env.PORT || 3000);
const trustProxyAuth = String(process.env.TRUST_PROXY_AUTH || "").toLowerCase() === "true";

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(attachUser);

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

async function resolveInstructorAccess(user) {
  if (!user) {
    return null;
  }

  if (user.canSwitchRoles) {
    return { courseNames: null, isAdmin: true, isTa: false };
  }

  if (user.role === "instructor") {
    return { courseNames: null, isAdmin: false, isTa: false };
  }

  const courseNames = await getTaCoursesForUser(user.userId, user.email);
  if (courseNames.length > 0) {
    return { courseNames, isAdmin: false, isTa: true };
  }

  return null;
}

async function requireInstructorAccess(req, res, next) {
  if (!req.user) {
    return redirectWithMessage(res, "/auth/login", {
      error: "Please sign in with UNC SSO first."
    });
  }

  try {
    const access = await resolveInstructorAccess(req.user);
    if (!access) {
      return res.status(403).send(
        renderLayout({
          title: "Access denied",
          body: `
            <div class="panel">
              <h2>Access denied</h2>
              <p>Your account is not configured as an instructor, TA, or role switcher.</p>
            </div>
          `
        })
      );
    }

    req.instructorAccess = access;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCourseAdmin(req, res, next) {
  if (!req.instructorAccess?.isAdmin) {
    return redirectWithMessage(res, "/instructor", {
      error: "Only role switchers can change course choices and TA assignments."
    });
  }

  return next();
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

function icon(name) {
  const icons = {
    activity: '<path d="M3 12h4l3 7 4-14 3 7h4"></path>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path>',
    mail: '<path d="M4 6h16v12H4z"></path><path d="m4 7 8 6 8-6"></path>',
    timer: '<path d="M10 2h4"></path><path d="M12 14l3-3"></path><circle cx="12" cy="14" r="8"></circle>',
    user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 22c1.5-4 4.5-6 8-6s6.5 2 8 6"></path>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
  };
  const body = icons[name] || icons.activity;
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function renderBrandHeader({ title, courseNames = [] }) {
  const courses = Array.isArray(courseNames) ? courseNames.filter(Boolean) : [];
  const hasCourses = courses.length > 0;
  const displayTitle = hasCourses ? "Office Hours Queue" : title;
  const subtitle = hasCourses
    ? `${courses.length} course${courses.length === 1 ? "" : "s"} connected to the live queue`
    : "UNC office hours queue";

  const courseDirectory = hasCourses
    ? `
      <nav class="course-directory" aria-label="Courses in this queue">
        <span class="course-directory-label">Courses</span>
        <div class="course-directory-list">
          ${courses.map((courseName) => `<span class="course-chip">${escapeHtml(courseName)}</span>`).join("")}
        </div>
      </nav>
    `
    : "";

  return `
    <header class="app-header">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img src="/unc-stor-logo.png" alt="">
        </div>
        <div class="brand-copy">
          <p class="eyebrow">UNC Statistics &amp; Operations Research</p>
          <h1>${escapeHtml(displayTitle)}</h1>
          <p class="hero-subtitle">${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <a class="ghost-button" href="/">${icon("layers")} Home</a>
      ${courseDirectory}
    </header>
  `;
}

function renderLayout({ title, body, courseNames = [], notice = "", error = "" }) {
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
          ${renderBrandHeader({ title, courseNames })}
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

function buildStatusPanel(user, activeEntry, studentCourseNames) {
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
          <select name="courseContext" required>
            ${studentCourseNames
              .map((courseName) => `<option value="${escapeHtml(courseName)}">${escapeHtml(courseName)}</option>`)
              .join("")}
          </select>
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

function renderHomePage({ user, activeEntry, studentCourseNames, notice, error }) {
  const title = buildQueueTitle(studentCourseNames);
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
      ${buildStatusPanel(user, activeEntry, studentCourseNames)}
    </div>
  `;

  return renderLayout({
    title,
    body,
    courseNames: studentCourseNames,
    notice,
    error
  });
}

function buildCourseSettingsPanel(studentCourseName) {
  return `
    <div class="panel">
      <h2>Student course choices</h2>
      <p>Students choose from this list when joining the queue. Separate courses with commas or spaces.</p>
      <form class="stack-form" method="post" action="/instructor/settings/course-name">
        <label>
          Courses
          <input name="courseName" maxlength="500" value="${escapeHtml(studentCourseName)}" required>
        </label>
        <button class="secondary-button" type="submit">Update course choices</button>
      </form>
    </div>
  `;
}

function buildTaManagementPanel(studentCourseNames, courseTasByCourse) {
  const courseCards = studentCourseNames
    .map((courseName) => {
      const tas = courseTasByCourse.get(courseName) || [];
      const rows =
        tas.length === 0
          ? '<tr><td colspan="4">No TAs assigned to this course yet.</td></tr>'
          : tas
              .map(
                (ta) => `
                  <tr>
                    <td>${escapeHtml(ta.ta_identifier)}</td>
                    <td>${escapeHtml(ta.ta_email)}</td>
                    <td>${ta.notify_email ? "Yes" : "No"}</td>
                    <td class="action-cell">
                      <form method="post" action="/instructor/tas/${ta.id}/remove">
                        <button class="ghost-button compact-button" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                `
              )
              .join("");

      return `
        <div class="course-admin-card">
          <h3>${escapeHtml(courseName)}</h3>
          <table class="data-table compact-table">
            <thead>
              <tr>
                <th>TA</th>
                <th>Email</th>
                <th>Email notifications</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <form class="stack-form ta-form" method="post" action="/instructor/tas">
            <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
            <label>
              TA ONYEN or email
              <input name="taIdentifier" maxlength="120" placeholder="onyen or onyen@unc.edu" required>
            </label>
            <label>
              TA email
              <input name="taEmail" type="email" maxlength="200" placeholder="optional; defaults to ONYEN@unc.edu">
            </label>
            <label class="checkbox-label">
              <input name="notifyEmail" type="checkbox" value="true" checked>
              Send email notifications to this TA
            </label>
            <button class="secondary-button" type="submit">Add TA</button>
          </form>
        </div>
      `;
    })
    .join("");

  return `
    <div class="panel">
      <h2>Course TAs</h2>
      <p>Add TAs by course. TAs can see their assigned course queues, and the checkbox controls queue-join email notifications.</p>
      <div class="course-admin-grid">${courseCards}</div>
    </div>
  `;
}

function normalizeQueueView(value) {
  return value === "course" ? "course" : "unified";
}

function getInstructorCourseOrder(activeQueue, studentCourseNames, instructorAccess) {
  const configuredCourses = instructorAccess.courseNames || studentCourseNames;
  const ordered = configuredCourses.filter(Boolean);
  const seen = new Set(ordered);

  for (const entry of activeQueue) {
    if (!seen.has(entry.course_context)) {
      ordered.push(entry.course_context);
      seen.add(entry.course_context);
    }
  }

  return ordered;
}

function buildActiveQueueRows(entries, startIndex = 0) {
  return entries
    .map(
      (entry, index) => `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td>${escapeHtml(entry.student_name)}</td>
          <td>${escapeHtml(entry.course_context)}</td>
          <td>${escapeHtml(entry.help_topic)}</td>
          <td>${renderMeetingLocation(entry.meeting_location)}</td>
          <td>${formatDuration(entry.wait_seconds)}</td>
          <td class="action-cell">
            <form method="post" action="/instructor/entries/${entry.id}/complete">
              <button class="primary-button compact-button" type="submit">${icon("check")} Mark helped</button>
            </form>
            <form method="post" action="/instructor/entries/${entry.id}/cancel">
              <button class="ghost-button compact-button" type="submit">${icon("x")} Remove</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("");
}

function buildActiveQueueTable(entries, { emptyMessage, startIndex = 0 } = {}) {
  const rows =
    entries.length === 0
      ? `<tr><td colspan="7">${escapeHtml(emptyMessage || "No active students in the queue.")}</td></tr>`
      : buildActiveQueueRows(entries, startIndex);

  return `
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
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildQueueViewToggle(queueView) {
  return `
    <div class="view-toggle" aria-label="Queue view">
      <a class="${queueView === "unified" ? "active" : ""}" href="/instructor?queueView=unified">Joined time</a>
      <a class="${queueView === "course" ? "active" : ""}" href="/instructor?queueView=course">By course</a>
    </div>
  `;
}

function buildActiveQueuePanel({ activeQueue, studentCourseNames, instructorAccess, queueView }) {
  if (queueView === "course") {
    const courseOrder = getInstructorCourseOrder(activeQueue, studentCourseNames, instructorAccess);
    const grouped = new Map(courseOrder.map((courseName) => [courseName, []]));

    for (const entry of activeQueue) {
      if (!grouped.has(entry.course_context)) {
        grouped.set(entry.course_context, []);
      }
      grouped.get(entry.course_context).push(entry);
    }

    const courseSections = Array.from(grouped.entries())
      .map(([courseName, entries]) => `
        <section class="queue-course-section">
          <div class="course-section-heading">
            <h3>${escapeHtml(courseName)}</h3>
            <span class="pill">${entries.length} waiting</span>
          </div>
          ${buildActiveQueueTable(entries, {
            emptyMessage: "No active students for this course."
          })}
        </section>
      `)
      .join("");

    return `
      <div class="panel">
        <div class="panel-heading-row">
          <h2>Active queue</h2>
          ${buildQueueViewToggle(queueView)}
        </div>
        <div class="course-queue-stack">${courseSections}</div>
      </div>
    `;
  }

  return `
    <div class="panel">
      <div class="panel-heading-row">
        <h2>Active queue</h2>
        ${buildQueueViewToggle(queueView)}
      </div>
      ${buildActiveQueueTable(activeQueue)}
    </div>
  `;
}

function numberValue(value) {
  return Number(value || 0);
}

function formatStatDuration(value) {
  const seconds = numberValue(value);
  return seconds > 0 ? formatDuration(seconds) : "0m";
}

function buildMetricCard({ detail, iconName, label, tone = "", value }) {
  return `
    <div class="stat-card ${tone}">
      <span class="stat-icon">${icon(iconName)}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(String(value))}</span>
      ${detail ? `<span class="stat-detail">${escapeHtml(detail)}</span>` : ""}
    </div>
  `;
}

function buildDashboardStatsPanel(dashboard) {
  const summary = dashboard.summary || {};
  return `
    <div class="stat-grid dashboard-stat-grid">
      ${buildMetricCard({
        detail: `${numberValue(summary.active_courses_now)} active course${numberValue(summary.active_courses_now) === 1 ? "" : "s"}`,
        iconName: "user",
        label: "Waiting now",
        tone: "stat-accent",
        value: numberValue(summary.waiting_now)
      })}
      ${buildMetricCard({
        detail: "current active queue",
        iconName: "clock",
        label: "Avg active wait",
        value: formatStatDuration(summary.avg_wait_seconds_now)
      })}
      ${buildMetricCard({
        detail: "current active queue",
        iconName: "timer",
        label: "Longest active wait",
        tone: numberValue(summary.longest_wait_seconds_now) >= 1800 ? "stat-warning" : "",
        value: formatStatDuration(summary.longest_wait_seconds_now)
      })}
      ${buildMetricCard({
        detail: `${numberValue(summary.left_today)} left today`,
        iconName: "check",
        label: "Helped today",
        tone: "stat-success",
        value: numberValue(summary.helped_today)
      })}
      ${buildMetricCard({
        detail: "completed visits",
        iconName: "activity",
        label: "Avg helped wait",
        value: formatStatDuration(summary.avg_wait_seconds_today)
      })}
      ${buildMetricCard({
        detail: "completed visits",
        iconName: "layers",
        label: "Longest helped wait",
        value: formatStatDuration(summary.longest_wait_seconds_today)
      })}
    </div>
  `;
}

function buildCourseStatsPanel({ dashboard, studentCourseNames, instructorAccess }) {
  const courseOrder = getInstructorCourseOrder([], studentCourseNames, instructorAccess);
  const statsByCourse = new Map((dashboard.courseStats || []).map((row) => [row.course_context, row]));
  const rows = courseOrder.map((courseName) => {
    const stats = statsByCourse.get(courseName) || {};
    return {
      courseName,
      avgWaitNow: numberValue(stats.avg_wait_seconds_now),
      avgWaitToday: numberValue(stats.avg_wait_seconds_today),
      helpedToday: numberValue(stats.helped_today),
      leftToday: numberValue(stats.left_today),
      longestWaitNow: numberValue(stats.longest_wait_seconds_now),
      waitingNow: numberValue(stats.waiting_now)
    };
  });

  if (rows.length === 0) {
    return "";
  }

  return `
    <div class="panel">
      <div class="panel-heading-row">
        <div>
          <p class="section-kicker">Course snapshot</p>
          <h2>Queue by course</h2>
        </div>
      </div>
      <div class="course-metrics-grid">
        ${rows
          .map(
            (stats) => `
              <article class="course-metric-card">
                <div class="course-metric-heading">
                  <span class="course-icon">${icon("book")}</span>
                  <h3>${escapeHtml(stats.courseName)}</h3>
                </div>
                <div class="course-metric-values">
                  <span><strong>${stats.waitingNow}</strong> waiting</span>
                  <span><strong>${formatStatDuration(stats.avgWaitNow)}</strong> avg now</span>
                  <span><strong>${formatStatDuration(stats.longestWaitNow)}</strong> longest now</span>
                  <span><strong>${stats.helpedToday}</strong> helped</span>
                  <span><strong>${stats.leftToday}</strong> left</span>
                  <span><strong>${formatStatDuration(stats.avgWaitToday)}</strong> avg helped</span>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderInstructorPage({
  user,
  activeQueue,
  dashboard,
  studentCourseName,
  studentCourseNames,
  instructorAccess,
  courseTasByCourse,
  queueView,
  notice,
  error
}) {
  const title = buildQueueTitle(studentCourseNames);
  const visibleCourses = getInstructorCourseOrder(activeQueue, studentCourseNames, instructorAccess);
  const roleLabel = instructorAccess.isAdmin ? "Role switcher" : instructorAccess.isTa ? "TA" : "Instructor";

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
    <div class="panel dashboard-hero">
      <div>
        <p class="section-kicker">Instructor dashboard</p>
        <h2>Queue control center</h2>
        <p>Signed in as <strong>${escapeHtml(user.displayName)}</strong>.</p>
      </div>
      <div class="dashboard-chips">
        <span class="chip">${icon("user")} ${escapeHtml(roleLabel)}</span>
        <span class="chip">${icon("book")} ${visibleCourses.length} course${visibleCourses.length === 1 ? "" : "s"}</span>
        <span class="chip">${icon("clock")} ${numberValue(dashboard.summary.waiting_now)} waiting</span>
      </div>
      ${
        user.baseRole && user.baseRole !== user.role
          ? `<p><strong>Role override active:</strong> base role is ${escapeHtml(user.baseRole)}.</p>`
          : ""
      }
    </div>

    ${buildRoleSwitchPanel(user)}

    ${instructorAccess.isAdmin ? buildCourseSettingsPanel(studentCourseName) : ""}
    ${instructorAccess.isAdmin ? buildTaManagementPanel(studentCourseNames, courseTasByCourse) : ""}

    ${buildDashboardStatsPanel(dashboard)}
    ${buildCourseStatsPanel({ dashboard, studentCourseNames, instructorAccess })}

    ${buildActiveQueuePanel({ activeQueue, studentCourseNames, instructorAccess, queueView })}

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
    title,
    body,
    courseNames: studentCourseNames,
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
    const instructorAccess = req.user ? await resolveInstructorAccess(req.user) : null;
    if (instructorAccess && (req.user.role === "instructor" || instructorAccess.isTa)) {
      return res.redirect("/instructor");
    }

    const [activeEntry, studentCourseNames] = await Promise.all([
      req.user ? getStudentActiveEntry(req.user.userId) : null,
      getStudentCourseNames()
    ]);

    res.send(
      renderHomePage({
        user: req.user,
        activeEntry,
        studentCourseNames,
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
    const studentCourseNames = await getStudentCourseNames();
    if (!studentCourseNames.includes(courseContext)) {
      return redirectWithMessage(res, "/", {
        error: "Please choose one of the available courses."
      });
    }

    await joinQueue({
      studentId: req.user.userId,
      studentName: req.user.displayName,
      studentEmail: req.user.email,
      courseContext,
      helpTopic,
      meetingLocation
    });

    const taNotificationEmails = await getNotificationEmailsForCourse(courseContext);
    sendQueueJoinNotification({
      entry: {
        studentId: req.user.userId,
        studentName: req.user.displayName,
        studentEmail: req.user.email,
        courseContext,
        helpTopic,
        meetingLocation
      },
      instructorUrl: `${getExternalBaseUrl(req)}/instructor`,
      extraRecipients: taNotificationEmails
    }).catch((error) => {
      console.error("Failed to send queue join notification", error);
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

app.get("/instructor", requireInstructorAccess, async (req, res, next) => {
  try {
    const instructorAccess = req.instructorAccess;
    const queueView = normalizeQueueView(req.query.queueView);
    const [studentCourseName, studentCourseNames] = await Promise.all([
      getStudentCourseName(),
      getStudentCourseNames()
    ]);
    const [activeQueue, dashboard, courseTas] = await Promise.all([
      getActiveQueue(instructorAccess.courseNames),
      getDashboardStats(instructorAccess.courseNames),
      instructorAccess.isAdmin ? getCourseTas(studentCourseNames) : []
    ]);

    res.send(
      renderInstructorPage({
        user: req.user,
        activeQueue,
        dashboard,
        studentCourseName,
        studentCourseNames,
        instructorAccess,
        courseTasByCourse: groupTasByCourse(courseTas),
        queueView,
        notice: req.query.notice,
        error: req.query.error
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/settings/course-name", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    await setStudentCourseName(req.body.courseName);
    return redirectWithMessage(res, "/instructor", { notice: "Student course choices updated." });
  } catch (error) {
    if (error.message === "At least one course name is required.") {
      return redirectWithMessage(res, "/instructor", { error: error.message });
    }
    next(error);
  }
});

app.post("/instructor/tas", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    await addCourseTa({
      courseName: req.body.courseName,
      taIdentifier: req.body.taIdentifier,
      taEmail: req.body.taEmail,
      notifyEmail: req.body.notifyEmail === "true"
    });

    return redirectWithMessage(res, "/instructor", { notice: "TA assignment saved." });
  } catch (error) {
    if (error.message === "Course, TA identifier, and TA email are required.") {
      return redirectWithMessage(res, "/instructor", { error: error.message });
    }
    next(error);
  }
});

app.post("/instructor/tas/:taId/remove", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    await removeCourseTa(req.params.taId);
    return redirectWithMessage(res, "/instructor", { notice: "TA assignment removed." });
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/entries/:entryId/complete", requireInstructorAccess, async (req, res, next) => {
  try {
    await completeEntry(req.params.entryId, req.instructorAccess.courseNames);
    return redirectWithMessage(res, "/instructor", { notice: "Queue entry marked complete." });
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/entries/:entryId/cancel", requireInstructorAccess, async (req, res, next) => {
  try {
    await cancelEntry(req.params.entryId, req.instructorAccess.courseNames);
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
