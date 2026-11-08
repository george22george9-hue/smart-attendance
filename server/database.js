const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
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

async function initDb() {
  // Create Students table
  await run(`
    CREATE TABLE IF NOT EXISTS students (
      national_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      department TEXT NOT NULL,
      registered_at TEXT NOT NULL
    )
  `);

  // Create Lectures table
  await run(`
    CREATE TABLE IF NOT EXISTS lectures (
      lecture_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      target_dept TEXT NOT NULL DEFAULT 'الكل',
      lecture_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Create Attendance table
  await run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecture_id TEXT NOT NULL,
      national_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      department TEXT NOT NULL,
      scan_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(lecture_id, national_id),
      FOREIGN KEY(lecture_id) REFERENCES lectures(lecture_id)
    )
  `);

  // Create System Config table (for instructor PIN and settings)
  await run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Set default PIN if not exists (default: 1234)
  const pinRow = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
  if (!pinRow) {
    await run(`INSERT INTO config (key, value) VALUES ('instructor_pin', '1234')`);
    console.log('Default Instructor PIN initialized to: 1234');
  }

  console.log('SQLite tables initialized successfully.');
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb
};

