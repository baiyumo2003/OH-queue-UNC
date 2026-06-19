const { query } = require("./db");
const { normalizeUserId } = require("./utils");

function normalizeTaIdentifier(value) {
  return normalizeUserId(value);
}

function normalizeTaEmail(email, identifier) {
  const value = String(email || "").trim().toLowerCase();
  if (value) {
    return value;
  }

  const fallback = normalizeTaIdentifier(identifier);
  return fallback ? `${fallback}@unc.edu` : "";
}

function normalizeTaName(value) {
  return String(value || "").trim();
}

function normalizeCourseName(value) {
  return String(value || "").trim();
}

async function addCourseTa({ courseName, taIdentifier, taName, taEmail, notifyEmail }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeTaIdentifier(taIdentifier || taEmail);
  const normalizedName = normalizeTaName(taName);
  const normalizedEmail = normalizeTaEmail(taEmail, normalizedIdentifier);

  if (!normalizedCourseName || !normalizedIdentifier || !normalizedEmail) {
    throw new Error("Course, TA identifier, and TA email are required.");
  }

  const result = await query(
    `
      INSERT INTO course_tas (course_name, ta_identifier, ta_name, ta_email, notify_email)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (course_name, ta_identifier)
      DO UPDATE SET ta_name = EXCLUDED.ta_name, ta_email = EXCLUDED.ta_email, notify_email = EXCLUDED.notify_email
      RETURNING id, course_name, ta_identifier, ta_name, ta_email, notify_email;
    `,
    [normalizedCourseName, normalizedIdentifier, normalizedName || null, normalizedEmail, Boolean(notifyEmail)]
  );

  return result.rows[0];
}

async function removeCourseTa(taId) {
  await query(
    `
      DELETE FROM course_tas
      WHERE id = $1;
    `,
    [taId]
  );
}

async function setCourseTaNotification({ courseName, taIdentifier, notifyEmail }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeTaIdentifier(taIdentifier);
  if (!normalizedCourseName || !normalizedIdentifier) {
    throw new Error("Course and TA identifier are required.");
  }

  const result = await query(
    `
      UPDATE course_tas
      SET notify_email = $3
      WHERE course_name = $1
        AND ta_identifier = $2
      RETURNING id, course_name, ta_identifier, ta_name, ta_email, notify_email;
    `,
    [normalizedCourseName, normalizedIdentifier, Boolean(notifyEmail)]
  );

  return result.rows[0] || null;
}

async function getCourseTaById(taId) {
  const result = await query(
    `
      SELECT id, course_name, ta_identifier, ta_name, ta_email, notify_email
      FROM course_tas
      WHERE id = $1
      LIMIT 1;
    `,
    [taId]
  );

  return result.rows[0] || null;
}

async function getCourseTas(courseNames = []) {
  const normalizedCourseNames = courseNames.map(normalizeCourseName).filter(Boolean);
  const result = await query(
    `
      SELECT id, course_name, ta_identifier, ta_name, ta_email, notify_email
      FROM course_tas
      WHERE $1::text[] IS NULL OR course_name = ANY($1::text[])
      ORDER BY course_name ASC, COALESCE(ta_name, ta_identifier) ASC;
    `,
    [normalizedCourseNames.length > 0 ? normalizedCourseNames : null]
  );

  return result.rows;
}

function groupTasByCourse(courseTas) {
  const grouped = new Map();
  for (const ta of courseTas) {
    if (!grouped.has(ta.course_name)) {
      grouped.set(ta.course_name, []);
    }
    grouped.get(ta.course_name).push(ta);
  }
  return grouped;
}

async function getTaCoursesForUser(userId, email) {
  const identifiers = [normalizeTaIdentifier(userId), normalizeTaIdentifier(email)]
    .filter(Boolean);
  const emailValue = String(email || "").trim().toLowerCase();

  const result = await query(
    `
      SELECT DISTINCT course_name
      FROM course_tas
      WHERE ta_identifier = ANY($1::text[])
        OR ta_email = $2
      ORDER BY course_name ASC;
    `,
    [identifiers, emailValue]
  );

  return result.rows.map((row) => row.course_name);
}

async function getNotificationEmailsForCourse(courseName) {
  const result = await query(
    `
      SELECT ta_email
      FROM course_tas
      WHERE course_name = $1
        AND notify_email = true
      ORDER BY ta_email ASC;
    `,
    [normalizeCourseName(courseName)]
  );

  return result.rows.map((row) => row.ta_email);
}

module.exports = {
  addCourseTa,
  getCourseTaById,
  getCourseTas,
  getNotificationEmailsForCourse,
  getTaCoursesForUser,
  groupTasByCourse,
  normalizeTaEmail,
  normalizeTaIdentifier,
  normalizeTaName,
  removeCourseTa,
  setCourseTaNotification
};
