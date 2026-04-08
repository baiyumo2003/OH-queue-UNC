const { query } = require("./db");

async function getActiveQueue() {
  const result = await query(
    `
      SELECT
        id,
        student_id,
        student_name,
        student_email,
        course_context,
        help_topic,
        joined_at,
        EXTRACT(EPOCH FROM (NOW() - joined_at))::INT AS wait_seconds
      FROM queue_entries
      WHERE completed_at IS NULL
        AND cancelled_at IS NULL
      ORDER BY joined_at ASC, id ASC;
    `
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

async function joinQueue({ studentId, studentName, studentEmail, courseContext, helpTopic }) {
  const result = await query(
    `
      INSERT INTO queue_entries (
        student_id,
        student_name,
        student_email,
        course_context,
        help_topic
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `,
    [studentId, studentName, studentEmail, courseContext, helpTopic]
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

async function completeEntry(entryId) {
  await query(
    `
      UPDATE queue_entries
      SET completed_at = NOW()
      WHERE id = $1
        AND completed_at IS NULL
        AND cancelled_at IS NULL;
    `,
    [entryId]
  );
}

async function cancelEntry(entryId) {
  await query(
    `
      UPDATE queue_entries
      SET cancelled_at = NOW()
      WHERE id = $1
        AND completed_at IS NULL
        AND cancelled_at IS NULL;
    `,
    [entryId]
  );
}

async function getDashboardStats() {
  const [summaryResult, completedResult] = await Promise.all([
    query(`
      SELECT
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
      FROM queue_entries;
    `),
    query(`
      SELECT
        id,
        student_name,
        course_context,
        help_topic,
        joined_at,
        completed_at,
        EXTRACT(EPOCH FROM (completed_at - joined_at))::INT AS wait_seconds
      FROM queue_entries
      WHERE completed_at >= date_trunc('day', NOW())
      ORDER BY completed_at DESC
      LIMIT 25;
    `)
  ]);

  return {
    summary: summaryResult.rows[0],
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
