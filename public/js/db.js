/**
 * Client-side IndexedDB Database Management
 * Handles offline persistence for Students, Lectures, and Attendance records
 */
const DB_NAME = 'AttendancePWA_DB';
const DB_VERSION = 1;

let dbInstance = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Students Store
      if (!db.objectStoreNames.contains('students')) {
        const studentStore = db.createObjectStore('students', { keyPath: 'national_id' });
        studentStore.createIndex('department', 'department', { unique: false });
        studentStore.createIndex('is_synced', 'is_synced', { unique: false });
      }

      // 2. Lectures Store
      if (!db.objectStoreNames.contains('lectures')) {
        const lectureStore = db.createObjectStore('lectures', { keyPath: 'lecture_id' });
        lectureStore.createIndex('created_at', 'created_at', { unique: false });
        lectureStore.createIndex('is_synced', 'is_synced', { unique: false });
      }

      // 3. Attendance Store
      if (!db.objectStoreNames.contains('attendance')) {
        const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        attendanceStore.createIndex('lecture_id', 'lecture_id', { unique: false });
        attendanceStore.createIndex('national_id', 'national_id', { unique: false });
        attendanceStore.createIndex('lecture_student', ['lecture_id', 'national_id'], { unique: true });
        attendanceStore.createIndex('is_synced', 'is_synced', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Student Operations
async function saveLocalStudent(student) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['students'], 'readwrite');
    const store = tx.objectStore('students');
    const record = {
      national_id: String(student.national_id).trim(),
      full_name: String(student.full_name).trim(),
      academic_year: student.academic_year || 'الفرقة الأولى',
      department: String(student.department).trim(),
      password: student.password ? String(student.password).trim() : '',
      registered_at: student.registered_at || new Date().toISOString(),
      is_synced: student.is_synced !== undefined ? student.is_synced : 0
    };

    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function getLocalStudent(nationalId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['students'], 'readonly');
    const store = tx.objectStore('students');
    const req = store.get(String(nationalId).trim());
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllLocalStudents() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['students'], 'readonly');
    const store = tx.objectStore('students');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Lecture Operations
async function saveLocalLecture(lecture) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['lectures'], 'readwrite');
    const store = tx.objectStore('lectures');
    const record = {
      lecture_id: lecture.lecture_id,
      title: lecture.title,
      session_type: lecture.session_type || 'محاضرة نظري',
      instructor_name: lecture.instructor_name || '',
      target_dept: lecture.target_dept || 'الكل',
      lecture_date: lecture.lecture_date || new Date().toLocaleDateString('ar-EG'),
      created_at: lecture.created_at || new Date().toISOString(),
      is_synced: lecture.is_synced !== undefined ? lecture.is_synced : 0
    };

    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function getAllLocalLectures() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['lectures'], 'readonly');
    const store = tx.objectStore('lectures');
    const req = store.getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      // Sort newest first
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getLocalLecture(lectureId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['lectures'], 'readonly');
    const store = tx.objectStore('lectures');
    const req = store.get(lectureId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Attendance Operations
async function deleteLocalLecture(lectureId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['lectures'], 'readwrite');
    const store = tx.objectStore('lectures');
    const req = store.delete(lectureId);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function deleteLocalStudent(nationalId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['students'], 'readwrite');
    const store = tx.objectStore('students');
    const req = store.delete(String(nationalId).trim());
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Attendance Operations
async function recordLocalAttendance(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['attendance'], 'readwrite');
    const store = tx.objectStore('attendance');
    const index = store.index('lecture_student');

    // 1. Duplicate check within this lecture
    const checkReq = index.get([record.lecture_id, String(record.national_id).trim()]);

    checkReq.onsuccess = () => {
      if (checkReq.result) {
        // Already recorded
        return resolve({
          success: false,
          duplicate: true,
          message: 'تم تسجيل الطالب مسبقاً في هذه المحاضرة',
          record: checkReq.result
        });
      }

      // 2. Insert new record
      const newEntry = {
        lecture_id: record.lecture_id,
        lecture_title: record.lecture_title || '',
        session_type: record.session_type || 'محاضرة نظري',
        instructor_name: record.instructor_name || '',
        national_id: String(record.national_id).trim(),
        student_name: record.student_name.trim(),
        department: record.department.trim(),
        scan_time: record.scan_time || new Date().toLocaleTimeString('ar-EG'),
        created_at: record.created_at || new Date().toISOString(),
        is_synced: record.is_synced !== undefined ? record.is_synced : 0
      };

      const addReq = store.add(newEntry);
      addReq.onsuccess = (e) => {
        newEntry.id = e.target.result;
        resolve({
          success: true,
          duplicate: false,
          record: newEntry
        });
      };
      addReq.onerror = () => reject(addReq.error);
    };

    checkReq.onerror = () => reject(checkReq.error);
  });
}

async function getLectureAttendance(lectureId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['attendance'], 'readonly');
    const store = tx.objectStore('attendance');
    const index = store.index('lecture_id');
    const req = index.getAll(lectureId);

    req.onsuccess = () => {
      const records = req.result || [];
      // Sort in ascending order by ID (sequence of attendance)
      records.sort((a, b) => a.id - b.id);
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteLocalAttendance(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['attendance'], 'readwrite');
    const store = tx.objectStore('attendance');
    const req = store.delete(Number(id));
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Sync Helpers: Get all records with is_synced === 0
async function getUnsyncedRecords() {
  const db = await openDb();
  const tx = db.transaction(['students', 'lectures', 'attendance'], 'readonly');

  const studentsStore = tx.objectStore('students');
  const lecturesStore = tx.objectStore('lectures');
  const attendanceStore = tx.objectStore('attendance');

  const getUnsyncedFromStore = (store) => {
    return new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        res(items.filter(item => !item.is_synced || item.is_synced === 0));
      };
      req.onerror = () => rej(req.error);
    });
  };

  const [unsyncedStudents, unsyncedLectures, unsyncedAttendance] = await Promise.all([
    getUnsyncedFromStore(studentsStore),
    getUnsyncedFromStore(lecturesStore),
    getUnsyncedFromStore(attendanceStore)
  ]);

  return {
    students: unsyncedStudents,
    lectures: unsyncedLectures,
    attendance: unsyncedAttendance
  };
}

async function markRecordsAsSynced(syncedData) {
  const db = await openDb();
  const tx = db.transaction(['students', 'lectures', 'attendance'], 'readwrite');

  // Mark students
  if (syncedData.students && syncedData.students.length > 0) {
    const stStore = tx.objectStore('students');
    for (const st of syncedData.students) {
      const rec = await new Promise(r => {
        const q = stStore.get(st.national_id);
        q.onsuccess = () => r(q.result);
        q.onerror = () => r(null);
      });
      if (rec) {
        rec.is_synced = 1;
        stStore.put(rec);
      }
    }
  }

  // Mark lectures
  if (syncedData.lectures && syncedData.lectures.length > 0) {
    const lecStore = tx.objectStore('lectures');
    for (const lec of syncedData.lectures) {
      const rec = await new Promise(r => {
        const q = lecStore.get(lec.lecture_id);
        q.onsuccess = () => r(q.result);
        q.onerror = () => r(null);
      });
      if (rec) {
        rec.is_synced = 1;
        lecStore.put(rec);
      }
    }
  }

  // Mark attendance
  if (syncedData.attendance && syncedData.attendance.length > 0) {
    const attStore = tx.objectStore('attendance');
    for (const att of syncedData.attendance) {
      if (att.id) {
        const rec = await new Promise(r => {
          const q = attStore.get(att.id);
          q.onsuccess = () => r(q.result);
          q.onerror = () => r(null);
        });
        if (rec) {
          rec.is_synced = 1;
          attStore.put(rec);
        }
      }
    }
  }

  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
  });
}

