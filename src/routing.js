import { fn } from './api.js';
import { optimizeOrder, haversine } from './optimize.js';

// origin: [lat,lng]، stops: [{lat,lng,priority}]
// خروجی: ترتیب بهینه + هندسه‌ی مسیر روی جاده + فاصله و زمان هر بخش
export async function planRoute(origin, stops) {
  if (!stops.length) return { order: [], legs: [], geometry: [], distance: 0, duration: 0 };
  const pts = [origin, ...stops.map((s) => [s.lat, s.lng])];
  let matrix, approximate = false;
  try {
    const t = await fn('geo', { action: 'table', points: pts });
    matrix = t.distances;
  } catch (e) {
    console.warn('table failed, using straight-line distances', e);
    matrix = pts.map((a) => pts.map((b) => haversine(a, b) * 1.3));
    approximate = true;
  }
  const order = optimizeOrder(matrix, stops.map((s) => s.priority ?? null));
  const r = await routeThrough([origin, ...order.map((i) => [stops[i].lat, stops[i].lng])]);
  return { order, ...r, approximate: approximate || r.approximate };
}

// هندسه‌ی مسیر برای یک ترتیب مشخص
export async function routeThrough(points) {
  try {
    const r = await fn('geo', { action: 'route', points });
    return { geometry: r.geometry, legs: r.legs, distance: r.distance, duration: r.duration, approximate: false };
  } catch (e) {
    console.warn('route failed, using straight lines', e);
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      const d = haversine(points[i - 1], points[i]) * 1.3;
      legs.push({ distance: d, duration: d / 13 }); // ~۴۷ کیلومتر بر ساعت
    }
    return {
      geometry: points, legs,
      distance: legs.reduce((a, l) => a + l.distance, 0),
      duration: legs.reduce((a, l) => a + l.duration, 0),
      approximate: true,
    };
  }
}

export const searchPlace = (q) => fn('geo', { action: 'search', q }).then((r) => r.results);
export const reversePlace = (lat, lng) => fn('geo', { action: 'reverse', lat, lng });

export const navLinks = (lat, lng, name = '') => ({
  geo: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
});
