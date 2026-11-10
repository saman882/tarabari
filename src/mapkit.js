import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { esc } from './ui.js';

export const COLORS = {
  planned: '#2563eb',   // بهترین مسیر فعلی
  load: '#a855f7',      // مسیر چیدمان بار (روز قبل)
  actual: '#e11d48',    // مسیری که راننده واقعاً رفته
  store: '#0f766e',
  origin: '#111827',
};
// رنگ ثابت برای هر راننده
const PALETTE = ['#e11d48', '#ea580c', '#16a34a', '#0891b2', '#9333ea', '#ca8a04', '#db2777', '#4f46e5'];
export const driverColor = (id) => {
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export function createMap(el, { center = [35.6892, 51.389], zoom = 6 } = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  });
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO',
  });
  osm.addTo(map);
  // اگر کاشی‌های OSM باز نشدند، به CARTO برو
  let fails = 0;
  osm.on('tileerror', () => { if (++fails === 6 && map.hasLayer(osm)) { map.removeLayer(osm); carto.addTo(map); } });
  L.control.layers({ 'نقشه OSM': osm, 'نقشه روشن': carto }, null, { position: 'topleft' }).addTo(map);
  map.attributionControl.setPrefix(false);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

export function numberIcon(n, { color = '#fff', bg = COLORS.planned, ring = '#fff', big = false } = {}) {
  const s = big ? 36 : 28;
  return L.divIcon({
    className: 'num-ico',
    html: `<div style="width:${s}px;height:${s}px;background:${bg};color:${color};border:3px solid ${ring}">${esc(n)}</div>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2],
  });
}
export const stopIcon = (stop, idx) => {
  const st = stop.status;
  const bg = st === 'delivered' ? '#16a34a' : st === 'arrived' ? '#f59e0b' : st === 'skipped' ? '#9ca3af' : COLORS.planned;
  return numberIcon(idx, { bg, ring: stop.priority ? '#facc15' : '#fff' });
};
export const storeIcon = () => L.divIcon({
  className: 'store-ico',
  html: `<div><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M4 4h16l1 5a3 3 0 0 1-2 2.8V20H5v-8.2A3 3 0 0 1 3 9zm3 9v5h4v-5zm6 0v5h4v-5z"/></svg></div>`,
  iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13],
});
export const originIcon = () => L.divIcon({
  className: 'origin-ico',
  html: `<div><svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 3 2 9v12h7v-6h6v6h7V9z"/></svg></div>`,
  iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15],
});
export const truckIcon = (color, label = '') => L.divIcon({
  className: 'truck-ico',
  html: `<div style="background:${color}"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M3 5h11v9h1V8h3.5L22 12v5h-2a2.5 2.5 0 0 1-5 0H9a2.5 2.5 0 0 1-5 0H3zm14.5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4m-11 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4M17 9.5V12h3.3l-1.8-2.5z"/></svg></div>${label ? `<span>${esc(label)}</span>` : ''}`,
  iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -17],
});
export const meIcon = () => L.divIcon({ className: 'me-ico', html: '<div></div>', iconSize: [20, 20], iconAnchor: [10, 10] });

export function legend(map, items) {
  const c = L.control({ position: 'bottomleft' });
  c.onAdd = () => {
    const d = L.DomUtil.create('div', 'legend');
    d.innerHTML = items.map(([color, label, dashed]) =>
      `<div><i style="border-top:4px ${dashed ? 'dashed' : 'solid'} ${color}"></i>${esc(label)}</div>`).join('');
    return d;
  };
  c.addTo(map);
  return c;
}

export function fit(map, latlngs, maxZoom = 15) {
  const pts = latlngs.filter(Boolean);
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], Math.min(maxZoom, 14));
  else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom });
}

export { L };
