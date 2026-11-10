import { sb, must, listStores, listDrivers } from './api.js';
import { createMap, L, numberIcon, storeIcon, originIcon, fit } from './mapkit.js';
import { modal, esc, $, toast, busy, todayISO, addDays, num } from './ui.js';
import { searchPlace, reversePlace } from './routing.js';
import { currentPosition } from './gps.js';
import { saveTrip } from './trips.js';

const LAST_ORIGIN = 'tarabari-last-origin';

// ویرایشگر سفر: مبدأ + مقصدها + اولویت ← محاسبه‌ی بهترین مسیر و ذخیره
export async function openTripEditor({ profile, trip = null, driverId = null, onSaved }) {
  const isSup = profile.role === 'supervisor';
  const [stores, drivers] = await Promise.all([listStores(), isSup ? listDrivers() : Promise.resolve([])]);
  let origin = trip
    ? { name: trip.origin_name, lat: trip.origin_lat, lng: trip.origin_lng }
    : (() => { try { return JSON.parse(localStorage.getItem(LAST_ORIGIN)); } catch { return null; } })();
  let stops = trip
    ? [...trip.trip_stops].sort((a, b) => a.load_seq - b.load_seq).map((s) => ({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, priority: s.priority, store_id: s.store_id, note: s.note }))
    : [];
  let mode = 'stop';

  const m = modal(`
    <h2>${trip ? 'ویرایش سفر' : 'سفر جدید'}</h2>
    <div class="editor">
      <div class="editor-form">
        <div class="grid2">
          ${isSup ? `<label>راننده<select name="driver">${drivers.filter((d) => d.active).map((d) => `<option value="${d.id}">${esc(d.full_name)} (${esc(d.username)})</option>`).join('')}</select></label>` : ''}
          <label>تاریخ حرکت<select name="date">
            ${[0, 1, 2, 3].map((n) => { const d = addDays(todayISO(), n); return `<option value="${d}">${['امروز', 'فردا', 'پس‌فردا', '۳ روز بعد'][n]}</option>`; }).join('')}
          </select></label>
          <label class="span2">عنوان سفر<input name="title" placeholder="مثلاً: تهران ← قم، کاشان" maxlength="120"></label>
        </div>

        <div class="section-title">مبدأ (انبار / محل بارگیری)</div>
        <div class="origin-box">
          <div class="origin-name">${'<span class="muted">انتخاب نشده</span>'}</div>
          <div class="row wrap">
            <button class="btn sm" data-origin-gps>موقعیت فعلی من</button>
            <button class="btn sm" data-origin-map>انتخاب روی نقشه</button>
            ${stores.length ? `<select class="sm" data-origin-store><option value="">از فروشگاه‌ها/انبارها…</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}${s.city ? ' — ' + esc(s.city) : ''}</option>`).join('')}</select>` : ''}
          </div>
        </div>

        <div class="section-title">مقصدها</div>
        <div class="add-stop">
          ${stores.length ? `<select data-add-store><option value="">+ افزودن از فروشگاه‌ها…</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}${s.city ? ' — ' + esc(s.city) : ''}</option>`).join('')}</select>` : ''}
          <div class="search">
            <input data-search placeholder="جستجوی شهر یا آدرس…">
            <div class="search-results"></div>
          </div>
          <p class="hint">یا روی نقشه کلیک کنید تا مقصد اضافه شود.</p>
        </div>
        <ol class="stops-edit"></ol>
        <p class="hint">مقصدی که «اولویت ۱» دارد همیشه اول تحویل می‌شود، بعد اولویت ۲ و… و بعد بقیه به ترتیب نزدیک‌ترین مسیر.</p>
      </div>
      <div class="editor-map"><div class="map" id="editor-map"></div><div class="map-mode"></div></div>
    </div>
    <div class="row end sticky-actions">
      <button class="btn ghost" data-cancel>انصراف</button>
      <button class="btn primary" data-save>محاسبه‌ی بهترین مسیر و ذخیره</button>
    </div>`, { wide: true });
  const el = m.el;

  if (isSup) $('[name=driver]', el).value = trip?.driver_id ?? driverId ?? drivers.find((d) => d.active)?.id ?? '';
  if (trip) {
    const sel = $('[name=date]', el);
    if (![...sel.options].some((o) => o.value === trip.plan_date)) sel.insertAdjacentHTML('afterbegin', `<option value="${trip.plan_date}">${trip.plan_date}</option>`);
    sel.value = trip.plan_date;
    $('[name=title]', el).value = trip.title;
  } else if (!isSup) $('[name=date]', el).value = addDays(todayISO(), 1);

  const map = createMap($('#editor-map', el));
  const storeLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  for (const s of stores) {
    L.marker([s.lat, s.lng], { icon: storeIcon() }).addTo(storeLayer)
      .bindPopup(`<b>${esc(s.name)}</b><br><button class="btn sm primary" data-pop-add="${s.id}">افزودن به مقصدها</button>`);
  }
  map.on('popupopen', (e) => {
    const b = e.popup.getElement().querySelector('[data-pop-add]');
    if (b) b.onclick = () => { addStore(+b.dataset.popAdd); map.closePopup(); };
  });

  const setMode = (md) => {
    mode = md;
    $('.map-mode', el).textContent = md === 'origin' ? 'روی نقشه کلیک کنید تا مبدأ انتخاب شود' : '';
    $('.map-mode', el).classList.toggle('on', md === 'origin');
  };

  function render() {
    $('.origin-name', el).innerHTML = origin ? `<b>${esc(origin.name || 'مبدأ')}</b>` : '<span class="muted">انتخاب نشده</span>';
    const ol = $('.stops-edit', el);
    ol.innerHTML = stops.map((s, i) => `
      <li>
        <span class="idx">${num(i + 1)}</span>
        <div class="stop-fields">
          <input data-name="${i}" value="${esc(s.name)}" maxlength="120" aria-label="نام مقصد">
          ${s.address ? `<small class="muted">${esc(s.address).slice(0, 90)}</small>` : ''}
        </div>
        <select data-pri="${i}" class="${s.priority ? 'pri-on' : ''}" aria-label="اولویت">
          <option value="">بدون اولویت</option>
          ${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${s.priority === p ? 'selected' : ''}>اولویت ${num(p)}</option>`).join('')}
        </select>
        ${s.store_id ? '' : `<button class="icon-btn" title="ذخیره در فروشگاه‌ها" data-save-store="${i}">★</button>`}
        <button class="icon-btn danger" title="حذف" data-del="${i}">✕</button>
      </li>`).join('') || '<li class="empty">هنوز مقصدی اضافه نشده</li>';
    stopLayer.clearLayers();
    stops.forEach((s, i) => L.marker([s.lat, s.lng], { icon: numberIcon(num(i + 1), { ring: s.priority ? '#facc15' : '#fff' }) }).addTo(stopLayer).bindTooltip(s.name));
    if (origin) L.marker([origin.lat, origin.lng], { icon: originIcon() }).addTo(stopLayer).bindTooltip('مبدأ: ' + (origin.name || ''));
  }
  const refit = () => fit(map, [origin && [origin.lat, origin.lng], ...stops.map((s) => [s.lat, s.lng])]);

  function addStore(id) {
    const s = stores.find((x) => x.id === id);
    if (!s) return;
    if (stops.some((x) => x.store_id === id)) return toast('این فروشگاه قبلاً اضافه شده');
    stops.push({ name: s.name, address: [s.city, s.address].filter(Boolean).join('، '), lat: s.lat, lng: s.lng, priority: null, store_id: s.id });
    render(); refit();
  }

  const ol = $('.stops-edit', el);
  ol.addEventListener('input', (e) => { const i = e.target.dataset.name; if (i != null) stops[+i].name = e.target.value; });
  ol.addEventListener('change', (e) => {
    const i = e.target.dataset.pri;
    if (i != null) { stops[+i].priority = e.target.value ? +e.target.value : null; render(); }
  });
  ol.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { stops.splice(+d.dataset.del, 1); render(); return; }
    const sv = e.target.closest('[data-save-store]');
    if (sv) {
      const s = stops[+sv.dataset.saveStore];
      await busy(sv, async () => {
        const row = must(await sb.from('stores').insert({ name: s.name || 'فروشگاه', address: s.address, lat: s.lat, lng: s.lng, created_by: profile.id }).select().single());
        s.store_id = row.id; stores.push(row);
        L.marker([row.lat, row.lng], { icon: storeIcon() }).addTo(storeLayer).bindTooltip(row.name);
        toast('در فروشگاه‌ها ذخیره شد', 'ok'); render();
      });
    }
  });

  $('[data-add-store]', el)?.addEventListener('change', (e) => { if (e.target.value) addStore(+e.target.value); e.target.value = ''; });
  $('[data-origin-store]', el)?.addEventListener('change', (e) => {
    const s = stores.find((x) => x.id === +e.target.value);
    if (s) { origin = { name: s.name, lat: s.lat, lng: s.lng }; render(); refit(); }
    e.target.value = '';
  });
  $('[data-origin-gps]', el).onclick = (e) => busy(e.currentTarget, async () => {
    const [lat, lng] = await currentPosition();
    origin = { name: 'موقعیت فعلی', lat, lng }; render(); refit();
    reversePlace(lat, lng).then((r) => { if (r.address && origin?.lat === lat) { origin.name = r.address.split(',').slice(0, 2).join('،'); render(); } }).catch(() => {});
  });
  $('[data-origin-map]', el).onclick = () => setMode('origin');

  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    if (mode === 'origin') {
      origin = { name: 'نقطه‌ی انتخابی', lat, lng }; setMode('stop'); render();
      reversePlace(lat, lng).then((r) => { if (origin?.lat === lat && r.address) { origin.name = r.address.split(',').slice(0, 2).join('،'); render(); } }).catch(() => {});
      return;
    }
    const s = { name: `مقصد ${num(stops.length + 1)}`, address: '', lat, lng, priority: null, store_id: null };
    stops.push(s); render();
    reversePlace(lat, lng).then((r) => { if (r.address) { s.address = r.address; if (/^مقصد/.test(s.name)) s.name = r.address.split(',').slice(0, 2).join('،'); render(); } }).catch(() => {});
  });

  // جستجو
  let timer;
  const input = $('[data-search]', el), results = $('.search-results', el);
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      results.innerHTML = '<div class="muted pad">در حال جستجو…</div>';
      try {
        const rs = await searchPlace(q);
        results.innerHTML = rs.map((r, i) => `<button data-r="${i}"><b>${esc(r.name)}</b><small>${esc(r.address)}</small></button>`).join('') || '<div class="muted pad">چیزی پیدا نشد</div>';
        results.onclick = (ev) => {
          const b = ev.target.closest('[data-r]'); if (!b) return;
          const r = rs[+b.dataset.r];
          if (mode === 'origin') { origin = { name: r.name, lat: r.lat, lng: r.lng }; setMode('stop'); }
          else stops.push({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, priority: null, store_id: null });
          results.innerHTML = ''; input.value = ''; render(); refit();
        };
      } catch (err) { results.innerHTML = `<div class="muted pad">${esc(err.message)}</div>`; }
    }, 450);
  });

  $('[data-cancel]', el).onclick = () => m.close();
  $('[data-save]', el).onclick = (e) => busy(e.currentTarget, async () => {
    if (!origin) throw new Error('مبدأ را انتخاب کنید');
    if (!stops.length) throw new Error('حداقل یک مقصد اضافه کنید');
    if (stops.length > 40) throw new Error('حداکثر ۴۰ مقصد در یک سفر');
    const title = $('[name=title]', el).value.trim() || stops.map((s) => s.name).slice(0, 3).join('، ');
    const data = {
      id: trip?.id, title, plan_date: $('[name=date]', el).value,
      driver_id: isSup ? $('[name=driver]', el).value : profile.id,
      origin_name: origin.name, origin_lat: origin.lat, origin_lng: origin.lng,
    };
    if (!data.driver_id) throw new Error('ابتدا یک راننده بسازید');
    try { localStorage.setItem(LAST_ORIGIN, JSON.stringify(origin)); } catch { /* */ }
    const r = await saveTrip(data, stops, profile.id);
    if (r.approximate) toast('سرویس مسیریابی در دسترس نبود؛ مسیر تقریبی (خط مستقیم) محاسبه شد', 'warn');
    else toast('بهترین مسیر محاسبه و ذخیره شد', 'ok');
    m.close();
    onSaved?.(r.trip);
  });

  render();
  setTimeout(() => { map.invalidateSize(); if (origin || stops.length) refit(); }, 120);
}
