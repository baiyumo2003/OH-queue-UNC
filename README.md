# UNC Student Queue

A small queue web application for UNC office hours or help sessions.

Features:

- Students sign in with UNC SSO and join the queue.
- Students can see their current place in line and waiting time.
- Instructors can open a dashboard with live wait times and daily summary stats.
- Queue data is stored in PostgreSQL so it survives pod restarts.

## Stack

- Node.js + Express
- PostgreSQL
- UNC SSO via trusted reverse-proxy headers from your CloudApps/Shibboleth setup

## What the app expects from UNC SSO

This app does not implement the SAML flow itself. It expects CloudApps/Shibboleth to authenticate the user and forward identity headers to the Node app.

Primary UNC username header:

- `HTTP_UID`

Other supported fallbacks:

- `REMOTE_USER` or `X-Remote-User`
- `mail` or `X-Forwarded-Email`
- `displayName`, `givenName`, `sn`, or `cn`

Per the UNC KB article, the separate Shibboleth proxy pod exposes the signed-in username through the `HTTP_UID` HTTP header. This app now treats `HTTP_UID` as the preferred source for the ONYEN/user id and falls back to the older generic headers only if needed.

## Environment variables

Required:

- `DATABASE_URL`

Recommended:

- `PORT` default: `3000`
- `QUEUE_TITLE` default: `Student Queue`
- `INSTRUCTOR_IDS` comma-separated ONYENs or email addresses allowed into `/instructor`
- `TRUST_PROXY_AUTH=true` in CloudApps when SSO headers are being forwarded
- `APP_BASE_URL` public route base URL, such as `https://student-queue-youronyen.apps.unc.edu`

Optional:

- `ALLOW_DEV_AUTH=true` for local development only
- `SSO_LOGIN_URL` override if your SSO article has you use a custom login URL
- `SSO_LOGOUT_URL` override if your SSO article has you use a custom logout URL

## Local development

1. Start PostgreSQL locally.
2. Create a database and set `DATABASE_URL`.
3. Copy `.env.example` to your own shell environment.
4. Install dependencies:

   ```bash
   npm install
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`.
7. Use the built-in dev login form while `ALLOW_DEV_AUTH=true`.

## Deploying to UNC CloudApps / OKD

These steps assume:

- You already signed up for Carolina CloudApps: <https://cloudapps.unc.edu/>
- You can log into the UNC OKD console.
- You will follow UNC's SSO/Shibboleth article here for the exact UNC-specific SSO resource creation details: <https://tdx.unc.edu/TDClient/33/Portal/KB/ArticleDet?ID=150>

### 1. Log into OKD

1. Open the UNC OKD console referenced by CloudApps.
2. Copy your `oc login` command from the console.
3. Run it locally.
4. Switch to your project.

Example:

```bash
oc login --token=... --server=...
oc project <your-project>
```

### 2. Create PostgreSQL in your project

Create a PostgreSQL app inside the same CloudApps project:

```bash
oc new-app postgresql:15-el9 \
  --name=student-queue-db \
  -e POSTGRESQL_USER=queueuser \
  -e POSTGRESQL_PASSWORD='replace-with-strong-password' \
  -e POSTGRESQL_DATABASE=student_queue
```

Wait for the database pod to become ready:

```bash
oc get pods -w
```

### 3. Create the queue application

From this repository directory:

```bash
oc new-app . --name=student-queue --strategy=docker
```

This uses the included `Dockerfile`.

### 4. Expose a public HTTPS route

```bash
oc create route edge --service=student-queue
oc get route student-queue
```

Record the public hostname shown by `oc get route`.

### 5. Set the app environment variables

Replace `<route-host>` with your route host from the previous step:

```bash
oc set env deployment/student-queue \
  DATABASE_URL='postgresql://queueuser:replace-with-strong-password@student-queue-db:5432/student_queue' \
  TRUST_PROXY_AUTH=true \
  INSTRUCTOR_IDS='youronyen,yourta' \
  QUEUE_TITLE='COMP 423 Office Hours Queue' \
  APP_BASE_URL='https://<route-host>' \
  ALLOW_DEV_AUTH=false
```

If UNC's SSO article tells you to use a custom login or logout URL, also set:

```bash
oc set env deployment/student-queue \
  SSO_LOGIN_URL='https://<route-host>/Shibboleth.sso/Login?target=https%3A%2F%2F<route-host>%2F' \
  SSO_LOGOUT_URL='https://<route-host>/Shibboleth.sso/Logout?return=https%3A%2F%2F<route-host>%2F'
```

### 6. Add the UNC Shibboleth Proxy

The KB article’s visible steps show this flow in CloudApps:

1. Switch to the `Administrator` perspective.
2. Go to `Networking`, then `Services`.
3. Find and note the service name for your application.
4. Switch to the `Developer` perspective.
5. Open `+Add`.
6. Choose `All services` from the Developer Catalog.
7. Search for `shibboleth`.
8. Choose `UNC Shibboleth Proxy`.
9. Click `Instantiate Template`.
10. Complete the template form.

From the KB page, the visible form fields include:

- `Application Name`: name of the Shibboleth pod to create, default `shibboleth`
- `Onyen`: required; used to submit a ticket to ITS Identity Management to provision the Shibboleth Service Provider

Use the service name from step 3 when the template asks which application/service should be protected.

### 7. Match the app to the UNC header behavior

The KB page says that because the Shibboleth proxy is a separate pod, your application should read the username from the `HTTP_UID` HTTP header rather than relying on the CGI `REMOTE_USER` variable.

That is already how this app is now configured:

1. `TRUST_PROXY_AUTH` must be `true`.
2. The protected route should point users through the Shibboleth proxy.
3. The Node app will read `HTTP_UID` as the primary ONYEN/user id.
4. `INSTRUCTOR_IDS` should use ONYEN values that match `HTTP_UID`.

### 8. If the protected domain changes later

The KB page also shows that changing the domain on an existing Shibboleth deployment requires updating the Shibboleth deployment config:

1. In `Administrator`, go to `Workloads`, then `Deployment Configs`.
2. Open the Shibboleth deployment.
3. Open the `Environment` tab.
4. Change `APPLICATION_DOMAIN` to the new domain only, without `http://` or `https://`.
5. Add `FORCE_TICKET=true`.
6. Save and wait for the new pod.
7. Remove `FORCE_TICKET`.
8. Save again.

In this app, update `APP_BASE_URL` at the same time so the Node app and the Shibboleth proxy use the same public hostname.

### 9. Verify the deployment

Open the route in a browser and verify:

1. Unauthenticated access redirects to UNC login.
2. After login, the app receives `HTTP_UID` and shows your ONYEN or derived UNC identity.
3. A student account can join the queue.
4. An instructor account listed in `INSTRUCTOR_IDS` can open `/instructor`.
5. The instructor dashboard shows the student and a live waiting time.

Useful commands:

```bash
oc get all
oc logs deployment/student-queue
oc logs deployment/student-queue-db
oc describe route student-queue
```

### 10. Update the deployment after code changes

If you change the app and want CloudApps to rebuild:

```bash
oc start-build student-queue --from-dir=. --follow
```

If your project uses webhook-driven builds instead, wire that into GitHub Actions after the initial deployment.

## Instructor access model

Instructor access is controlled by `INSTRUCTOR_IDS`, and those values should match the ONYEN values UNC sends in `HTTP_UID`.

Examples:

- `INSTRUCTOR_IDS=abc123`
- `INSTRUCTOR_IDS=abc123,def456`
- `INSTRUCTOR_IDS=abc123,ta1@unc.edu,ta2@unc.edu`

## Notes

- The app enforces one active queue entry per student.
- The instructor dashboard shows active wait times and a completed-today table with recorded wait durations.
- Data is stored in PostgreSQL, not in memory.
- UNC CloudApps Shibboleth should provide the username in `HTTP_UID`; generic proxy headers are treated as fallback compatibility only.
