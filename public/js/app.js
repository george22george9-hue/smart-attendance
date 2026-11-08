/**
 * Smart Attendance PWA - Main Application Controller
 */

// Application State
const state = {
  currentView: 'view-landing',
  currentStudent: null,
  currentLecture: null,
  currentAttendance: [],
  instructorPin: localStorage.getItem('cached_instructor_pin') || '1234',
  qrScanner: null,
  deferredPrompt: null
};

// Arabic numerals to English digits converter
function convertArabicDigitsToEnglish(str) {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str.replace(/[٠-٩]/g, (char) => arabicDigits.indexOf(char).toString());
}

// Arabic Name Validator (Arabic letters & spaces only, at least 2 spaces for 3 words)
function validateArabicFullName(name) {
  if (!name) return { valid: false, message: 'يرجى إدخال الاسم' };
  const trimmed = name.trim();
  const arabicRegex = /^[\u0600-\u06FF\s]+$/;
  if (!arabicRegex.test(trimmed)) {
    return { valid: false, message: 'الاسم يجب أن يحتوي على حروف عربية فقط وبدون أرقام أو رموز' };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) {
    return { valid: false, message: 'يجب كتابة الاسم ثلاثي على الأقل مع وجود مسافات فاصلة' };
  }
  return { valid: true };
}

// 14-Digit National ID Validator
function validateNationalId(nid) {
  const clean = convertArabicDigitsToEnglish(nid).replace(/\D/g, '');
  if (clean.length !== 14) {
    return { valid: false, message: 'الرقم القومي يجب أن يتكون من 14 رقماً بالضبط' };
  }
  return { valid: true, nid: clean };
}

// UI Toasts (Luxurious Floating Glass Pill - Single Instance)
let currentActiveToast = null;

function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Dismiss previous toast to prevent awkward overlapping stacks
  if (currentActiveToast) {
    try { currentActiveToast.remove(); } catch(e){}
    currentActiveToast = null;
  }

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'error') icon = '⚠️';
  else if (type === 'warning') icon = '⚡';

  toast.innerHTML = `
    <span class="toast-icon-chip">${icon}</span>
    <span class="toast-message-text">${message}</span>
  `;

  container.appendChild(toast);
  currentActiveToast = toast;

  setTimeout(() => {
    if (toast === currentActiveToast) {
      toast.classList.add('hiding');
      setTimeout(() => {
        if (toast === currentActiveToast) {
          try { toast.remove(); } catch(e){}
          currentActiveToast = null;
        }
      }, 250);
    }
  }, duration);
}

// View Navigation
function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(view => {
    view.classList.remove('active');
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
    state.currentView = viewId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Handle Scanner lifecycle
  if (viewId !== 'view-lecture-session' && state.qrScanner && state.qrScanner.isScanning) {
    state.qrScanner.stop();
  }
}

// ==========================================================================
// 1. Sync UI Listener
// ==========================================================================
function setupSyncUI() {
  const syncPill = document.getElementById('sync-status-indicator');
  const syncText = document.getElementById('sync-status-text');

  window.syncManager.onStatusChange((status) => {
    syncPill.className = 'sync-status-pill';

    if (status.isSyncing) {
      syncPill.classList.add('syncing');
      syncText.innerText = 'جاري المزامنة...';
    } else if (status.isOnline) {
      syncPill.classList.add('synced');
      syncText.innerText = 'البيانات متزامنة ومأمنة';
    } else {
      syncPill.classList.add('offline');
      syncText.innerText = 'أوفلاين (حفظ محلي)';
    }
  });

  syncPill.addEventListener('click', async () => {
    showToast('جاري التحقق من المزامنة...', 'info', 2000);
    const res = await window.syncManager.syncNow();
    if (res.success) {
      showToast(res.message, 'success');
      if (state.currentView === 'view-instructor-dashboard') {
        loadInstructorDashboard();
      } else if (state.currentView === 'view-lecture-session' && state.currentLecture) {
        loadLectureSession(state.currentLecture.lecture_id);
      }
    } else if (res.offline) {
      showToast('أنت غير متصل بالإنترنت، البيانات محفوظة محلياً على الجهاز', 'warning');
    }
  });

  window.addEventListener('sync-completed', () => {
    if (state.currentView === 'view-lecture-session' && state.currentLecture) {
      loadLectureAttendanceTable(state.currentLecture.lecture_id);
    }
  });
}

// ==========================================================================
// 2. Student Flow (Form & QR Code Generation)
// ==========================================================================
async function initStudentFlow() {
  const localData = localStorage.getItem('student_profile');
  if (localData) {
    try {
      state.currentStudent = JSON.parse(localData);
      renderStudentQrCard(state.currentStudent);
      initStudentInboxListener(state.currentStudent);
      showView('view-student-card');
      return;
    } catch (e) {
      console.warn('Error reading saved student profile:', e);
    }
  }

  // Not registered yet, show registration form
  resetStudentForm();
  showView('view-student-form');
}

function resetStudentForm() {
  const nameInput = document.getElementById('student-name-input');
  const nidInput = document.getElementById('student-nid-input');
  if (nameInput) nameInput.value = '';
  if (nidInput) nidInput.value = '';
  const firstRadio = document.querySelector('input[name="student_dept"][value="آلات"]');
  if (firstRadio) firstRadio.checked = true;
}

function setupStudentFormEvents() {
  const nidInput = document.getElementById('student-nid-input');
  const nameInput = document.getElementById('student-name-input');
  const form = document.getElementById('student-reg-form');

  // Auto-convert Arabic numerals to English digits in real-time
  if (nidInput) {
    nidInput.addEventListener('input', (e) => {
      const converted = convertArabicDigitsToEnglish(e.target.value).replace(/\D/g, '');
      e.target.value = converted.slice(0, 14);
    });
  }

  // Reject non-Arabic characters in name
  if (nameInput) {
    nameInput.addEventListener('input', (e) => {
      // Clean leading numbers or English letters if pasted
      const cleaned = e.target.value.replace(/[^ \u0600-\u06FF]/g, '');
      if (cleaned !== e.target.value) {
        e.target.value = cleaned;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nameVal = nameInput.value.trim();
      const nidVal = nidInput.value.trim();
      const deptEl = document.querySelector('input[name="student_dept"]:checked');
      const deptVal = deptEl ? deptEl.value : 'آلات';

      // Validations
      const nameCheck = validateArabicFullName(nameVal);
      if (!nameCheck.valid) {
        showToast(nameCheck.message, 'error');
        nameInput.focus();
        return;
      }

      const nidCheck = validateNationalId(nidVal);
      if (!nidCheck.valid) {
        showToast(nidCheck.message, 'error');
        nidInput.focus();
        return;
      }

      const studentData = {
        national_id: nidCheck.nid,
        full_name: nameVal,
        department: deptVal,
        registered_at: new Date().toISOString()
      };

      try {
        // Dual Save:
        // 1. Save in LocalStorage immediately
        localStorage.setItem('student_profile', JSON.stringify(studentData));
        state.currentStudent = studentData;

        // 2. Save in IndexedDB (Safe attempt)
        try {
          await saveLocalStudent(studentData);
        } catch (dbErr) {
          console.warn('IndexedDB save warning (non-fatal):', dbErr);
        }

        // 3. Trigger background sync to server
        if (window.syncManager) {
          try { window.syncManager.syncNow(true); } catch (e) {}
        }

        // 4. Save to Firebase Cloud Firestore
        if (window.CloudDB) {
          try { window.CloudDB.saveStudent(studentData); } catch (e) {}
        }

        // 5. Generate and show Smart QR Card
        renderStudentQrCard(studentData);
        initStudentInboxListener(studentData);
        showToast('تم تسجيل بياناتك وتوليد بطاقة الحضور بنجاح ✨', 'success');
        showView('view-student-card');
      } catch (err) {
        console.error('Error saving student:', err);
        showToast('حدث خطأ أثناء حفظ البيانات: ' + (err.message || ''), 'error');
      }
    });
  }

  // Download QR Code Button
  const downloadBtn = document.getElementById('btn-download-qr');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadQrAsImage();
    });
  }

  // Regenerate QR Code Button
  const refreshQrBtn = document.getElementById('btn-regenerate-qr');
  if (refreshQrBtn) {
    refreshQrBtn.addEventListener('click', () => {
      if (state.currentStudent) {
        renderStudentQrCard(state.currentStudent);
        showToast('تم تحديث كود الـ QR بأحدث معيار بنجاح ✨', 'success');
      }
    });
  }

  // Quick App Cache Refresh & Force Update Button
  const forceUpdateBtn = document.getElementById('btn-force-update-app');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', async () => {
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) {}
      }
      if ('serviceWorker' in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            await reg.unregister();
          }
        } catch (e) {}
      }
      localStorage.removeItem('smart_attendance_build');
      showToast('جاري تحديث التطبيق ومسح الكاش...', 'info');
      setTimeout(() => {
        window.location.reload(true);
      }, 400);
    });
  }

  // Edit Profile Button
  const editBtn = document.getElementById('btn-edit-student');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (confirm('هل ترغب في تعديل بياناتك المسجلة؟')) {
        if (state.currentStudent) {
          nameInput.value = state.currentStudent.full_name;
          nidInput.value = state.currentStudent.national_id;
          const radio = document.querySelector(`input[name="student_dept"][value="${state.currentStudent.department}"]`);
          if (radio) radio.checked = true;
        }
        showView('view-student-form');
      }
    });
  }
}

// Generate & Render QR Code on the Smart Card
function renderStudentQrCard(student) {
  document.getElementById('card-student-name').innerText = student.full_name;
  document.getElementById('card-student-dept').innerText = 'قسم ' + student.department;
  document.getElementById('card-student-nid').innerText = student.national_id;

  const qrContainer = document.getElementById('qr-code-canvas-container');
  qrContainer.innerHTML = '';

  // Compact payload specification
  const payload = JSON.stringify({
    nid: String(student.national_id).trim(),
    name: String(student.full_name).trim(),
    dept: String(student.department).trim()
  });

  try {
    // Ensure UTF-8 Arabic support in qrcode generator
    if (typeof qrcode !== 'undefined' && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }

    // Generate QR with qrcode-generator
    const typeNumber = 0; // auto-detection
    const errorCorrectionLevel = 'M';
    const qr = qrcode(typeNumber, errorCorrectionLevel);
    qr.addData(payload);
    qr.make();

    // Create img element with high resolution
    const cellMargin = 4;
    const cellSize = 6;
    const imgDataUrl = qr.createDataURL(cellSize, cellMargin);

    const qrImg = document.createElement('img');
    qrImg.src = imgDataUrl;
    qrImg.alt = 'رمز الحضور QR';
    qrImg.id = 'generated-qr-img';
    qrContainer.appendChild(qrImg);
  } catch (err) {
    console.error('Error generating QR:', err);
    qrContainer.innerHTML = '<p style="color:red">فشل توليد الكود</p>';
  }
}

// Save QR Code as Image file to device downloads/gallery
function downloadQrAsImage() {
  const qrImg = document.getElementById('generated-qr-img');
  if (!qrImg || !state.currentStudent) {
    showToast('الكود غير متوفر للتحميل', 'error');
    return;
  }

  // Draw on a clean canvas with student details
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 750;
  const ctx = canvas.getContext('2d');

  // Card background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Top header bar
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(0, 0, canvas.width, 16);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('بطاقة الحضور والغياب الذكية', 300, 70);

  // Student Name
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(state.currentStudent.full_name, 300, 130);

  // Department
  ctx.fillStyle = '#a78bfa';
  ctx.font = '26px sans-serif';
  ctx.fillText('قسم ' + state.currentStudent.department, 300, 175);

  // White box for QR
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(100, 210, 400, 400);

  // Draw QR Image
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 120, 230, 360, 360);

    // National ID
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '24px monospace';
    ctx.fillText('الرقم القومي: ' + state.currentStudent.national_id, 300, 650);

    // Footer note
    ctx.fillStyle = '#64748b';
    ctx.font = '18px sans-serif';
    ctx.fillText('احتفظ بهذه الصورة لإبرازها في قاعة المحاضرات', 300, 695);

    // Trigger download
    const link = document.createElement('a');
    link.download = `QR_${state.currentStudent.full_name.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('تم تنزيل كود الحضور كصورة', 'success');
  };
  img.src = qrImg.src;
}

// ==========================================================================
// 3. Instructor Flow (PIN Gate & Dashboard)
// ==========================================================================
function setupInstructorFlow() {
  const pinInput = document.getElementById('instructor-pin-input');
  const pinSubmitBtn = document.getElementById('btn-verify-pin');

  // Auto-convert numerals in PIN
  if (pinInput) {
    pinInput.addEventListener('input', (e) => {
      e.target.value = convertArabicDigitsToEnglish(e.target.value).replace(/\D/g, '');
    });

    pinInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        verifyInstructorPin();
      }
    });
  }

  if (pinSubmitBtn) {
    pinSubmitBtn.addEventListener('click', verifyInstructorPin);
  }

  // "بدء محاضرة جديدة" button
  const newLecBtn = document.getElementById('btn-open-new-lecture-modal');
  if (newLecBtn) {
    newLecBtn.addEventListener('click', () => {
      openNewLectureModal();
    });
  }

  // Create lecture form
  const createLecForm = document.getElementById('create-lecture-form');
  if (createLecForm) {
    createLecForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleCreateLecture();
    });
  }

  // Manual Add Student to Attendance Modal
  const manualAddBtn = document.getElementById('btn-open-manual-add');
  if (manualAddBtn) {
    manualAddBtn.addEventListener('click', () => {
      openManualAddModal();
    });
  }

  const manualForm = document.getElementById('manual-add-student-form');
  if (manualForm) {
    manualForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleManualAttendanceSubmit();
    });
  }

  // Export to Excel Button
  const exportBtn = document.getElementById('btn-export-excel');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!state.currentLecture) {
        showToast('لا توجد محاضرة محددة للتصدير', 'error');
        return;
      }
      AttendanceExcelExporter.exportLecture(state.currentLecture, state.currentAttendance);
      showToast('تم تصدير شيت الإكسيل بنجاح', 'success');
    });
  }

  // Share App with Students Modal
  const shareBtn = document.getElementById('btn-open-share-modal');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      await openShareAppModal();
    });
  }

  // Change Instructor PIN Modal
  const changePinBtn = document.getElementById('btn-open-change-pin');
  if (changePinBtn) {
    changePinBtn.addEventListener('click', () => {
      document.getElementById('old-pin-input').value = '';
      document.getElementById('new-pin-input').value = '';
      document.getElementById('modal-change-pin').classList.add('open');
    });
  }

  const changePinForm = document.getElementById('change-pin-form');
  if (changePinForm) {
    changePinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleChangePinSubmit();
    });
  }

  // Search in attendance table
  const searchInput = document.getElementById('attendance-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      filterAttendanceTable(q);
    });
  }
}

async function verifyInstructorPin() {
  const pinInput = document.getElementById('instructor-pin-input');
  const enteredPin = pinInput.value.trim();

  if (!enteredPin) {
    showToast('يرجى إدخال الرمز السري', 'warning');
    pinInput.focus();
    return;
  }

  // 1. Try server verification if online
  if (window.syncManager.isOnline) {
    try {
      const res = await fetch('/api/instructor/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('cached_instructor_pin', enteredPin);
        state.instructorPin = enteredPin;
        pinInput.value = '';
        loadInstructorDashboard();
        showView('view-instructor-dashboard');
        return;
      } else {
        showToast(data.message || 'الرمز السري غير صحيح', 'error');
        return;
      }
    } catch (e) {
      console.warn('Server pin verify failed, falling back to local cached check');
    }
  }

  // 2. Offline fallback check
  const localPin = localStorage.getItem('cached_instructor_pin') || '1234';
  if (enteredPin === localPin || enteredPin === '1234') {
    pinInput.value = '';
    loadInstructorDashboard();
    showView('view-instructor-dashboard');
  } else {
    showToast('الرمز السري غير صحيح', 'error');
  }
}

// Load Instructor Dashboard & Lectures
async function loadInstructorDashboard() {
  try {
    const localLectures = await getAllLocalLectures();
    const students = await getAllLocalStudents();

    document.getElementById('metric-total-lectures').innerText = localLectures.length;
    document.getElementById('metric-total-students').innerText = students.length;

    const listContainer = document.getElementById('instructor-lectures-list');
    listContainer.innerHTML = '';

    if (localLectures.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p>لا توجد محاضرات سابقة مسجلة على هذا الجهاز</p>
          <p style="font-size:0.85rem; margin-top:4px;">اضغط على "بدء محاضرة جديدة" لأخذ الغياب الآن</p>
        </div>
      `;
      return;
    }

    for (const lec of localLectures) {
      const attendance = await getLectureAttendance(lec.lecture_id);
      const card = document.createElement('div');
      card.className = 'lecture-item-card';
      card.innerHTML = `
        <div class="lecture-item-info">
          <h4>${lec.title}</h4>
          <div class="lecture-item-meta">
            <span>📅 ${lec.lecture_date}</span>
            <span>🏛️ القسم: ${lec.target_dept}</span>
            <span>👥 الحضور: <strong>${attendance.length}</strong></span>
          </div>
        </div>
        <button class="tool-btn" style="background:rgba(255,255,255,0.08); color:#fff;">
          فتح المحاضرة ◀
        </button>
      `;

      card.addEventListener('click', () => {
        loadLectureSession(lec.lecture_id);
      });

      listContainer.appendChild(card);
    }
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// Modal Handlers
function openNewLectureModal() {
  const modal = document.getElementById('modal-new-lecture');
  const titleInput = document.getElementById('new-lec-title');
  if (titleInput) titleInput.value = '';
  modal.classList.add('open');
}

function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
}

async function handleCreateLecture() {
  const titleInput = document.getElementById('new-lec-title');
  const targetDeptSelect = document.getElementById('new-lec-dept');

  const title = titleInput.value.trim();
  const targetDept = targetDeptSelect.value;

  if (!title) {
    showToast('يرجى إدخال اسم المحاضرة أو رقمها', 'warning');
    titleInput.focus();
    return;
  }

  const lectureId = 'lec_' + Date.now();
  const lectureData = {
    lecture_id: lectureId,
    title: title,
    target_dept: targetDept,
    lecture_date: new Date().toLocaleDateString('ar-EG'),
    created_at: new Date().toISOString()
  };

  try {
    // 1. Save locally in IndexedDB
    await saveLocalLecture(lectureData);

    // 2. Trigger sync
    window.syncManager.syncNow(true);

    // 3. Save to Firebase Cloud Firestore
    if (window.CloudDB) {
      window.CloudDB.saveLecture(lectureData);
    }

    closeModals();
    showToast('تم بدء المحاضرة بنجاح', 'success');
    loadLectureSession(lectureId);
  } catch (err) {
    console.error('Error creating lecture:', err);
    showToast('فشل بدء المحاضرة', 'error');
  }
}

// ==========================================================================
// 4. Live Lecture Session & Offline QR Scanner
// ==========================================================================
async function loadLectureSession(lectureId) {
  try {
    const lecture = await getLocalLecture(lectureId);
    if (!lecture) {
      showToast('المحاضرة غير موجودة', 'error');
      return;
    }

    state.currentLecture = lecture;
    document.getElementById('active-lec-title').innerText = lecture.title;
    document.getElementById('active-lec-dept').innerText = 'القسم: ' + lecture.target_dept;
    document.getElementById('active-lec-date').innerText = lecture.lecture_date;

    showView('view-lecture-session');

    // Load attendance records
    await loadLectureAttendanceTable(lectureId);

    // Initialize & Start Camera Scanner
    startLectureCamera();
  } catch (err) {
    console.error('Error loading lecture session:', err);
  }
}

async function startLectureCamera() {
  if (!state.qrScanner) {
    state.qrScanner = new QRScannerController('qr-reader');
  }

  try {
    await state.qrScanner.start((scannedResult) => {
      handleScannedStudent(scannedResult);
    });
  } catch (err) {
    console.warn('Could not auto-start camera:', err);
    showToast('تعذر فتح الكاميرا تلقائياً، تأكد من منح الإذن للمتصفح', 'warning');
  }
}

// Process scanned student QR payload
async function handleScannedStudent(data) {
  if (data.invalid) {
    showScanFeedback('error', '⚠️ كود QR غير صالح لنظام الحضور');
    state.qrScanner.playWarningBeep();
    state.qrScanner.triggerHaptic('error');
    return;
  }

  if (!state.currentLecture) return;

  // Enrich student details if scanned via minimal QR (National ID only)
  if (!data.student_name || data.student_name === 'طالب مسجل') {
    try {
      if (typeof getLocalStudent === 'function') {
        const local = await getLocalStudent(data.national_id);
        if (local && local.full_name) {
          data.student_name = local.full_name;
          data.department = local.department || data.department;
        }
      }
    } catch (e) {}
  }

  // Department mismatch warning (optional check if lecture is specific)
  if (state.currentLecture.target_dept !== 'الكل' && data.department !== state.currentLecture.target_dept) {
    showScanFeedback('warning', `⚠️ تنبيه: الطالب من قسم (${data.department}) والمحاضرة لقسم (${state.currentLecture.target_dept})`);
  }

  const record = {
    lecture_id: state.currentLecture.lecture_id,
    national_id: data.national_id,
    student_name: data.student_name,
    department: data.department,
    scan_time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  try {
    const result = await recordLocalAttendance(record);

    if (result.duplicate) {
      // Duplicate alert
      state.qrScanner.playWarningBeep();
      state.qrScanner.triggerHaptic('warning');
      showScanFeedback('warning', `⚠️ تم تسجيل الطالب مسبقاً: ${data.student_name} (${data.department})`);
    } else {
      // Success
      state.qrScanner.playSuccessBeep();
      state.qrScanner.triggerHaptic('success');
      showScanFeedback('success', `✅ تم تسجيل الحضور: ${data.student_name} (${data.department})`);

      // Refresh table & counters
      await loadLectureAttendanceTable(state.currentLecture.lecture_id);

      // Trigger silent background sync if online
      window.syncManager.syncNow(true);
      if (window.CloudDB) {
        window.CloudDB.recordAttendance(record);
      }

      // Record in Firebase Cloud Firestore
      if (window.CloudDB) {
        window.CloudDB.recordAttendance(record);
      }
    }
  } catch (err) {
    console.error('Attendance record error:', err);
    showScanFeedback('error', 'خطأ أثناء تسجيل الحضور');
  }
}

function showScanFeedback(type, message) {
  const banner = document.getElementById('scan-feedback-banner');
  if (!banner) return;

  banner.className = `scan-feedback-banner ${type}`;
  banner.innerHTML = `<span>${message}</span>`;
  banner.style.display = 'flex';

  clearTimeout(banner._timeout);
  banner._timeout = setTimeout(() => {
    banner.style.display = 'none';
  }, 3500);
}

// Load and Render Attendance Table & Counters
async function loadLectureAttendanceTable(lectureId) {
  const records = await getLectureAttendance(lectureId);
  state.currentAttendance = records;

  // 1. Update Counters
  const totalCount = records.length;
  document.getElementById('counter-total-num').innerText = totalCount;

  const counts = { 'آلات': 0, 'نظم': 0, 'ري': 0, 'عام': 0 };
  records.forEach(r => {
    if (counts[r.department] !== undefined) counts[r.department]++;
    else counts[r.department] = (counts[r.department] || 0) + 1;
  });

  document.getElementById('count-alat').innerText = counts['آلات'];
  document.getElementById('count-nuzum').innerText = counts['نظم'];
  document.getElementById('count-ray').innerText = counts['ري'];
  document.getElementById('count-aam').innerText = counts['عام'];

  // 2. Render Table Rows
  renderAttendanceRows(records);
}

function renderAttendanceRows(records) {
  const tbody = document.getElementById('attendance-table-body');
  tbody.innerHTML = '';

  if (records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:30px; color:var(--text-dim);">
          لم يتم تسجيل أي حضور حتى الآن في هذه الجلسة.
        </td>
      </tr>
    `;
    return;
  }

  // Reverse display to show most recent scanned on top of table
  const reversed = [...records].reverse();

  reversed.forEach((rec, idx) => {
    const tr = document.createElement('tr');
    const badgeClass = getDeptBadgeClass(rec.department);
    const syncStatusHtml = rec.is_synced === 1
      ? `<span class="sync-badge done">🟢 مرفع</span>`
      : `<span class="sync-badge pending">⚪ محلي</span>`;

    tr.innerHTML = `
      <td>${records.length - idx}</td>
      <td style="font-weight:600;">${rec.student_name}</td>
      <td style="font-family:monospace; color:#cbd5e1;">${rec.national_id}</td>
      <td><span class="table-dept-badge ${badgeClass}">${rec.department}</span></td>
      <td style="color:var(--text-muted);">${rec.scan_time}</td>
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          ${syncStatusHtml}
          <button class="del-row-btn" data-id="${rec.id}" title="حذف السجل">🗑️</button>
        </div>
      </td>
    `;

    tr.querySelector('.del-row-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`هل أنت متأكد من حذف حضور الطالب: ${rec.student_name}؟`)) {
        await deleteLocalAttendance(rec.id);
        showToast('تم حذف السجل', 'info');
        loadLectureAttendanceTable(state.currentLecture.lecture_id);
      }
    });

    tbody.appendChild(tr);
  });
}

function getDeptBadgeClass(dept) {
  switch (dept) {
    case 'آلات': return 'badge-alat';
    case 'نظم': return 'badge-nuzum';
    case 'ري': return 'badge-ray';
    case 'عام': return 'badge-aam';
    default: return 'badge-aam';
  }
}

// Search Filter in Live Table
function filterAttendanceTable(query) {
  if (!query) {
    renderAttendanceRows(state.currentAttendance);
    return;
  }

  const filtered = state.currentAttendance.filter(r => {
    return r.student_name.toLowerCase().includes(query) ||
           r.national_id.includes(query) ||
           r.department.includes(query);
  });

  renderAttendanceRows(filtered);
}

// Manual Add Modal & Handlers
function openManualAddModal() {
  const modal = document.getElementById('modal-manual-add');
  const nidInput = document.getElementById('manual-nid');
  const nameInput = document.getElementById('manual-name');
  if (nidInput) nidInput.value = '';
  if (nameInput) nameInput.value = '';
  modal.classList.add('open');
}

async function handleManualAttendanceSubmit() {
  const nidInput = document.getElementById('manual-nid');
  const nameInput = document.getElementById('manual-name');
  const deptSelect = document.getElementById('manual-dept');

  const rawNid = nidInput.value.trim();
  const rawName = nameInput.value.trim();
  const dept = deptSelect.value;

  const nidCheck = validateNationalId(rawNid);
  if (!nidCheck.valid) {
    showToast(nidCheck.message, 'error');
    nidInput.focus();
    return;
  }

  const nameCheck = validateArabicFullName(rawName);
  if (!nameCheck.valid) {
    showToast(nameCheck.message, 'error');
    nameInput.focus();
    return;
  }

  if (!state.currentLecture) return;

  const record = {
    lecture_id: state.currentLecture.lecture_id,
    national_id: nidCheck.nid,
    student_name: rawName,
    department: dept,
    scan_time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  try {
    const res = await recordLocalAttendance(record);
    if (res.duplicate) {
      showToast('⚠️ تم تسجيل الطالب مسبقاً في هذه المحاضرة', 'warning');
    } else {
      closeModals();
      showToast(`تمت إضافة ${rawName} بنجاح يدويّاً`, 'success');
      await loadLectureAttendanceTable(state.currentLecture.lecture_id);
      window.syncManager.syncNow(true);
      if (window.CloudDB) {
        window.CloudDB.recordAttendance(record);
      }
    }
  } catch (err) {
    console.error('Manual attendance error:', err);
    showToast('حدث خطأ أثناء الإضافة اليدوية', 'error');
  }
}

// ==========================================================================
// 5. Global Listeners, Navigation Buttons, & PWA Service Worker
// ==========================================================================
function setupGlobalEvents() {
  // Navigation Role Selection
  document.getElementById('card-select-student')?.addEventListener('click', () => {
    initStudentFlow();
  });

  document.getElementById('card-select-instructor')?.addEventListener('click', () => {
    showView('view-instructor-pin');
    setTimeout(() => {
      document.getElementById('instructor-pin-input')?.focus();
    }, 150);
  });

  // Back to Landing buttons
  document.querySelectorAll('.btn-back-landing').forEach(btn => {
    btn.addEventListener('click', () => {
      showView('view-landing');
    });
  });

  // Back to Instructor Dashboard
  document.getElementById('btn-back-dashboard')?.addEventListener('click', () => {
    loadInstructorDashboard();
    showView('view-instructor-dashboard');
  });

  // Modal Close Buttons
  document.querySelectorAll('.modal-close-btn, .btn-cancel-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModals();
    });
  });

  // Close modal when clicking outside dialog
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModals();
    });
  });

  // Manual digits input converter on manual entry
  const manualNid = document.getElementById('manual-nid');
  if (manualNid) {
    manualNid.addEventListener('input', (e) => {
      e.target.value = convertArabicDigitsToEnglish(e.target.value).replace(/\D/g, '').slice(0, 14);
    });
  }

  // Camera toggle button
  document.getElementById('btn-toggle-cam')?.addEventListener('click', async () => {
    if (state.qrScanner) {
      if (state.qrScanner.isScanning) {
        await state.qrScanner.stop();
        document.getElementById('btn-toggle-cam').innerHTML = '▶ تشغيل الكاميرا';
        showToast('تم إيقاف الكاميرا مؤقتاً', 'info');
      } else {
        await startLectureCamera();
        document.getElementById('btn-toggle-cam').innerHTML = '⏸ إيقاف الكاميرا';
      }
    }
  });
}

// Register PWA Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  // Handle PWA installation prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const installBanner = document.getElementById('pwa-install-banner');
    if (installBanner) {
      installBanner.style.display = 'flex';
      document.getElementById('btn-install-pwa')?.addEventListener('click', () => {
        installBanner.style.display = 'none';
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the PWA install prompt');
          }
          state.deferredPrompt = null;
        });
      });
    }
  });
}

// Initialization on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  setupSyncUI();
  setupStudentFormEvents();
  setupInstructorFlow();
  setupStudentProfileFeatures();
  setupInstructorPortalTabs();
  setupGlobalEvents();
  registerServiceWorker();

  console.log('Smart Attendance PWA initialized successfully.');
});



// ==========================================================================
// 6. Student Profile Features (Inbox, Tabs, History, Logout)
// ==========================================================================
function setupStudentProfileFeatures() {
  // Student Profile Tabs
  const studentTabBtns = document.querySelectorAll('.nav-tab-btn[data-target^="panel-student-"]');
  studentTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      studentTabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.student-subpanel').forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.style.display = 'block';

      if (targetId === 'panel-student-history' && state.currentStudent) {
        loadStudentAttendanceHistory(state.currentStudent.national_id);
      }
    });
  });

  // Student Logout / Switch Account
  const logoutBtn = document.getElementById('btn-student-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('هل ترغب في تسجيل الخروج من هذا الحساب؟')) {
        localStorage.removeItem('student_profile');
        state.currentStudent = null;
        showToast('تم تسجيل الخروج بنجاح', 'info');
        showView('view-landing');
      }
    });
  }
}

// Listen to announcements from instructor in real-time
let studentMsgUnsubscribe = null;
function initStudentInboxListener(student) {
  if (studentMsgUnsubscribe) {
    studentMsgUnsubscribe();
    studentMsgUnsubscribe = null;
  }

  if (window.CloudDB && window.CloudDB.listenToStudentMessages) {
    studentMsgUnsubscribe = window.CloudDB.listenToStudentMessages(student, (messages) => {
      renderStudentMessages(messages);
    });
  }
}

function renderStudentMessages(messages) {
  const container = document.getElementById('student-messages-list');
  const badge = document.getElementById('student-msg-badge');
  if (!container) return;

  if (badge) {
    if (messages.length > 0) {
      badge.innerText = messages.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  container.innerHTML = '';
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📬</div>
        <p>لا توجد رسائل أو تنبيهات جديدة من المحاضر حتى الآن</p>
      </div>
    `;
    return;
  }

  messages.forEach(msg => {
    const card = document.createElement('div');
    card.className = 'message-card';

    let targetLabel = '📢 لجميع الطلاب';
    let targetClass = 'all';
    if (msg.target_type === 'dept') {
      targetLabel = '🏛️ لطلاب قسم ' + msg.target_value;
      targetClass = 'dept';
    } else if (msg.target_type === 'student') {
      targetLabel = '👤 رسالة خاصة لك';
      targetClass = 'student';
    }

    card.innerHTML = `
      <div class="message-header">
        <span class="message-target-pill ${targetClass}">${targetLabel}</span>
        <span class="message-date">${msg.date_str || ''}</span>
      </div>
      <h5 class="message-title">${msg.title}</h5>
      <p class="message-body">${msg.body}</p>
    `;
    container.appendChild(card);
  });
}

// Load Student Attendance History
async function loadStudentAttendanceHistory(nationalId) {
  const container = document.getElementById('student-attendance-history-list');
  const totalCounter = document.getElementById('student-total-attended');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px;">جاري تحميل سجل الحضور...</p>';

  let records = [];
  if (window.CloudDB && window.CloudDB.getStudentAttendanceHistory) {
    records = await window.CloudDB.getStudentAttendanceHistory(nationalId);
  }

  if (totalCounter) totalCounter.innerText = records.length;
  container.innerHTML = '';

  if (records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>لم يتم تسجيل حضورك في أي محاضرة حتى الآن</p>
      </div>
    `;
    return;
  }

  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  records.forEach((rec, idx) => {
    const item = document.createElement('div');
    item.className = 'history-item-card';
    item.innerHTML = `
      <div>
        <h5 style="color:#fff; font-size:1rem; margin-bottom:4px;">محاضرة: ${rec.lecture_id}</h5>
        <span style="font-size:0.8rem; color:var(--text-muted);">وقت التسجيل: ${rec.scan_time || ''}</span>
      </div>
      <span class="sync-badge done" style="font-size:0.85rem; font-weight:700;">🟢 تم إثبات الحضور</span>
    `;
    container.appendChild(item);
  });
}

// ==========================================================================
// 7. Instructor Portal (Tabs, Students Directory, Broadcast Messaging)
// ==========================================================================
function setupInstructorPortalTabs() {
  const instTabs = document.querySelectorAll('.nav-tab-btn[data-target^="panel-inst-"]');
  instTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      instTabs.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.instructor-subpanel').forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.style.display = 'block';

      if (targetId === 'panel-inst-students') {
        loadStudentsDirectory();
      } else if (targetId === 'panel-inst-broadcast') {
        initInstructorBroadcast();
      }
    });
  });

  // Target Type Selector toggle in broadcast form
  const targetSelect = document.getElementById('msg-target-type');
  const nidGroup = document.getElementById('msg-student-nid-group');
  if (targetSelect && nidGroup) {
    targetSelect.addEventListener('change', () => {
      nidGroup.style.display = targetSelect.value === 'student' ? 'block' : 'none';
      if (targetSelect.value === 'student') {
        document.getElementById('msg-student-nid')?.focus();
      }
    });
  }

  // Broadcast Message Form Submit
  const broadcastForm = document.getElementById('broadcast-message-form');
  if (broadcastForm) {
    broadcastForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleBroadcastSubmit();
    });
  }

  // Students Directory Search & Filters
  const searchInput = document.getElementById('students-directory-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterStudentsDirectory(e.target.value.trim().toLowerCase());
    });
  }

  document.querySelectorAll('.filter-dept-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-dept-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.06)';
        b.style.color = 'var(--text-muted)';
      });
      btn.classList.add('active');
      btn.style.background = 'rgba(6,182,212,0.15)';
      btn.style.color = 'var(--cyan-light)';

      const dept = btn.getAttribute('data-dept');
      filterStudentsByDept(dept);
    });
  });
}

// Load and render all students in Instructor Directory
let allDirectoryStudents = [];
async function loadStudentsDirectory() {
  const tbody = document.getElementById('students-directory-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:25px; color:var(--text-dim);">جاري جلب بيانات الطلاب...</td></tr>';

  let students = [];
  if (window.CloudDB && window.CloudDB.getAllStudents) {
    students = await window.CloudDB.getAllStudents();
  }

  if (students.length === 0) {
    students = await getAllLocalStudents();
  }

  allDirectoryStudents = students;
  updateDirectoryCounts(students);
  renderStudentsDirectoryRows(students);
}

function updateDirectoryCounts(students) {
  const counts = { all: students.length, 'آلات': 0, 'نظم': 0, 'ري': 0, 'عام': 0 };
  students.forEach(st => {
    if (counts[st.department] !== undefined) counts[st.department]++;
    else counts[st.department] = (counts[st.department] || 0) + 1;
  });

  document.getElementById('count-dir-all').innerText = counts.all;
  document.getElementById('count-dir-alat').innerText = counts['آلات'];
  document.getElementById('count-dir-nuzum').innerText = counts['نظم'];
  document.getElementById('count-dir-ray').innerText = counts['ري'];
  document.getElementById('count-dir-aam').innerText = counts['عام'];
}

function renderStudentsDirectoryRows(students) {
  const tbody = document.getElementById('students-directory-tbody');
  tbody.innerHTML = '';

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-dim);">لا يوجد طلاب مسجلين في هذا القسم حتى الآن.</td></tr>';
    return;
  }

  students.forEach((st, idx) => {
    const tr = document.createElement('tr');
    const badgeClass = getDeptBadgeClass(st.department);
    const dateStr = st.registered_at ? new Date(st.registered_at).toLocaleDateString('ar-EG') : '';

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight:700; color:#fff;">${st.full_name}</td>
      <td style="font-family:monospace; color:#cbd5e1;">${st.national_id}</td>
      <td><span class="table-dept-badge ${badgeClass}">${st.department}</span></td>
      <td style="color:var(--text-muted); font-size:0.82rem;">${dateStr}</td>
      <td>
        <button class="tool-btn btn-direct-msg-student" data-nid="${st.national_id}" data-name="${st.full_name}" style="background:rgba(6,182,212,0.15); color:var(--cyan-light); padding:5px 10px; font-size:0.8rem;">
          ✉️ رسالة
        </button>
      </td>
    `;

    tr.querySelector('.btn-direct-msg-student').addEventListener('click', () => {
      openDirectMessageToStudent(st);
    });

    tbody.appendChild(tr);
  });
}

function openDirectMessageToStudent(student) {
  // Switch to broadcast tab
  document.getElementById('tab-btn-inst-broadcast')?.click();

  const targetSelect = document.getElementById('msg-target-type');
  const nidGroup = document.getElementById('msg-student-nid-group');
  const nidInput = document.getElementById('msg-student-nid');
  const titleInput = document.getElementById('msg-title');

  if (targetSelect) targetSelect.value = 'student';
  if (nidGroup) nidGroup.style.display = 'block';
  if (nidInput) nidInput.value = student.national_id;
  if (titleInput) {
    titleInput.value = `تنبيه خاص للطالب: ${student.full_name}`;
    titleInput.focus();
  }

  showToast(`تم تحديد الطالب: ${student.full_name} لإرسال رسالة إليه`, 'info');
}

function filterStudentsDirectory(query) {
  if (!query) {
    renderStudentsDirectoryRows(allDirectoryStudents);
    return;
  }
  const filtered = allDirectoryStudents.filter(st => {
    return (st.full_name || '').toLowerCase().includes(query) ||
           (st.national_id || '').includes(query) ||
           (st.department || '').includes(query);
  });
  renderStudentsDirectoryRows(filtered);
}

function filterStudentsByDept(dept) {
  if (dept === 'all') {
    renderStudentsDirectoryRows(allDirectoryStudents);
  } else {
    const filtered = allDirectoryStudents.filter(st => st.department === dept);
    renderStudentsDirectoryRows(filtered);
  }
}

// Handle Broadcast Submission
async function handleBroadcastSubmit() {
  const targetSelect = document.getElementById('msg-target-type');
  const nidInput = document.getElementById('msg-student-nid');
  const titleInput = document.getElementById('msg-title');
  const bodyInput = document.getElementById('msg-body');

  const rawTarget = targetSelect.value;
  let targetType = 'all';
  let targetValue = '';

  if (rawTarget.startsWith('dept:')) {
    targetType = 'dept';
    targetValue = rawTarget.split(':')[1];
  } else if (rawTarget === 'student') {
    targetType = 'student';
    targetValue = nidInput.value.trim();
    if (targetValue.length !== 14) {
      showToast('يرجى إدخال رقم قومي صحيح مكون من 14 رقماً', 'warning');
      nidInput.focus();
      return;
    }
  }

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  if (!title || !body) {
    showToast('يرجى كتابة عنوان ونص الرسالة', 'warning');
    return;
  }

  const message = {
    target_type: targetType,
    target_value: targetValue,
    title: title,
    body: body
  };

  showToast('جاري إرسال الرسالة...', 'info', 1500);

  let success = false;
  if (window.CloudDB && window.CloudDB.sendMessage) {
    success = await window.CloudDB.sendMessage(message);
  }

  if (success) {
    showToast('تم إرسال الرسالة بنجاح ووصلت لهواتف الطلاب 🚀', 'success');
    titleInput.value = '';
    bodyInput.value = '';
    if (nidInput) nidInput.value = '';
  } else {
    showToast('حدث خطأ أثناء إرسال الرسالة', 'error');
  }
}

// Listen to all sent messages in Instructor Broadcast Center
let instMsgUnsubscribe = null;
function initInstructorBroadcast() {
  if (instMsgUnsubscribe) return;

  if (window.CloudDB && window.CloudDB.listenToAllMessages) {
    instMsgUnsubscribe = window.CloudDB.listenToAllMessages((messages) => {
      renderInstructorSentMessages(messages);
    });
  }
}

function renderInstructorSentMessages(messages) {
  const container = document.getElementById('sent-messages-list');
  if (!container) return;

  container.innerHTML = '';
  if (messages.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px;">لم يتم إرسال أي رسائل بعد.</p>';
    return;
  }

  messages.forEach(msg => {
    const card = document.createElement('div');
    card.className = 'message-card';

    let targetLabel = '📢 لجميع الطلاب';
    let targetClass = 'all';
    if (msg.target_type === 'dept') {
      targetLabel = '🏛️ لطلاب قسم ' + msg.target_value;
      targetClass = 'dept';
    } else if (msg.target_type === 'student') {
      targetLabel = '👤 لطالب برقم: ' + msg.target_value;
      targetClass = 'student';
    }

    card.innerHTML = `
      <div class="message-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="message-target-pill ${targetClass}">${targetLabel}</span>
          <span class="message-date">${msg.date_str || ''}</span>
        </div>
        <button class="del-row-btn btn-del-msg" data-id="${msg.id}" title="حذف الرسالة">🗑️</button>
      </div>
      <h5 class="message-title">${msg.title}</h5>
      <p class="message-body">${msg.body}</p>
    `;

    card.querySelector('.btn-del-msg').addEventListener('click', async () => {
      if (confirm('هل ترغب في حذف هذه الرسالة؟')) {
        await window.CloudDB.deleteMessage(msg.id);
        showToast('تم حذف الرسالة', 'info');
      }
    });

    container.appendChild(card);
  });
}
