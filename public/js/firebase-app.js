/**
 * Firebase Initialization & Cloud Firestore Integration
 * Enables real-time cloud sync and offline persistence for students, lectures, and attendance
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

  // 2. Save or sync lecture
  async saveLecture(lecture) {
    if (!cloudDb) return false;
    try {
      const lecId = lecture.lecture_id;
      await cloudDb.collection('lectures').doc(lecId).set({
        lecture_id: lecId,
        title: lecture.title,
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

  // 3. Record attendance in Cloud Firestore
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

  // 4. Real-time listener for lecture attendance
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
  }
};

window.CloudDB = CloudDB;

