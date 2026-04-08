const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const sslMode = String(process.env.DATABASE_SSL || "").toLowerCase();
const pool = new Pool({
  connectionString,
  ssl: sslMode === "true" ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_entries (
      id BIGSERIAL PRIMARY KEY,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_email TEXT NOT NULL,
      course_context TEXT NOT NULL,
      help_topic TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    ALTER TABLE queue_entries
    ADD COLUMN IF NOT EXISTS meeting_location TEXT;
  `);

  await pool.query(`
    UPDATE queue_entries
    SET meeting_location = 'In person'
    WHERE meeting_location IS NULL;
  `);

  await pool.query(`
    ALTER TABLE queue_entries
    ALTER COLUMN meeting_location SET NOT NULL;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_one_active_per_student
    ON queue_entries (student_id)
    WHERE completed_at IS NULL AND cancelled_at IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS queue_entries_active_joined_idx
    ON queue_entries (joined_at)
    WHERE completed_at IS NULL AND cancelled_at IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS queue_entries_completed_idx
    ON queue_entries (completed_at)
    WHERE completed_at IS NOT NULL;
  `);
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  initDb,
  pool,
  query
};
