const { query } = require("./db");

const STUDENT_COURSE_NAME_KEY = "student_course_name";
const DEFAULT_STUDENT_COURSE_NAME = process.env.STUDENT_COURSE_NAME || "STOR113";

function parseStudentCourseNames(value) {
  const input = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!input) {
    return [];
  }

  const parts = input.includes(",") ? input.split(",") : input.split(" ");
  const seen = new Set();
  const courseNames = [];

  for (const part of parts) {
    const courseName = part.trim().slice(0, 120);
    const key = courseName.toLowerCase();
    if (courseName && !seen.has(key)) {
      seen.add(key);
      courseNames.push(courseName);
    }
  }

  return courseNames;
}

function normalizeStudentCourseName(value) {
  return parseStudentCourseNames(value).join(", ");
}

function buildQueueTitle(courseNames) {
  const names = Array.isArray(courseNames) ? courseNames : parseStudentCourseNames(courseNames);
  const prefix = names.length > 0 ? names.join(" / ") : DEFAULT_STUDENT_COURSE_NAME;
  return `${prefix} Office hours queue`;
}

async function getSetting(key, fallbackValue = "") {
  const result = await query(
    `
      SELECT value
      FROM app_settings
      WHERE key = $1
      LIMIT 1;
    `,
    [key]
  );

  return result.rows[0]?.value || fallbackValue;
}

async function setSetting(key, value) {
  const result = await query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING value;
    `,
    [key, value]
  );

  return result.rows[0].value;
}

async function getStudentCourseName() {
  return getSetting(STUDENT_COURSE_NAME_KEY, DEFAULT_STUDENT_COURSE_NAME);
}

async function getStudentCourseNames() {
  const value = await getStudentCourseName();
  const courseNames = parseStudentCourseNames(value);
  return courseNames.length > 0 ? courseNames : parseStudentCourseNames(DEFAULT_STUDENT_COURSE_NAME);
}

async function setStudentCourseName(value) {
  const courseName = normalizeStudentCourseName(value);
  if (!courseName) {
    throw new Error("At least one course name is required.");
  }

  return setSetting(STUDENT_COURSE_NAME_KEY, courseName);
}

module.exports = {
  buildQueueTitle,
  getStudentCourseNames,
  getStudentCourseName,
  normalizeStudentCourseName,
  parseStudentCourseNames,
  setStudentCourseName
};
