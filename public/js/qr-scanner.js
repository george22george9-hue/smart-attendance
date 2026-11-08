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

    // Validate QR code payload format
    try {
      const data = JSON.parse(decodedText);
      if (!data.nid || !data.name || !data.dept) {
        throw new Error('QR code does not contain required attendance fields');
      }

      if (this.onScanCallback) {
        this.onScanCallback({
          national_id: String(data.nid).trim(),
          student_name: String(data.name).trim(),
          department: String(data.dept).trim()
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

