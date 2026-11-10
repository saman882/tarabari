import { L, COLORS, stopIcon, originIcon, fit } from './mapkit.js';
import { esc, num, km, dur, time, STOP_FA } from './ui.js';
import { sortStops } from './trips.js';
import { navLinks } from './routing.js';

// لایه‌های نقشه‌ی یک سفر
export class TripLayers {
  constructor(map, { showLoad = false } = {}) {
    this.map = map;
    this.load = L.layerGroup().addTo(map);
    this.planned = L.layerGroup().addTo(map);
    this.actual = L.layerGroup().addTo(map);
    this.stops = L.layerGroup().addTo(map);
    this.showLoad = showLoad;
    this.actualLine = null;
  }
  clear() { [this.load, this.planned, this.actual, this.stops].forEach((l) => l.clearLayers()); this.actualLine = null; }
  draw(trip, path = [], { fitView = true } = {}) {
    this.clear();
    const stops = sortStops(trip.trip_stops);
    if (this.showLoad && trip.load_geometry && trip.replanned_at)
      L.polyline(trip.load_geometry, { color: COLORS.load, weight: 4, opacity: 0.8, dashArray: '8 8' }).addTo(this.load).bindTooltip('مسیر چیدمان بار (برنامه‌ی اولیه)');
    if (trip.planned_geometry?.length) {
      L.polyline(trip.planned_geometry, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(this.planned);
      L.polyline(trip.planned_geometry, { color: COLORS.planned, weight: 5, opacity: 0.95 }).addTo(this.planned).bindTooltip('بهترین مسیر');
    }
    this.setPath(path);
    L.marker([trip.origin_lat, trip.origin_lng], { icon: originIcon(), zIndexOffset: 500 }).addTo(this.stops)
      .bindPopup(`<b>مبدأ</b><br>${esc(trip.origin_name || '')}`);
    stops.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: stopIcon(s, num(i + 1)), zIndexOffset: 1000 }).addTo(this.stops).bindPopup(stopPopup(s, i));
    });
    if (fitView) fit(this.map, [[trip.origin_lat, trip.origin_lng], ...stops.map((s) => [s.lat, s.lng]), ...path.slice(-1).map((p) => [p.lat, p.lng])]);
  }
  setPath(path) {
    this.actual.clearLayers();
    if (!path.length) { this.actualLine = null; return; }
    this.actualLine = L.polyline(path.map((p) => [p.lat, p.lng]), { color: COLORS.actual, weight: 4, opacity: 0.9 }).addTo(this.actual).bindTooltip('مسیر طی‌شده توسط راننده');
  }
  addPoint(p) {
    if (!this.actualLine) this.setPath([p]); else this.actualLine.addLatLng([p.lat, p.lng]);
  }
}

function stopPopup(s, i) {
  return `<b>${num(i + 1)}. ${esc(s.name)}</b>${s.priority ? ` <span class="badge pri">اولویت ${num(s.priority)}</span>` : ''}<br>
    ${s.address ? `<small>${esc(s.address)}</small><br>` : ''}
    وضعیت: ${STOP_FA[s.status]}<br>
    ${s.eta && s.status === 'pending' ? `رسیدن تخمینی: ${time(s.eta)}<br>` : ''}
    ${s.arrived_at ? `رسید: ${time(s.arrived_at)}<br>` : ''}
    ${s.delivered_at ? `تحویل: ${time(s.delivered_at)}` : ''}`;
}

// جدول زمان‌بندی مقصدها
export function timelineHTML(trip) {
  const stops = sortStops(trip.trip_stops);
  const delivered = stops.filter((s) => s.status === 'delivered').length;
  return `
    <div class="tl-head">
      <div><span class="muted">شروع حرکت:</span> <b>${trip.started_at ? time(trip.started_at) : 'هنوز حرکت نکرده'}</b></div>
      ${trip.finished_at ? `<div><span class="muted">پایان:</span> <b>${time(trip.finished_at)}</b></div>` : ''}
      <div><span class="muted">مسافت:</span> <b>${km(trip.planned_distance_m)}</b> · <span class="muted">زمان رانندگی:</span> <b>${dur(trip.planned_duration_s)}</b></div>
      <div class="progress"><i style="width:${stops.length ? (delivered / stops.length) * 100 : 0}%"></i><span>${num(delivered)} از ${num(stops.length)} تحویل شد</span></div>
    </div>
    <ol class="timeline">
      <li class="tl-origin"><span class="dot"></span><div><b>مبدأ</b> — ${esc(trip.origin_name || '')}<div class="tl-times">${trip.started_at ? `حرکت: ${time(trip.started_at)}` : ''}</div></div></li>
      ${stops.map((s, i) => `
        <li class="st-${s.status}">
          <span class="dot">${num(i + 1)}</span>
          <div>
            <b>${esc(s.name)}</b> ${s.priority ? `<span class="badge pri">اولویت ${num(s.priority)}</span>` : ''} <span class="badge st">${STOP_FA[s.status]}</span>
            <div class="tl-times">
              ${s.leg_distance_m != null ? `<span>${km(s.leg_distance_m)} · ${dur(s.leg_duration_s)}</span>` : ''}
              ${s.status === 'pending' && s.eta ? `<span>رسیدن تخمینی: <b>${time(s.eta)}</b></span>` : ''}
              ${s.arrived_at ? `<span>رسید: <b>${time(s.arrived_at)}</b></span>` : ''}
              ${s.delivered_at ? `<span>تحویل: <b>${time(s.delivered_at)}</b></span>` : ''}
              ${s.arrived_at && s.eta && s.status !== 'pending' ? lateness(s) : ''}
            </div>
          </div>
        </li>`).join('')}
    </ol>`;
}
function lateness(s) {
  const d = Math.round((new Date(s.arrived_at) - new Date(s.eta)) / 60000);
  if (Math.abs(d) < 5) return '<span class="ok-t">به‌موقع</span>';
  return d > 0 ? `<span class="late">${num(d)} دقیقه تأخیر</span>` : `<span class="ok-t">${num(-d)} دقیقه زودتر</span>`;
}

// راهنمای چیدن بار: مقصد آخر ته ماشین، مقصد اول دم در
export function loadPlanHTML(trip) {
  const byLoad = [...trip.trip_stops].sort((a, b) => a.load_seq - b.load_seq);
  return `
    <div class="loadplan">
      <div>
        <h4>ترتیب تحویل</h4>
        <ol>${byLoad.map((s) => `<li><b>${esc(s.name)}</b>${s.priority ? ` <span class="badge pri">اولویت ${num(s.priority)}</span>` : ''}</li>`).join('')}</ol>
      </div>
      <div>
        <h4>ترتیب چیدن بار در ماشین</h4>
        <ol class="truck">${[...byLoad].reverse().map((s, i, a) => `<li><span class="pos">${i === 0 ? 'ته ماشین' : i === a.length - 1 ? 'دم در' : ''}</span>بار «${esc(s.name)}»</li>`).join('')}</ol>
        <p class="hint">اول بار آخرین مقصد را ته ماشین بگذارید تا بار مقصد اول دم در باشد.</p>
      </div>
    </div>`;
}

export function navButtonsHTML(s) {
  const l = navLinks(s.lat, s.lng, s.name);
  return `<div class="row wrap nav-btns">
    <a class="btn sm" href="${l.geo}">مسیریابی با نشان / بلد</a>
    <a class="btn sm" href="${l.google}" target="_blank" rel="noopener">گوگل‌مپ</a>
    <a class="btn sm" href="${l.waze}" target="_blank" rel="noopener">ویز</a>
  </div>`;
}
