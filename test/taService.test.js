process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/test";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeTaEmail, normalizeTaIdentifier } = require("../src/taService");

test("normalizeTaIdentifier stores ONYEN-style identifiers", () => {
  assert.equal(normalizeTaIdentifier("TAUser@unc.edu"), "tauser");
  assert.equal(normalizeTaIdentifier(" TAUser "), "tauser");
});

test("normalizeTaEmail uses explicit email or falls back to ONYEN at UNC", () => {
  assert.equal(normalizeTaEmail("TAUser@UNC.EDU", "ignored"), "tauser@unc.edu");
  assert.equal(normalizeTaEmail("", "tauser"), "tauser@unc.edu");
});
