const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, run, get, all } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes

// 1. Instructor PIN verification and settings
app.post('/api/instructor/verify-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, message: 'يرجى إدخال الرمز السري' });
    }
    const row = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
    const currentPin = row ? row.value : '1234';

    if (String(pin).trim() === String(currentPin).trim()) {
      return res.json({ success: true, message: 'تم التحقق بنجاح' });
    } else {
      return res.status(401).json({ success: false, message: 'الرمز السري غير صحيح' });
    }
  } catch (err) {
    console.error('PIN verify error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

app.post('/api/instructor/change-pin', async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    if (!oldPin || !newPin) {
      return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }
    const row = await get(`SELECT value FROM config WHERE key = 'instructor_pin'`);
    const currentPin = row ? row.value : '1234';

    if (String(oldPin).trim() !== String(currentPin).trim()) {
      return res.status(401).json({ success: false, message: 'الرمز السري الحالي غير صحيح' });
    }

    if (newPin.trim().length < 4) {
      return res.status(400).json({ success: false, message: 'الرمز السري الجديد يجب ألا يقل عن 4 أرقام' });
    }

    await run(`UPDATE config SET value = ? WHERE key = 'instructor_pin'`, [newPin.trim()]);
    res.json({ success: true, message: 'تم تغيير الرمز السري بنجاح' });
  } catch (err) {
    console.error('Change PIN error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

// 2. Students API
app.post('/api/students', async (req, res) => {
  try {
    const { national_id, full_name, department, registered_at } = req.body;
    if (!national_id || !full_name || !department) {
      return res.status(400).json({ success: false, message: 'بيانات الطالب غير مكتملة' });
    }

    const regAt = registered_at || new Date().toISOString();

    await run(
      `INSERT INTO students (national_id, full_name, department, registered_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(national_id) DO UPDATE SET
       full_name = excluded.full_name,
       department = excluded.department`,
      [national_id, full_name, department, regAt]
    );

    res.json({ success: true, message: 'تم تسجيل الطالب بنجاح' });
  } catch (err) {
    console.error('Save student error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حفظ بيانات الطالب' });
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const students = await all(`SELECT * FROM students ORDER BY registered_at DESC`);
    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل استرجاع بيانات الطلاب' });
  }
});

// 3. Lectures API
app.post('/api/lectures', async (req, res) => {
  try {
    const { lecture_id, title, target_dept, lecture_date } = req.body;
    if (!lecture_id || !title) {
      return res.status(400).json({ success: false, message: 'بيانات المحاضرة غير مكتملة' });
    }

    const createdAt = new Date().toISOString();
    const date = lecture_date || new Date().toLocaleDateString('ar-EG');
    const target = target_dept || 'الكل';

    await run(
      `INSERT INTO lectures (lecture_id, title, target_dept, lecture_date, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lecture_id) DO UPDATE SET
       title = excluded.title,
       target_dept = excluded.target_dept`,
      [lecture_id, title, target, date, createdAt]
    );

    res.json({ success: true, message: 'تم حفظ المحاضرة بنجاح' });
  } catch (err) {
    console.error('Save lecture error:', err);
    res.status(500).json({ success: false, message: 'فشل في حفظ المحاضرة' });
  }
});

app.get('/api/lectures', async (req, res) => {
  try {
    const lectures = await all(`
      SELECT l.*, 
        (SELECT COUNT(*) FROM attendance a WHERE a.lecture_id = l.lecture_id) as attendees_count
      FROM lectures l 
      ORDER BY l.created_at DESC
    `);
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

// 4. Attendance API
app.post('/api/attendance', async (req, res) => {
  try {
    const { lecture_id, national_id, student_name, department, scan_time } = req.body;
    if (!lecture_id || !national_id || !student_name || !department) {
      return res.status(400).json({ success: false, message: 'بيانات الحضور غير مكتملة' });
    }

    const createdAt = new Date().toISOString();
    const time = scan_time || new Date().toLocaleTimeString('ar-EG');

    // Check for existing record
    const existing = await get(
      `SELECT * FROM attendance WHERE lecture_id = ? AND national_id = ?`,
      [lecture_id, national_id]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: 'تم تسجيل الطالب مسبقاً في هذه المحاضرة',
        record: existing
      });
    }

    const result = await run(
      `INSERT INTO attendance (lecture_id, national_id, student_name, department, scan_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [lecture_id, national_id, student_name, department, time, createdAt]
    );

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

// 5. Batch Synchronization API (Dual-Database Sync)
app.post('/api/sync', async (req, res) => {
  try {
    const { students = [], lectures = [], attendance = [] } = req.body;

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
          `INSERT INTO students (national_id, full_name, department, registered_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(national_id) DO UPDATE SET
           full_name = excluded.full_name,
           department = excluded.department`,
          [st.national_id, st.full_name, st.department, st.registered_at || new Date().toISOString()]
        );
        synced.studentsCount++;
      }
    }

    // 2. Sync lectures
    for (const lec of lectures) {
      if (lec.lecture_id && lec.title) {
        await run(
          `INSERT INTO lectures (lecture_id, title, target_dept, lecture_date, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(lecture_id) DO UPDATE SET
           title = excluded.title,
           target_dept = excluded.target_dept`,
          [lec.lecture_id, lec.title, lec.target_dept || 'الكل', lec.lecture_date, lec.created_at || new Date().toISOString()]
        );
        synced.lecturesCount++;
      }
    }

    // 3. Sync attendance records
    for (const att of attendance) {
      if (att.lecture_id && att.national_id && att.student_name && att.department) {
        await run(
          `INSERT INTO attendance (lecture_id, national_id, student_name, department, scan_time, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(lecture_id, national_id) DO NOTHING`,
          [
            att.lecture_id,
            att.national_id,
            att.student_name,
            att.department,
            att.scan_time || new Date().toLocaleTimeString('ar-EG'),
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

// 6. Stats API
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

// 7. Network Info (Returns local IPv4 addresses and port for student onboarding QR)
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

// Fallback for SPA client-side routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Initialize DB and start server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
});
