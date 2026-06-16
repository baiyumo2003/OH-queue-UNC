# UNC STOR Office Hours Queue

A lightweight web app for running UNC office hours queues across one or more courses.

Students sign in with UNC SSO, choose a course, describe what they need help with, and join the queue. Professors, instructors, and TAs use a staff dashboard to view the live queue, manage entries, review wait-time statistics, and configure course-specific TA access.

Staff guide: [Professor and TA User Manual](docs/instructor-ta-manual.md)

## Features

- UNC SSO/Shibboleth header-based authentication.
- Student queue form with course selection, help topic, and location.
- Students only see their own queue position and wait information.
- One active queue entry per student.
- Instructor dashboard with live queue management.
- Dashboard views for a unified join-time queue or course-separated queues.
- Course-level TA access.
- Role switchers can manage course names and TA assignments.
- Course-specific email notification settings for TAs.
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

### TA

TAs are assigned to one or more courses from the instructor dashboard. A TA can:

- View only their assigned course queues.
- Switch between **Joined time** and **By course** queue views.
- Mark students helped.
- Remove abandoned or mistaken entries.
- Receive queue-join emails for assigned courses when enabled.

### Instructor

Instructors listed in `INSTRUCTOR_IDS` can access the instructor dashboard and manage the queue.

### Role Switcher / Professor

Users listed in `ROLE_SWITCH_USERS` can switch into instructor view and manage:

- Student-facing course choices.
- Course-specific TA assignments.
- Whether each TA receives email notifications for each course.

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
│   └── instructor-ta-manual.md
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
export INSTRUCTOR_IDS='testinstructor'
export ROLE_SWITCH_USERS='testinstructor'
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

When `ALLOW_DEV_AUTH=true`, use the dev login form. When `TEST_LOGIN_ENABLED=true`, these test routes are also available:

```text
/test-login/student
/test-login/instructor
```

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
| `INSTRUCTOR_IDS` | Comma-separated ONYENs or emails with instructor dashboard access. |
| `ROLE_SWITCH_USERS` | Comma-separated ONYENs or emails that can switch roles and manage courses/TAs. |
| `STUDENT_COURSE_NAME` | Initial course list before it is changed from the dashboard. Courses may be separated by commas or spaces. |
| `DATABASE_SSL` | Set to `true` if your PostgreSQL connection requires SSL. |

### Development and Testing

| Variable | Description |
| --- | --- |
| `ALLOW_DEV_AUTH` | Enables the local dev login form. Do not enable in production. |
| `TEST_LOGIN_ENABLED` | Enables `/test-login/student` and `/test-login/instructor`. Do not enable in production. |
| `TEST_STUDENT_ONYEN` | Test student ONYEN. |
| `TEST_STUDENT_NAME` | Test student display name. |
| `TEST_STUDENT_EMAIL` | Test student email. |
| `TEST_INSTRUCTOR_ONYEN` | Test instructor ONYEN. |
| `TEST_INSTRUCTOR_NAME` | Test instructor display name. |
| `TEST_INSTRUCTOR_EMAIL` | Test instructor email. |
| `STUDENT_VIEW_KEY` | Optional access key for switching to student view. |
| `INSTRUCTOR_VIEW_KEY` | Optional access key for switching to instructor view. |

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

Course-specific TA notification emails are managed inside the instructor dashboard.

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

Important constraints:

- One active queue entry per student.
- Unique TA assignment per course and TA identifier.

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
  INSTRUCTOR_IDS='profonyen' \
  ROLE_SWITCH_USERS='profonyen' \
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

Course-specific TA recipients can then be configured from the instructor dashboard.

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

Role switchers can edit the course list in **Student course choices**.

Courses may be separated by commas or spaces:

```text
STOR113, STOR118, STOR666
```

### Add TAs

Role switchers can add TAs under **Course TAs**. Each TA assignment includes:

- Course name.
- TA ONYEN or email.
- Optional explicit TA email.
- Checkbox for queue-join email notifications.

TAs can be assigned to multiple courses.

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
- `ROLE_SWITCH_USERS` should be limited to trusted course administrators.
- `INSTRUCTOR_IDS` grants broad instructor dashboard access.
- TA access is best managed from the dashboard rather than environment variables.
- The student-facing course list is stored in PostgreSQL after it is changed from the dashboard.
- Course/TA assignments are stored in PostgreSQL.
- Email delivery depends on SMTP configuration and UNC relay/network policy.

## Related Documentation

- [Professor and TA User Manual](docs/instructor-ta-manual.md)
- UNC CloudApps documentation
- UNC Shibboleth Proxy documentation
