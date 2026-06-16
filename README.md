# UNC STOR Office Hours Queue

A lightweight web app for running UNC office hours queues across one or more courses.

Students sign in with UNC SSO, choose a course, describe what they need help with, and join the queue. Administrators, professors, and TAs use a staff dashboard to view the live queue, manage entries, review wait-time statistics, and configure course-specific access.

Staff guide: [Professor and TA User Manual](docs/professor-ta-manual.md)

## Features

- UNC SSO/Shibboleth header-based authentication.
- Student queue form with course selection, help topic, and location.
- Students only see their own queue position and wait information.
- One active queue entry per student.
- Staff dashboard with live queue management.
- Dashboard views for a unified join-time queue or course-separated queues.
- Administrator-managed professor assignments.
- Course-level professor and TA access.
- Professors can manage TAs and rosters for their assigned courses.
- Professors can choose whether they receive queue-join emails for each assigned course.
- TAs can choose whether they receive queue-join emails for each assigned course.
- Course-specific email notification settings for TAs.
- Optional course roster restrictions using imported or manually entered ONYENs.
- Canvas gradebook CSV import using the `SIS Login ID` column.
- Administrator course database package export.
- Queue join emails through SMTP, including UNC relay support.
- Daily and live queue statistics, including per-course wait metrics.
- PostgreSQL persistence across pod restarts.
- Responsive UI with UNC/STOR branding.

## User Roles

### Student

Students can:

- Sign in through UNC SSO.
- Join the queue for one configured course.
- Enter `In person` or a valid UNC Zoom URL as their location.
- See their own position, wait time, and number of people ahead.
- Leave the queue before they are helped.

Students cannot see other students or the full queue.

### Administrator

Administrators listed in `ADMINISTRATOR_IDS` can:

- Update the student-facing course list.
- Add or remove one or more professors for each course.
- Use Professor view to inspect the dashboard as a selected professor.
- Manage every course's TAs and allowed-student roster.
- Export all database content for a course.

### TA

TAs are assigned to one or more courses from the staff dashboard. A TA can:

- View only their assigned course queues.
- Switch between **Joined time** and **By course** queue views.
- Mark students helped.
- Remove abandoned or mistaken entries.
- Receive queue-join emails for assigned courses when enabled.

### Professor

Professors assigned by an administrator can manage their own courses:

- Course-specific TA assignments.
- Whether each TA receives email notifications for each course.
- Course roster restrictions.
- Imported or manually entered allowed students.

The legacy environment variable `INSTRUCTOR_IDS` can also grant broad staff dashboard access, but day-to-day course administration should use `ADMINISTRATOR_IDS` for administrators and dashboard-managed professor/TA assignments for course staff.

## Tech Stack

- Node.js 20+
- Express
- PostgreSQL
- Nodemailer
- Docker
- UNC CloudApps / OpenShift
- UNC Shibboleth Proxy for SSO

## Repository Layout

```text
.
├── docs/
│   └── professor-ta-manual.md
├── public/
│   ├── styles.css
│   └── unc-stor-logo.png
├── src/
│   ├── auth.js
│   ├── db.js
│   ├── emailService.js
│   ├── queueService.js
│   ├── server.js
│   ├── settingsService.js
│   ├── taService.js
│   └── utils.js
├── test/
├── Dockerfile
├── package.json
└── README.md
```

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

Create a local database and set `DATABASE_URL`.

Example:

```bash
createdb student_queue
export DATABASE_URL='postgresql://localhost:5432/student_queue'
```

### 3. Configure local environment

Use `.env.example` as a reference. This project does not automatically load `.env`; export variables in your shell or use your preferred environment loader.

Useful local settings:

```bash
export PORT=3000
export DATABASE_URL='postgresql://localhost:5432/student_queue'
export TRUST_PROXY_AUTH=false
export ALLOW_DEV_AUTH=true
export TEST_LOGIN_ENABLED=true
export ADMINISTRATOR_IDS='testadmin'
export ROLE_SWITCH_USERS='testadmin'
export INSTRUCTOR_IDS=''
export STUDENT_COURSE_NAME='STOR113, STOR118'
export APP_BASE_URL='http://localhost:3000'
```

### 4. Run the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

When `ALLOW_DEV_AUTH=true`, use the dev login form. `TEST_LOGIN_ENABLED=true` also enables bookmarkable student and staff test-login endpoints for local development.

### 5. Run tests

```bash
npm test
```

## Environment Variables

### Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |

### Core App Settings

| Variable | Description |
| --- | --- |
| `PORT` | Port for the Node server. Defaults to `3000`; CloudApps commonly uses `8080` inside the container. |
| `APP_BASE_URL` | Public base URL used for SSO redirects and email dashboard links. |
| `TRUST_PROXY_AUTH` | Set to `true` in CloudApps when Shibboleth headers are trusted. |
| `ADMINISTRATOR_IDS` | Comma-separated administrator ONYENs or emails. Administrators can assign professors and export course DB packages. |
| `INSTRUCTOR_IDS` | Legacy comma-separated ONYENs or emails with broad staff dashboard access. |
| `ROLE_SWITCH_USERS` | Legacy role-switch allowlist. Used as an administrator fallback only when `ADMINISTRATOR_IDS` is unset. |
| `STUDENT_COURSE_NAME` | Initial course list before it is changed from the dashboard. Courses may be separated by commas or spaces. |
| `DATABASE_SSL` | Set to `true` if your PostgreSQL connection requires SSL. |

### Development and Testing

| Variable | Description |
| --- | --- |
| `ALLOW_DEV_AUTH` | Enables the local dev login form. Do not enable in production. |
| `TEST_LOGIN_ENABLED` | Enables the student and staff test-login routes. Do not enable in production. |
| `TEST_STUDENT_ONYEN` | Test student ONYEN. |
| `TEST_STUDENT_NAME` | Test student display name. |
| `TEST_STUDENT_EMAIL` | Test student email. |
| `TEST_INSTRUCTOR_ONYEN` | Test professor/staff ONYEN. |
| `TEST_INSTRUCTOR_NAME` | Test professor/staff display name. |
| `TEST_INSTRUCTOR_EMAIL` | Test professor/staff email. |
| `STUDENT_VIEW_KEY` | Optional access key for switching to student view. |
| `INSTRUCTOR_VIEW_KEY` | Optional access key for switching to staff view. |

### Email Notifications

| Variable | Description |
| --- | --- |
| `EMAIL_NOTIFICATIONS_ENABLED` | Set to `true` to send queue-join emails. |
| `QUEUE_NOTIFICATION_RECIPIENTS` | Comma-separated global notification recipients. |
| `INSTRUCTOR_NOTIFICATION_EMAILS` | Legacy fallback for global notification recipients. |
| `INSTRUCTOR_EMAILS` | Legacy fallback for global notification recipients. |
| `MAIL_FROM` | Sender shown on notification emails. |
| `SMTP_HOST` | SMTP server hostname, for example `relay.unc.edu`. |
| `SMTP_PORT` | SMTP port. Defaults to `587`. |
| `SMTP_SECURE` | Set to `true` for TLS-on-connect SMTP. |
| `SMTP_USER` | Optional SMTP username. |
| `SMTP_PASS` | Optional SMTP password. |

If `QUEUE_NOTIFICATION_RECIPIENTS`, `INSTRUCTOR_NOTIFICATION_EMAILS`, and `INSTRUCTOR_EMAILS` are all unset, the app falls back to `INSTRUCTOR_IDS` and treats bare ONYENs as `<onyen>@unc.edu`.

Course-specific TA notification emails are managed inside the staff dashboard.

### SSO Overrides

| Variable | Description |
| --- | --- |
| `SSO_LOGIN_URL` | Optional explicit login URL. |
| `SSO_LOGOUT_URL` | Optional explicit logout URL. |

## Authentication and Shibboleth Headers

The app does not implement SAML directly. In production, UNC CloudApps/Shibboleth authenticates users and forwards identity headers to the Node app.

The preferred username header is:

```text
HTTP_UID
```

Supported identity fallbacks include:

- `REMOTE_USER`
- `X-Remote-User`
- `mail`
- `X-Forwarded-Email`
- `displayName`
- `givenName`
- `sn`
- `cn`
- Shibboleth-style `HTTP_`-prefixed variants such as `HTTP_DISPLAYNAME`, `HTTP_GIVENNAME`, `HTTP_SN`, and `HTTP_MAIL`

For formal student names, ask UNC ITS/Shibboleth to release display-name attributes such as `displayName`, or `givenName` and `sn`.

## Database Tables

The app creates and updates its own tables at startup:

- `queue_entries`: student queue entries.
- `app_settings`: dashboard-managed settings such as course choices.
- `course_tas`: course-specific TA assignments and email notification preferences.
- `course_professors`: administrator-assigned professors for each course, including professor email notification preferences.
- `course_roster_settings`: whether a course is restricted to the allowed-student roster.
- `course_allowed_students`: students allowed to join roster-restricted course queues.

Important constraints:

- One active queue entry per student.
- Unique TA assignment per course and TA identifier.
- Unique professor assignment per course and professor identifier.
- Unique allowed-student entry per course and student identifier.

## CloudApps / OpenShift Deployment

These steps assume you have access to UNC CloudApps and the `oc` CLI.

### 1. Log in and select your project

```bash
oc login --token=... --server=...
oc project <your-project>
```

### 2. Create PostgreSQL

```bash
oc new-app postgresql:15-el9 \
  --name=student-queue-db \
  -e POSTGRESQL_USER=queueuser \
  -e POSTGRESQL_PASSWORD='replace-with-a-strong-password' \
  -e POSTGRESQL_DATABASE=student_queue
```

Wait for the database pod:

```bash
oc get pods -w
```

### 3. Create the application

From this repository:

```bash
oc new-app . --name=student-queue --strategy=docker
```

This uses the included `Dockerfile`.

### 4. Configure the deployment

Example:

```bash
oc set env deployment/student-queue \
  DATABASE_URL='postgresql://queueuser:replace-with-a-strong-password@student-queue-db:5432/student_queue' \
  TRUST_PROXY_AUTH=true \
  ALLOW_DEV_AUTH=false \
  TEST_LOGIN_ENABLED=false \
  ADMINISTRATOR_IDS='adminonyen' \
  ROLE_SWITCH_USERS='adminonyen' \
  INSTRUCTOR_IDS='' \
  STUDENT_COURSE_NAME='STOR113, STOR118' \
  APP_BASE_URL='https://<public-route-host>'
```

### 5. Enable email notifications

UNC relay example:

```bash
oc set env deployment/student-queue \
  EMAIL_NOTIFICATIONS_ENABLED=true \
  QUEUE_NOTIFICATION_RECIPIENTS='professor@unc.edu' \
  MAIL_FROM='Office Hours Queue <no-reply@unc.edu>' \
  SMTP_HOST='relay.unc.edu' \
  SMTP_PORT='587' \
  SMTP_SECURE=false
```

Course-specific TA recipients can then be configured from the staff dashboard.

### 6. Add the UNC Shibboleth Proxy

Follow UNC CloudApps Shibboleth documentation and protect the queue app route with the UNC Shibboleth Proxy.

At a high level:

1. Identify the service for `student-queue`.
2. Add the `UNC Shibboleth Proxy` template from the CloudApps catalog.
3. Point the proxy to the queue service.
4. Ensure the public route goes through the Shibboleth proxy.
5. Confirm Shibboleth forwards `HTTP_UID`.

If the route host changes later, update both:

- Shibboleth `APPLICATION_DOMAIN`
- App `APP_BASE_URL`

If ITS requires a new Shibboleth ticket after a domain change, temporarily set `FORCE_TICKET=true` on the Shibboleth deployment, let it submit the ticket, then remove `FORCE_TICKET`.

### 7. Rebuild after code changes

If the BuildConfig tracks the GitHub repository:

```bash
oc start-build student-queue --follow
```

If you are using a binary/local source build:

```bash
oc start-build student-queue --from-dir=. --follow
```

Then confirm rollout:

```bash
oc rollout status deployment/student-queue
oc logs deployment/student-queue --tail=100
```

## Staff Dashboard Workflow

### Configure Courses

Administrators can edit the course list in **Student course choices**.

Courses may be separated by commas or spaces:

```text
STOR113, STOR118, STOR666
```

### Add TAs

Administrators can add one or more professors to each course under **Course professors**. Professors and administrators can add TAs under **Course TAs**. Each TA assignment includes:

- Course name.
- TA ONYEN or email.
- Optional explicit TA email.
- Checkbox for queue-join email notifications.

TAs can be assigned to multiple courses.

Professors can choose whether to receive queue-join emails under **Professor email notifications**. TAs can do the same under **TA email notifications**. These settings are course-specific, so staff can receive emails for one course and turn them off for another.

### Manage Rosters

Professors and administrators can manage allowed students under **Course rosters**:

- Toggle whether only students on the roster may join a course queue.
- Import a Canvas gradebook CSV. In Canvas, open the course, go to **Grades**, click **Export**, then choose **Export Entire Gradebook**. The app reads the `SIS Login ID` column as the student's ONYEN.
- Manually add allowed students by ONYEN.
- Remove allowed students.

When roster restriction is off, any signed-in UNC student can join that course queue. When it is on, only students in `course_allowed_students` for that course can join.

### Export Course Data

Administrators can use **Export DB package** for a course to download a JSON package containing that course's professor assignments, TA assignments, roster settings, allowed students, and queue entries.

The download is useful for:

- Backing up a course before major roster or staffing changes.
- Auditing who had professor or TA access to a course.
- Reviewing historical queue entries outside the app.
- Sharing a course-specific data snapshot with another administrator.

The file is plain UTF-8 JSON and is named like `STOR113-db-package.json`. It has this top-level shape:

```json
{
  "courseName": "STOR113",
  "exportedAt": "2026-06-16T22:15:00.000Z",
  "professors": [],
  "tas": [],
  "rosterSettings": {},
  "allowedStudents": [],
  "queueEntries": []
}
```

Important fields:

- `professors`: professor ONYENs/emails assigned to the course and each professor's queue-join email notification preference.
- `tas`: TA ONYENs/emails and whether each TA receives queue email notifications.
- `rosterSettings`: whether the course is restricted to the allowed-student roster.
- `allowedStudents`: manually added or CSV-imported students allowed into roster-restricted queues.
- `queueEntries`: active, completed, and cancelled queue entries for that course.

You can read it with common tools:

```bash
jq . STOR113-db-package.json
jq '.professors' STOR113-db-package.json
jq '.queueEntries[] | {student_name, help_topic, joined_at, completed_at, cancelled_at}' STOR113-db-package.json
```

Or with Node.js:

```bash
node -e "const db=require('./STOR113-db-package.json'); console.log(db.courseName, db.queueEntries.length)"
```

### Manage the Queue

Staff can:

- View active students.
- Switch between **Joined time** and **By course** queue views.
- Mark students helped.
- Remove entries that should no longer be active.
- Review completed visits for the day.
- Review live and per-course statistics.

## Useful Commands

```bash
npm test
```

```bash
oc get pods
oc get deployment student-queue
oc logs deployment/student-queue --tail=100
oc exec deployment/student-queue -- wget -qO- http://127.0.0.1:8080/healthz
```

Current app health endpoint:

```text
/healthz
```

## Known Operational Notes

- Keep `ALLOW_DEV_AUTH=false` and `TEST_LOGIN_ENABLED=false` in production.
- `ADMINISTRATOR_IDS` should be limited to trusted course administrators.
- `ROLE_SWITCH_USERS` is retained for backward-compatible role switching and administrator fallback.
- `INSTRUCTOR_IDS` is retained as a legacy broad staff-dashboard access setting.
- Professor and TA access is best managed from the dashboard rather than environment variables.
- The student-facing course list is stored in PostgreSQL after it is changed from the dashboard.
- Course/TA assignments are stored in PostgreSQL.
- Email delivery depends on SMTP configuration and UNC relay/network policy.

## Related Documentation

- [Professor and TA User Manual](docs/professor-ta-manual.md)
- UNC CloudApps documentation
- UNC Shibboleth Proxy documentation
