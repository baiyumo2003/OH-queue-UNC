const { query } = require("./db");
const { normalizeUserId } = require("./utils");

function normalizeCourseName(value) {
  return String(value || "").trim();
}

function normalizeIdentifier(value) {
  return normalizeUserId(value);
}

function normalizeEmail(email, identifier) {
  const value = String(email || "").trim().toLowerCase();
  if (value) {
    return value;
  }

  const fallback = normalizeIdentifier(identifier);
  return fallback ? `${fallback}@unc.edu` : "";
}

async function getCourseProfessors(courseNames = []) {
  const normalizedCourseNames = courseNames.map(normalizeCourseName).filter(Boolean);
  const result = await query(
    `
      SELECT id, course_name, professor_identifier, professor_name, professor_email, notify_email, updated_at
      FROM course_professors
      WHERE $1::text[] IS NULL OR course_name = ANY($1::text[])
      ORDER BY course_name ASC, COALESCE(professor_name, professor_identifier) ASC;
    `,
    [normalizedCourseNames.length > 0 ? normalizedCourseNames : null]
  );

  return result.rows;
}

function professorsByCourse(courseProfessors) {
  const grouped = new Map();
  for (const professor of courseProfessors) {
    if (!grouped.has(professor.course_name)) {
      grouped.set(professor.course_name, []);
    }
    grouped.get(professor.course_name).push(professor);
  }
  return grouped;
}

function professorOptions(courseProfessors) {
  const professors = new Map();
  for (const professor of courseProfessors) {
    const key = professor.professor_identifier;
    if (!professors.has(key)) {
      const option = {
        professor_identifier: professor.professor_identifier,
        professor_email: professor.professor_email,
        courseNames: []
      };
      if (professor.professor_name) {
        option.professor_name = professor.professor_name;
      }
      professors.set(key, option);
    } else if (professor.professor_name && !professors.get(key).professor_name) {
      professors.get(key).professor_name = professor.professor_name;
    }
    professors.get(key).courseNames.push(professor.course_name);
  }

  return Array.from(professors.values()).sort((left, right) =>
    left.professor_identifier.localeCompare(right.professor_identifier)
  );
}

function getProfessorCoursesFromAssignments(courseProfessors, professorIdentifier) {
  const normalizedIdentifier = normalizeIdentifier(professorIdentifier);
  if (!normalizedIdentifier) {
    return [];
  }

  return courseProfessors
    .filter((professor) => professor.professor_identifier === normalizedIdentifier)
    .map((professor) => professor.course_name);
}

async function getProfessorCoursesForUser(userId, email) {
  const identifiers = [normalizeIdentifier(userId), normalizeIdentifier(email)].filter(Boolean);
  const emailValue = String(email || "").trim().toLowerCase();
  const result = await query(
    `
      SELECT course_name
      FROM course_professors
      WHERE professor_identifier = ANY($1::text[])
        OR professor_email = $2
      ORDER BY course_name ASC;
    `,
    [identifiers, emailValue]
  );

  return result.rows.map((row) => row.course_name);
}

async function getProfessorProfile(professorIdentifier) {
  const normalizedIdentifier = normalizeIdentifier(professorIdentifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const result = await query(
    `
      SELECT professor_identifier, professor_name, professor_email
      FROM course_professors
      WHERE professor_identifier = $1
      ORDER BY professor_name NULLS LAST, updated_at DESC
      LIMIT 1;
    `,
    [normalizedIdentifier]
  );

  return result.rows[0] || null;
}

async function assignCourseProfessor({ courseName, professorIdentifier, professorName, professorEmail, notifyEmail = true }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeIdentifier(professorIdentifier || professorEmail);
  const normalizedName = String(professorName || "").trim();
  const normalizedEmail = normalizeEmail(professorEmail, normalizedIdentifier);

  if (!normalizedCourseName || !normalizedIdentifier || !normalizedEmail) {
    throw new Error("Course, professor identifier, and professor email are required.");
  }

  const result = await query(
    `
      INSERT INTO course_professors (course_name, professor_identifier, professor_name, professor_email, notify_email, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (course_name, professor_identifier)
      DO UPDATE SET
        professor_name = EXCLUDED.professor_name,
        professor_email = EXCLUDED.professor_email,
        notify_email = EXCLUDED.notify_email,
        updated_at = NOW()
      RETURNING id, course_name, professor_identifier, professor_name, professor_email, notify_email, updated_at;
    `,
    [normalizedCourseName, normalizedIdentifier, normalizedName || null, normalizedEmail, Boolean(notifyEmail)]
  );

  return { professor: result.rows[0] };
}

async function setCourseProfessorNotification({ courseName, professorIdentifier, notifyEmail }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeIdentifier(professorIdentifier);
  if (!normalizedCourseName || !normalizedIdentifier) {
    throw new Error("Course and professor identifier are required.");
  }

  const result = await query(
    `
      UPDATE course_professors
      SET notify_email = $3, updated_at = NOW()
      WHERE course_name = $1
        AND professor_identifier = $2
      RETURNING id, course_name, professor_identifier, professor_name, professor_email, notify_email, updated_at;
    `,
    [normalizedCourseName, normalizedIdentifier, Boolean(notifyEmail)]
  );

  return result.rows[0] || null;
}

async function getProfessorNotificationEmailsForCourse(courseName) {
  const result = await query(
    `
      SELECT professor_email
      FROM course_professors
      WHERE course_name = $1
        AND notify_email = true
      ORDER BY professor_email ASC;
    `,
    [normalizeCourseName(courseName)]
  );

  return result.rows.map((row) => row.professor_email);
}

async function removeCourseProfessor({ courseName, professorIdentifier }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeIdentifier(professorIdentifier);
  if (!normalizedCourseName || !normalizedIdentifier) {
    throw new Error("Course and professor identifier are required.");
  }

  await query(
    `
      DELETE FROM course_professors
      WHERE course_name = $1
        AND professor_identifier = $2;
    `,
    [normalizedCourseName, normalizedIdentifier]
  );
}

async function getRosterSettings(courseNames = []) {
  const normalizedCourseNames = courseNames.map(normalizeCourseName).filter(Boolean);
  const result = await query(
    `
      SELECT course_name, restrict_to_roster, updated_at
      FROM course_roster_settings
      WHERE $1::text[] IS NULL OR course_name = ANY($1::text[])
      ORDER BY course_name ASC;
    `,
    [normalizedCourseNames.length > 0 ? normalizedCourseNames : null]
  );

  return result.rows;
}

function rosterSettingsByCourse(settings) {
  return new Map(settings.map((setting) => [setting.course_name, setting]));
}

async function setRosterRestriction(courseName, restrictToRoster) {
  const normalizedCourseName = normalizeCourseName(courseName);
  if (!normalizedCourseName) {
    throw new Error("Course is required.");
  }

  const result = await query(
    `
      INSERT INTO course_roster_settings (course_name, restrict_to_roster, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (course_name)
      DO UPDATE SET restrict_to_roster = EXCLUDED.restrict_to_roster, updated_at = NOW()
      RETURNING course_name, restrict_to_roster, updated_at;
    `,
    [normalizedCourseName, Boolean(restrictToRoster)]
  );

  return result.rows[0];
}

async function addAllowedStudent({ courseName, studentIdentifier, studentName, studentEmail }) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const normalizedIdentifier = normalizeIdentifier(studentIdentifier || studentEmail);
  const normalizedEmail = normalizeEmail(studentEmail, normalizedIdentifier);
  const normalizedName = String(studentName || "").trim();

  if (!normalizedCourseName || !normalizedIdentifier) {
    throw new Error("Course and student ONYEN are required.");
  }

  const result = await query(
    `
      INSERT INTO course_allowed_students (course_name, student_identifier, student_name, student_email)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (course_name, student_identifier)
      DO UPDATE SET student_name = EXCLUDED.student_name, student_email = EXCLUDED.student_email
      RETURNING id, course_name, student_identifier, student_name, student_email, created_at;
    `,
    [normalizedCourseName, normalizedIdentifier, normalizedName || null, normalizedEmail || null]
  );

  return result.rows[0];
}

async function removeAllowedStudent(studentId) {
  await query(
    `
      DELETE FROM course_allowed_students
      WHERE id = $1;
    `,
    [studentId]
  );
}

async function getAllowedStudentById(studentId) {
  const result = await query(
    `
      SELECT id, course_name, student_identifier, student_name, student_email
      FROM course_allowed_students
      WHERE id = $1
      LIMIT 1;
    `,
    [studentId]
  );

  return result.rows[0] || null;
}

async function getAllowedStudents(courseNames = []) {
  const normalizedCourseNames = courseNames.map(normalizeCourseName).filter(Boolean);
  const result = await query(
    `
      SELECT id, course_name, student_identifier, student_name, student_email, created_at
      FROM course_allowed_students
      WHERE $1::text[] IS NULL OR course_name = ANY($1::text[])
      ORDER BY course_name ASC, student_identifier ASC;
    `,
    [normalizedCourseNames.length > 0 ? normalizedCourseNames : null]
  );

  return result.rows;
}

function allowedStudentsByCourse(students) {
  const grouped = new Map();
  for (const student of students) {
    if (!grouped.has(student.course_name)) {
      grouped.set(student.course_name, []);
    }
    grouped.get(student.course_name).push(student);
  }
  return grouped;
}

async function getAllowedStudentCounts(courseNames = []) {
  const normalizedCourseNames = courseNames.map(normalizeCourseName).filter(Boolean);
  const result = await query(
    `
      SELECT course_name, COUNT(*)::INT AS allowed_student_count
      FROM course_allowed_students
      WHERE $1::text[] IS NULL OR course_name = ANY($1::text[])
      GROUP BY course_name
      ORDER BY course_name ASC;
    `,
    [normalizedCourseNames.length > 0 ? normalizedCourseNames : null]
  );

  return new Map(result.rows.map((row) => [row.course_name, Number(row.allowed_student_count || 0)]));
}

async function isStudentAllowedForCourse(courseName, studentId, email) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const settings = await query(
    `
      SELECT restrict_to_roster
      FROM course_roster_settings
      WHERE course_name = $1
      LIMIT 1;
    `,
    [normalizedCourseName]
  );

  if (!settings.rows[0]?.restrict_to_roster) {
    return { allowed: true, restricted: false };
  }

  const identifiers = [normalizeIdentifier(studentId), normalizeIdentifier(email)].filter(Boolean);
  const emailValue = String(email || "").trim().toLowerCase();
  const student = await query(
    `
      SELECT id
      FROM course_allowed_students
      WHERE course_name = $1
        AND (student_identifier = ANY($2::text[]) OR student_email = $3)
      LIMIT 1;
    `,
    [normalizedCourseName, identifiers, emailValue]
  );

  return { allowed: student.rows.length > 0, restricted: true };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell || "").trim())) {
    rows.push(row);
  }

  return rows;
}

function parseRosterCsv(text) {
  const rows = parseCsvRows(String(text || "").replace(/^\uFEFF/, ""));
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const loginIndex = headers.indexOf("sis login id");
  const nameIndex = headers.indexOf("student");

  if (loginIndex === -1) {
    throw new Error("CSV must include a SIS Login ID column.");
  }

  const students = [];
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const identifier = normalizeIdentifier(row[loginIndex]);
    if (!identifier || seen.has(identifier)) {
      continue;
    }

    seen.add(identifier);
    students.push({
      studentIdentifier: identifier,
      studentName: nameIndex >= 0 ? String(row[nameIndex] || "").trim() : "",
      studentEmail: `${identifier}@unc.edu`
    });
  }

  return students;
}

async function importAllowedStudentsFromCsv(courseName, csvText) {
  const students = parseRosterCsv(csvText);
  for (const student of students) {
    await addAllowedStudent({ courseName, ...student });
  }

  return students.length;
}

async function getCoursePackage(courseName) {
  const normalizedCourseName = normalizeCourseName(courseName);
  const [professors, tas, rosterSettings, allowedStudents, entries] = await Promise.all([
    getCourseProfessors([normalizedCourseName]),
    query(
      `
        SELECT id, course_name, ta_identifier, ta_name, ta_email, notify_email, created_at
        FROM course_tas
        WHERE course_name = $1
        ORDER BY COALESCE(ta_name, ta_identifier) ASC;
      `,
      [normalizedCourseName]
    ),
    getRosterSettings([normalizedCourseName]),
    getAllowedStudents([normalizedCourseName]),
    query(
      `
        SELECT *
        FROM queue_entries
        WHERE course_context = $1
        ORDER BY joined_at ASC, id ASC;
      `,
      [normalizedCourseName]
    )
  ]);

  return {
    courseName: normalizedCourseName,
    exportedAt: new Date().toISOString(),
    professors,
    tas: tas.rows,
    rosterSettings: rosterSettings[0] || { course_name: normalizedCourseName, restrict_to_roster: false },
    allowedStudents,
    queueEntries: entries.rows
  };
}

module.exports = {
  addAllowedStudent,
  allowedStudentsByCourse,
  assignCourseProfessor,
  getAllowedStudentCounts,
  getAllowedStudentById,
  getAllowedStudents,
  getCoursePackage,
  getCourseProfessors,
  getProfessorCoursesFromAssignments,
  getProfessorCoursesForUser,
  getProfessorNotificationEmailsForCourse,
  getProfessorProfile,
  getRosterSettings,
  importAllowedStudentsFromCsv,
  isStudentAllowedForCourse,
  normalizeEmail,
  normalizeIdentifier,
  parseRosterCsv,
  professorOptions,
  professorsByCourse,
  removeAllowedStudent,
  removeCourseProfessor,
  rosterSettingsByCourse,
  setCourseProfessorNotification,
  setRosterRestriction
};
