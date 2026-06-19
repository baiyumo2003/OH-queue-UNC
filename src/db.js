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
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_entry_images (
      id BIGSERIAL PRIMARY KEY,
      entry_id BIGINT NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_tas (
      id BIGSERIAL PRIMARY KEY,
      course_name TEXT NOT NULL,
      ta_identifier TEXT NOT NULL,
      ta_name TEXT,
      ta_email TEXT NOT NULL,
      notify_email BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE course_tas
    ADD COLUMN IF NOT EXISTS ta_name TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_professors (
      id BIGSERIAL,
      course_name TEXT NOT NULL,
      professor_identifier TEXT NOT NULL,
      professor_email TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE course_professors
    DROP CONSTRAINT IF EXISTS course_professors_pkey;
  `);

  await pool.query(`
    ALTER TABLE course_professors
    ADD COLUMN IF NOT EXISTS id BIGSERIAL;
  `);

  await pool.query(`
    ALTER TABLE course_professors
    ALTER COLUMN course_name SET NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE course_professors
    ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true;
  `);

  await pool.query(`
    ALTER TABLE course_professors
    ADD COLUMN IF NOT EXISTS professor_name TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_roster_settings (
      course_name TEXT PRIMARY KEY,
      restrict_to_roster BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_allowed_students (
      id BIGSERIAL PRIMARY KEY,
      course_name TEXT NOT NULL,
      student_identifier TEXT NOT NULL,
      student_name TEXT,
      student_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `
      INSERT INTO app_settings (key, value)
      VALUES ('student_course_name', $1)
      ON CONFLICT (key) DO NOTHING;
    `,
    [process.env.STUDENT_COURSE_NAME || "STOR113"]
  );

  await pool.query(`
    ALTER TABLE queue_entries
    ADD COLUMN IF NOT EXISTS meeting_location TEXT;
  `);

  await pool.query(`
    ALTER TABLE queue_entries
    ADD COLUMN IF NOT EXISTS help_topic_html TEXT;
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS queue_entry_images_entry_id_idx
    ON queue_entry_images (entry_id);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS course_tas_course_identifier_idx
    ON course_tas (course_name, ta_identifier);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS course_tas_identifier_idx
    ON course_tas (ta_identifier);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS course_professors_identifier_idx
    ON course_professors (professor_identifier);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS course_professors_id_idx
    ON course_professors (id);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS course_professors_course_identifier_idx
    ON course_professors (course_name, professor_identifier);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS course_allowed_students_course_identifier_idx
    ON course_allowed_students (course_name, student_identifier);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS course_allowed_students_identifier_idx
    ON course_allowed_students (student_identifier);
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
