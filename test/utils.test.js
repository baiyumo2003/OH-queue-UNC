const test = require("node:test");
const assert = require("node:assert/strict");

const { escapeHtml, formatDuration, normalizeUserId } = require("../src/utils");

test("formatDuration handles hours and minutes", () => {
  assert.equal(formatDuration(3661), "1h 1m");
  assert.equal(formatDuration(120), "2m");
  assert.equal(formatDuration(15), "<1m");
});

test("normalizeUserId strips domain", () => {
  assert.equal(normalizeUserId("ABC123@unc.edu"), "abc123");
  assert.equal(normalizeUserId("abc123"), "abc123");
});

test("escapeHtml escapes reserved characters", () => {
  assert.equal(escapeHtml("<tag>"), "&lt;tag&gt;");
});
