const { query } = require("./db");

const STUDENT_COURSE_NAME_KEY = "student_course_name";
const DEFAULT_STUDENT_COURSE_NAME = process.env.STUDENT_COURSE_NAME || "STOR113";

function normalizeStudentCourseName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
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

async function setStudentCourseName(value) {
  const courseName = normalizeStudentCourseName(value);
  if (!courseName) {
    throw new Error("Course name is required.");
  }

  return setSetting(STUDENT_COURSE_NAME_KEY, courseName);
}

module.exports = {
  getStudentCourseName,
  normalizeStudentCourseName,
  setStudentCourseName
};
