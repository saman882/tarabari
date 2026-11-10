import { sb, must, getTrip, tripPath } from './api.js';
import { createMap, L, meIcon, legend, COLORS } from './mapkit.js';
import { $, esc, num, km, dur, time, dateFa, toast, busy, confirmBox, modal, todayISO, addDays, STATUS_FA } from './ui.js';
import { openTripEditor } from './tripEditor.js';
import { TripLayers, timelineHTML, loadPlanHTML, navButtonsHTML } from './tripView.js';
import { replan, markArrived, markDelivered, skipStop, pendingStops, sortStops } from './trips.js';
import { Tracker, currentPosition } from './gps.js';
import { haversine } from './optimize.js';
import { ARRIVE_RADIUS_M } from './config.js';

let tracker = null;

export async function driverApp(root, profile) {
  tracker?.stop();
  tracker = new Tracker({ driverId: profile.id, onError: (m) => toast(m, 'error') });
  const go = (hash) => { location.hash = hash; };
  const route = async () => {
    const m = location.hash.match(/^#trip\/(\d+)/);
    if (m) await tripScreen(root, profile, +m[1], go);
    else { await listScreen(root, profile, go); }
  };
  window.onhashchange = route;
  await route();
}

async function listScreen(root, profile, go) {
  if (tracker.running) tracker.stop();
  root.innerHTML = `<section class="page">
    <div class="page-head"><h2>سفرهای من</h2><button class="btn primary" data-new>+ سفر جدید</button></div>
    <div class="cards" id="trips"><div class="muted pad">در حال بارگذاری…</div></div>
  </section>`;
  $('[data-new]', root).onclick = () => openTripEditor({ profile, onSaved: (t) => go(`#trip/${t.id}`) });
  const since = addDays(todayISO(), -2);
  const trips = must(await sb.from('trips').select('*, trip_stops(id,status)').eq('driver_id', profile.id)
    .or(`plan_date.gte.${since},status.eq.active,status.eq.planned`).order('plan_date', { ascending: true }).order('id'));
  const box = $('#trips', root);
  if (!trips.length) { box.innerHTML = '<div class="empty-state"><p>هنوز سفری ندارید.</p><p class="muted">با «سفر جدید» مقصدها را وارد کنید تا بهترین مسیر و ترتیب چیدن بار را ببینید.</p></div>'; return; }
  box.innerHTML = trips.map((t) => {
    const del = t.trip_stops.filter((s) => s.status === 'delivered').length;
    return `<button class="card trip-card st-${t.status}" data-id="${t.id}">
      <div class="row between"><b>${esc(t.title)}</b><span class="badge s-${t.status}">${STATUS_FA[t.status]}</span></div>
      <div class="muted">${dateFa(t.plan_date)}</div>
      <div class="row wrap gap">
        <span>${num(t.trip_stops.length)} مقصد</span><span>${km(t.planned_distance_m)}</span><span>${dur(t.planned_duration_s)}</span>
        ${t.status !== 'planned' ? `<span>${num(del)} تحویل‌شده</span>` : ''}
      </div></button>`;
  }).join('');
  box.onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) go(`#trip/${c.dataset.id}`); };
}

async function tripScreen(root, profile, id, go) {
  root.innerHTML = `<section class="trip-screen">
    <div class="trip-map"><div class="map" id="dmap"></div><button class="fab" data-center title="موقعیت من">◎</button></div>
    <div class="trip-panel" id="panel"><div class="muted pad">در حال بارگذاری…</div></div>
  </section>`;
  const map = createMap($('#dmap', root));
  legend(map, [[COLORS.planned, 'بهترین مسیر'], [COLORS.actual, 'مسیر طی‌شده'], [COLORS.load, 'مسیر چیدمان بار', true]]);
  const layers = new TripLayers(map, { showLoad: true });
  let me = null, meMarker = null, trip = null, firstDraw = true, autoArrivedFor = null;
  let gpsOK = false;

  tracker.onPosition = (p) => {
    gpsOK = true;
    me = [p.lat, p.lng];
    if (!meMarker) meMarker = L.marker(me, { icon: meIcon(), zIndexOffset: 2000 }).addTo(map);
    else meMarker.setLatLng(me);
    if (trip?.status === 'active') {
      layers.addPoint(p);
      const cur = pendingStops(trip)[0];
      if (cur && cur.status === 'pending' && autoArrivedFor !== cur.id && haversine(me, [cur.lat, cur.lng]) < ARRIVE_RADIUS_M) {
        autoArrivedFor = cur.id;
        markArrived(cur).then(() => { toast(`به «${cur.name}» رسیدید`, 'ok'); load(); }).catch(() => {});
      }
      updateDistance();
    }
  };
  $('[data-center]', root).onclick = () => { if (me) map.setView(me, 15); else toast('هنوز موقعیت GPS دریافت نشده'); };

  const channel = sb.channel(`driver-trip-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_stops', filter: `trip_id=eq.${id}` }, () => scheduleLoad())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${id}` }, () => scheduleLoad())
    .subscribe();
  const off = () => { sb.removeChannel(channel); window.removeEventListener('hashchange', off); };
  window.addEventListener('hashchange', off);
  let lt; const scheduleLoad = () => { clearTimeout(lt); lt = setTimeout(load, 600); };

  function updateDistance() {
    const el = $('[data-dist]', root);
    const cur = trip && pendingStops(trip)[0];
    if (el && cur && me) el.textContent = `فاصله‌ی مستقیم تا مقصد: ${km(haversine(me, [cur.lat, cur.lng]))}`;
  }

  async function load() {
    try { trip = await getTrip(id); } catch { root.innerHTML = '<div class="pad">سفر پیدا نشد. <a href="#">بازگشت</a></div>'; return; }
    if (trip.status === 'active') { if (!tracker.running || tracker.tripId !== id) { tracker.stop(); tracker.start(id); } }
    else if (trip.status === 'planned') { if (!tracker.running) tracker.start(null); }
    else if (tracker.running) tracker.stop();
    const path = trip.status === 'planned' ? [] : await tripPath(id);
    layers.draw(trip, path, { fitView: firstDraw });
    firstDraw = false;
    renderPanel();
  }

  function renderPanel() {
    const p = $('#panel', root);
    const head = `<div class="row between"><a href="#" class="back">→ سفرها</a><span class="badge s-${trip.status}">${STATUS_FA[trip.status]}</span></div>
      <h2 class="trip-title">${esc(trip.title)}</h2><div class="muted">${dateFa(trip.plan_date)} · ${num(trip.trip_stops.length)} مقصد · ${km(trip.planned_distance_m)} · ${dur(trip.planned_duration_s)}</div>`;

    if (trip.status === 'planned') {
      p.innerHTML = `${head}
        <div class="callout">برای چیدن بار از راهنمای زیر استفاده کنید. موقع حرکت دکمه‌ی «شروع حرکت» را بزنید تا بهترین مسیر از جایی که هستید دوباره محاسبه شود.</div>
        ${loadPlanHTML(trip)}
        <button class="btn primary big block" data-start>شروع حرکت</button>
        <div class="row wrap gap mt">
          <button class="btn" data-edit>ویرایش مقصدها</button>
          <button class="btn" data-print>چاپ برگه‌ی بار</button>
          <button class="btn danger ghost" data-del>حذف سفر</button>
        </div>`;
      $('[data-start]', p).onclick = (e) => busy(e.currentTarget, async () => {
        let pos = me;
        if (!pos) pos = await currentPosition();
        const r = await replan(trip, pos, { start: true });
        if (r.approximate) toast('مسیریابی آنلاین در دسترس نبود؛ مسیر تقریبی است', 'warn');
        if (r.changed) {
          modal(`<h3>ترتیب مقصدها نسبت به برنامه‌ی چیدمان تغییر کرد</h3>
            <p>با توجه به موقعیت فعلی شما، ترتیب جدید بهتر است:</p>
            <ol>${r.ordered.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ol>
            <p class="hint">اگر بار به ترتیب قبلی چیده شده، هنگام تخلیه دقت کنید.</p>`);
        } else toast('مسیر محاسبه شد. حرکت بخیر!', 'ok');
        tracker.stop(); tracker.start(id);
        await load();
      });
      $('[data-edit]', p).onclick = () => openTripEditor({ profile, trip, onSaved: () => { firstDraw = true; load(); } });
      $('[data-print]', p).onclick = () => printLoad(trip);
      $('[data-del]', p).onclick = async () => {
        if (await confirmBox('این سفر حذف شود؟', 'حذف')) { must(await sb.from('trips').delete().eq('id', trip.id)); go('#'); }
      };
    } else if (trip.status === 'active') {
      const rest = pendingStops(trip);
      const cur = rest[0];
      const idx = sortStops(trip.trip_stops).indexOf(cur) + 1;
      p.innerHTML = `${head}
        ${cur ? `<div class="current-stop ${cur.status}">
          <div class="muted">مقصد ${num(idx)} از ${num(trip.trip_stops.length)}${cur.priority ? ` · <span class="badge pri">اولویت ${num(cur.priority)}</span>` : ''}</div>
          <h3>${esc(cur.name)}</h3>
          ${cur.address ? `<div class="muted">${esc(cur.address)}</div>` : ''}
          <div class="row wrap gap"><span>رسیدن تخمینی: <b>${time(cur.eta)}</b></span><span data-dist></span></div>
          ${navButtonsHTML(cur)}
          <div class="row gap mt">
            ${cur.status === 'pending' ? '<button class="btn big" data-arrive>رسیدم</button>' : `<span class="ok-t">رسیدید: ${time(cur.arrived_at)}</span>`}
            <button class="btn primary big grow" data-deliver>تحویل دادم ✓</button>
          </div>
        </div>` : ''}
        <div class="row wrap gap mt">
          <button class="btn sm" data-replan>مسیریابی دوباره از اینجا</button>
          ${cur ? '<button class="btn sm ghost" data-skip>رد کردن این مقصد</button>' : ''}
          ${gpsOK ? '' : '<span class="warn-t">در انتظار GPS…</span>'}
        </div>
        <details class="mt" open><summary>همه‌ی مقصدها</summary>${timelineHTML(trip)}</details>
        <p class="hint">برای ثبت دقیق مسیر، صفحه را باز نگه دارید (صفحه‌ی گوشی خاموش نمی‌شود).</p>`;
      updateDistance();
      $('[data-arrive]', p)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { await markArrived(cur); await load(); }));
      $('[data-deliver]', p)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await markDelivered(trip, cur);
        toast(r.finished ? 'همه‌ی بارها تحویل شد. خسته نباشید!' : `«${cur.name}» تحویل شد. برو مقصد بعدی`, 'ok');
        await load();
      }));
      $('[data-skip]', p)?.addEventListener('click', async () => {
        if (await confirmBox(`مقصد «${cur.name}» رد شود؟ (بعداً سرپرست می‌بیند)`, 'رد کن')) { await skipStop(trip, cur); await load(); }
      });
      $('[data-replan]', p).onclick = (e) => busy(e.currentTarget, async () => {
        const pos = me ?? await currentPosition();
        const r = await replan(trip, pos);
        toast(r.approximate ? 'مسیر تقریبی محاسبه شد' : 'مسیر جدید محاسبه شد', r.approximate ? 'warn' : 'ok');
        await load();
      });
    } else {
      p.innerHTML = `${head}<div class="callout ok">این سفر تمام شده است.</div>${timelineHTML(trip)}`;
    }
    $('.back', p).onclick = (e) => { e.preventDefault(); go('#'); };
  }

  await load();
}

function printLoad(trip) {
  const w = window.open('', '_blank');
  if (!w) return toast('اجازه‌ی باز کردن پنجره داده نشد', 'error');
  w.document.write(`<html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>برگه‌ی بار</title>
    <style>body{font-family:Vazirmatn,Tahoma,sans-serif;padding:24px}li{margin:6px 0}.badge{border:1px solid #999;border-radius:6px;padding:0 6px;font-size:12px}.pos{font-weight:bold;margin-left:6px}.loadplan{display:flex;gap:40px}.hint{color:#666}</style></head>
    <body><h2>${esc(trip.title)}</h2><p>${dateFa(trip.plan_date)} — مبدأ: ${esc(trip.origin_name || '')}</p>${loadPlanHTML(trip)}<script>print()<\/script></body></html>`);
  w.document.close();
}

export function stopDriver() { tracker?.stop(); }
