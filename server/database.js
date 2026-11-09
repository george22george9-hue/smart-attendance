const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// On Vercel serverless environment, use /tmp directory for writable SQLite DB
const dataDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'attendance.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Enable Foreign Key constraints
db.run('PRAGMA foreign_keys = ON;');

// Helper for promise-based queries
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Safely add column if it doesn't already exist in SQLite table
async function safeAddColumn(table, columnDef) {
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    // Column already exists or syntax error - safely ignore duplicate column
  }
}

async function initDb() {
  await run('PRAGMA foreign_keys = ON;');

  // 1. Create Students table
  await run(`
    CREATE TABLE IF NOT EXISTS students (
      national_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      academic_year TEXT NOT NULL DEFAULT 'الفرقة الأولى',
      department TEXT NOT NULL,
      password TEXT DEFAULT '',
      registered_at TEXT NOT NULL
    )
  `);
  await safeAddColumn('students', "academic_year TEXT NOT NULL DEFAULT 'الفرقة الأولى'");
  await safeAddColumn('students', "password TEXT DEFAULT ''");

  // 2. Create Lectures table
  await run(`
    CREATE TABLE IF NOT EXISTS lectures (
      lecture_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'محاضرة نظري',
      instructor_id TEXT DEFAULT '',
      instructor_name TEXT DEFAULT '',
      target_year TEXT NOT NULL DEFAULT 'الكل',
      target_dept TEXT NOT NULL DEFAULT 'الكل',
      lecture_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await safeAddColumn('lectures', "session_type TEXT NOT NULL DEFAULT 'محاضرة نظري'");
  await safeAddColumn('lectures', "instructor_id TEXT DEFAULT ''");
  await safeAddColumn('lectures', "instructor_name TEXT DEFAULT ''");
  await safeAddColumn('lectures', "target_year TEXT NOT NULL DEFAULT 'الكل'");

  // 3. Create Attendance table
  await run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecture_id TEXT NOT NULL,
      national_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      academic_year TEXT NOT NULL DEFAULT 'الفرقة الأولى',
      department TEXT NOT NULL,
      session_type TEXT DEFAULT 'محاضرة نظري',
      instructor_name TEXT DEFAULT '',
      scan_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(lecture_id, national_id),
      FOREIGN KEY(lecture_id) REFERENCES lectures(lecture_id) ON DELETE CASCADE
    )
  `);
  await safeAddColumn('attendance', "academic_year TEXT NOT NULL DEFAULT 'الفرقة الأولى'");
  await safeAddColumn('attendance', "session_type TEXT DEFAULT 'محاضرة نظري'");
  await safeAddColumn('attendance', "instructor_name TEXT DEFAULT ''");

  // 4. Create Instructors table
  await run(`
    CREATE TABLE IF NOT EXISTS instructors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dept TEXT NOT NULL DEFAULT 'الكل',
      role TEXT NOT NULL DEFAULT 'دكتور',
      pin TEXT NOT NULL DEFAULT '1234',
      created_at TEXT NOT NULL
    )
  `);

  // 5. Create Broadcast Messages table
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_value TEXT DEFAULT '',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      instructor_name TEXT DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  // 6. Create System Config table (for instructor PIN and settings)
  await run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Set default Master PIN if not exists
  const pinRow = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
  if (!pinRow) {
    await run(`INSERT INTO config (key, value) VALUES ('instructor_pin', '1234')`);
  }

  // Prepopulate default instructors if empty
  const instCount = await get(`SELECT COUNT(*) as count FROM instructors`);
  if (instCount && instCount.count === 0) {
    const defaultInstructors = [
      ['doc_1', 'د. محمد صبري', 'الكل', 'معيد • قسم الكل', '1234', new Date().toISOString()],
      ['doc_2', 'د. راندا العشري', 'آلات', 'دكتور • قسم الآلات', '1234', new Date().toISOString()],
      ['doc_3', 'د. علي عبد الحميد', 'نظم', 'دكتور • قسم النظم', '1234', new Date().toISOString()],
      ['doc_4', 'د. إبراهيم محمد', 'ري', 'دكتور • قسم الري', '1234', new Date().toISOString()],
      ['doc_5', 'د. سمير حامد', 'عام', 'دكتور • قسم عام', '1234', new Date().toISOString()]
    ];
    for (const inst of defaultInstructors) {
      await run(
        `INSERT INTO instructors (id, name, dept, role, pin, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        inst
      );
    }
  }

  console.log('SQLite tables & schema migrations initialized successfully.');
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb
};
