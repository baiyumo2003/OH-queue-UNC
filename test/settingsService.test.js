process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/test";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildQueueTitle, normalizeStudentCourseName, parseStudentCourseNames } = require("../src/settingsService");

test("parseStudentCourseNames splits comma-separated courses", () => {
  assert.deepEqual(parseStudentCourseNames("STOR666, STOR655"), ["STOR666", "STOR655"]);
});

test("parseStudentCourseNames splits space-separated courses", () => {
  assert.deepEqual(parseStudentCourseNames("STOR666 STOR655"), ["STOR666", "STOR655"]);
});

test("normalizeStudentCourseName deduplicates and stores courses consistently", () => {
  assert.equal(normalizeStudentCourseName("STOR666, stor666, STOR655"), "STOR666, STOR655");
});

test("buildQueueTitle uses configured course choices", () => {
  assert.equal(buildQueueTitle(["STOR666", "STOR655"]), "STOR666 / STOR655 Office hours queue");
});
