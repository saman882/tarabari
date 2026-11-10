import { sb, must, fn, getTrip, tripPath, listDrivers, listStores } from './api.js';
import { createMap, L, COLORS, truckIcon, storeIcon, driverColor, legend, fit } from './mapkit.js';
import { $, $$, esc, num, km, dur, time, dateFa, ago, toast, busy, confirmBox, modal, todayISO, addDays, STATUS_FA } from './ui.js';
import { openTripEditor } from './tripEditor.js';
import { TripLayers, timelineHTML, loadPlanHTML } from './tripView.js';
import { searchPlace } from './routing.js';

let cleanup = [];
const onCleanup = (f) => cleanup.push(f);
const runCleanup = () => { cleanup.forEach((f) => { try { f(); } catch { /* */ } }); cleanup = []; };

export async function supervisorApp(root, profile) {
  const route = async () => {
    runCleanup();
    const h = location.hash || '#live';
    $$('.tabs a').forEach((a) => a.classList.toggle('on', h.startsWith(a.getAttribute('href').replace(/\/.*/, '')) || (h.startsWith('#trip/') && a.getAttribute('href') === '#live')));
    const m = h.match(/^#trip\/(\d+)/);
    if (m) return live(root, profile, +m[1]);
    if (h.startsWith('#trips')) return tripsPage(root, profile);
    if (h.startsWith('#drivers')) return driversPage(root);
    if (h.startsWith('#stores')) return storesPage(root, profile);
    return live(root, profile, null);
  };
  window.onhashchange = route;
  await route();
}

// ---------------- نقشه‌ی زنده ----------------
async function live(root, profile, focusTripId) {
  root.innerHTML = `<section class="live">
    <aside class="side" id="side"><div class="muted pad">در حال بارگذاری…</div></aside>
    <div class="live-map"><div class="map" id="smap"></div>
      <label class="map-toggle"><input type="checkbox" checked data-stores> فروشگاه‌ها</label></div>
  </section>`;
  const map = createMap($('#smap', root));
  legend(map, [[COLORS.planned, 'بهترین مسیر'], [COLORS.actual, 'مسیر طی‌شده راننده'], [COLORS.load, 'مسیر چیدمان بار (برنامه‌ی اولیه)', true], [COLORS.store, 'فروشگاه‌ها']]);
  const storeLayer = L.layerGroup().addTo(map);
  const truckLayer = L.layerGroup().addTo(map);
  const layers = new TripLayers(map, { showLoad: true });
  const trucks = new Map();
  let drivers = [], trips = [], locs = new Map(), selected = focusTripId, selTrip = null;

  $('[data-stores]', root).onchange = (e) => (e.target.checked ? storeLayer.addTo(map) : map.removeLayer(storeLayer));

  const [st, dr, lc] = await Promise.all([listStores(), listDrivers(), sb.from('driver_locations').select('*').then(must)]);
  drivers = dr;
  st.forEach((s) => L.marker([s.lat, s.lng], { icon: storeIcon() }).addTo(storeLayer).bindPopup(`<b>${esc(s.name)}</b>${s.city ? '<br>' + esc(s.city) : ''}${s.address ? '<br><small>' + esc(s.address) + '</small>' : ''}`));
  lc.forEach((l) => locs.set(l.driver_id, l));

  async function loadTrips() {
    const today = todayISO();
    trips = must(await sb.from('trips').select('id,title,status,plan_date,driver_id,started_at,finished_at,planned_distance_m,trip_stops(id,status,eta,seq,name)')
      .or(`status.eq.active,plan_date.eq.${today},plan_date.eq.${addDays(today, 1)}`).order('plan_date').order('id'));
  }
  await loadTrips();

  function drawTrucks() {
    for (const d of drivers) {
      const l = locs.get(d.id);
      if (!l) continue;
      const stale = Date.now() - new Date(l.updated_at) > 10 * 60000;
      const icon = truckIcon(stale ? '#9ca3af' : driverColor(d.id), d.full_name);
      if (trucks.has(d.id)) trucks.get(d.id).setLatLng([l.lat, l.lng]).setIcon(icon);
      else {
        const mk = L.marker([l.lat, l.lng], { icon, zIndexOffset: 3000 }).addTo(truckLayer);
        mk.on('click', () => { const t = trips.find((x) => x.driver_id === d.id && x.status === 'active'); if (t) select(t.id); else mk.openPopup(); });
        trucks.set(d.id, mk);
      }
      trucks.get(d.id).bindPopup(`<b>${esc(d.full_name)}</b><br>آخرین موقعیت: ${ago(l.updated_at)}${l.speed != null ? `<br>سرعت: ${num(Math.round(l.speed * 3.6))} کیلومتر بر ساعت` : ''}`);
    }
  }

  function renderSide() {
    const side = $('#side', root);
    if (selected && selTrip) {
      const d = selTrip.driver;
      side.innerHTML = `<div class="row between"><button class="link" data-back>→ همه‌ی راننده‌ها</button><span class="badge s-${selTrip.status}">${STATUS_FA[selTrip.status]}</span></div>
        <h3 class="trip-title">${esc(selTrip.title)}</h3>
        <div class="muted">${dateFa(selTrip.plan_date)}</div>
        <div class="driver-line"><i style="background:${driverColor(d.id)}"></i><b>${esc(d.full_name)}</b>${d.phone ? ` · <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : ''}${d.vehicle ? ` · ${esc(d.vehicle)}` : ''}</div>
        ${locs.get(d.id) ? `<div class="muted">آخرین موقعیت GPS: ${ago(locs.get(d.id).updated_at)}</div>` : '<div class="warn-t">هنوز موقعیتی از این راننده دریافت نشده</div>'}
        ${timelineHTML(selTrip)}
        ${selTrip.status === 'planned' ? `<details><summary>برگه‌ی چیدن بار</summary>${loadPlanHTML(selTrip)}</details>` : ''}
        <div class="row wrap gap mt">
          ${selTrip.status !== 'done' ? '<button class="btn sm" data-edit>ویرایش مقصدها</button>' : ''}
          ${selTrip.status === 'active' ? '<button class="btn sm ghost" data-finish>پایان دادن به سفر</button>' : ''}
          <button class="btn sm danger ghost" data-del>حذف</button>
        </div>`;
      $('[data-back]', side).onclick = () => { location.hash = '#live'; };
      $('[data-edit]', side)?.addEventListener('click', () => openTripEditor({ profile, trip: selTrip, onSaved: () => select(selTrip.id) }));
      $('[data-finish]', side)?.addEventListener('click', async () => {
        if (await confirmBox('سفر به عنوان تمام‌شده ثبت شود؟')) { must(await sb.from('trips').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', selTrip.id)); select(selTrip.id); }
      });
      $('[data-del]', side).onclick = async () => {
        if (await confirmBox('این سفر و مسیر ثبت‌شده‌اش حذف شود؟', 'حذف')) { must(await sb.from('trips').delete().eq('id', selTrip.id)); location.hash = '#live'; }
      };
      return;
    }
    const active = drivers.filter((d) => d.active);
    side.innerHTML = `<div class="row between"><h3>راننده‌ها</h3><button class="btn sm primary" data-new>+ سفر جدید</button></div>
      ${active.length ? '' : '<div class="empty-state"><p>هنوز راننده‌ای ندارید.</p><a class="btn sm" href="#drivers">افزودن راننده</a></div>'}
      <ul class="driver-list">${active.map((d) => {
        const l = locs.get(d.id);
        const dts = trips.filter((t) => t.driver_id === d.id);
        return `<li>
          <div class="row between"><div class="driver-line"><i style="background:${driverColor(d.id)}"></i><b>${esc(d.full_name)}</b></div>
          <small class="${l && Date.now() - new Date(l.updated_at) < 600000 ? 'ok-t' : 'muted'}">${l ? ago(l.updated_at) : 'بدون GPS'}</small></div>
          ${dts.map((t) => {
            const del = t.trip_stops.filter((s) => s.status === 'delivered').length;
            const next = t.trip_stops.filter((s) => s.status === 'pending' || s.status === 'arrived').sort((a, b) => a.seq - b.seq)[0];
            return `<button class="trip-mini st-${t.status}" data-trip="${t.id}">
              <span class="row between"><span>${esc(t.title)}</span><span class="badge s-${t.status}">${STATUS_FA[t.status]}</span></span>
              <small class="muted">${t.plan_date === todayISO() ? 'امروز' : dateFa(t.plan_date)} · ${num(del)}/${num(t.trip_stops.length)} تحویل${t.status === 'active' && next ? ` · بعدی: ${esc(next.name)} (${time(next.eta)})` : ''}</small>
            </button>`;
          }).join('') || '<small class="muted">سفری برای امروز/فردا ندارد</small>'}
        </li>`;
      }).join('')}</ul>`;
    $('[data-new]', side).onclick = () => openTripEditor({ profile, onSaved: (t) => { location.hash = `#trip/${t.id}`; } });
    side.onclick = (e) => { const b = e.target.closest('[data-trip]'); if (b) location.hash = `#trip/${b.dataset.trip}`; };
  }

  async function select(id, { fitView = true } = {}) {
    selected = id;
    try { selTrip = await getTrip(id); } catch { toast('سفر پیدا نشد', 'error'); location.hash = '#live'; return; }
    const path = await tripPath(id);
    layers.draw(selTrip, path, { fitView });
    renderSide();
  }

  drawTrucks();
  if (selected) await select(selected);
  else {
    renderSide();
    fit(map, [...[...locs.values()].map((l) => [l.lat, l.lng]), ...st.map((s) => [s.lat, s.lng])], 12);
  }

  // به‌روزرسانی زنده
  let t1;
  const refresh = () => { clearTimeout(t1); t1 = setTimeout(async () => { await loadTrips(); if (selected) await select(selected, { fitView: false }); else renderSide(); }, 700); };
  const ch = sb.channel('supervisor-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (p) => {
      if (p.new?.driver_id) { locs.set(p.new.driver_id, p.new); drawTrucks(); if (!selected) renderSide(); }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_points' }, (p) => {
      if (selected && p.new.trip_id === selected) layers.addPoint(p.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_stops' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, refresh)
    .subscribe();
  const tick = setInterval(() => { drawTrucks(); }, 60000);
  onCleanup(() => { sb.removeChannel(ch); clearInterval(tick); map.remove(); });
}

// ---------------- فهرست سفرها ----------------
async function tripsPage(root, profile) {
  let date = sessionStorage.getItem('tarabari-trips-date') || todayISO();
  root.innerHTML = `<section class="page">
    <div class="page-head"><h2>سفرها</h2>
      <div class="row gap"><button class="btn sm" data-prev>روز قبل</button><b id="dlabel"></b><button class="btn sm" data-next>روز بعد</button>
      <button class="btn primary" data-new>+ سفر جدید</button></div></div>
    <div id="tlist"></div></section>`;
  const drivers = await listDrivers();
  const dname = (id) => drivers.find((d) => d.id === id)?.full_name ?? '—';
  async function load() {
    sessionStorage.setItem('tarabari-trips-date', date);
    $('#dlabel', root).textContent = dateFa(date) + (date === todayISO() ? ' (امروز)' : '');
    const trips = must(await sb.from('trips').select('*, trip_stops(id,status,arrived_at,eta)').eq('plan_date', date).order('id'));
    $('#tlist', root).innerHTML = trips.length ? `<table class="table"><thead><tr><th>راننده</th><th>سفر</th><th>وضعیت</th><th>مقصدها</th><th>مسافت</th><th>حرکت</th><th>پایان</th><th></th></tr></thead><tbody>
      ${trips.map((t) => {
        const del = t.trip_stops.filter((s) => s.status === 'delivered').length;
        return `<tr><td><span class="dot-c" style="background:${driverColor(t.driver_id)}"></span>${esc(dname(t.driver_id))}</td><td>${esc(t.title)}</td>
          <td><span class="badge s-${t.status}">${STATUS_FA[t.status]}</span></td><td>${num(del)} / ${num(t.trip_stops.length)}</td>
          <td>${km(t.planned_distance_m)}</td><td>${time(t.started_at)}</td><td>${time(t.finished_at)}</td>
          <td><a class="btn sm" href="#trip/${t.id}">مشاهده روی نقشه</a></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty-state">برای این روز سفری ثبت نشده.</div>';
  }
  $('[data-prev]', root).onclick = () => { date = addDays(date, -1); load(); };
  $('[data-next]', root).onclick = () => { date = addDays(date, 1); load(); };
  $('[data-new]', root).onclick = () => openTripEditor({ profile, onSaved: (t) => { location.hash = `#trip/${t.id}`; } });
  await load();
}

// ---------------- راننده‌ها ----------------
async function driversPage(root) {
  root.innerHTML = `<section class="page">
    <div class="page-head"><h2>راننده‌ها</h2><button class="btn primary" data-add>+ راننده‌ی جدید</button></div>
    <div id="dlist"></div></section>`;
  async function load() {
    const ds = await listDrivers();
    $('#dlist', root).innerHTML = ds.length ? `<table class="table"><thead><tr><th>نام</th><th>نام کاربری</th><th>تلفن</th><th>خودرو</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${ds.map((d) => `<tr class="${d.active ? '' : 'inactive'}"><td><span class="dot-c" style="background:${driverColor(d.id)}"></span>${esc(d.full_name)}</td><td dir="ltr">${esc(d.username)}</td>
        <td dir="ltr">${esc(d.phone || '')}</td><td>${esc(d.vehicle || '')}</td><td>${d.active ? 'فعال' : 'غیرفعال'}</td>
        <td class="row gap"><button class="btn sm" data-edit="${d.id}">ویرایش</button><button class="btn sm ghost" data-toggle="${d.id}">${d.active ? 'غیرفعال' : 'فعال'} کن</button><button class="btn sm danger ghost" data-del="${d.id}">حذف</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty-state">هنوز راننده‌ای اضافه نکرده‌اید. هر راننده نام کاربری و رمز جدا می‌گیرد و فقط مسیرهای خودش را می‌بیند.</div>';
    $('#dlist', root).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'), tg = e.target.closest('[data-toggle]'), dl = e.target.closest('[data-del]');
      if (ed) driverForm(ds.find((d) => d.id === ed.dataset.edit), load);
      if (tg) { const d = ds.find((x) => x.id === tg.dataset.toggle); await busy(tg, async () => { await fn('admin', { action: 'update_driver', id: d.id, active: !d.active }); await load(); }); }
      if (dl) {
        const d = ds.find((x) => x.id === dl.dataset.del);
        if (await confirmBox(`حساب «${d.full_name}» و همه‌ی سفرهایش حذف شود؟`, 'حذف')) await busy(dl, async () => { await fn('admin', { action: 'delete_driver', id: d.id }); toast('حذف شد', 'ok'); await load(); });
      }
    };
  }
  $('[data-add]', root).onclick = () => driverForm(null, load);
  await load();
}

function driverForm(d, done) {
  const m = modal(`<h2>${d ? 'ویرایش راننده' : 'راننده‌ی جدید'}</h2>
    <form class="form">
      <label>نام و نام خانوادگی<input name="full_name" required maxlength="120" value="${esc(d?.full_name ?? '')}"></label>
      ${d ? `<label>نام کاربری<input value="${esc(d.username)}" disabled dir="ltr"></label>` : '<label>نام کاربری (برای ورود)<input name="username" required dir="ltr" placeholder="مثلاً ali یا 0912…" autocomplete="off"></label>'}
      <label>${d ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور'}<input name="password" ${d ? '' : 'required'} minlength="6" dir="ltr" autocomplete="new-password"></label>
      <label>تلفن<input name="phone" dir="ltr" maxlength="20" value="${esc(d?.phone ?? '')}"></label>
      <label>خودرو / پلاک<input name="vehicle" maxlength="60" value="${esc(d?.vehicle ?? '')}"></label>
      <div class="row end"><button class="btn primary" type="submit">${d ? 'ذخیره' : 'ساخت حساب'}</button></div>
    </form>`);
  $('form', m.el).onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    busy($('[type=submit]', m.el), async () => {
      if (d) await fn('admin', { action: 'update_driver', id: d.id, full_name: f.full_name, phone: f.phone, vehicle: f.vehicle, password: f.password || undefined });
      else await fn('admin', { action: 'create_driver', ...f });
      toast(d ? 'ذخیره شد' : `حساب «${f.full_name}» ساخته شد`, 'ok');
      m.close(); done();
    });
  };
}

// ---------------- فروشگاه‌ها ----------------
async function storesPage(root, profile) {
  root.innerHTML = `<section class="stores-page">
    <aside class="side">
      <h3>فروشگاه‌ها و انبارها</h3>
      <div class="search"><input data-search placeholder="جستجو برای افزودن (شهر، خیابان…)"><div class="search-results"></div></div>
      <p class="hint">روی نقشه کلیک کنید تا فروشگاه جدید در آن نقطه ثبت شود.</p>
      <ul class="store-list" id="slist"></ul>
    </aside>
    <div class="live-map"><div class="map" id="stmap"></div></div></section>`;
  const map = createMap($('#stmap', root));
  const layer = L.layerGroup().addTo(map);
  let stores = [];
  onCleanup(() => map.remove());
  async function load(fitView = false) {
    stores = await listStores();
    layer.clearLayers();
    stores.forEach((s) => L.marker([s.lat, s.lng], { icon: storeIcon() }).addTo(layer).bindTooltip(s.name));
    $('#slist', root).innerHTML = stores.map((s) => `<li><button class="link" data-go="${s.id}"><b>${esc(s.name)}</b>${s.city ? ` <small class="muted">${esc(s.city)}</small>` : ''}</button>
      <span class="row"><button class="icon-btn" data-edit="${s.id}" title="ویرایش">✎</button><button class="icon-btn danger" data-del="${s.id}" title="حذف">✕</button></span></li>`).join('') || '<li class="muted">هنوز فروشگاهی ثبت نشده</li>';
    if (fitView) fit(map, stores.map((s) => [s.lat, s.lng]), 13);
  }
  function storeForm(s, done) {
    const m = modal(`<h2>${s.id ? 'ویرایش فروشگاه' : 'فروشگاه جدید'}</h2><form class="form">
      <label>نام<input name="name" required maxlength="200" value="${esc(s.name ?? '')}"></label>
      <label>شهر<input name="city" maxlength="80" value="${esc(s.city ?? '')}"></label>
      <label>آدرس<input name="address" maxlength="300" value="${esc(s.address ?? '')}"></label>
      <label>تلفن<input name="phone" dir="ltr" maxlength="20" value="${esc(s.phone ?? '')}"></label>
      <div class="row end"><button class="btn primary" type="submit">ذخیره</button></div></form>`);
    $('form', m.el).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      busy($('[type=submit]', m.el), async () => {
        if (s.id) must(await sb.from('stores').update(f).eq('id', s.id));
        else must(await sb.from('stores').insert({ ...f, lat: s.lat, lng: s.lng, created_by: profile.id }));
        toast('ذخیره شد', 'ok'); m.close(); done();
      });
    };
  }
  map.on('click', (e) => storeForm({ lat: e.latlng.lat, lng: e.latlng.lng }, () => load()));
  $('#slist', root).onclick = async (e) => {
    const g = e.target.closest('[data-go]'), ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (g) { const s = stores.find((x) => x.id === +g.dataset.go); map.setView([s.lat, s.lng], 15); }
    if (ed) storeForm(stores.find((x) => x.id === +ed.dataset.edit), () => load());
    if (dl) { const s = stores.find((x) => x.id === +dl.dataset.del); if (await confirmBox(`«${s.name}» حذف شود؟`, 'حذف')) { must(await sb.from('stores').delete().eq('id', s.id)); load(); } }
  };
  let timer;
  const input = $('[data-search]', root), results = $('.search-results', root);
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const rs = await searchPlace(q);
        results.innerHTML = rs.map((r, i) => `<button data-r="${i}"><b>${esc(r.name)}</b><small>${esc(r.address)}</small></button>`).join('') || '<div class="muted pad">چیزی پیدا نشد</div>';
        results.onclick = (ev) => {
          const b = ev.target.closest('[data-r]'); if (!b) return;
          const r = rs[+b.dataset.r];
          results.innerHTML = ''; input.value = '';
          map.setView([r.lat, r.lng], 16);
          storeForm({ name: r.name, address: r.address, lat: r.lat, lng: r.lng }, () => load());
        };
      } catch (err) { results.innerHTML = `<div class="muted pad">${esc(err.message)}</div>`; }
    }, 450);
  };
  await load(true);
}
