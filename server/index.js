require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, run, get, all } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_INSTRUCTOR_PIN = process.env.DEFAULT_INSTRUCTOR_PIN || '1234';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Simple In-Memory Brute-Force Rate Limiter for PIN Attempts
const failedAttempts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (now > entry.resetAt) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= 8;
}
function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  entry.count++;
  failedAttempts.set(ip, entry);
}
function resetFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// =========================================================================
// API Routes
// =========================================================================

// 1. Instructor PIN verification and settings
app.post('/api/instructor/verify-pin', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, message: 'محاولات دخول كثيرة خاطئة. يرجى الانتظار 5 دقائق.' });
  }

  try {
    const { pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال الرمز السري' });
    }
    const cleanPin = String(pin).trim();
    const row = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
    const currentPin = row ? row.value : DEFAULT_INSTRUCTOR_PIN;

    if (cleanPin === String(currentPin).trim()) {
      resetFailedAttempts(clientIp);
      return res.json({ success: true, message: 'تم التحقق بنجاح' });
    } else {
      recordFailedAttempt(clientIp);
      return res.status(401).json({ success: false, message: 'الرمز السري غير صحيح' });
    }
  } catch (err) {
    console.error('PIN verify error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

app.post('/api/instructor/change-pin', async (req, res) => {
  try {
    const { oldPin, newPin } = req.body || {};
    if (!oldPin || !newPin) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }
    const cleanOldPin = String(oldPin).trim();
    const cleanNewPin = String(newPin).trim();

    const row = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
    const currentPin = row ? row.value : DEFAULT_INSTRUCTOR_PIN;

    if (cleanOldPin !== String(currentPin).trim()) {
      return res.status(401).json({ success: false, message: 'الرمز السري الحالي غير صحيح' });
    }

    if (cleanNewPin.length < 4) {
      return res.status(400).json({ success: false, message: 'الرمز السري الجديد يجب ألا يقل عن 4 أرقام' });
    }

    await run(`UPDATE config SET value = ? WHERE key = 'instructor_pin'`, [cleanNewPin]);
    res.json({ success: true, message: 'تم تغيير الرمز السري بنجاح' });
  } catch (err) {
    console.error('Change PIN error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

// 2. Instructors Management API (Multi-doctor system)
app.get('/api/instructors', async (req, res) => {
  try {
    const instructors = await all(
      `SELECT id, name, role, department, avatar, is_admin, created_at FROM instructors ORDER BY id ASC`
    );
    res.json({ success: true, instructors });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل استرجاع بيانات المحاضرين' });
  }
});

app.post('/api/instructors/login', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, message: 'محاولات دخول كثيرة خاطئة. يرجى الانتظار 5 دقائق.' });
  }

  try {
    const { instructor_id, pin } = req.body || {};
    if (!instructor_id || !pin) {
      return res.status(400).json({ success: false, message: 'يرجى اختيار المحاضر وإدخال رمز PIN' });
    }

    const inst = await get(
      `SELECT id, name, role, department, avatar, pin, is_admin FROM instructors WHERE id = ?`,
      [instructor_id]
    );

    if (!inst) {
      return res.status(404).json({ success: false, message: 'المحاضر غير مسجل بالنظام' });
    }

    if (String(pin).trim() === String(inst.pin).trim()) {
      resetFailedAttempts(clientIp);
      const { pin: _p, ...safeInstructor } = inst;
      return res.json({ success: true, instructor: safeInstructor, message: 'تم الدخول بنجاح' });
    } else {
      recordFailedAttempt(clientIp);
      return res.status(401).json({ success: false, message: 'رمز PIN الخاص بالمحاضر غير صحيح' });
    }
  } catch (err) {
    console.error('Instructor login error:', err);
    res.status(500).json({ success: false, message: 'خطأ في التحقق من المحاضر' });
  }
});

// 3. Students API
app.post('/api/students', async (req, res) => {
  try {
    const { national_id, full_name, department, academic_year, password, registered_at } = req.body || {};
    if (!national_id || !full_name || !department) {
      return res.status(400).json({ success: false, message: 'بيانات الطالب غير مكتملة' });
    }

    const regAt = registered_at || new Date().toISOString();
    const year = academic_year || 'الفرقة الرابعة';
    const pwd = password ? String(password).trim() : null;

    await run(
      `INSERT INTO students (national_id, full_name, department, academic_year, password, registered_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(national_id) DO UPDATE SET
       full_name = excluded.full_name,
       department = excluded.department,
       academic_year = COALESCE(excluded.academic_year, students.academic_year),
       password = COALESCE(excluded.password, students.password)`,
      [String(national_id).trim(), String(full_name).trim(), String(department).trim(), year, pwd, regAt]
    );

    res.json({ success: true, message: 'تم تسجيل الطالب بنجاح' });
  } catch (err) {
    console.error('Save student error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حفظ بيانات الطالب' });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const students = await all(
      `SELECT national_id, full_name, department, academic_year, registered_at FROM students ORDER BY registered_at DESC`
    );
    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل استرجاع بيانات الطلاب' });
  }
});

// 4. Lectures API
app.post('/api/lectures', async (req, res) => {
  try {
    const {
      lecture_id,
      title,
      target_dept,
      lecture_date,
      session_type,
      instructor_id,
      instructor_name,
      target_year
    } = req.body || {};

    if (!lecture_id || !title) {
      return res.status(400).json({ success: false, message: 'بيانات المحاضرة غير مكتملة' });
    }

    const createdAt = new Date().toISOString();
    const date = lecture_date || new Date().toLocaleDateString('ar-EG');
    const target = target_dept || 'الكل';
    const sType = session_type || 'نظري';
    const instId = instructor_id || 'inst_default';
    const instName = instructor_name || 'د. محمد صبري';
    const tYear = target_year || 'الفرقة الرابعة';

    await run(
      `INSERT INTO lectures (lecture_id, title, target_dept, lecture_date, session_type, instructor_id, instructor_name, target_year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lecture_id) DO UPDATE SET
       title = excluded.title,
       target_dept = excluded.target_dept,
       session_type = COALESCE(excluded.session_type, lectures.session_type),
       instructor_id = COALESCE(excluded.instructor_id, lectures.instructor_id),
       instructor_name = COALESCE(excluded.instructor_name, lectures.instructor_name),
       target_year = COALESCE(excluded.target_year, lectures.target_year)`,
      [lecture_id, title, target, date, sType, instId, instName, tYear, createdAt]
    );

    res.json({ success: true, message: 'تم حفظ المحاضرة بنجاح' });
  } catch (err) {
    console.error('Save lecture error:', err);
    res.status(500).json({ success: false, message: 'فشل في حفظ المحاضرة' });
  }
});

app.get('/api/lectures', async (req, res) => {
  try {
    const { instructor_id } = req.query;
    let query = `
      SELECT l.*, 
        (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.lecture_id) as attendees_count
      FROM lectures l 
    `;
    const params = [];
    if (instructor_id) {
      query += ` WHERE l.instructor_id = ? `;
      params.push(instructor_id);
    }
    query += ` ORDER BY l.created_at DESC `;

    const lectures = await all(query, params);
    res.json({ success: true, lectures });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل استرجاع المحاضرات' });
  }
});

app.get('/api/lectures/:id', async (req, res) => {
  try {
    const lecture = await get(`SELECT * FROM lectures WHERE lecture_id = ?`, [req.params.id]);
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'المحاضرة غير موجودة' });
    }

    const attendance = await all(
      `SELECT * FROM attendance WHERE lecture_id = ? ORDER BY id ASC`,
      [req.params.id]
    );

    res.json({ success: true, lecture, attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات المحاضرة' });
  }
});

// 5. Attendance API
app.post('/api/attendance', async (req, res) => {
  try {
    const {
      lecture_id,
      national_id,
      student_name,
      department,
      scan_time,
      academic_year,
      session_type,
      instructor_name
    } = req.body || {};

    if (!lecture_id || !national_id || !student_name || !department) {
      return res.status(400).json({ success: false, message: 'بيانات الحضور غير مكتملة' });
    }

    const createdAt = new Date().toISOString();
    const time = scan_time || new Date().toLocaleTimeString('ar-EG');
    const year = academic_year || 'الفرقة الرابعة';
    const sType = session_type || 'نظري';
    const instName = instructor_name || 'د. محمد صبري';

    // Atomic conflict-free insert or detection
    const result = await run(
      `INSERT INTO attendance (lecture_id, national_id, student_name, department, scan_time, academic_year, session_type, instructor_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lecture_id, national_id) DO NOTHING`,
      [lecture_id, national_id, student_name, department, time, year, sType, instName, createdAt]
    );

    if (result.changes === 0) {
      const existing = await get(
        `SELECT * FROM attendance WHERE lecture_id = ? AND national_id = ?`,
        [lecture_id, national_id]
      );
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: 'تم تسجيل الطالب مسبقاً في هذه المحاضرة',
        record: existing
      });
    }

    res.json({
      success: true,
      message: 'تم تسجيل الحضور بنجاح',
      id: result.lastID
    });
  } catch (err) {
    console.error('Record attendance error:', err);
    res.status(500).json({ success: false, message: 'فشل تسجيل الحضور' });
  }
});

app.delete('/api/attendance/:id', async (req, res) => {
  try {
    await run(`DELETE FROM attendance WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'تم حذف السجل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل حذف السجل' });
  }
});

// 6. Messages API (Broadcast / Student messaging)
app.get('/api/messages', async (req, res) => {
  try {
    const { instructor_id, target_dept, target_year, national_id } = req.query;
    let query = `SELECT * FROM messages WHERE 1=1 `;
    const params = [];

    if (instructor_id) {
      query += ` AND instructor_id = ? `;
      params.push(instructor_id);
    }
    if (target_dept && target_dept !== 'all') {
      query += ` AND (target_dept = 'all' OR target_dept = ?) `;
      params.push(target_dept);
    }
    if (target_year && target_year !== 'all') {
      query += ` AND (target_year = 'all' OR target_year = ?) `;
      params.push(target_year);
    }
    if (national_id) {
      query += ` AND (target_type != 'student' OR target_student_nid = ?) `;
      params.push(national_id);
    }

    query += ` ORDER BY created_at DESC `;
    const messages = await all(query, params);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل استرجاع الرسائل' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const {
      instructor_id,
      instructor_name,
      title,
      body,
      target_type,
      target_dept,
      target_year,
      target_student_nid
    } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'عنوان الرسالة ومحتواها مطلوبان' });
    }

    const createdAt = new Date().toISOString();
    const result = await run(
      `INSERT INTO messages (instructor_id, instructor_name, title, body, target_type, target_dept, target_year, target_student_nid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        instructor_id || 'inst_default',
        instructor_name || 'د. محمد صبري',
        title.trim(),
        body.trim(),
        target_type || 'all',
        target_dept || 'all',
        target_year || 'all',
        target_student_nid || null,
        createdAt
      ]
    );

    res.json({ success: true, message: 'تم إرسال الرسالة بنجاح', id: result.lastID });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: 'فشل إرسال الرسالة' });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  try {
    await run(`DELETE FROM messages WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'تم حذف الرسالة' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل حذف الرسالة' });
  }
});

// 7. Batch Synchronization API (Dual-Database Sync)
app.post('/api/sync', async (req, res) => {
  try {
    const { students = [], lectures = [], attendance = [] } = req.body || {};

    const synced = {
      studentsCount: 0,
      lecturesCount: 0,
      attendanceCount: 0,
      attendanceIds: []
    };

    // 1. Sync students
    for (const st of students) {
      if (st.national_id && st.full_name && st.department) {
        await run(
          `INSERT INTO students (national_id, full_name, department, academic_year, password, registered_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(national_id) DO UPDATE SET
           full_name = excluded.full_name,
           department = excluded.department,
           academic_year = COALESCE(excluded.academic_year, students.academic_year),
           password = COALESCE(excluded.password, students.password)`,
          [
            String(st.national_id).trim(),
            String(st.full_name).trim(),
            String(st.department).trim(),
            st.academic_year || 'الفرقة الرابعة',
            st.password ? String(st.password).trim() : null,
            st.registered_at || new Date().toISOString()
          ]
        );
        synced.studentsCount++;
      }
    }

    // 2. Sync lectures
    for (const lec of lectures) {
      if (lec.lecture_id && lec.title) {
        await run(
          `INSERT INTO lectures (lecture_id, title, target_dept, lecture_date, session_type, instructor_id, instructor_name, target_year, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(lecture_id) DO UPDATE SET
           title = excluded.title,
           target_dept = excluded.target_dept,
           session_type = COALESCE(excluded.session_type, lectures.session_type),
           instructor_id = COALESCE(excluded.instructor_id, lectures.instructor_id),
           instructor_name = COALESCE(excluded.instructor_name, lectures.instructor_name),
           target_year = COALESCE(excluded.target_year, lectures.target_year)`,
          [
            lec.lecture_id,
            lec.title,
            lec.target_dept || 'الكل',
            lec.lecture_date,
            lec.session_type || 'نظري',
            lec.instructor_id || 'inst_default',
            lec.instructor_name || 'د. محمد صبري',
            lec.target_year || 'الفرقة الرابعة',
            lec.created_at || new Date().toISOString()
          ]
        );
        synced.lecturesCount++;
      }
    }

    // 3. Sync attendance records
    for (const att of attendance) {
      if (att.lecture_id && att.national_id && att.student_name && att.department) {
        await run(
          `INSERT INTO attendance (lecture_id, national_id, student_name, department, scan_time, academic_year, session_type, instructor_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(lecture_id, national_id) DO NOTHING`,
          [
            att.lecture_id,
            att.national_id,
            att.student_name,
            att.department,
            att.scan_time || new Date().toLocaleTimeString('ar-EG'),
            att.academic_year || 'الفرقة الرابعة',
            att.session_type || 'نظري',
            att.instructor_name || 'د. محمد صبري',
            att.created_at || new Date().toISOString()
          ]
        );
        synced.attendanceCount++;
        synced.attendanceIds.push(att.local_id || att.id || att.national_id);
      }
    }

    res.json({
      success: true,
      message: 'تمت المزامنة بنجاح',
      synced
    });
  } catch (err) {
    console.error('Batch sync error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء المزامنة' });
  }
});

// 8. Stats API
app.get('/api/stats', async (req, res) => {
  try {
    const totalStudents = await get(`SELECT COUNT(*) as count FROM students`);
    const totalLectures = await get(`SELECT COUNT(*) as count FROM lectures`);
    const totalAttendance = await get(`SELECT COUNT(*) as count FROM attendance`);
    const deptStats = await all(`
      SELECT department, COUNT(*) as count FROM students GROUP BY department
    `);

    res.json({
      success: true,
      stats: {
        students: totalStudents ? totalStudents.count : 0,
        lectures: totalLectures ? totalLectures.count : 0,
        attendance: totalAttendance ? totalAttendance.count : 0,
        departments: deptStats
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل جلب الإحصائيات' });
  }
});

// 9. Network Info (Returns local IPv4 addresses and port for student onboarding QR)
app.get('/api/network-info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  const primaryIp = ips[0] || 'localhost';
  res.json({
    success: true,
    port: PORT,
    ips,
    url: `http://${primaryIp}:${PORT}`
  });
});

// 10. Fallback for SPA client-side routing (returns 404 for missing static/api files, index.html for navigation)
app.use((req, res) => {
  if (req.path.startsWith('/api/') || path.extname(req.path)) {
    return res.status(404).json({ success: false, message: 'المسار أو الملف غير موجود' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Initialize DB and start server (or export for Vercel Serverless)
initDb().then(() => {
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}).catch(err => {
  console.error('Failed to initialize DB:', err);
});

module.exports = app;
