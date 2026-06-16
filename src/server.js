const express = require("express");
const multer = require("multer");
const {
  attachUser,
  clearDevCookie,
  clearRoleOverrideCookie,
  getExternalBaseUrl,
  requireAuth,
  serializeDevCookie,
  serializeRoleOverride
} = require("./auth");
const {
  addAllowedStudent,
  allowedStudentsByCourse,
  assignCourseProfessor,
  getAllowedStudentCounts,
  getAllowedStudentById,
  getAllowedStudents,
  getCoursePackage,
  getCourseProfessors,
  getProfessorCoursesFromAssignments,
  getProfessorCoursesForUser,
  getProfessorNotificationEmailsForCourse,
  getRosterSettings,
  importAllowedStudentsFromCsv,
  isStudentAllowedForCourse,
  professorOptions,
  professorsByCourse,
  removeAllowedStudent,
  removeCourseProfessor,
  rosterSettingsByCourse,
  setCourseProfessorNotification,
  setRosterRestriction
} = require("./courseAdminService");
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
  getCourseTaById,
  getCourseTas,
  getNotificationEmailsForCourse,
  getTaCoursesForUser,
  groupTasByCourse,
  removeCourseTa,
  setCourseTaNotification
} = require("./taService");
const { escapeHtml, formatDuration, normalizeUserId } = require("./utils");

const app = express();
const port = Number(process.env.PORT || 3000);
const trustProxyAuth = String(process.env.TRUST_PROXY_AUTH || "").toLowerCase() === "true";

app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(attachUser);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});

const testLoginEnabled = String(process.env.TEST_LOGIN_ENABLED || "").toLowerCase() === "true";
const studentViewKey = String(process.env.STUDENT_VIEW_KEY || "").trim();
const instructorViewKey = String(process.env.INSTRUCTOR_VIEW_KEY || "").trim();

function getTestAccount(kind) {
  if (kind === "instructor") {
    return {
      displayName: process.env.TEST_INSTRUCTOR_NAME || "Test Staff",
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

function getAdministratorIds() {
  const configured = String(process.env.ADMINISTRATOR_IDS || "").trim();
  const values = configured || process.env.ROLE_SWITCH_USERS || "";
  return new Set(
    String(values)
      .split(",")
      .map((value) => normalizeUserId(value))
      .filter(Boolean)
  );
}

function isAdministrator(user) {
  if (!user) {
    return false;
  }

  const administrators = getAdministratorIds();
  return administrators.has(normalizeUserId(user.userId)) || administrators.has(normalizeUserId(user.email));
}

function uniqueCourses(...courseLists) {
  const seen = new Set();
  const courses = [];
  for (const courseList of courseLists) {
    for (const courseName of courseList || []) {
      const normalized = String(courseName || "").trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        courses.push(normalized);
      }
    }
  }
  return courses;
}

async function resolveInstructorAccess(user) {
  if (!user) {
    return null;
  }

  const admin = isAdministrator(user);
  if (admin) {
    return {
      courseNames: null,
      isAdmin: true,
      isProfessor: true,
      isTa: false,
      managedCourseNames: null,
      professorCourseNames: [],
      taCourseNames: []
    };
  }

  const [professorCourseNames, taCourseNames] = await Promise.all([
    getProfessorCoursesForUser(user.userId, user.email),
    getTaCoursesForUser(user.userId, user.email)
  ]);
  const courseNames = uniqueCourses(professorCourseNames, taCourseNames);

  if (courseNames.length > 0) {
    return {
      courseNames,
      isAdmin: false,
      isProfessor: professorCourseNames.length > 0,
      isTa: taCourseNames.length > 0,
      managedCourseNames: professorCourseNames,
      professorCourseNames,
      taCourseNames
    };
  }

  if (user.role === "instructor") {
    return {
      courseNames: null,
      isAdmin: false,
      isProfessor: false,
      isTa: false,
      managedCourseNames: [],
      professorCourseNames: [],
      taCourseNames: []
    };
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
              <p>Your account is not configured as an administrator, professor, or TA.</p>
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
      error: "Only administrators can change course choices and professor assignments."
    });
  }

  return next();
}

function canManageCourse(access, courseName) {
  if (access?.isAdmin) {
    return true;
  }

  const managedCourseNames = access?.managedCourseNames || [];
  return managedCourseNames.includes(String(courseName || "").trim());
}

function requireManagedCourse(req, res, next) {
  if (canManageCourse(req.instructorAccess, req.body.courseName || req.params.courseName)) {
    return next();
  }

  return redirectWithMessage(res, "/instructor", {
    error: "Only administrators and the assigned professor can manage that course."
  });
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
  const isAdminUser = isAdministrator(user);
  if (!user || (!user.canSwitchRoles && !isAdminUser && !hasRoleAccessKeys())) {
    return "";
  }

  return `
    <div class="panel">
      <h2>Role switch</h2>
      <p>Signed in as <strong>${escapeHtml(user.userId)}</strong>. Current role: <strong>${escapeHtml(user.role)}</strong>.</p>
      ${
        user.canSwitchRoles || isAdminUser
          ? `
            <div class="button-row">
              <form method="post" action="/session/role">
                <input type="hidden" name="role" value="student">
                <button class="secondary-button" type="submit">Use student view</button>
              </form>
              <form method="post" action="/session/role">
                <input type="hidden" name="role" value="instructor">
                <button class="secondary-button" type="submit">Use staff view</button>
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
                  ${instructorViewKey ? '<option value="instructor">Staff view</option>' : ""}
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

function normalizeStaffView(value, instructorAccess) {
  if (!instructorAccess?.isAdmin) {
    return "professor";
  }

  return value === "professor" ? "professor" : "administrator";
}

function normalizeSelectedProfessor(value, options = []) {
  const requested = normalizeUserId(value);
  if (requested && options.some((option) => option.professor_identifier === requested)) {
    return requested;
  }

  return options[0]?.professor_identifier || "";
}

function buildInstructorQuery(params = {}) {
  const search = new URLSearchParams();
  if (params.queueView) {
    search.set("queueView", params.queueView);
  }
  if (params.staffView) {
    search.set("staffView", params.staffView);
  }
  if (params.professor) {
    search.set("professor", params.professor);
  }
  const queryString = search.toString();
  return `/instructor${queryString ? `?${queryString}` : ""}`;
}

function buildViewContextFields({ staffView, selectedProfessorIdentifier } = {}) {
  if (staffView !== "professor") {
    return "";
  }

  return `
    <input type="hidden" name="staffView" value="professor">
    <input type="hidden" name="professor" value="${escapeHtml(selectedProfessorIdentifier || "")}">
  `;
}

function buildStaffViewSwitcher({ staffView, professorOptions: options = [], selectedProfessorIdentifier = "", queueView }) {
  const professorHref = buildInstructorQuery({
    staffView: "professor",
    professor: selectedProfessorIdentifier || options[0]?.professor_identifier || "",
    queueView
  });
  const professorSelector =
    staffView === "professor"
      ? `
        <form class="stack-form compact-selector" method="get" action="/instructor">
          <input type="hidden" name="staffView" value="professor">
          <input type="hidden" name="queueView" value="${escapeHtml(queueView || "unified")}">
          <label>
            Professor
            <select name="professor" ${options.length === 0 ? "disabled" : ""}>
              ${
                options.length === 0
                  ? '<option value="">No professors assigned yet</option>'
                  : options
                      .map(
                        (option) => `
                          <option value="${escapeHtml(option.professor_identifier)}" ${
                            option.professor_identifier === selectedProfessorIdentifier ? "selected" : ""
                          }>
                            ${escapeHtml(option.professor_identifier)} (${option.courseNames.length} course${option.courseNames.length === 1 ? "" : "s"})
                          </option>
                        `
                      )
                      .join("")
              }
            </select>
          </label>
          <button class="secondary-button compact-button" type="submit">View professor</button>
        </form>
      `
      : "";

  return `
    <div class="panel">
      <div class="panel-heading-row">
        <div>
          <p class="section-kicker">Administrator views</p>
          <h2>Choose working view</h2>
        </div>
        <span class="chip">${icon("user")} Administrator</span>
      </div>
      <div class="view-toggle staff-view-toggle" aria-label="Administrator view">
        <a href="/?view=student">Student view</a>
        <a class="${staffView === "administrator" ? "active" : ""}" href="${buildInstructorQuery({ staffView: "administrator", queueView })}">Administrator view</a>
        <a class="${staffView === "professor" ? "active" : ""}" href="${professorHref}">Professor view</a>
      </div>
      ${professorSelector}
      <p class="queue-meta">Administrator view includes course setup, professor assignment, exports, TA management, and roster rules. Professor view shows the course-level tools a professor uses.</p>
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
        <form method="post" action="/queue/leave?view=student">
          <button class="secondary-button" type="submit">Leave queue</button>
        </form>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h2>Join the queue</h2>
      <p>Students only see their own position and how many people are ahead of them.</p>
      <form class="stack-form" method="post" action="/queue/join?view=student">
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
                  <input name="displayName" placeholder="Pat Professor" required>
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
                    <option value="instructor">Staff</option>
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
                <p>Student and staff test-login routes are available when enabled.</p>
                <div class="button-row">
                  <form method="post" action="/test-login">
                    <input type="hidden" name="kind" value="student">
                    <button class="secondary-button" type="submit">Test student</button>
                  </form>
                  <form method="post" action="/test-login">
                    <input type="hidden" name="kind" value="instructor">
                    <button class="secondary-button" type="submit">Test staff</button>
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

function buildProfessorAssignmentPanel(studentCourseNames, courseProfessorsByCourse) {
  const courseCards = studentCourseNames
    .map((courseName) => {
      const professors = courseProfessorsByCourse.get(courseName) || [];
      const professorSummary =
        professors.length > 0
          ? `${professors.length} professor${professors.length === 1 ? "" : "s"}`
          : "No professor";
      const professorRows =
        professors.length === 0
          ? '<tr><td colspan="4">No professors assigned to this course yet.</td></tr>'
          : professors
              .map(
                (professor) => `
                  <tr>
                    <td>${escapeHtml(professor.professor_identifier)}</td>
                    <td>${escapeHtml(professor.professor_email)}</td>
                    <td>${professor.notify_email ? "Yes" : "No"}</td>
                    <td class="action-cell">
                      <form method="post" action="/instructor/professors/remove">
                        <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
                        <input type="hidden" name="professorIdentifier" value="${escapeHtml(professor.professor_identifier)}">
                        <button class="ghost-button compact-button" type="submit">${icon("x")} Remove</button>
                      </form>
                    </td>
                  </tr>
                `
              )
              .join("");
      return `
        <details class="course-admin-card collapsible-course">
          <summary>
            <span class="summary-title">${escapeHtml(courseName)}</span>
            <span class="summary-meta">${escapeHtml(professorSummary)}</span>
          </summary>
          <div class="collapsible-body">
            <div class="panel-heading-row">
              <div>
                <h3>${escapeHtml(courseName)}</h3>
                <p class="queue-meta">${professorSummary}</p>
              </div>
              <a class="secondary-button compact-button" href="/instructor/courses/${encodeURIComponent(courseName)}/export">${icon("layers")} Export DB package</a>
            </div>
            <table class="data-table compact-table">
              <thead>
                <tr>
                  <th>Professor</th>
                  <th>Email</th>
                  <th>Email notifications</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${professorRows}</tbody>
            </table>
            <form class="stack-form ta-form" method="post" action="/instructor/professors">
              <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
              <label>
                Professor ONYEN or email
                <input name="professorIdentifier" maxlength="120" placeholder="onyen or onyen@unc.edu" required>
              </label>
              <label>
                Professor email
                <input name="professorEmail" type="email" maxlength="200" placeholder="optional; defaults to ONYEN@unc.edu">
              </label>
              <label class="checkbox-label">
                <input name="notifyEmail" type="checkbox" value="true" checked>
                Send email notifications to this professor
              </label>
              <button class="secondary-button" type="submit">Add professor</button>
            </form>
          </div>
        </details>
      `;
    })
    .join("");

  return `
    <div class="panel">
      <h2>Course professors</h2>
      <p>Administrators can assign multiple professors to each course.</p>
      <div class="course-admin-grid">${courseCards}</div>
    </div>
  `;
}

function buildProfessorNotificationPanel({
  user,
  instructorAccess,
  managedCourseNames,
  courseProfessorsByCourse,
  staffView,
  selectedProfessorIdentifier
}) {
  const targetIdentifier =
    instructorAccess.isAdmin && staffView === "professor"
      ? selectedProfessorIdentifier
      : normalizeUserId(user?.userId || user?.email);

  if (!targetIdentifier || managedCourseNames.length === 0) {
    return "";
  }

  const rows = managedCourseNames
    .map((courseName) => {
      const professor = (courseProfessorsByCourse.get(courseName) || []).find(
        (assignment) => assignment.professor_identifier === targetIdentifier
      );
      if (!professor) {
        return "";
      }

      const contextFields = buildViewContextFields({ staffView, selectedProfessorIdentifier });
      return `
        <tr>
          <td>${escapeHtml(courseName)}</td>
          <td>${escapeHtml(professor.professor_email)}</td>
          <td>${professor.notify_email ? "Yes" : "No"}</td>
          <td class="action-cell">
            <form method="post" action="/instructor/professors/notifications">
              ${contextFields}
              <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
              <input type="hidden" name="professorIdentifier" value="${escapeHtml(professor.professor_identifier)}">
              <label class="checkbox-label">
                <input name="notifyEmail" type="checkbox" value="true" ${professor.notify_email ? "checked" : ""}>
                Receive join emails
              </label>
              <button class="secondary-button compact-button" type="submit">Save</button>
            </form>
          </td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join("");

  if (!rows) {
    return "";
  }

  return `
    <div class="panel">
      <h2>Professor email notifications</h2>
      <p>Choose whether this professor receives an email when a student joins the queue for each assigned course.</p>
      <table class="data-table compact-table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Email</th>
            <th>Receiving emails</th>
            <th>Preference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildTaNotificationPanel({ user, taCourseNames, courseTasByCourse, staffView, selectedProfessorIdentifier }) {
  const identifiers = new Set([normalizeUserId(user?.userId), normalizeUserId(user?.email)].filter(Boolean));
  if (identifiers.size === 0 || taCourseNames.length === 0) {
    return "";
  }

  const rows = taCourseNames
    .map((courseName) => {
      const ta = (courseTasByCourse.get(courseName) || []).find((assignment) =>
        identifiers.has(assignment.ta_identifier) || identifiers.has(normalizeUserId(assignment.ta_email))
      );
      if (!ta) {
        return "";
      }

      const contextFields = buildViewContextFields({ staffView, selectedProfessorIdentifier });
      return `
        <tr>
          <td>${escapeHtml(courseName)}</td>
          <td>${escapeHtml(ta.ta_email)}</td>
          <td>${ta.notify_email ? "Yes" : "No"}</td>
          <td class="action-cell">
            <form method="post" action="/instructor/tas/notifications">
              ${contextFields}
              <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
              <input type="hidden" name="taIdentifier" value="${escapeHtml(ta.ta_identifier)}">
              <label class="checkbox-label">
                <input name="notifyEmail" type="checkbox" value="true" ${ta.notify_email ? "checked" : ""}>
                Receive join emails
              </label>
              <button class="secondary-button compact-button" type="submit">Save</button>
            </form>
          </td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join("");

  if (!rows) {
    return "";
  }

  return `
    <div class="panel">
      <h2>TA email notifications</h2>
      <p>Choose whether you receive an email when a student joins the queue for each course where you are assigned as a TA.</p>
      <table class="data-table compact-table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Email</th>
            <th>Receiving emails</th>
            <th>Preference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildTaManagementPanel(managedCourseNames, courseTasByCourse, viewContext = {}) {
  if (managedCourseNames.length === 0) {
    return "";
  }

  const contextFields = buildViewContextFields(viewContext);
  const courseCards = managedCourseNames
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
                        ${contextFields}
                        <button class="ghost-button compact-button" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                `
              )
              .join("");

      return `
        <details class="course-admin-card collapsible-course">
          <summary>
            <span class="summary-title">${escapeHtml(courseName)}</span>
            <span class="summary-meta">${tas.length} TA${tas.length === 1 ? "" : "s"}</span>
          </summary>
          <div class="collapsible-body">
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
              ${contextFields}
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
        </details>
      `;
    })
    .join("");

  return `
    <div class="panel">
      <h2>Course TAs</h2>
      <p>Professors can add TAs for their courses. Administrators can manage TAs for every course.</p>
      <div class="course-admin-grid">${courseCards}</div>
    </div>
  `;
}

function buildRosterManagementPanel(managedCourseNames, rosterSettingsByCourseMap, allowedStudentCounts, allowedStudentsByCourseMap, viewContext = {}) {
  if (managedCourseNames.length === 0) {
    return "";
  }

  const contextFields = buildViewContextFields(viewContext);
  const courseCards = managedCourseNames
    .map((courseName) => {
      const settings = rosterSettingsByCourseMap.get(courseName);
      const restrictToRoster = Boolean(settings?.restrict_to_roster);
      const allowedStudents = allowedStudentsByCourseMap.get(courseName) || [];
      const allowedCount = allowedStudentCounts.get(courseName) || 0;
      const previewRows =
        allowedStudents.length === 0
          ? '<tr><td colspan="4">No allowed students imported yet.</td></tr>'
          : allowedStudents
              .slice(0, 12)
              .map(
                (student) => `
                  <tr>
                    <td>${escapeHtml(student.student_identifier)}</td>
                    <td>${escapeHtml(student.student_name || "")}</td>
                    <td>${escapeHtml(student.student_email || "")}</td>
                    <td class="action-cell">
                      <form method="post" action="/instructor/rosters/students/${student.id}/remove">
                        ${contextFields}
                        <button class="ghost-button compact-button" type="submit">${icon("x")} Remove</button>
                      </form>
                    </td>
                  </tr>
                `
              )
              .join("");
      const rosterSummary = restrictToRoster
        ? `${allowedCount} allowed, restricted`
        : `${allowedCount} allowed, open`;

      return `
        <details class="course-admin-card collapsible-course">
          <summary>
            <span class="summary-title">${escapeHtml(courseName)}</span>
            <span class="summary-meta">${escapeHtml(rosterSummary)}</span>
          </summary>
          <div class="collapsible-body">
            <div class="panel-heading-row">
              <div>
                <h3>${escapeHtml(courseName)}</h3>
                <p class="queue-meta">${allowedCount} allowed student${allowedCount === 1 ? "" : "s"} imported.</p>
              </div>
              <form method="post" action="/instructor/rosters/settings">
                ${contextFields}
                <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
                <label class="checkbox-label">
                  <input name="restrictToRoster" type="checkbox" value="true" ${restrictToRoster ? "checked" : ""}>
                  Only roster students can join
                </label>
                <button class="secondary-button compact-button" type="submit">Save roster rule</button>
              </form>
            </div>
            <form class="stack-form ta-form" method="post" action="/instructor/rosters/import" enctype="multipart/form-data">
              ${contextFields}
              <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
              <label>
                Import Canvas CSV
                <input name="rosterCsv" type="file" accept=".csv,text/csv" required>
              </label>
              <p class="form-help">In Canvas, open the course, go to <strong>Grades</strong>, click <strong>Export</strong>, then choose <strong>Export Entire Gradebook</strong>.</p>
              <button class="secondary-button" type="submit">${icon("layers")} Import SIS Login IDs</button>
            </form>
            <form class="stack-form ta-form" method="post" action="/instructor/rosters/students">
              ${contextFields}
              <input type="hidden" name="courseName" value="${escapeHtml(courseName)}">
              <label>
                Student ONYEN
                <input name="studentIdentifier" maxlength="120" placeholder="onyen" required>
              </label>
              <label>
                Student name
                <input name="studentName" maxlength="200" placeholder="optional">
              </label>
              <label>
                Student email
                <input name="studentEmail" type="email" maxlength="200" placeholder="optional; defaults to ONYEN@unc.edu">
              </label>
              <button class="secondary-button" type="submit">Add allowed student</button>
            </form>
            <table class="data-table compact-table">
              <thead>
                <tr>
                  <th>ONYEN</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${previewRows}</tbody>
            </table>
          </div>
        </details>
      `;
    })
    .join("");

  return `
    <div class="panel">
      <h2>Course rosters</h2>
      <p>Professors and administrators can import Canvas gradebook CSV files or manually add allowed students. In Canvas, go to <strong>Grades</strong>, click <strong>Export</strong>, then choose <strong>Export Entire Gradebook</strong>. The CSV column <strong>SIS Login ID</strong> is used as the ONYEN.</p>
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

function buildQueueViewToggle(queueView, staffView, selectedProfessorIdentifier) {
  const joinedTimeHref = buildInstructorQuery({
    queueView: "unified",
    staffView,
    professor: staffView === "professor" ? selectedProfessorIdentifier : ""
  });
  const courseHref = buildInstructorQuery({
    queueView: "course",
    staffView,
    professor: staffView === "professor" ? selectedProfessorIdentifier : ""
  });
  return `
    <div class="view-toggle" aria-label="Queue view">
      <a class="${queueView === "unified" ? "active" : ""}" href="${joinedTimeHref}">Joined time</a>
      <a class="${queueView === "course" ? "active" : ""}" href="${courseHref}">By course</a>
    </div>
  `;
}

function buildActiveQueuePanel({ activeQueue, studentCourseNames, instructorAccess, queueView, staffView, selectedProfessorIdentifier }) {
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
        <details class="queue-course-section collapsible-course" ${entries.length > 0 ? "open" : ""}>
          <summary>
            <span class="summary-title">${escapeHtml(courseName)}</span>
            <span class="summary-meta">${entries.length} waiting</span>
          </summary>
          <div class="collapsible-body">
            ${buildActiveQueueTable(entries, {
              emptyMessage: "No active students for this course."
            })}
          </div>
        </details>
      `)
      .join("");

    return `
      <div class="panel">
        <div class="panel-heading-row">
          <h2>Active queue</h2>
          ${buildQueueViewToggle(queueView, staffView, selectedProfessorIdentifier)}
        </div>
        <div class="course-queue-stack">${courseSections}</div>
      </div>
    `;
  }

  return `
    <div class="panel">
      <div class="panel-heading-row">
        <h2>Active queue</h2>
        ${buildQueueViewToggle(queueView, staffView, selectedProfessorIdentifier)}
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
  courseProfessorsByCourse,
  courseTasByCourse,
  rosterSettingsByCourseMap,
  allowedStudentCounts,
  allowedStudentsByCourseMap,
  queueView,
  staffView,
  professorOptions,
  selectedProfessorIdentifier,
  managedCourseNames,
  taCourseNames,
  notice,
  error
}) {
  const title = buildQueueTitle(studentCourseNames);
  const visibleCourses = getInstructorCourseOrder(activeQueue, studentCourseNames, instructorAccess);
  const showAdminControls = instructorAccess.isAdmin && staffView === "administrator";
  const roleLabel = instructorAccess.isAdmin
    ? staffView === "professor"
      ? "Administrator · professor view"
      : "Administrator"
    : instructorAccess.isProfessor
      ? "Professor"
      : "TA";
  const courseManagementNames =
    managedCourseNames || (instructorAccess.isAdmin ? studentCourseNames : instructorAccess.managedCourseNames || []);
  const viewContext = { staffView, selectedProfessorIdentifier };

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
        <p class="section-kicker">Staff dashboard</p>
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

    ${
      instructorAccess.isAdmin
        ? buildStaffViewSwitcher({ staffView, professorOptions, selectedProfessorIdentifier, queueView })
        : buildRoleSwitchPanel(user)
    }

    ${showAdminControls ? buildCourseSettingsPanel(studentCourseName) : ""}
    ${showAdminControls ? buildProfessorAssignmentPanel(studentCourseNames, courseProfessorsByCourse) : ""}
    ${buildProfessorNotificationPanel({
      user,
      instructorAccess,
      managedCourseNames: courseManagementNames,
      courseProfessorsByCourse,
      staffView,
      selectedProfessorIdentifier
    })}
    ${buildTaNotificationPanel({
      user,
      taCourseNames: taCourseNames || [],
      courseTasByCourse,
      staffView,
      selectedProfessorIdentifier
    })}
    ${buildTaManagementPanel(courseManagementNames, courseTasByCourse, viewContext)}
    ${buildRosterManagementPanel(courseManagementNames, rosterSettingsByCourseMap, allowedStudentCounts, allowedStudentsByCourseMap, viewContext)}

    ${buildDashboardStatsPanel(dashboard)}
    ${buildCourseStatsPanel({ dashboard, studentCourseNames, instructorAccess })}

    ${buildActiveQueuePanel({ activeQueue, studentCourseNames, instructorAccess, queueView, staffView, selectedProfessorIdentifier })}

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
  const separator = String(path).includes("?") ? "&" : "?";
  const suffix = search.size ? `${separator}${search.toString()}` : "";
  return res.redirect(`${path}${suffix}`);
}

function getInstructorReturnParams(req, params = {}) {
  const returnParams = { ...params };
  if (req.body?.staffView === "professor") {
    returnParams.staffView = "professor";
    const professor = normalizeUserId(req.body.professor);
    if (professor) {
      returnParams.professor = professor;
    }
  }
  return returnParams;
}

function getStudentReturnPath(req) {
  return req.query.view === "student" || req.body?.view === "student" ? "/?view=student" : "/";
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
  const allowedByIdentity = Boolean(req.user?.canSwitchRoles) || isAdministrator(req.user);
  const allowedByKey = matchesRoleAccessKey(role, req.body.accessKey);

  if (!allowedByIdentity && !allowedByKey) {
    return redirectWithMessage(res, req.user?.role === "instructor" ? "/instructor" : "/", {
      error: "Role switching is not allowed for this account or the access key was invalid."
    });
  }

  res.setHeader("Set-Cookie", serializeRoleOverride(role));
  return redirectWithMessage(res, role === "instructor" ? "/instructor" : "/?view=student", {
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
    const requestedStudentView = req.query.view === "student";
    const instructorAccess = req.user ? await resolveInstructorAccess(req.user) : null;
    if (
      !requestedStudentView &&
      instructorAccess &&
      (req.user.role === "instructor" || instructorAccess.isAdmin || instructorAccess.isProfessor || instructorAccess.isTa)
    ) {
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
  const returnPath = getStudentReturnPath(req);
  const courseContext = String(req.body.courseContext || "").trim();
  const helpTopic = String(req.body.helpTopic || "").trim();
  const meetingLocation = normalizeMeetingLocation(req.body.meetingLocation);

  if (!courseContext || !helpTopic || !meetingLocation) {
    return redirectWithMessage(res, returnPath, {
      error: "Course, help topic, and a location of either In person or a valid UNC Zoom link are required."
    });
  }

  try {
    const studentCourseNames = await getStudentCourseNames();
    if (!studentCourseNames.includes(courseContext)) {
      return redirectWithMessage(res, returnPath, {
        error: "Please choose one of the available courses."
      });
    }

    const rosterAccess = await isStudentAllowedForCourse(courseContext, req.user.userId, req.user.email);
    if (!rosterAccess.allowed) {
      return redirectWithMessage(res, returnPath, {
        error: `Join failed: ${courseContext} is restricted to students on the allowed roster. Please contact your professor or TA if you believe you should have access.`
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

    const [professorNotificationEmails, taNotificationEmails] = await Promise.all([
      getProfessorNotificationEmailsForCourse(courseContext),
      getNotificationEmailsForCourse(courseContext)
    ]);
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
      extraRecipients: [...professorNotificationEmails, ...taNotificationEmails]
    }).catch((error) => {
      console.error("Failed to send queue join notification", error);
    });

    return redirectWithMessage(res, returnPath, { notice: "You joined the queue." });
  } catch (error) {
    if (error?.code === "23505") {
      return redirectWithMessage(res, returnPath, {
        error: "You already have an active queue entry."
      });
    }
    next(error);
  }
});

app.post("/queue/leave", requireAuth, async (req, res, next) => {
  const returnPath = getStudentReturnPath(req);
  try {
    await leaveQueue(req.user.userId);
    return redirectWithMessage(res, returnPath, { notice: "You left the queue." });
  } catch (error) {
    next(error);
  }
});

app.get("/instructor", requireInstructorAccess, async (req, res, next) => {
  try {
    const instructorAccess = req.instructorAccess;
    const queueView = normalizeQueueView(req.query.queueView);
    const staffView = normalizeStaffView(req.query.staffView, instructorAccess);
    const [studentCourseName, studentCourseNames] = await Promise.all([
      getStudentCourseName(),
      getStudentCourseNames()
    ]);
    const initialProfessorCourseNames = instructorAccess.isAdmin ? studentCourseNames : instructorAccess.managedCourseNames || [];
    const courseProfessors =
      instructorAccess.isAdmin || initialProfessorCourseNames.length > 0
        ? await getCourseProfessors(initialProfessorCourseNames)
        : [];
    const availableProfessorOptions = professorOptions(courseProfessors);
    const selectedProfessorIdentifier =
      instructorAccess.isAdmin && staffView === "professor"
        ? normalizeSelectedProfessor(req.query.professor, availableProfessorOptions)
        : "";
    const selectedProfessorCourseNames = getProfessorCoursesFromAssignments(courseProfessors, selectedProfessorIdentifier);
    const managedCourseNames =
      instructorAccess.isAdmin && staffView === "professor"
        ? selectedProfessorCourseNames
        : instructorAccess.isAdmin
          ? studentCourseNames
          : instructorAccess.managedCourseNames || [];
    const taCourseNames = instructorAccess.isAdmin ? [] : instructorAccess.taCourseNames || [];
    const courseTaLoadCourseNames = uniqueCourses(managedCourseNames, taCourseNames);
    const viewCourseNames =
      instructorAccess.isAdmin && staffView === "professor" ? selectedProfessorCourseNames : instructorAccess.courseNames;
    const viewInstructorAccess =
      instructorAccess.isAdmin && staffView === "professor"
        ? { ...instructorAccess, courseNames: viewCourseNames }
        : instructorAccess;
    const rosterPreviewCourseNames = managedCourseNames;
    const [activeQueue, dashboard, courseTas, rosterSettings, allowedStudents, allowedStudentCounts] = await Promise.all([
      getActiveQueue(viewCourseNames),
      getDashboardStats(viewCourseNames),
      getCourseTas(courseTaLoadCourseNames),
      getRosterSettings(rosterPreviewCourseNames),
      getAllowedStudents(rosterPreviewCourseNames),
      getAllowedStudentCounts(rosterPreviewCourseNames)
    ]);

    res.send(
      renderInstructorPage({
        user: req.user,
        activeQueue,
        dashboard,
        studentCourseName,
        studentCourseNames,
        instructorAccess: viewInstructorAccess,
        courseProfessorsByCourse: professorsByCourse(courseProfessors),
        courseTasByCourse: groupTasByCourse(courseTas),
        rosterSettingsByCourseMap: rosterSettingsByCourse(rosterSettings),
        allowedStudentCounts,
        allowedStudentsByCourseMap: allowedStudentsByCourse(allowedStudents),
        queueView,
        staffView,
        professorOptions: availableProfessorOptions,
        selectedProfessorIdentifier,
        managedCourseNames,
        taCourseNames,
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

app.post("/instructor/professors", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    await assignCourseProfessor({
      courseName: req.body.courseName,
      professorIdentifier: req.body.professorIdentifier,
      professorEmail: req.body.professorEmail,
      notifyEmail: req.body.notifyEmail === "true"
    });
    return redirectWithMessage(res, "/instructor", { notice: "Professor assignment saved." });
  } catch (error) {
    if (error.message === "Course, professor identifier, and professor email are required.") {
      return redirectWithMessage(res, "/instructor", { error: error.message });
    }
    next(error);
  }
});

app.post("/instructor/professors/notifications", requireInstructorAccess, async (req, res, next) => {
  try {
    const professorIdentifier = normalizeUserId(req.body.professorIdentifier);
    const canUpdate =
      req.instructorAccess?.isAdmin ||
      professorIdentifier === normalizeUserId(req.user?.userId) ||
      professorIdentifier === normalizeUserId(req.user?.email);

    if (!canUpdate || !canManageCourse(req.instructorAccess, req.body.courseName)) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "Only administrators or the assigned professor can change professor email notifications."
      }));
    }

    const updated = await setCourseProfessorNotification({
      courseName: req.body.courseName,
      professorIdentifier,
      notifyEmail: req.body.notifyEmail === "true"
    });

    if (!updated) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "Professor assignment was not found."
      }));
    }

    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
      notice: "Professor email notification preference saved."
    }));
  } catch (error) {
    if (error.message === "Course and professor identifier are required.") {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: error.message }));
    }
    next(error);
  }
});

app.post("/instructor/professors/remove", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    await removeCourseProfessor({
      courseName: req.body.courseName,
      professorIdentifier: req.body.professorIdentifier
    });
    return redirectWithMessage(res, "/instructor", { notice: "Professor assignment removed." });
  } catch (error) {
    if (error.message === "Course and professor identifier are required.") {
      return redirectWithMessage(res, "/instructor", { error: error.message });
    }
    next(error);
  }
});

app.post("/instructor/tas", requireInstructorAccess, requireManagedCourse, async (req, res, next) => {
  try {
    await addCourseTa({
      courseName: req.body.courseName,
      taIdentifier: req.body.taIdentifier,
      taEmail: req.body.taEmail,
      notifyEmail: req.body.notifyEmail === "true"
    });

    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { notice: "TA assignment saved." }));
  } catch (error) {
    if (error.message === "Course, TA identifier, and TA email are required.") {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: error.message }));
    }
    next(error);
  }
});

app.post("/instructor/tas/notifications", requireInstructorAccess, async (req, res, next) => {
  try {
    const taIdentifier = normalizeUserId(req.body.taIdentifier);
    const userIdentifiers = new Set([normalizeUserId(req.user?.userId), normalizeUserId(req.user?.email)].filter(Boolean));
    const courseName = String(req.body.courseName || "").trim();
    const canAccessCourse =
      req.instructorAccess?.isAdmin || (req.instructorAccess?.courseNames || []).includes(courseName);
    const canUpdate = req.instructorAccess?.isAdmin || userIdentifiers.has(taIdentifier);

    if (!canUpdate || !canAccessCourse) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "Only administrators or the assigned TA can change TA email notifications."
      }));
    }

    const updated = await setCourseTaNotification({
      courseName,
      taIdentifier,
      notifyEmail: req.body.notifyEmail === "true"
    });

    if (!updated) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "TA assignment was not found."
      }));
    }

    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
      notice: "TA email notification preference saved."
    }));
  } catch (error) {
    if (error.message === "Course and TA identifier are required.") {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: error.message }));
    }
    next(error);
  }
});

app.post("/instructor/tas/:taId/remove", requireInstructorAccess, async (req, res, next) => {
  try {
    const ta = await getCourseTaById(req.params.taId);
    if (!ta || !canManageCourse(req.instructorAccess, ta.course_name)) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "Only administrators and the assigned professor can remove that TA."
      }));
    }

    await removeCourseTa(req.params.taId);
    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { notice: "TA assignment removed." }));
  } catch (error) {
    next(error);
  }
});

app.post("/instructor/rosters/settings", requireInstructorAccess, requireManagedCourse, async (req, res, next) => {
  try {
    await setRosterRestriction(req.body.courseName, req.body.restrictToRoster === "true");
    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { notice: "Roster restriction updated." }));
  } catch (error) {
    next(error);
  }
});

app.post(
  "/instructor/rosters/import",
  requireInstructorAccess,
  upload.single("rosterCsv"),
  requireManagedCourse,
  async (req, res, next) => {
    try {
      if (!req.file?.buffer) {
        return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: "Please choose a CSV file to import." }));
      }

      const importedCount = await importAllowedStudentsFromCsv(req.body.courseName, req.file.buffer.toString("utf8"));
      return redirectWithMessage(
        res,
        "/instructor",
        getInstructorReturnParams(req, { notice: `${importedCount} student${importedCount === 1 ? "" : "s"} imported.` })
      );
    } catch (error) {
      if (error.message === "CSV must include a SIS Login ID column.") {
        return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: error.message }));
      }
      next(error);
    }
  }
);

app.post("/instructor/rosters/students", requireInstructorAccess, requireManagedCourse, async (req, res, next) => {
  try {
    await addAllowedStudent({
      courseName: req.body.courseName,
      studentIdentifier: req.body.studentIdentifier,
      studentName: req.body.studentName,
      studentEmail: req.body.studentEmail
    });
    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { notice: "Allowed student saved." }));
  } catch (error) {
    if (error.message === "Course and student ONYEN are required.") {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { error: error.message }));
    }
    next(error);
  }
});

app.post("/instructor/rosters/students/:studentId/remove", requireInstructorAccess, async (req, res, next) => {
  try {
    const student = await getAllowedStudentById(req.params.studentId);
    if (!student || !canManageCourse(req.instructorAccess, student.course_name)) {
      return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, {
        error: "Only administrators and the assigned professor can remove that student."
      }));
    }

    await removeAllowedStudent(req.params.studentId);
    return redirectWithMessage(res, "/instructor", getInstructorReturnParams(req, { notice: "Allowed student removed." }));
  } catch (error) {
    next(error);
  }
});

app.get("/instructor/courses/:courseName/export", requireInstructorAccess, requireCourseAdmin, async (req, res, next) => {
  try {
    const courseName = req.params.courseName;
    const payload = await getCoursePackage(courseName);
    const safeName = String(courseName || "course").replace(/[^a-z0-9_-]+/gi, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-db-package.json"`);
    return res.send(JSON.stringify(payload, null, 2));
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
