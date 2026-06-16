const { query } = require("./db");

function normalizeCourseFilter(courseNames) {
  if (!Array.isArray(courseNames) || courseNames.length === 0) {
    return null;
  }

  const normalized = courseNames.map((courseName) => String(courseName || "").trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

async function getActiveQueue(courseNames) {
  const courseFilter = normalizeCourseFilter(courseNames);
  const result = await query(
    `
      SELECT
        id,
        student_id,
        student_name,
        student_email,
        course_context,
        help_topic,
        meeting_location,
        joined_at,
        EXTRACT(EPOCH FROM (NOW() - joined_at))::INT AS wait_seconds
      FROM queue_entries
      WHERE completed_at IS NULL
        AND cancelled_at IS NULL
        AND ($1::text[] IS NULL OR course_context = ANY($1::text[]))
      ORDER BY joined_at ASC, id ASC;
    `,
    [courseFilter]
  );

  return result.rows;
}

async function getStudentActiveEntry(studentId) {
  const result = await query(
    `
      SELECT
        entry.*,
        EXTRACT(EPOCH FROM (NOW() - entry.joined_at))::INT AS wait_seconds,
        (
          SELECT COUNT(*) + 1
          FROM queue_entries q2
          WHERE q2.completed_at IS NULL
            AND q2.cancelled_at IS NULL
            AND (q2.joined_at < entry.joined_at OR (q2.joined_at = entry.joined_at AND q2.id < entry.id))
        )::INT AS queue_position
      FROM queue_entries entry
      WHERE entry.student_id = $1
        AND entry.completed_at IS NULL
        AND entry.cancelled_at IS NULL
      ORDER BY entry.joined_at ASC
      LIMIT 1;
    `,
    [studentId]
  );

  return result.rows[0] || null;
}

async function joinQueue({ studentId, studentName, studentEmail, courseContext, helpTopic, meetingLocation }) {
  const result = await query(
    `
      INSERT INTO queue_entries (
        student_id,
        student_name,
        student_email,
        course_context,
        help_topic,
        meeting_location
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `,
    [studentId, studentName, studentEmail, courseContext, helpTopic, meetingLocation]
  );

  return result.rows[0];
}

async function leaveQueue(studentId) {
  await query(
    `
      UPDATE queue_entries
      SET cancelled_at = NOW()
      WHERE student_id = $1
        AND completed_at IS NULL
        AND cancelled_at IS NULL;
    `,
    [studentId]
  );
}

async function completeEntry(entryId, courseNames) {
  const courseFilter = normalizeCourseFilter(courseNames);
  await query(
    `
      UPDATE queue_entries
      SET completed_at = NOW()
      WHERE id = $1
        AND completed_at IS NULL
        AND ($2::text[] IS NULL OR course_context = ANY($2::text[]))
        AND cancelled_at IS NULL;
    `,
    [entryId, courseFilter]
  );
}

async function cancelEntry(entryId, courseNames) {
  const courseFilter = normalizeCourseFilter(courseNames);
  await query(
    `
      UPDATE queue_entries
      SET cancelled_at = NOW()
      WHERE id = $1
        AND completed_at IS NULL
        AND ($2::text[] IS NULL OR course_context = ANY($2::text[]))
        AND cancelled_at IS NULL;
    `,
    [entryId, courseFilter]
  );
}

async function getDashboardStats(courseNames) {
  const courseFilter = normalizeCourseFilter(courseNames);
  const [summaryResult, courseStatsResult, completedResult] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (
          WHERE completed_at IS NULL AND cancelled_at IS NULL
        )::INT AS waiting_now,
        COUNT(DISTINCT course_context) FILTER (
          WHERE completed_at IS NULL AND cancelled_at IS NULL
        )::INT AS active_courses_now,
        COUNT(*) FILTER (
          WHERE completed_at >= date_trunc('day', NOW())
        )::INT AS helped_today,
        COUNT(*) FILTER (
          WHERE cancelled_at >= date_trunc('day', NOW())
        )::INT AS left_today,
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - joined_at))) FILTER (
            WHERE completed_at IS NULL AND cancelled_at IS NULL
          )),
          0
        )::INT AS avg_wait_seconds_now,
        COALESCE(
          MAX(EXTRACT(EPOCH FROM (NOW() - joined_at))) FILTER (
            WHERE completed_at IS NULL AND cancelled_at IS NULL
          ),
          0
        )::INT AS longest_wait_seconds_now,
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - joined_at))) FILTER (
            WHERE completed_at >= date_trunc('day', NOW())
          )),
          0
        )::INT AS avg_wait_seconds_today,
        COALESCE(
          MAX(EXTRACT(EPOCH FROM (completed_at - joined_at))) FILTER (
            WHERE completed_at >= date_trunc('day', NOW())
          ),
          0
        )::INT AS longest_wait_seconds_today
      FROM queue_entries
      WHERE $1::text[] IS NULL OR course_context = ANY($1::text[]);
    `, [courseFilter]),
    query(`
      SELECT
        course_context,
        COUNT(*) FILTER (
          WHERE completed_at IS NULL AND cancelled_at IS NULL
        )::INT AS waiting_now,
        COUNT(*) FILTER (
          WHERE completed_at >= date_trunc('day', NOW())
        )::INT AS helped_today,
        COUNT(*) FILTER (
          WHERE cancelled_at >= date_trunc('day', NOW())
        )::INT AS left_today,
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - joined_at))) FILTER (
            WHERE completed_at IS NULL AND cancelled_at IS NULL
          )),
          0
        )::INT AS avg_wait_seconds_now,
        COALESCE(
          MAX(EXTRACT(EPOCH FROM (NOW() - joined_at))) FILTER (
            WHERE completed_at IS NULL AND cancelled_at IS NULL
          ),
          0
        )::INT AS longest_wait_seconds_now,
        COALESCE(
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - joined_at))) FILTER (
            WHERE completed_at >= date_trunc('day', NOW())
          )),
          0
        )::INT AS avg_wait_seconds_today
      FROM queue_entries
      WHERE $1::text[] IS NULL OR course_context = ANY($1::text[])
      GROUP BY course_context
      ORDER BY course_context ASC;
    `, [courseFilter]),
    query(`
      SELECT
        id,
        student_name,
        course_context,
        help_topic,
        meeting_location,
        joined_at,
        completed_at,
        EXTRACT(EPOCH FROM (completed_at - joined_at))::INT AS wait_seconds
      FROM queue_entries
      WHERE completed_at >= date_trunc('day', NOW())
        AND ($1::text[] IS NULL OR course_context = ANY($1::text[]))
      ORDER BY completed_at DESC
      LIMIT 25;
    `, [courseFilter])
  ]);

  return {
    summary: summaryResult.rows[0],
    courseStats: courseStatsResult.rows,
    completedToday: completedResult.rows
  };
}

module.exports = {
  cancelEntry,
  completeEntry,
  getActiveQueue,
  getDashboardStats,
  getStudentActiveEntry,
  joinQueue,
  leaveQueue
};
