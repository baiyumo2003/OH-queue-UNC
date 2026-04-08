const test = require("node:test");
const assert = require("node:assert/strict");

const { getExternalBaseUrl, getFirstConfiguredValue, parseCookies, resolveUser } = require("../src/auth");

test("parseCookies parses multiple cookie pairs", () => {
  const result = parseCookies("a=1; b=two");
  assert.equal(result.a, "1");
  assert.equal(result.b, "two");
});

test("getFirstConfiguredValue ignores duplicated comma-separated values", () => {
  assert.equal(
    getFirstConfiguredValue("https://a.example, https://b.example"),
    "https://a.example"
  );
});

test("getExternalBaseUrl uses first forwarded host and protocol value", () => {
  const req = {
    headers: {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "student-queue-yumo.apps.cloudapps.unc.edu, internal-router"
    },
    protocol: "http"
  };

  assert.equal(
    getExternalBaseUrl(req),
    "https://student-queue-yumo.apps.cloudapps.unc.edu"
  );
});

test("resolveUser uses trusted SSO headers when enabled", () => {
  process.env.TRUST_PROXY_AUTH = "true";
  process.env.ALLOW_DEV_AUTH = "false";
  process.env.INSTRUCTOR_IDS = "teacher1";

  const req = {
    headers: {
      http_uid: "teacher1",
      mail: "teacher1@unc.edu",
      displayname: "Teacher One"
    }
  };

  const user = resolveUser(req);
  assert.equal(user.userId, "teacher1");
  assert.equal(user.role, "instructor");
  assert.equal(user.displayName, "Teacher One");
});

test("resolveUser falls back to legacy proxy headers if HTTP_UID is absent", () => {
  process.env.TRUST_PROXY_AUTH = "true";
  process.env.ALLOW_DEV_AUTH = "false";
  process.env.INSTRUCTOR_IDS = "";
  process.env.ROLE_SWITCH_USERS = "";

  const req = {
    headers: {
      "x-remote-user": "student1"
    }
  };

  const user = resolveUser(req);
  assert.equal(user.userId, "student1");
  assert.equal(user.role, "student");
});

test("resolveUser applies role override for allowed switch user", () => {
  process.env.TRUST_PROXY_AUTH = "true";
  process.env.ALLOW_DEV_AUTH = "false";
  process.env.INSTRUCTOR_IDS = "";
  process.env.ROLE_SWITCH_USERS = "yumo";

  const req = {
    headers: {
      http_uid: "yumo",
      cookie: "role_override=instructor"
    }
  };

  const user = resolveUser(req);
  assert.equal(user.userId, "yumo");
  assert.equal(user.baseRole, "student");
  assert.equal(user.role, "instructor");
  assert.equal(user.canSwitchRoles, true);
});
