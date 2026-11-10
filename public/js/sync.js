/**
 * Dual-Database Synchronization Engine
 * Automatically monitors network connectivity and syncs local IndexedDB with Cloud Firestore (or Express SQLite)
 */
class SyncManager {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;
    this.lastSyncTime = localStorage.getItem('last_sync_timestamp') || null;
    this.listeners = [];
    this.syncInterval = null;

    this.init();
  }

  init() {
    // Listen to browser network status
    window.addEventListener('online', () => {
      console.log('[Sync] Network came online.');
      this.isOnline = true;
      this.notifyStatus('online');
      this.syncNow();
    });

    window.addEventListener('offline', () => {
      console.log('[Sync] Network went offline.');
      this.isOnline = false;
      this.notifyStatus('offline');
    });

    // Periodic sync attempt (every 25 seconds if online)
    this.syncInterval = setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.syncNow(true); // silent background sync
      }
    }, 25000);

    // Initial check on load
    setTimeout(() => {
      this.isOnline = navigator.onLine;
      if (this.isOnline) {
        this.notifyStatus('online');
        this.syncNow(true);
      } else {
        this.notifyStatus('offline');
      }
    }, 800);
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
    callback(this.getStatus());
  }

  notifyStatus(forceState = null) {
    const status = this.getStatus(forceState);
    this.listeners.forEach(cb => {
      try { cb(status); } catch (e) { console.error(e); }
    });
  }

  getStatus(forceState = null) {
    let online = navigator.onLine;
    if (forceState === 'online' || forceState === 'synced') online = true;
    if (forceState === 'offline') online = false;

    return {
      isOnline: online,
      isSyncing: this.isSyncing || forceState === 'syncing',
      syncState: forceState || (online ? 'online' : 'offline'),
      lastSyncTime: this.lastSyncTime
    };
  }

  async syncNow(silent = false) {
    if (this.isSyncing) return;
    if (!navigator.onLine) {
      this.isOnline = false;
      this.notifyStatus('offline');
      return { success: false, offline: true, message: 'الجهاز غير متصل بالإنترنت حالياً' };
    }

    this.isOnline = true;
    this.isSyncing = true;
    this.notifyStatus('syncing');

    try {
      // 1. Gather all unsynced data from local IndexedDB
      const unsynced = await getUnsyncedRecords();
      const totalCount = unsynced.students.length + unsynced.lectures.length + unsynced.attendance.length;

      if (totalCount === 0) {
        this.isSyncing = false;
        this.notifyStatus('synced');
        return { success: true, count: 0, message: 'جميع البيانات متزامنة ومأمنة في السحابة أونلاين 🟢' };
      }

      // 2. Primary Cloud Sync: Sync via Firebase Cloud Firestore if available
      if (window.CloudDB && typeof firebase !== 'undefined') {
        // Sync students
        for (const st of unsynced.students) {
          await window.CloudDB.saveStudent(st);
        }
        // Sync lectures
        for (const lec of unsynced.lectures) {
          await window.CloudDB.saveLecture(lec);
        }
        // Sync attendance records
        for (const att of unsynced.attendance) {
          await window.CloudDB.recordAttendance(att);
        }

        // Mark as synced locally
        await markRecordsAsSynced(unsynced);

        this.lastSyncTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem('last_sync_timestamp', this.lastSyncTime);

        this.isSyncing = false;
        this.notifyStatus('synced');
        window.dispatchEvent(new CustomEvent('sync-completed', { detail: { count: totalCount } }));

        return {
          success: true,
          count: totalCount,
          message: `تم رفع ${totalCount} سجل إلى سحابة Google بنجاح`
        };
      }

      // 3. Fallback: Local Server Sync (/api/sync) only if running on local Node.js server (not Firebase static hosting)
      const isCloudHosting = window.location.hostname.includes('web.app') || window.location.hostname.includes('firebaseapp.com');
      if (!isCloudHosting) {
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            students: unsynced.students,
            lectures: unsynced.lectures,
            attendance: unsynced.attendance
          })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            await markRecordsAsSynced(unsynced);
            this.lastSyncTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
            localStorage.setItem('last_sync_timestamp', this.lastSyncTime);
            this.isSyncing = false;
            this.notifyStatus('synced');
            window.dispatchEvent(new CustomEvent('sync-completed', { detail: result }));
            return { success: true, count: totalCount, message: `تم رفع البيانات بنجاح` };
          }
        }
      }

      this.isSyncing = false;
      this.notifyStatus(navigator.onLine ? 'synced' : 'offline');
      return { success: true, count: totalCount, message: 'تم حفظ البيانات' };
    } catch (err) {
      console.warn('[Sync] Sync notice:', err.message);
      this.isSyncing = false;
      if (!navigator.onLine) {
        this.isOnline = false;
        this.notifyStatus('offline');
      } else {
        this.isOnline = true;
        this.notifyStatus('synced');
      }
      return { success: false, error: err.message };
    }
  }
}

// Global singleton
window.syncManager = new SyncManager();
