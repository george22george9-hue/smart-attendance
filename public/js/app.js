/**
 * Smart Attendance PWA - Main Application Controller (v5.3)
 */

// Master Developer Key (Default requested by user)
const DEFAULT_DEV_MASTER_PIN = 'ENG-22-George';

// Auto-migrate legacy '0000' PIN to ENG-22-George
if (!localStorage.getItem('dev_master_pin') || localStorage.getItem('dev_master_pin') === '0000') {
  localStorage.setItem('dev_master_pin', DEFAULT_DEV_MASTER_PIN);
}

// Application State
const state = {
  currentView: 'view-landing',
  currentStudent: null,
  currentInstructor: null,
  instructors: [],
  currentLecture: null,
  currentAttendance: [],
  instructorPin: localStorage.getItem('cached_instructor_pin') || '1234',
  devMasterPin: localStorage.getItem('dev_master_pin') || DEFAULT_DEV_MASTER_PIN,
  qrScanner: null,
  deferredPrompt: null
};

// Navigation History Stack (Prevents browser from exiting on back navigation)
const viewHistory = ['view-landing'];

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

// Robust View Navigation with History Stack
function showView(viewId, pushHistory = true) {
  if (!viewId) return;

  document.querySelectorAll('.view-section').forEach(view => {
    view.classList.remove('active');
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
    state.currentView = viewId;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (pushHistory) {
      if (viewHistory[viewHistory.length - 1] !== viewId) {
        viewHistory.push(viewId);
      }
      try {
        window.history.pushState({ view: viewId }, '', '#' + viewId.replace('view-', ''));
      } catch (e) {}
    }
  }

  // Handle Scanner lifecycle
  if (viewId !== 'view-lecture-session' && state.qrScanner && state.qrScanner.isScanning) {
    state.qrScanner.stop();
  }
}
window.showView = showView;

// Global Back Navigation: Steps back within the app instead of closing or exiting
function navigateBack() {
  const openModal = document.querySelector('.modal-backdrop.open');
  if (openModal) {
    closeModals();
    return;
  }

  if (viewHistory.length > 1) {
    viewHistory.pop(); // Remove current view
    const prevView = viewHistory[viewHistory.length - 1] || 'view-landing';
    showView(prevView, false);
    try {
      window.history.replaceState({ view: prevView }, '', '#' + prevView.replace('view-', ''));
    } catch (e) {}
  } else {
    showView('view-landing', false);
  }
}
window.navigateBack = navigateBack;

// Listen to Android hardware / browser popstate back button
window.addEventListener('popstate', (event) => {
  if (event.state && event.state.view) {
    if (viewHistory.length > 1) {
      viewHistory.pop();
    }
    showView(event.state.view, false);
  } else {
    navigateBack();
  }
});

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
function initStudentFlow() {
  try {
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
  } catch (err) {
    console.error('initStudentFlow error:', err);
    showView('view-student-form');
  }
}
window.initStudentFlow = initStudentFlow;

function resetStudentForm() {
  const nameInput = document.getElementById('student-name-input');
  const nidInput = document.getElementById('student-nid-input');
  if (nameInput) nameInput.value = '';
  if (nidInput) nidInput.value = '';
  const firstRadio = document.querySelector('input[name="student_dept"][value="آلات"]');
  if (firstRadio) firstRadio.checked = true;
}

// Force Update and Clear All Local Data & Test Profiles
async function forceUpdateApp() {
  try {
    localStorage.removeItem('student_profile');
    localStorage.removeItem('app_lectures');
    localStorage.removeItem('app_attendance');
    localStorage.removeItem('app_messages');
  } catch (e) {}

  if ('indexedDB' in window) {
    try {
      window.indexedDB.deleteDatabase('SmartAttendanceDB');
    } catch (e) {}
  }

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
  showToast('تم مسح البيانات التجريبية والكاش بنجاح 🧹', 'success');
  setTimeout(() => {
    window.location.reload(true);
  }, 400);
}
window.forceUpdateApp = forceUpdateApp;

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
    forceUpdateBtn.addEventListener('click', forceUpdateApp);
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
// 3. Instructor Flow (Multi-Doctor PIN Gate, Developer Panel & Dashboard)
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

  // Developer Panel Triggers
  document.getElementById('btn-open-dev-login')?.addEventListener('click', openDevPinModal);
  document.getElementById('btn-landing-dev-portal')?.addEventListener('click', openDevPinModal);

  // Developer Master PIN Form
  const devPinForm = document.getElementById('dev-pin-form');
  if (devPinForm) {
    devPinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleDevPinSubmit();
    });
  }

  // Developer Settings (Change Master Developer PIN)
  document.getElementById('btn-open-dev-settings')?.addEventListener('click', openChangeDevMasterPinModal);

  // Form to Change Developer Master PIN
  const changeDevPinForm = document.getElementById('change-dev-master-pin-form');
  if (changeDevPinForm) {
    changeDevPinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleChangeDevMasterPinSubmit();
    });
  }

  // Random PIN Generator button in Add Doctor
  document.getElementById('btn-gen-random-pin')?.addEventListener('click', () => {
    const pinInput = document.getElementById('new-doc-pin');
    if (pinInput) {
      const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
      pinInput.value = randomPin;
      showToast('تم توليد كلمة سر عشوائية: ' + randomPin, 'info', 2000);
    }
  });

  // Add Instructor Form (Developer Portal)
  const addDocForm = document.getElementById('add-instructor-form');
  if (addDocForm) {
    addDocForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleAddDoctorSubmit();
    });
  }

  // Edit Doctor PIN Form
  const editDocPinForm = document.getElementById('edit-doc-pin-form');
  if (editDocPinForm) {
    editDocPinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleEditDocPinSubmit();
    });
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

// Populate Instructors list and show Instructor PIN screen (Instant 0ms switch)
function initInstructorFlow() {
  showView('view-instructor-pin');
  loadInstructorsList();
  const pinInput = document.getElementById('instructor-pin-input');
  if (pinInput) {
    pinInput.value = '';
    setTimeout(() => pinInput.focus(), 150);
  }
}
window.initInstructorFlow = initInstructorFlow;

async function loadInstructorsList() {
  let cached = null;
  try {
    const local = localStorage.getItem('app_instructors');
    if (local) cached = JSON.parse(local);
  } catch (e) {}

  if (cached && Array.isArray(cached) && cached.length > 0) {
    state.instructors = cached;
  } else if (!state.instructors || state.instructors.length === 0) {
    state.instructors = [{
      id: 'inst_default',
      name: 'د. جورج سليمان رشدي',
      role: 'دكتور',
      department: 'الكل',
      pin: '1234'
    }];
  }
  renderInstructorsDropdown();

  // Fresh background sync from Cloud DB
  if (window.CloudDB && window.CloudDB.getAllInstructors) {
    try {
      const cloudList = await window.CloudDB.getAllInstructors();
      if (cloudList && cloudList.length > 0) {
        state.instructors = cloudList;
        renderInstructorsDropdown();
      }
    } catch (err) {
      console.warn('Could not refresh cloud instructors list:', err);
    }
  }
}

function renderInstructorsDropdown() {
  const sel = document.getElementById('instructor-select');
  if (sel && state.instructors) {
    sel.innerHTML = '';
    state.instructors.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.innerText = `${doc.name} (${doc.role} - قسم ${doc.department})`;
      sel.appendChild(opt);
    });
  }
}

async function verifyInstructorPin() {
  const pinInput = document.getElementById('instructor-pin-input');
  const sel = document.getElementById('instructor-select');
  const enteredPin = pinInput.value.trim();

  if (!enteredPin) {
    showToast('يرجى إدخال الرمز السري', 'warning');
    pinInput.focus();
    return;
  }

  const selectedDocId = sel ? sel.value : null;
  const doctor = state.instructors.find(i => i.id === selectedDocId) || state.instructors[0];

  // Match doctor PIN or developer master key (0000) or default fallback
  const isMatch = (doctor && doctor.pin === enteredPin) || enteredPin === '1234' || enteredPin === '0000';

  if (isMatch) {
    state.currentInstructor = doctor;
    localStorage.setItem('cached_instructor_pin', enteredPin);
    pinInput.value = '';
    showToast(`مرحباً بك ${doctor.name} ✨`, 'success');
    loadInstructorDashboard();
    showView('view-instructor-dashboard');
  } else {
    showToast('الرمز السري غير صحيح لهذا المحاضر', 'error');
    pinInput.focus();
  }
}

// Centralized Active Developer PIN Resolver
async function getActiveDevMasterPin() {
  if (window.CloudDB && window.CloudDB.getAdminSetting) {
    try {
      const cloudPin = await window.CloudDB.getAdminSetting('dev_master_pin');
      if (cloudPin && typeof cloudPin === 'string' && cloudPin.trim().length > 0) {
        const cleaned = cloudPin.trim();
        state.devMasterPin = cleaned;
        localStorage.setItem('dev_master_pin', cleaned);
        return cleaned;
      }
    } catch (e) {}
  }
  const local = localStorage.getItem('dev_master_pin');
  if (local && typeof local === 'string' && local.trim().length > 0) {
    state.devMasterPin = local.trim();
    return local.trim();
  }
  state.devMasterPin = DEFAULT_DEV_MASTER_PIN;
  return DEFAULT_DEV_MASTER_PIN;
}

// Developer Master PIN Gate
function openDevPinModal() {
  const modal = document.getElementById('modal-dev-pin');
  const input = document.getElementById('dev-pin-input');
  if (input) {
    input.value = '';
    input.type = 'password';
  }
  modal?.classList.add('open');
  setTimeout(() => input?.focus(), 200);
}
window.openDevPinModal = openDevPinModal;

async function handleDevPinSubmit() {
  const input = document.getElementById('dev-pin-input');
  const entered = input.value.trim();

  if (!entered) {
    showToast('يرجى إدخال كلمة سر المطور', 'error');
    input.focus();
    return;
  }

  const activePin = await getActiveDevMasterPin();

  // Strictly verify against activePin ONLY!
  // If the developer changed it, NO old password works!
  const isMatch = (entered === activePin || entered.toLowerCase() === activePin.toLowerCase());

  if (isMatch) {
    closeModals();
    input.value = '';
    showToast('تم التحقق بنجاح! مرحباً بك في لوحة المطور 🛠️', 'success');
    await initDeveloperPortal();
    showView('view-developer-admin');
  } else {
    showToast('كلمة سر المطور غير صحيحة', 'error');
    input.value = '';
    input.focus();
  }
}

// Master Developer Portal Orchestrator
async function initDeveloperPortal() {
  setupDeveloperPortalTabs();
  setupDevAddStudentForm();
  setupDevActionButtons();
  await Promise.all([
    loadDeveloperInstructors(),
    loadDeveloperStudents(),
    loadDeveloperLectures(),
    loadDeveloperKPIs()
  ]);
}

let devPortalTabsInitialized = false;
function setupDeveloperPortalTabs() {
  if (devPortalTabsInitialized) return;
  devPortalTabsInitialized = true;

  const tabBtns = document.querySelectorAll('.nav-tab-btn[data-target^="dev-panel-"]');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dev-subpanel').forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const panel = document.getElementById(targetId);
      if (panel) panel.style.display = 'block';

      if (targetId === 'dev-panel-students') {
        loadDeveloperStudents();
      } else if (targetId === 'dev-panel-lectures') {
        loadDeveloperLectures();
      } else if (targetId === 'dev-panel-control') {
        loadDeveloperKPIs();
      } else if (targetId === 'dev-panel-instructors') {
        loadDeveloperInstructors();
      }
    });
  });
}

// Developer Panel: Load, Render, Add, Edit & Delete Instructors
async function loadDeveloperInstructors() {
  const container = document.getElementById('instructors-list-container');
  const badge = document.getElementById('instructors-count-badge');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:16px;">جاري تحميل قائمة الدكاترة...</p>';

  await loadInstructorsList();
  if (badge) badge.innerText = `${state.instructors.length} محاضر`;

  container.innerHTML = '';
  if (state.instructors.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">لا يوجد دكاترة مسجلين حتى الآن.</p>';
    return;
  }

  state.instructors.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doctor-item-card';
    const isProf = doc.role === 'دكتور';
    card.innerHTML = `
      <div class="doctor-info-box" style="flex: 1;">
        <div style="position: relative;">
          <div class="doctor-avatar-box" style="border-radius: 16px; width: 52px; height: 52px; background: ${isProf ? 'rgba(6,182,212,0.15)' : 'rgba(168,85,247,0.15)'}; border: 1px solid ${isProf ? 'rgba(6,182,212,0.3)' : 'rgba(168,85,247,0.3)'};">
            ${isProf ? '👨‍🏫' : '🔬'}
          </div>
          <span style="position: absolute; bottom: -2px; left: -2px; width: 10px; height: 10px; border-radius: 50%; background: #10b981; border: 2px solid #0f172a;"></span>
        </div>
        <div style="flex: 1;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
            <h4 style="color:#fff; font-size:1.15rem; margin:0; font-weight:800;">${doc.name}</h4>
            <span class="doctor-role-badge ${isProf ? 'prof' : 'assistant'}">${doc.role} - قسم ${doc.department}</span>
          </div>
          <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 8px; padding: 6px 12px; display: inline-flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">كلمة السر / الرمز السري:</span>
            <code style="color: var(--cyan-light); font-weight: 800; font-size: 1.05rem; letter-spacing: 1.5px; font-family: monospace;">${doc.pin}</code>
          </div>
        </div>
      </div>
      <div class="doctor-actions" style="margin-top: 8px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-view-doc-profile" data-id="${doc.id}" style="border: 1px solid rgba(6, 182, 212, 0.4); background: rgba(6, 182, 212, 0.12); color: var(--cyan-light); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 700;">
          👤 الملف الكامل
        </button>
        <button class="btn-change-doc-pin" data-id="${doc.id}" data-name="${doc.name}" data-pin="${doc.pin}" style="border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08); color: #fbbf24; padding: 7px 12px; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 600;">
          🔑 تعديل السر
        </button>
        <button class="btn-delete-doc" data-id="${doc.id}" data-name="${doc.name}" style="border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08); color: #f87171; padding: 7px 12px; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 600;">
          🗑️ حذف
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  // Attach button events
  container.querySelectorAll('.btn-view-doc-profile').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.getAttribute('data-id');
      const doc = state.instructors.find(i => String(i.id) === String(docId));
      if (doc) openOwnerInstructorProfile(doc);
    });
  });

  container.querySelectorAll('.btn-change-doc-pin').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.getAttribute('data-id');
      const docName = btn.getAttribute('data-name');
      const currentPin = btn.getAttribute('data-pin');
      openEditDoctorPinModal(docId, docName, currentPin);
    });
  });

  container.querySelectorAll('.btn-delete-doc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.getAttribute('data-id');
      const docName = btn.getAttribute('data-name');
      if (confirm(`هل أنت متأكد من حذف ${docName}؟`)) {
        if (window.CloudDB && window.CloudDB.deleteInstructor) {
          await window.CloudDB.deleteInstructor(docId);
        }
        showToast('تم حذف المحاضر بنجاح', 'info');
        await loadDeveloperInstructors();
        await loadDeveloperKPIs();
      }
    });
  });
}

// ==========================================================================
// Developer Students Management (Add, List, Search, Delete)
// ==========================================================================
let allDevStudentsCache = [];
let allDevAttendanceCache = [];

async function loadDeveloperStudents() {
  const container = document.getElementById('dev-students-list-container');
  const countBadge = document.getElementById('dev-students-count-badge');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:16px;">جاري تحميل دليل الطلاب...</p>';

  try {
    if (window.CloudDB && window.CloudDB.getAllStudents) {
      allDevStudentsCache = await window.CloudDB.getAllStudents();
    } else {
      allDevStudentsCache = [];
    }

    if (window.CloudDB && window.CloudDB.getAllAttendance) {
      allDevAttendanceCache = await window.CloudDB.getAllAttendance();
    } else {
      allDevAttendanceCache = [];
    }

    if (countBadge) countBadge.innerText = `● ${allDevStudentsCache.length} طالب`;

    renderDeveloperStudents(allDevStudentsCache);

    // Setup live search once
    const searchInput = document.getElementById('dev-student-search-input');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
          renderDeveloperStudents(allDevStudentsCache);
          return;
        }
        const filtered = allDevStudentsCache.filter(s => {
          return (
            (s.full_name && s.full_name.toLowerCase().includes(query)) ||
            (s.national_id && String(s.national_id).includes(query)) ||
            (s.department && s.department.toLowerCase().includes(query))
          );
        });
        renderDeveloperStudents(filtered);
      });
    }
  } catch (err) {
    console.error('Error loading dev students:', err);
    container.innerHTML = '<p style="text-align:center; color:red; padding:16px;">فشل تحميل قائمة الطلاب</p>';
  }
}

function renderDeveloperStudents(students) {
  const container = document.getElementById('dev-students-list-container');
  if (!container) return;

  container.innerHTML = '';
  if (!students || students.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:24px;">لا يوجد طلاب مسجلين حالياً في النظام.</p>';
    return;
  }

  // Pre-calculate attendance per student
  const attendanceCounts = {};
  allDevAttendanceCache.forEach(att => {
    const nid = String(att.national_id).trim();
    attendanceCounts[nid] = (attendanceCounts[nid] || 0) + 1;
  });

  students.forEach(student => {
    const nid = String(student.national_id).trim();
    const attendedCount = attendanceCounts[nid] || 0;
    const card = document.createElement('div');
    card.className = 'doctor-item-card';
    card.style.background = 'rgba(15, 23, 42, 0.65)';
    card.style.borderColor = 'rgba(255, 255, 255, 0.08)';

    card.innerHTML = `
      <div class="doctor-info-box" style="flex: 1;">
        <div class="doctor-avatar-box" style="border-radius: 14px; width: 48px; height: 48px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); font-size: 1.25rem;">
          🎓
        </div>
        <div style="flex: 1;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
            <h4 style="color:#fff; font-size:1.05rem; margin:0; font-weight:700;">${student.full_name}</h4>
            <span class="doctor-role-badge" style="background: rgba(16,185,129,0.15); color: var(--emerald-light); font-size: 0.75rem;">قسم ${student.department}</span>
            <span class="dept-badge" style="background: rgba(6,182,212,0.15); color: var(--cyan-light); font-size: 0.72rem;">حضر ${attendedCount} محاضرة</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.78rem; color:var(--text-muted);">الرقم القومي:</span>
            <code style="color:#fff; font-size:0.88rem; font-family:monospace; letter-spacing:1px;">${student.national_id}</code>
          </div>
        </div>
      </div>
      <div class="doctor-actions" style="margin-top: 6px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-view-student-profile" data-nid="${student.national_id}" style="border: 1px solid rgba(6, 182, 212, 0.4); background: rgba(6, 182, 212, 0.12); color: var(--cyan-light); padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 700;">
          👤 الملف الكامل
        </button>
        <button class="btn-delete-student" data-nid="${student.national_id}" data-name="${student.full_name}" style="border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1); color: #f87171; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">
          🗑️ حذف الطالب
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach profile view buttons
  container.querySelectorAll('.btn-view-student-profile').forEach(btn => {
    btn.addEventListener('click', () => {
      const nid = btn.getAttribute('data-nid');
      const st = students.find(s => String(s.national_id).trim() === String(nid).trim());
      if (st) openOwnerStudentProfile(st);
    });
  });

  // Attach delete buttons
  container.querySelectorAll('.btn-delete-student').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nid = btn.getAttribute('data-nid');
      const name = btn.getAttribute('data-name');
      await handleDevDeleteStudent(nid, name);
    });
  });
}

async function handleDevDeleteStudent(nid, name) {
  if (confirm(`هل أنت متأكد من حذف الطالب "${name}" (${nid})؟\nسيتم حذف بياناته بالكامل وسجل حضوره.`)) {
    showToast('جاري حذف الطالب...', 'info', 1000);
    if (window.CloudDB && window.CloudDB.deleteStudent) {
      await window.CloudDB.deleteStudent(nid);
    }
    if (typeof deleteLocalStudent === 'function') {
      try { await deleteLocalStudent(nid); } catch (e) {}
    }
    showToast(`تم حذف الطالب ${name} بنجاح`, 'info');
    await loadDeveloperStudents();
    await loadDeveloperKPIs();
  }
}

// ==========================================================================
// Owner Detailed Profiles (Student & Instructor Modals)
// ==========================================================================
let currentViewingStudent = null;

async function openOwnerStudentProfile(student) {
  currentViewingStudent = student;
  const modal = document.getElementById('modal-owner-student-profile');
  if (!modal) return;

  const nidStr = String(student.national_id || '').trim();
  document.getElementById('owner-student-prof-name').innerText = student.full_name || 'طالب';
  document.getElementById('owner-student-prof-dept').innerText = `قسم ${student.department || 'عام'}`;

  const regDate = student.registered_at ? new Date(student.registered_at).toLocaleDateString('ar-EG') : 'غير محدد';
  document.getElementById('owner-student-prof-date').innerText = `انضم: ${regDate}`;
  document.getElementById('owner-student-prof-nid').innerText = nidStr;

  // Generate QR Code
  const qrContainer = document.getElementById('owner-student-qr-container');
  qrContainer.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: nidStr,
      width: 160,
      height: 160,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  // Copy NID
  const copyBtn = document.getElementById('btn-copy-student-nid');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(nidStr);
      showToast('تم نسخ الرقم القومي بنجاح 📋', 'info');
    };
  }

  // Download QR Code image
  const downloadBtn = document.getElementById('btn-download-owner-student-qr');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const img = qrContainer.querySelector('img');
      const canvas = qrContainer.querySelector('canvas');
      const src = img ? img.src : (canvas ? canvas.toDataURL('image/png') : null);
      if (src) {
        const a = document.createElement('a');
        a.href = src;
        a.download = `QR_${student.full_name || 'student'}_${nidStr}.png`;
        a.click();
        showToast('تم تحميل كود الطالب بنجاح 📥', 'success');
      } else {
        showToast('تعذر تحميل الكود حالياً', 'error');
      }
    };
  }

  // Load Attendance History
  const attList = document.getElementById('owner-student-att-list');
  const attCountBadge = document.getElementById('owner-student-att-count');
  attList.innerHTML = '<p style="text-align:center; color:var(--text-dim); font-size:0.82rem; padding:10px;">جاري تحميل سجل الحضور...</p>';

  try {
    let records = [];
    if (window.CloudDB && window.CloudDB.getStudentAttendanceHistory) {
      records = await window.CloudDB.getStudentAttendanceHistory(nidStr);
    }
    if (records.length === 0 && allDevAttendanceCache && allDevAttendanceCache.length > 0) {
      records = allDevAttendanceCache.filter(a => String(a.national_id).trim() === nidStr);
    }

    if (attCountBadge) attCountBadge.innerText = `${records.length} حضور`;
    attList.innerHTML = '';

    if (records.length === 0) {
      attList.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.82rem; padding:12px;">لم يسجل هذا الطالب أي حضور حتى الآن.</p>';
    } else {
      records.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      records.forEach(r => {
        const item = document.createElement('div');
        item.className = 'owner-history-item';
        const isLab = (r.session_type || '').includes('عملي');
        item.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
              <span class="doctor-role-badge ${isLab ? 'assistant' : 'prof'}" style="font-size:0.7rem; padding:2px 6px;">${r.session_type || 'محاضرة'}</span>
              <strong style="color:#fff; font-size:0.88rem;">${r.lecture_title || 'محاضرة'}</strong>
            </div>
            <div style="font-size:0.75rem; color:var(--text-dim);">
              ${r.instructor_name ? `👨‍🏫 ${r.instructor_name} | ` : ''}⏰ وقت الرصد: ${r.scan_time || ''}
            </div>
          </div>
          <span style="font-size:0.75rem; color:var(--emerald-light); font-weight:700;">✅ حاضر</span>
        `;
        attList.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Error fetching student history:', err);
    attList.innerHTML = '<p style="text-align:center; color:red; font-size:0.82rem;">تعذر جلب سجل الحضور</p>';
  }

  // Delete Student action in modal
  const delBtn = document.getElementById('btn-owner-delete-student');
  if (delBtn) {
    delBtn.onclick = async () => {
      closeModals();
      await handleDevDeleteStudent(nidStr, student.full_name);
    };
  }

  modal.classList.add('open');
}

let currentViewingInstructor = null;
let ownerInstPinVisible = false;

async function openOwnerInstructorProfile(instructor) {
  currentViewingInstructor = instructor;
  ownerInstPinVisible = false;
  const modal = document.getElementById('modal-owner-instructor-profile');
  if (!modal) return;

  const isProf = instructor.role === 'دكتور';
  const avatarBox = document.getElementById('owner-inst-prof-avatar');
  if (avatarBox) {
    avatarBox.innerText = isProf ? '👨‍🏫' : '🔬';
    avatarBox.style.background = isProf ? 'rgba(6,182,212,0.15)' : 'rgba(168,85,247,0.15)';
    avatarBox.style.borderColor = isProf ? 'rgba(6,182,212,0.3)' : 'rgba(168,85,247,0.3)';
  }

  document.getElementById('owner-inst-prof-name').innerText = instructor.name || 'محاضر';

  const roleBadge = document.getElementById('owner-inst-prof-role');
  if (roleBadge) {
    roleBadge.className = `doctor-role-badge ${isProf ? 'prof' : 'assistant'}`;
    roleBadge.innerText = instructor.role || 'دكتور';
  }

  document.getElementById('owner-inst-prof-dept').innerText = `قسم ${instructor.department || 'الكل'}`;

  // PIN display & reveal toggle
  const pinElem = document.getElementById('owner-inst-prof-pin');
  const toggleBtn = document.getElementById('btn-toggle-owner-inst-pin');
  const updatePinText = () => {
    if (ownerInstPinVisible) {
      pinElem.innerText = instructor.pin || '----';
      if (toggleBtn) toggleBtn.innerText = '🔒';
    } else {
      pinElem.innerText = '••••';
      if (toggleBtn) toggleBtn.innerText = '👁️';
    }
  };
  updatePinText();

  if (toggleBtn) {
    toggleBtn.onclick = () => {
      ownerInstPinVisible = !ownerInstPinVisible;
      updatePinText();
    };
  }

  // Edit PIN CTA
  const editPinCta = document.getElementById('btn-owner-edit-inst-pin-cta');
  if (editPinCta) {
    editPinCta.onclick = () => {
      closeModals();
      openEditDoctorPinModal(instructor.id, instructor.name, instructor.pin);
    };
  }

  // Load instructor lectures & attendance stats
  const listContainer = document.getElementById('owner-inst-lectures-list');
  listContainer.innerHTML = '<p style="text-align:center; color:var(--text-dim); font-size:0.82rem; padding:10px;">جاري تحميل سجل المحاضرات...</p>';

  try {
    let allLectures = allDevLecturesCache;
    if (allLectures.length === 0 && window.CloudDB && window.CloudDB.getAllLectures) {
      allLectures = await window.CloudDB.getAllLectures();
    }
    let allAtt = allDevAttendanceCache;
    if (allAtt.length === 0 && window.CloudDB && window.CloudDB.getAllAttendance) {
      allAtt = await window.CloudDB.getAllAttendance();
    }

    const instLectures = allLectures.filter(l => {
      return (l.instructor_name && instructor.name && l.instructor_name.trim() === instructor.name.trim()) ||
             (l.instructor_id && l.instructor_id === instructor.id);
    });

    const lecIds = new Set(instLectures.map(l => l.lecture_id));
    const totalAttCount = allAtt.filter(a => lecIds.has(a.lecture_id)).length;

    document.getElementById('owner-inst-total-lectures').innerText = instLectures.length;
    document.getElementById('owner-inst-total-attendance').innerText = totalAttCount;

    listContainer.innerHTML = '';
    if (instLectures.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.82rem; padding:12px;">لم يقم هذا المحاضر بإنشاء أي محاضرات بعد.</p>';
    } else {
      instLectures.forEach(l => {
        const lecAtt = allAtt.filter(a => a.lecture_id === l.lecture_id).length;
        const item = document.createElement('div');
        item.className = 'owner-history-item';
        item.innerHTML = `
          <div>
            <div style="color:#fff; font-size:0.88rem; font-weight:700; margin-bottom:2px;">${l.title}</div>
            <div style="font-size:0.75rem; color:var(--text-dim);">
              <span>📅 ${l.lecture_date || ''}</span> | <span>🏛️ ${l.target_dept || 'الكل'}</span>
            </div>
          </div>
          <span class="dept-badge" style="background:rgba(16,185,129,0.15); color:var(--emerald-light); font-size:0.72rem;">
            👥 ${lecAtt} طالب
          </span>
        `;
        listContainer.appendChild(item);
      });
    }
  } catch (err) {
    console.error('Error fetching instructor stats:', err);
    listContainer.innerHTML = '<p style="text-align:center; color:red; font-size:0.82rem;">تعذر تحميل السجل</p>';
  }

  // Delete Instructor CTA
  const delBtn = document.getElementById('btn-owner-delete-instructor');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (confirm(`هل أنت متأكد من حذف حساب ${instructor.name}؟`)) {
        closeModals();
        if (window.CloudDB && window.CloudDB.deleteInstructor) {
          await window.CloudDB.deleteInstructor(instructor.id);
        }
        showToast('تم حذف المحاضر بنجاح', 'info');
        await loadDeveloperInstructors();
        await loadDeveloperKPIs();
      }
    };
  }

  modal.classList.add('open');
}

let devAddStudentFormBound = false;
function setupDevAddStudentForm() {
  if (devAddStudentFormBound) return;
  const form = document.getElementById('dev-add-student-form');
  if (!form) return;
  devAddStudentFormBound = true;

  const nidInput = document.getElementById('dev-student-nid');
  if (nidInput) {
    nidInput.addEventListener('input', (e) => {
      e.target.value = convertArabicDigitsToEnglish(e.target.value).replace(/\D/g, '').slice(0, 14);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('dev-student-name');
    const deptSelect = document.getElementById('dev-student-dept');

    const name = nameInput.value.trim();
    const nid = nidInput.value.trim();
    const dept = deptSelect.value;

    const nameVal = validateArabicName(name);
    if (!nameVal.valid) {
      showToast(nameVal.message, 'error');
      nameInput.focus();
      return;
    }

    const nidVal = validateNationalId(nid);
    if (!nidVal.valid) {
      showToast(nidVal.message, 'error');
      nidInput.focus();
      return;
    }

    const newStudent = {
      national_id: nidVal.nid,
      full_name: name,
      department: dept,
      registered_at: new Date().toISOString()
    };

    showToast('جاري حفظ الطالب في النظام...', 'info', 1000);
    if (window.CloudDB && window.CloudDB.saveStudent) {
      await window.CloudDB.saveStudent(newStudent);
    }
    if (typeof saveLocalStudent === 'function') {
      try { await saveLocalStudent(newStudent); } catch (e) {}
    }

    showToast(`تم تسجيل الطالب "${name}" بنجاح ✨`, 'success');
    nameInput.value = '';
    nidInput.value = '';
    await loadDeveloperStudents();
    await loadDeveloperKPIs();
  });
}

// ==========================================================================
// Developer Lectures Management (List, Search, Delete)
// ==========================================================================
let allDevLecturesCache = [];

async function loadDeveloperLectures() {
  const container = document.getElementById('dev-lectures-list-container');
  const countBadge = document.getElementById('dev-lectures-count-badge');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:16px;">جاري تحميل قائمة المحاضرات...</p>';

  try {
    if (window.CloudDB && window.CloudDB.getAllLectures) {
      allDevLecturesCache = await window.CloudDB.getAllLectures();
    } else {
      allDevLecturesCache = [];
    }

    if (window.CloudDB && window.CloudDB.getAllAttendance) {
      allDevAttendanceCache = await window.CloudDB.getAllAttendance();
    } else {
      allDevAttendanceCache = [];
    }

    if (countBadge) countBadge.innerText = `● ${allDevLecturesCache.length} محاضرة`;

    renderDeveloperLectures(allDevLecturesCache);

    // Setup live search once
    const searchInput = document.getElementById('dev-lecture-search-input');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
          renderDeveloperLectures(allDevLecturesCache);
          return;
        }
        const filtered = allDevLecturesCache.filter(l => {
          return (
            (l.title && l.title.toLowerCase().includes(query)) ||
            (l.instructor_name && l.instructor_name.toLowerCase().includes(query)) ||
            (l.target_dept && l.target_dept.toLowerCase().includes(query)) ||
            (l.session_type && l.session_type.toLowerCase().includes(query))
          );
        });
        renderDeveloperLectures(filtered);
      });
    }
  } catch (err) {
    console.error('Error loading dev lectures:', err);
    container.innerHTML = '<p style="text-align:center; color:red; padding:16px;">فشل تحميل قائمة المحاضرات</p>';
  }
}

function renderDeveloperLectures(lectures) {
  const container = document.getElementById('dev-lectures-list-container');
  if (!container) return;

  container.innerHTML = '';
  if (!lectures || lectures.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:24px;">لا توجد محاضرات مسجلة حالياً في النظام.</p>';
    return;
  }

  // Pre-calculate attendance per lecture
  const attendanceCounts = {};
  allDevAttendanceCache.forEach(att => {
    const lid = att.lecture_id;
    attendanceCounts[lid] = (attendanceCounts[lid] || 0) + 1;
  });

  lectures.forEach(lecture => {
    const lid = lecture.lecture_id;
    const attendedCount = attendanceCounts[lid] || 0;
    const isLab = (lecture.session_type || '').includes('عملي');

    const card = document.createElement('div');
    card.className = 'lecture-item-card';

    card.innerHTML = `
      <div class="lecture-card-header">
        <div class="lecture-title-wrap">
          <span class="lecture-type-badge ${isLab ? 'lab' : 'theory'}">${isLab ? '🔬 سكشن عملي' : '📚 محاضرة نظري'}</span>
          <h4 class="lecture-card-title">${lecture.title}</h4>
        </div>
        <button class="lecture-btn-delete-quick btn-delete-lecture" data-id="${lecture.lecture_id}" data-title="${lecture.title}" title="حذف المحاضرة">
          🗑️
        </button>
      </div>

      <div class="lecture-chips-grid">
        <div class="lecture-chip">
          <span>📅</span>
          <span>${lecture.lecture_date || ''}</span>
        </div>
        <div class="lecture-chip">
          <span>🏛️</span>
          <span>قسم ${lecture.target_dept || 'الكل'}</span>
        </div>
        ${lecture.instructor_name ? `
        <div class="lecture-chip">
          <span>👨‍🏫</span>
          <span>${lecture.instructor_name}</span>
        </div>` : ''}
        <div class="lecture-chip highlight-chip">
          <span>👥</span>
          <span>حضر: <strong>${attendedCount}</strong> طالب</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach delete buttons
  container.querySelectorAll('.btn-delete-lecture').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lid = btn.getAttribute('data-id');
      const title = btn.getAttribute('data-title');
      await handleDevDeleteLecture(lid, title);
    });
  });
}

async function handleDevDeleteLecture(lid, title) {
  if (confirm(`هل أنت متأكد من حذف محاضرة "${title}"؟\nسيتم حذف المحاضرة وجميع سجلات الحضور الخاصة بها.`)) {
    showToast('جاري حذف المحاضرة...', 'info', 1000);
    if (window.CloudDB && window.CloudDB.deleteLecture) {
      await window.CloudDB.deleteLecture(lid);
    }
    showToast(`تم حذف المحاضرة "${title}" بنجاح`, 'info');
    await loadDeveloperLectures();
    await loadDeveloperKPIs();
  }
}

// ==========================================================================
// Developer KPIs & Master Actions
// ==========================================================================
async function loadDeveloperKPIs() {
  try {
    let students = allDevStudentsCache;
    if (students.length === 0 && window.CloudDB && window.CloudDB.getAllStudents) {
      students = await window.CloudDB.getAllStudents();
      allDevStudentsCache = students;
    }
    let instructors = state.instructors || [];
    if (instructors.length === 0 && window.CloudDB && window.CloudDB.getAllInstructors) {
      instructors = await window.CloudDB.getAllInstructors();
      state.instructors = instructors;
    }
    let lectures = allDevLecturesCache;
    if (lectures.length === 0 && window.CloudDB && window.CloudDB.getAllLectures) {
      lectures = await window.CloudDB.getAllLectures();
      allDevLecturesCache = lectures;
    }
    let attendance = allDevAttendanceCache;
    if (attendance.length === 0 && window.CloudDB && window.CloudDB.getAllAttendance) {
      attendance = await window.CloudDB.getAllAttendance();
      allDevAttendanceCache = attendance;
    }

    const sElem = document.getElementById('kpi-dev-total-students');
    const iElem = document.getElementById('kpi-dev-total-instructors');
    const lElem = document.getElementById('kpi-dev-total-lectures');
    const aElem = document.getElementById('kpi-dev-total-attendance');

    if (sElem) sElem.innerText = students.length;
    if (iElem) iElem.innerText = instructors.length;
    if (lElem) lElem.innerText = lectures.length;
    if (aElem) aElem.innerText = attendance.length;
  } catch (err) {
    console.warn('KPI calculation error:', err);
  }
}

let devActionsBound = false;
function setupDevActionButtons() {
  if (devActionsBound) return;
  devActionsBound = true;

  // Change Master PIN button inside Control tab
  document.getElementById('btn-dev-change-pin-action')?.addEventListener('click', openChangeDevMasterPinModal);

  // Export Full System to Excel
  document.getElementById('btn-dev-export-full-excel')?.addEventListener('click', async () => {
    if (!window.XLSX) {
      showToast('مكتبة تصدير الإكسيل غير متوفرة', 'error');
      return;
    }
    showToast('جاري تجميع بيانات النظام وإنشاء ملف Excel...', 'info', 1200);

    const [students, lectures, attendance] = await Promise.all([
      window.CloudDB ? window.CloudDB.getAllStudents() : [],
      window.CloudDB ? window.CloudDB.getAllLectures() : [],
      window.CloudDB ? window.CloudDB.getAllAttendance() : []
    ]);

    const wb = XLSX.utils.book_new();

    // Sheet 1: Students
    const studentRows = [
      ['دليل الطلاب المسجلين - Agricultural Engineer'],
      ['تاريخ التصدير:', new Date().toLocaleDateString('ar-EG'), 'إجمالي الطلاب:', students.length],
      [],
      ['م', 'الاسم ثلاثي', 'الرقم القومي', 'القسم', 'تاريخ التسجيل']
    ];
    students.forEach((s, idx) => {
      studentRows.push([idx + 1, s.full_name, String(s.national_id), s.department, s.registered_at || '']);
    });
    const wsStudents = XLSX.utils.aoa_to_sheet(studentRows);
    XLSX.utils.book_append_sheet(wb, wsStudents, 'دليل الطلاب');

    // Sheet 2: Lectures
    const lectureRows = [
      ['سجل المحاضرات والسكاشن - Agricultural Engineer'],
      ['إجمالي المحاضرات:', lectures.length],
      [],
      ['م', 'عنوان المحاضرة', 'النوع', 'المحاضر', 'القسم', 'التاريخ']
    ];
    lectures.forEach((l, idx) => {
      lectureRows.push([idx + 1, l.title, l.session_type || 'نظري', l.instructor_name || '', l.target_dept || 'الكل', l.lecture_date || '']);
    });
    const wsLectures = XLSX.utils.aoa_to_sheet(lectureRows);
    XLSX.utils.book_append_sheet(wb, wsLectures, 'المحاضرات والسكاشن');

    // Sheet 3: Attendance
    const attRows = [
      ['سجل الحضور الكامل - Agricultural Engineer'],
      ['إجمالي عمليات الحضور:', attendance.length],
      [],
      ['م', 'المحاضرة', 'النوع', 'المحاضر', 'اسم الطالب', 'الرقم القومي', 'القسم', 'وقت التسجيل']
    ];
    attendance.forEach((a, idx) => {
      attRows.push([
        idx + 1,
        a.lecture_title || a.lecture_id,
        a.session_type || 'نظري',
        a.instructor_name || '',
        a.student_name || '',
        String(a.national_id),
        a.department || '',
        a.scan_time || a.created_at || ''
      ]);
    });
    const wsAttendance = XLSX.utils.aoa_to_sheet(attRows);
    XLSX.utils.book_append_sheet(wb, wsAttendance, 'سجل الحضور الكامل');

    // Download File
    const filename = `Agricultural_Engineer_System_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast('تم تصدير ملف الإكسيل الشامل بنجاح 📊', 'success');
  });
}

async function handleAddDoctorSubmit() {
  const nameInput = document.getElementById('new-doc-name');
  const roleSelect = document.getElementById('new-doc-role');
  const deptSelect = document.getElementById('new-doc-dept');
  const pinInput = document.getElementById('new-doc-pin');

  const name = nameInput.value.trim();
  const role = roleSelect.value;
  const dept = deptSelect.value;
  const pin = convertArabicDigitsToEnglish(pinInput.value.trim());

  if (!name || !pin) {
    showToast('يرجى ملء جميع الحقول المطلوبة', 'warning');
    return;
  }

  const doctorData = {
    name: name,
    role: role,
    department: dept,
    pin: pin
  };

  showToast('جاري حفظ المحاضر الجديد...', 'info', 1000);

  if (window.CloudDB && window.CloudDB.saveInstructor) {
    await window.CloudDB.saveInstructor(doctorData);
  }

  showToast(`تمت إضافة ${name} وتحديد كلمة السر بنجاح ✨`, 'success');
  nameInput.value = '';
  pinInput.value = '';
  await loadDeveloperInstructors();
}

function openEditDoctorPinModal(docId, docName, currentPin) {
  const modal = document.getElementById('modal-edit-doc-pin');
  const idInput = document.getElementById('edit-doc-id');
  const subtitle = document.getElementById('edit-doc-pin-subtitle');
  const pinInput = document.getElementById('edit-doc-new-pin');

  if (idInput) idInput.value = docId;
  if (subtitle) subtitle.innerText = `المحاضر: ${docName}`;
  if (pinInput) {
    pinInput.value = currentPin || '';
    setTimeout(() => pinInput.focus(), 200);
  }
  modal?.classList.add('open');
}

async function handleEditDocPinSubmit() {
  const idInput = document.getElementById('edit-doc-id');
  const pinInput = document.getElementById('edit-doc-new-pin');

  const docId = idInput.value;
  const newPin = convertArabicDigitsToEnglish(pinInput.value.trim());

  if (!newPin) {
    showToast('يرجى إدخال كلمة السر الجديدة', 'warning');
    return;
  }

  if (window.CloudDB && window.CloudDB.updateInstructorPin) {
    await window.CloudDB.updateInstructorPin(docId, newPin);
  }

  closeModals();
  showToast('تم تحديث كلمة السر بنجاح وحفظها في السحابة 🔒', 'success');
  await loadDeveloperInstructors();
}

// Developer Master PIN Management
function openChangeDevMasterPinModal() {
  const modal = document.getElementById('modal-change-dev-master-pin');
  const cur = document.getElementById('dev-current-pin');
  const nw = document.getElementById('dev-new-pin');
  const cnf = document.getElementById('dev-confirm-new-pin');

  if (cur) cur.value = '';
  if (nw) nw.value = '';
  if (cnf) cnf.value = '';

  modal?.classList.add('open');
  setTimeout(() => cur?.focus(), 200);
}

async function handleChangeDevMasterPinSubmit() {
  const currentInput = document.getElementById('dev-current-pin');
  const newInput = document.getElementById('dev-new-pin');
  const confirmInput = document.getElementById('dev-confirm-new-pin');

  const currentPin = currentInput.value.trim();
  const newPin = newInput.value.trim();
  const confirmPin = confirmInput.value.trim();

  const activeMasterPin = await getActiveDevMasterPin();

  if (currentPin !== activeMasterPin && currentPin.toLowerCase() !== activeMasterPin.toLowerCase()) {
    showToast('كلمة سر المطور الحالية غير صحيحة', 'error');
    currentInput.focus();
    return;
  }

  if (!newPin || newPin.length < 4) {
    showToast('كلمة السر يجب أن تكون 4 خانات على الأقل', 'warning');
    newInput.focus();
    return;
  }

  if (newPin !== confirmPin) {
    showToast('كلمة السر الجديدة وتأكيدها غير متطابقين', 'error');
    confirmInput.focus();
    return;
  }

  // Save locally immediately
  state.devMasterPin = newPin;
  localStorage.setItem('dev_master_pin', newPin);

  // Sync to Cloud Firestore
  if (window.CloudDB && window.CloudDB.saveAdminSetting) {
    try {
      await window.CloudDB.saveAdminSetting('dev_master_pin', newPin);
    } catch (e) {
      console.warn('Failed to save master pin to cloud:', e);
    }
  }

  closeModals();
  currentInput.value = '';
  newInput.value = '';
  confirmInput.value = '';
  showToast('تم تغيير وحفظ كلمة سر المطور الجديدة بنجاح 🔒', 'success');
}

// Load Instructor Dashboard & Lectures
async function loadInstructorDashboard() {
  try {
    let lectures = [];
    if (window.CloudDB && window.CloudDB.getAllLectures) {
      try {
        lectures = await window.CloudDB.getAllLectures();
      } catch (e) {
        console.warn('Error fetching cloud lectures:', e);
      }
    }
    if (!lectures || lectures.length === 0) {
      lectures = await getAllLocalLectures();
    }

    let students = [];
    if (window.CloudDB && window.CloudDB.getAllStudents) {
      try {
        students = await window.CloudDB.getAllStudents();
      } catch (e) {
        console.warn('Error fetching cloud students:', e);
      }
    }
    if (!students || students.length === 0) {
      students = await getAllLocalStudents();
    }

    let allAtt = [];
    if (window.CloudDB && window.CloudDB.getAllAttendance) {
      try {
        allAtt = await window.CloudDB.getAllAttendance();
      } catch (e) {}
    }

    document.getElementById('metric-total-lectures').innerText = lectures.length;
    document.getElementById('metric-total-students').innerText = students.length;

    const listContainer = document.getElementById('instructor-lectures-list');
    listContainer.innerHTML = '';

    if (lectures.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p>لا توجد جلسات أو محاضرات سابقة مسجلة على هذا الجهاز</p>
          <p style="font-size:0.85rem; margin-top:4px;">اضغط على "بدء محاضرة جديدة" لأخذ الغياب الآن</p>
        </div>
      `;
      return;
    }

    for (const lec of lectures) {
      let attCount = 0;
      if (allAtt && allAtt.length > 0) {
        attCount = allAtt.filter(a => a.lecture_id === lec.lecture_id).length;
      } else {
        const localAtt = await getLectureAttendance(lec.lecture_id);
        attCount = localAtt ? localAtt.length : 0;
      }

      const card = document.createElement('div');
      card.className = 'lecture-item-card';

      const isLab = (lec.session_type || '').includes('عملي');
      card.innerHTML = `
        <div class="lecture-card-header">
          <div class="lecture-title-wrap">
            <span class="lecture-type-badge ${isLab ? 'lab' : 'theory'}">${isLab ? '🔬 سكشن عملي' : '📚 محاضرة نظري'}</span>
            <h4 class="lecture-card-title">${lec.title}</h4>
          </div>
          <button class="lecture-btn-delete-quick btn-del-inst-lecture" data-id="${lec.lecture_id}" data-title="${lec.title}" title="حذف المحاضرة">
            🗑️
          </button>
        </div>

        <div class="lecture-chips-grid">
          <div class="lecture-chip">
            <span>📅</span>
            <span>${lec.lecture_date || ''}</span>
          </div>
          <div class="lecture-chip">
            <span>🏛️</span>
            <span>قسم ${lec.target_dept || 'الكل'}</span>
          </div>
          ${lec.instructor_name ? `
          <div class="lecture-chip">
            <span>👨‍🏫</span>
            <span>${lec.instructor_name}</span>
          </div>` : ''}
          <div class="lecture-chip highlight-chip">
            <span>👥</span>
            <span>الحضور: <strong>${attCount}</strong> طالب</span>
          </div>
        </div>

        <div class="lecture-card-actions">
          <button class="btn-open-lecture-cta btn-open-inst-lecture" data-id="${lec.lecture_id}">
            <span>فتح ورصد المحاضرة</span>
            <span>◀</span>
          </button>
        </div>
      `;

      // Delete lecture
      const delBtn = card.querySelector('.btn-del-inst-lecture');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lid = delBtn.getAttribute('data-id');
          const title = delBtn.getAttribute('data-title');
          if (confirm(`هل أنت متأكد من حذف محاضرة "${title}"؟\nسيتم حذف سجلات الحضور الخاصة بها.`)) {
            showToast('جاري حذف المحاضرة...', 'info', 1000);
            if (window.CloudDB && window.CloudDB.deleteLecture) {
              await window.CloudDB.deleteLecture(lid);
            }
            if (typeof deleteLocalLecture === 'function') {
              try { await deleteLocalLecture(lid); } catch (err) {}
            }
            showToast(`تم حذف محاضرة "${title}" بنجاح`, 'info');
            await loadInstructorDashboard();
          }
        });
      }

      // Open lecture
      const openBtn = card.querySelector('.btn-open-inst-lecture');
      if (openBtn) {
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadLectureSession(lec.lecture_id);
        });
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-inst-lecture')) return;
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
  const instructorInput = document.getElementById('new-lec-instructor');
  if (titleInput) titleInput.value = '';
  if (instructorInput) {
    instructorInput.value = state.currentInstructor ? state.currentInstructor.name : '';
  }
  const defaultRadio = document.querySelector('input[name="session_type"][value="محاضرة نظري"]');
  if (defaultRadio) defaultRadio.checked = true;
  modal?.classList.add('open');
}

function closeModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
}
window.closeModals = closeModals;

async function handleCreateLecture() {
  const titleInput = document.getElementById('new-lec-title');
  const targetDeptSelect = document.getElementById('new-lec-dept');
  const sessionTypeRadio = document.querySelector('input[name="session_type"]:checked');
  const instructorInput = document.getElementById('new-lec-instructor');

  const title = titleInput.value.trim();
  const targetDept = targetDeptSelect.value;
  const sessionType = sessionTypeRadio ? sessionTypeRadio.value : 'محاضرة نظري';
  const instructorName = instructorInput ? instructorInput.value.trim() : (state.currentInstructor ? state.currentInstructor.name : '');

  if (!title) {
    showToast('يرجى إدخال اسم المحاضرة أو الموضوع', 'warning');
    titleInput.focus();
    return;
  }

  const lectureId = 'lec_' + Date.now();
  const lectureData = {
    lecture_id: lectureId,
    title: title,
    session_type: sessionType,
    instructor_name: instructorName,
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
    showToast(`تم بدء ${sessionType}: (${title}) بنجاح ✨`, 'success');
    loadLectureSession(lectureId);
  } catch (err) {
    console.error('Error creating lecture:', err);
    showToast('فشل بدء الجلسة', 'error');
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

    const typeEl = document.getElementById('active-lec-type');
    if (typeEl) {
      const isLab = lecture.session_type === 'سكشن عملي';
      typeEl.innerText = isLab ? '🔬 سكشن عملي' : '📖 محاضرة نظري';
      typeEl.style.background = isLab ? 'rgba(168,85,247,0.2)' : 'rgba(6,182,212,0.18)';
      typeEl.style.color = isLab ? '#c084fc' : 'var(--cyan-light)';
    }

    document.getElementById('active-lec-dept').innerText = 'القسم: ' + (lecture.target_dept || 'الكل');
    document.getElementById('active-lec-date').innerText = lecture.lecture_date || '';

    const instEl = document.getElementById('active-lec-instructor');
    if (instEl) {
      instEl.innerText = lecture.instructor_name ? 'المحاضر: ' + lecture.instructor_name : '';
    }

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
    lecture_title: state.currentLecture.title,
    session_type: state.currentLecture.session_type || 'محاضرة نظري',
    instructor_name: state.currentLecture.instructor_name || '',
    national_id: data.national_id,
    student_name: data.student_name,
    department: data.department,
    scan_time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    created_at: new Date().toISOString()
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
    lecture_title: state.currentLecture.title,
    session_type: state.currentLecture.session_type || 'محاضرة نظري',
    instructor_name: state.currentLecture.instructor_name || '',
    national_id: nidCheck.nid,
    student_name: rawName,
    department: dept,
    scan_time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    created_at: new Date().toISOString()
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
  // 1. Simple Clean Role Action Buttons (Direct & Instant)
  document.getElementById('btn-main-student')?.addEventListener('click', (e) => {
    e.preventDefault();
    initStudentFlow();
  });

  document.getElementById('btn-main-instructor')?.addEventListener('click', (e) => {
    e.preventDefault();
    initInstructorFlow();
  });

  document.getElementById('btn-landing-dev-portal')?.addEventListener('click', (e) => {
    e.preventDefault();
    openDevPinModal();
  });

  // Password visibility eye toggle button
  document.getElementById('btn-toggle-dev-pin-visibility')?.addEventListener('click', () => {
    const pinInput = document.getElementById('dev-pin-input');
    if (pinInput) {
      pinInput.type = pinInput.type === 'password' ? 'text' : 'password';
    }
  });

  // Legacy Card Clicks Fallback (if present)
  document.getElementById('card-select-student')?.addEventListener('click', () => {
    initStudentFlow();
  });
  document.getElementById('card-select-instructor')?.addEventListener('click', async () => {
    await initInstructorFlow();
  });

  // 3. Global Back Buttons Navigation (Never closes app, returns to previous view)
  document.querySelectorAll('.btn-back-landing, .back-btn:not(#btn-edit-student):not(#btn-student-logout):not(.btn-cancel-modal)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateBack();
    });
  });

  // Brand Header Click -> Smoothly navigates to landing
  document.querySelector('.brand-container')?.addEventListener('click', (e) => {
    e.preventDefault();
    showView('view-landing');
  });

  // Back to Instructor Dashboard from active lecture
  document.getElementById('btn-back-dashboard')?.addEventListener('click', () => {
    loadInstructorDashboard();
    navigateBack();
  });

  // Modal Close Buttons
  document.querySelectorAll('.modal-close-btn, .btn-cancel-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModals();
    });
  });

  // Factory Reset All Data Button (Developer Portal)
  document.getElementById('btn-factory-reset-data')?.addEventListener('click', async () => {
    if (confirm('تحذير: هل أنت متأكد من تصفير ومسح كافة بيانات الطلاب وسجل الحضور والمحاضرات التجريبية؟')) {
      showToast('جاري تصفير ومسح كافة البيانات...', 'info');
      if (window.CloudDB && window.CloudDB.clearAllTestData) {
        await window.CloudDB.clearAllTestData();
      }
      await forceUpdateApp();
    }
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

// Robust Initialization (handles loading or already-interactive DOM)
function initApp() {
  try {
    setupSyncUI();
    setupStudentFormEvents();
    setupInstructorFlow();
    setupStudentProfileFeatures();
    setupInstructorPortalTabs();
    setupGlobalEvents();
    registerServiceWorker();
    console.log('Agricultural engineer PWA v5.9 initialized successfully.');
  } catch (e) {
    console.error('Error during initApp:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM is already ready
  initApp();
}



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

    const senderInfo = msg.sender_name || msg.sender;
    card.innerHTML = `
      <div class="message-header">
        <span class="message-target-pill ${targetClass}">${targetLabel}</span>
        <span class="message-date">${senderInfo ? `👨‍🏫 ${senderInfo} • ` : ''}${msg.date_str || ''}</span>
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

  // Pre-load lectures map to resolve older attendance records without saved title
  let lecturesMap = {};
  try {
    const allLecs = await getAllLocalLectures();
    allLecs.forEach(l => { lecturesMap[l.lecture_id] = l; });
  } catch(e) {}

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

  records.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  records.forEach((rec, idx) => {
    // If older record lacked lecture_title, resolve from lecturesMap
    if (!rec.lecture_title && lecturesMap[rec.lecture_id]) {
      rec.lecture_title = lecturesMap[rec.lecture_id].title;
      rec.session_type = lecturesMap[rec.lecture_id].session_type;
      rec.instructor_name = lecturesMap[rec.lecture_id].instructor_name;
    }

    const isLab = rec.session_type === 'سكشن عملي';
    const typeBadge = isLab ? '🔬 سكشن عملي' : '📖 محاضرة نظري';
    const titleText = rec.lecture_title || (rec.lecture_id ? `جلسة معتمدة (${rec.lecture_id.slice(-6)})` : 'محاضرة معتمدة');

    const item = document.createElement('div');
    item.className = 'history-item-card';
    item.innerHTML = `
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
          <span class="doctor-role-badge ${isLab ? 'assistant' : 'prof'}">${typeBadge}</span>
          <h5 style="color:#fff; font-size:1.05rem; font-weight:700; margin:0;">${titleText}</h5>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:12px; margin-top:4px;">
          <span>🕒 وقت الحضور: ${rec.scan_time || ''}</span>
          ${rec.instructor_name ? `<span>👨‍🏫 المحاضر: ${rec.instructor_name}</span>` : ''}
          ${rec.created_at ? `<span>📅 التاريخ: ${new Date(rec.created_at).toLocaleDateString('ar-EG')}</span>` : ''}
        </div>
      </div>
      <div style="text-align:left;">
        <span class="sync-badge done" style="font-size:0.82rem; font-weight:700; white-space:nowrap;">🟢 تم إثبات الحضور</span>
      </div>
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

  const senderDocName = state.currentInstructor ? state.currentInstructor.name : 'المحاضر';
  const message = {
    sender: senderDocName,
    sender_name: senderDocName,
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
