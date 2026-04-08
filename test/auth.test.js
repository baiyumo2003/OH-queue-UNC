const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCookies, resolveUser } = require("../src/auth");

test("parseCookies parses multiple cookie pairs", () => {
  const result = parseCookies("a=1; b=two");
  assert.equal(result.a, "1");
  assert.equal(result.b, "two");
});

test("resolveUser uses trusted SSO headers when enabled", () => {
  process.env.TRUST_PROXY_AUTH = "true";
  process.env.ALLOW_DEV_AUTH = "false";
  process.env.INSTRUCTOR_IDS = "teacher1";

  const req = {
    headers: {
      "x-remote-user": "teacher1",
      mail: "teacher1@unc.edu",
      displayname: "Teacher One"
    }
  };

  const user = resolveUser(req);
  assert.equal(user.userId, "teacher1");
  assert.equal(user.role, "instructor");
  assert.equal(user.displayName, "Teacher One");
});
