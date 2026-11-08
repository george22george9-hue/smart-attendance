/**
 * Offline QR Code Scanner, Audio Synthesizer, and Haptic Feedback
 */
class QRScannerController {
  constructor(containerId) {
    this.containerId = containerId;
    this.html5QrCode = null;
    this.isScanning = false;
    this.currentCameraId = null;
    this.availableCameras = [];
    this.audioCtx = null;
    this.lastScannedPayload = null;
    this.lastScannedTime = 0;
    this.scanCooldownMs = 1800; // prevent duplicate read within 1.8 seconds for same code
    this.onScanCallback = null;
  }

  // Web Audio API Synthesizer (Works 100% offline with zero external audio assets)
  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  playSuccessBeep() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // High crisp chime (880Hz -> 1320Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  playWarningBeep() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Lower warning buzz tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.setValueAtTime(320, now + 0.1);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  triggerHaptic(type = 'success') {
    if ('vibrate' in navigator) {
      try {
        if (type === 'success') {
          navigator.vibrate([70, 40, 70]);
        } else if (type === 'warning') {
          navigator.vibrate([150, 80, 150]);
        } else if (type === 'error') {
          navigator.vibrate([250]);
        }
      } catch (e) {
        console.warn('Vibration error:', e);
      }
    }
  }

  async initCameras() {
    try {
      this.availableCameras = await Html5Qrcode.getCameras();
      return this.availableCameras;
    } catch (err) {
      console.warn('Could not enumerate cameras:', err);
      return [];
    }
  }

  async start(onScanCallback) {
    this.onScanCallback = onScanCallback;
    if (this.isScanning) {
      await this.stop();
    }

    if (!this.html5QrCode) {
      this.html5QrCode = new Html5Qrcode(this.containerId);
    }

    const config = {
      fps: 12,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        return {
          width: Math.floor(minEdge * 0.72),
          height: Math.floor(minEdge * 0.72)
        };
      },
      aspectRatio: 1.0
    };

    // Camera strategy: Prefer back camera (facingMode environment)
    const cameraConfig = { facingMode: 'environment' };

    try {
      await this.html5QrCode.start(
        cameraConfig,
        config,
        (decodedText) => this.handleDecodedText(decodedText),
        (errorMessage) => {
          // ignore common scan frame misses
        }
      );
      this.isScanning = true;
      return true;
    } catch (err) {
      console.warn('Failed to start with facingMode, trying camera list fallback:', err);
      // Fallback: list cameras and pick the last one (usually back camera on mobile)
      const cameras = await this.initCameras();
      if (cameras && cameras.length > 0) {
        const selectedCam = cameras[cameras.length - 1].id;
        await this.html5QrCode.start(
          selectedCam,
          config,
          (decodedText) => this.handleDecodedText(decodedText),
          () => {}
        );
        this.isScanning = true;
        this.currentCameraId = selectedCam;
        return true;
      }
      throw err;
    }
  }

  handleDecodedText(decodedText) {
    const now = Date.now();
    // Debounce duplicate reads of the exact same code
    if (this.lastScannedPayload === decodedText && (now - this.lastScannedTime) < this.scanCooldownMs) {
      return;
    }

    this.lastScannedPayload = decodedText;
    this.lastScannedTime = now;

    // Multi-format QR decoder (JSON, URL encoded, pipe delimited, base64)
    try {
      let data = null;
      let text = String(decodedText).trim();

      // Attempt 1: URL encoded JSON
      if (text.includes('%')) {
        try { text = decodeURIComponent(text); } catch (e) {}
      }

      // Attempt 2: Direct JSON
      if (text.startsWith('{') && text.endsWith('}')) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          // If JSON failed, try cleaning quotes or brackets
          console.warn('Direct JSON parse failed, trying relaxed parse:', e);
        }
      }

      // Attempt 3: Prefix format ATTEND:nid|name|dept
      if (!data && text.startsWith('ATTEND:')) {
        const parts = text.substring(7).split('|');
        if (parts.length >= 3) {
          data = { nid: parts[0], name: parts[1], dept: parts[2] };
        }
      }

      // Attempt 4: Pipe separated nid|name|dept
      if (!data && text.includes('|')) {
        const parts = text.split('|');
        if (parts.length >= 3) {
          data = { nid: parts[0], name: parts[1], dept: parts[2] };
        }
      }

      // If still not parsed, try regex extraction of nid / name / dept
      if (!data) {
        const nidMatch = text.match(/"nid"\s*:\s*"(\d{14})"/);
        const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
        const deptMatch = text.match(/"dept"\s*:\s*"([^"]+)"/);
        if (nidMatch) {
          data = {
            nid: nidMatch[1],
            name: nameMatch ? nameMatch[1] : 'طالب مسجل',
            dept: deptMatch ? deptMatch[1] : 'عام'
          };
        }
      }

      // Attempt 5: Any 14-digit National ID in the text
      if (!data) {
        const rawNidMatch = text.match(/\b\d{14}\b/) || text.match(/\d{14}/);
        if (rawNidMatch) {
          data = {
            nid: rawNidMatch[0],
            name: 'طالب مسجل',
            dept: 'عام'
          };
        }
      }

      if (!data || !data.nid) {
        throw new Error('QR payload is missing student national ID');
      }

      if (this.onScanCallback) {
        this.onScanCallback({
          national_id: String(data.nid).trim(),
          student_name: String(data.name || 'طالب مسجل').trim(),
          department: String(data.dept || 'عام').trim()
        });
      }
    } catch (err) {
      console.warn('Invalid QR Code scanned:', decodedText, err.message);
      if (this.onScanCallback) {
        this.onScanCallback({
          invalid: true,
          raw: decodedText,
          message: 'كود QR غير صالح لنظام الحضور'
        });
      }
    }
  }

  async stop() {
    if (this.html5QrCode && this.isScanning) {
      try {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      } catch (err) {
        console.warn('Error stopping scanner:', err);
      }
      this.isScanning = false;
    }
  }
}

window.QRScannerController = QRScannerController;

