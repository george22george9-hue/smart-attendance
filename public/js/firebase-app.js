/**
 * Firebase Initialization & Cloud Firestore Integration
 * Enables real-time cloud sync, messaging, and offline persistence
 */
const firebaseConfig = {
  apiKey: "AIzaSyBsV_WcXz4JG9PSJRX8VCUO5fmAcIX9dNE",
  authDomain: "smart-attendance-7019f.firebaseapp.com",
  projectId: "smart-attendance-7019f",
  storageBucket: "smart-attendance-7019f.firebasestorage.app",
  messagingSenderId: "45270123562",
  appId: "1:45270123562:web:3fcb2df5853af2848eef53",
  measurementId: "G-KLV9R8JMYF"
};

let cloudDb = null;
let isFirebaseReady = false;

try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    cloudDb = firebase.firestore();

    // Enable multi-tab offline persistence
    cloudDb.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('Firestore persistence failed: multiple tabs open');
      } else if (err.code === 'unimplemented') {
        console.warn('Firestore persistence not supported by this browser');
      }
    });

    isFirebaseReady = true;
    console.log('[Firebase] Cloud Firestore initialized with project:', firebaseConfig.projectId);
  }
} catch (e) {
  console.warn('[Firebase] Initialization error:', e);
}

// Cloud Database Helper Functions
const CloudDB = {
  // 1. Save or sync student profile
  async saveStudent(student) {
    if (!cloudDb) return false;
    try {
      const nid = String(student.national_id).trim();
      await cloudDb.collection('students').doc(nid).set({
        national_id: nid,
        full_name: student.full_name.trim(),
        department: student.department.trim(),
        registered_at: student.registered_at || new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (err) {
      console.warn('[Firebase] Save student error:', err);
      return false;
    }
  },

  // 2. Fetch all registered students
  async getAllStudents() {
    if (!cloudDb) return [];
    try {
      const snap = await cloudDb.collection('students').get();
      const list = [];
      snap.forEach(doc => list.push(doc.data()));
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'));
      return list;
    } catch (err) {
      console.warn('[Firebase] Get students error:', err);
      return [];
    }
  },

  // 3. Save or sync lecture
  async saveLecture(lecture) {
    if (!cloudDb) return false;
    try {
      const lecId = lecture.lecture_id;
      await cloudDb.collection('lectures').doc(lecId).set({
        lecture_id: lecId,
        title: lecture.title,
        session_type: lecture.session_type || 'محاضرة نظري',
        instructor_name: lecture.instructor_name || '',
        target_dept: lecture.target_dept || 'الكل',
        lecture_date: lecture.lecture_date,
        created_at: lecture.created_at || new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (err) {
      console.warn('[Firebase] Save lecture error:', err);
      return false;
    }
  },

  // 4. Record attendance in Cloud Firestore
  async recordAttendance(record) {
    if (!cloudDb) return { success: false };
    try {
      const docId = `${record.lecture_id}_${record.national_id}`;
      const docRef = cloudDb.collection('attendance').doc(docId);
      const existing = await docRef.get();

      if (existing.exists) {
        return { success: false, duplicate: true, record: existing.data() };
      }

      const payload = {
        lecture_id: record.lecture_id,
        lecture_title: record.lecture_title || '',
        session_type: record.session_type || 'محاضرة نظري',
        instructor_name: record.instructor_name || '',
        national_id: String(record.national_id).trim(),
        student_name: record.student_name.trim(),
        department: record.department.trim(),
        scan_time: record.scan_time || new Date().toLocaleTimeString('ar-EG'),
        created_at: record.created_at || new Date().toISOString()
      };

      await docRef.set(payload);
      return { success: true, duplicate: false, record: payload };
    } catch (err) {
      console.warn('[Firebase] Record attendance error:', err);
      return { success: false, error: err };
    }
  },

  // 5. Real-time listener for lecture attendance
  listenToLecture(lectureId, callback) {
    if (!cloudDb) return null;
    return cloudDb.collection('attendance')
      .where('lecture_id', '==', lectureId)
      .onSnapshot((snapshot) => {
        const records = [];
        snapshot.forEach(doc => records.push(doc.data()));
        callback(records);
      }, (err) => {
        console.warn('[Firebase] Attendance listener error:', err);
      });
  },

  // 6. Get attendance history for a specific student
  async getStudentAttendanceHistory(nationalId) {
    if (!cloudDb) return [];
    try {
      const nid = String(nationalId).trim();
      const snap = await cloudDb.collection('attendance')
        .where('national_id', '==', nid)
        .get();
      const records = [];
      snap.forEach(doc => records.push(doc.data()));
      return records;
    } catch (err) {
      console.warn('[Firebase] Get student attendance error:', err);
      return [];
    }
  },

  // 7. Send Announcement/Message from Instructor
  async sendMessage(message) {
    if (!cloudDb) return false;
    try {
      const docRef = cloudDb.collection('announcements').doc();
      const payload = {
        id: docRef.id,
        sender: message.sender || 'المحاضر',
        sender_name: message.sender_name || 'دكتور المحاضرة',
        target_type: message.target_type || 'all', // 'all' | 'dept' | 'student'
        target_value: message.target_value || '',  // dept name or national_id
        title: message.title.trim(),
        body: message.body.trim(),
        created_at: new Date().toISOString(),
        date_str: new Date().toLocaleDateString('ar-EG') + ' ' + new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      };
      await docRef.set(payload);
      return true;
    } catch (err) {
      console.warn('[Firebase] Send message error:', err);
      return false;
    }
  },

  // 8. Delete message
  async deleteMessage(msgId) {
    if (!cloudDb) return false;
    try {
      await cloudDb.collection('announcements').doc(msgId).delete();
      return true;
    } catch (err) {
      return false;
    }
  },

  // 9. Real-time listener for student messages
  listenToStudentMessages(student, callback) {
    if (!cloudDb || !student) return null;
    const nid = String(student.national_id).trim();
    const dept = String(student.department).trim();

    return cloudDb.collection('announcements')
      .onSnapshot((snapshot) => {
        const list = [];
        snapshot.forEach(doc => {
          const msg = doc.data();
          // Filter: for all, for student's department, or specifically for this student
          if (
            msg.target_type === 'all' ||
            (msg.target_type === 'dept' && msg.target_value === dept) ||
            (msg.target_type === 'student' && String(msg.target_value).trim() === nid)
          ) {
            list.push(msg);
          }
        });
        // Sort newest first
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        callback(list);
      }, (err) => {
        console.warn('[Firebase] Student messages listener error:', err);
      });
  },

  // 10. Real-time listener for instructor messages
  listenToAllMessages(callback) {
    if (!cloudDb) return null;
    return cloudDb.collection('announcements')
      .onSnapshot((snapshot) => {
        const list = [];
        snapshot.forEach(doc => list.push(doc.data()));
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        callback(list);
      }, (err) => {
        console.warn('[Firebase] Instructor messages listener error:', err);
      });
  },

  // 11. Instructors Directory & Multi-Doctor Password Management
  async getAllInstructors() {
    let list = [];
    if (cloudDb) {
      try {
        const snap = await cloudDb.collection('instructors').get();
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.warn('[Firebase] Get instructors cloud error:', err);
      }
    }

    // If cloud is empty or offline, check localStorage
    if (list.length === 0) {
      try {
        const local = localStorage.getItem('app_instructors');
        if (local) list = JSON.parse(local);
      } catch (e) {}
    }

    // Default Seed Instructor if brand new
    if (list.length === 0) {
      const defaultDoctor = {
        id: 'inst_default',
        name: 'د. جورج سليمان رشدي',
        role: 'دكتور',
        department: 'الكل',
        pin: '1234',
        updated_at: new Date().toISOString()
      };
      list.push(defaultDoctor);
      this.saveInstructor(defaultDoctor);
    } else {
      try {
        localStorage.setItem('app_instructors', JSON.stringify(list));
      } catch (e) {}
    }

    return list;
  },

  async saveInstructor(instructor) {
    const id = instructor.id || ('inst_' + Date.now());
    const payload = {
      id: id,
      name: String(instructor.name || '').trim(),
      role: instructor.role || 'دكتور',
      department: instructor.department || 'الكل',
      pin: String(instructor.pin || '1234').trim(),
      updated_at: new Date().toISOString()
    };

    if (cloudDb) {
      try {
        await cloudDb.collection('instructors').doc(id).set(payload, { merge: true });
      } catch (e) {
        console.warn('[Firebase] Save instructor error:', e);
      }
    }

    try {
      const local = JSON.parse(localStorage.getItem('app_instructors') || '[]');
      const idx = local.findIndex(i => i.id === id);
      if (idx >= 0) local[idx] = payload;
      else local.push(payload);
      localStorage.setItem('app_instructors', JSON.stringify(local));
    } catch (e) {}

    return payload;
  },

  async deleteInstructor(id) {
    if (cloudDb) {
      try {
        await cloudDb.collection('instructors').doc(id).delete();
      } catch (e) {}
    }
    try {
      const local = JSON.parse(localStorage.getItem('app_instructors') || '[]');
      const filtered = local.filter(i => i.id !== id);
      localStorage.setItem('app_instructors', JSON.stringify(filtered));
    } catch (e) {}
    return true;
  },

  async updateInstructorPin(id, newPin) {
    const cleanPin = String(newPin).trim();
    if (cloudDb) {
      try {
        await cloudDb.collection('instructors').doc(id).update({
          pin: cleanPin,
          updated_at: new Date().toISOString()
        });
      } catch (e) {}
    }
    try {
      const local = JSON.parse(localStorage.getItem('app_instructors') || '[]');
      const inst = local.find(i => i.id === id);
      if (inst) {
        inst.pin = cleanPin;
        localStorage.setItem('app_instructors', JSON.stringify(local));
      }
    } catch (e) {}
    return true;
  }
};

window.CloudDB = CloudDB;
