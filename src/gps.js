import { sb } from './api.js';
import { haversine } from './optimize.js';

// ردیابی GPS راننده: ارسال هر ۲۰ ثانیه یا هر ۲۵ متر جابه‌جایی، با صف آفلاین
const QKEY = 'tarabari-gps-queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-5000))); } catch { /* پر */ } };

export class Tracker {
  constructor({ driverId, onPosition, onError }) {
    this.driverId = driverId; this.tripId = null;
    this.onPosition = onPosition; this.onError = onError;
    this.watch = null; this.last = null; this.lastSent = 0; this.flushing = false; this.wake = null;
    this.timer = null;
  }
  get running() { return this.watch != null; }

  start(tripId = null) {
    this.tripId = tripId;
    if (!('geolocation' in navigator)) { this.onError?.('مرورگر شما GPS را پشتیبانی نمی‌کند'); return; }
    if (this.watch != null) return;
    this.watch = navigator.geolocation.watchPosition((p) => this.#handle(p), (e) => {
      this.onError?.(e.code === 1 ? 'اجازه‌ی دسترسی به موقعیت داده نشده. از تنظیمات مرورگر اجازه دهید.' : 'موقعیت GPS دریافت نشد');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    this.#keepAwake();
    this.timer = setInterval(() => this.flush(), 30000);
    document.addEventListener('visibilitychange', this.#onVis);
  }

  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    clearInterval(this.timer);
    this.wake?.release?.().catch(() => {});
    this.wake = null;
    document.removeEventListener('visibilitychange', this.#onVis);
    this.flush();
  }

  #onVis = () => { if (document.visibilityState === 'visible' && this.watch != null) { this.#keepAwake(); this.flush(); } };

  async #keepAwake() {
    try { if ('wakeLock' in navigator && !this.wake) { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; }); } } catch { /* */ }
  }

  #handle(p) {
    const c = p.coords;
    const pos = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, recorded_at: new Date(p.timestamp).toISOString() };
    this.onPosition?.(pos);
    if (c.accuracy > 150) return; // دقت پایین
    const moved = this.last ? haversine([this.last.lat, this.last.lng], [pos.lat, pos.lng]) : Infinity;
    const now = Date.now();
    if (moved < 25 && now - this.lastSent < 20000) return;
    this.last = pos; this.lastSent = now;
    const q = readQ();
    q.push({ ...pos, trip_id: this.tripId, driver_id: this.driverId });
    writeQ(q);
    this.flush();
  }

  async flush() {
    if (this.flushing) return;
    const q = readQ();
    if (!q.length) return;
    this.flushing = true;
    try {
      const batch = q.slice(0, 200);
      const { error } = await sb.from('gps_points').insert(batch);
      if (error) throw error;
      writeQ(readQ().slice(batch.length));
      const l = batch[batch.length - 1];
      await sb.from('driver_locations').upsert({
        driver_id: this.driverId, trip_id: l.trip_id, lat: l.lat, lng: l.lng,
        accuracy: l.accuracy, speed: l.speed, heading: l.heading, updated_at: l.recorded_at,
      });
      if (readQ().length) setTimeout(() => this.flush(), 500);
    } catch (e) {
      console.warn('gps flush failed', e);
    } finally { this.flushing = false; }
  }
}

export function currentPosition() {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('GPS در دسترس نیست'));
    navigator.geolocation.getCurrentPosition(
      (p) => res([p.coords.latitude, p.coords.longitude]),
      (e) => rej(new Error(e.code === 1 ? 'اجازه‌ی دسترسی به موقعیت داده نشده' : 'موقعیت GPS دریافت نشد. بیرون از ساختمان دوباره امتحان کنید.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  });
}
