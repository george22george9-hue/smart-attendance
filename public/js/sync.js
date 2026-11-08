/**
 * Dual-Database Synchronization Engine
 * Automatically monitors network connectivity and syncs local IndexedDB with SQLite backend
 */
class SyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
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

    // Periodic sync attempt (every 25 seconds)
    this.syncInterval = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.syncNow(true); // silent background sync
      }
    }, 25000);

    // Initial check on load
    setTimeout(() => {
      this.checkServerReachability().then((reachable) => {
        this.isOnline = reachable;
        if (reachable) {
          this.syncNow(true);
        } else {
          this.notifyStatus('offline');
        }
      });
    }, 1000);
  }

  onStatusChange(callback) {
    this.listeners.push(callback);
    // Trigger immediately with current status
    callback(this.getStatus());
  }

  notifyStatus(forceState = null) {
    const status = this.getStatus(forceState);
    this.listeners.forEach(cb => {
      try { cb(status); } catch (e) { console.error(e); }
    });
  }

  getStatus(forceState = null) {
    return {
      isOnline: forceState ? forceState === 'online' : this.isOnline,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime
    };
  }

  async checkServerReachability() {
    if (!navigator.onLine) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('/api/stats', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async syncNow(silent = false) {
    if (this.isSyncing) return;

    // Check if truly reachable
    const reachable = await this.checkServerReachability();
    this.isOnline = reachable;

    if (!reachable) {
      this.notifyStatus('offline');
      return { success: false, offline: true, message: 'الخادم غير متاح حالياً' };
    }

    this.isSyncing = true;
    this.notifyStatus('syncing');

    try {
      // 1. Gather all unsynced data from IndexedDB
      const unsynced = await getUnsyncedRecords();
      const totalCount = unsynced.students.length + unsynced.lectures.length + unsynced.attendance.length;

      if (totalCount === 0) {
        this.isSyncing = false;
        this.notifyStatus('synced');
        return { success: true, count: 0, message: 'جميع البيانات متزامنة ومحدثة' };
      }

      // 2. Transmit batch to server
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: unsynced.students,
          lectures: unsynced.lectures,
          attendance: unsynced.attendance
        })
      });

      if (!response.ok) {
        throw new Error('Server returned ' + response.status);
      }

      const result = await response.json();

      if (result.success) {
        // 3. Mark records as synced in local IndexedDB
        await markRecordsAsSynced(unsynced);

        this.lastSyncTime = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem('last_sync_timestamp', this.lastSyncTime);

        this.isSyncing = false;
        this.notifyStatus('synced');

        // Dispatch window event so UI can re-render if needed
        window.dispatchEvent(new CustomEvent('sync-completed', { detail: result }));

        return {
          success: true,
          count: totalCount,
          message: `تم رفع ${totalCount} سجل إلى السيرفر بنجاح`
        };
      } else {
        throw new Error(result.message || 'فشلت المزامنة');
      }
    } catch (err) {
      console.warn('[Sync] Sync failed or offline:', err.message);
      this.isSyncing = false;
      this.notifyStatus('offline');
      return { success: false, error: err.message };
    }
  }
}

// Global singleton
window.syncManager = new SyncManager();

