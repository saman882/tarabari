// تست سرتاسری روی سرور واقعی (فقط وقتی هنوز سرپرستی ساخته نشده اجرا می‌شود؛ داده‌های تست بعداً پاک می‌شوند)
import assert from 'node:assert/strict';
import { sb, fn, login, myProfile, getTrip, tripPath } from '../src/api.js';
import { saveTrip, replan, markDelivered, markArrived, pendingStops } from '../src/trips.js';

const pw = 'T' + Math.random().toString(36).slice(2) + '9!';
const ok = (m) => console.log('PASS', m);

const st = await fn('admin', { action: 'status' });
if (st.has_supervisor) { console.log('supervisor exists — skipping e2e'); process.exit(0); }

await fn('admin', { action: 'bootstrap', username: 'e2e_sup', password: pw, full_name: 'تست سرپرست' }); ok('bootstrap supervisor');
await assert.rejects(fn('admin', { action: 'bootstrap', username: 'e2e_sup2', password: pw }), /قبلاً/); ok('second bootstrap rejected');
await assert.rejects(fn('admin', { action: 'create_driver', username: 'e2e_x', password: pw }), /وارد شوید/); ok('anon create_driver rejected');
await assert.rejects(fn('geo', { action: 'table', points: [[35.7, 51.4], [34.6, 50.9]] }), /وارد شوید/); ok('anon geo rejected');

await login('e2e_sup', pw);
assert.equal((await myProfile()).role, 'supervisor'); ok('supervisor login');
await fn('admin', { action: 'create_driver', username: 'e2e_d1', password: pw, full_name: 'راننده یک' });
await fn('admin', { action: 'create_driver', username: 'e2e_d2', password: pw, full_name: 'راننده دو' }); ok('drivers created');

const s = await fn('geo', { action: 'search', q: 'قم' }); console.log('search قم →', s.results[0]?.name, s.results.length); assert.ok(s.results.length); ok('search');

await login('e2e_d2', pw);
await assert.rejects(fn('admin', { action: 'create_driver', username: 'e2e_x', password: pw }), /سرپرست/); ok('driver cannot create drivers');
await login('e2e_d1', pw);
const me = await myProfile();
const tehran = [35.6892, 51.389];
const stops = [
  { name: 'قم', lat: 34.6399, lng: 50.8759 },
  { name: 'کاشان', lat: 33.9850, lng: 51.4100 },
  { name: 'اصفهان', lat: 32.6539, lng: 51.6660, priority: 1 },
];
const { trip, approximate } = await saveTrip({ driver_id: me.id, title: 'تست', plan_date: '2026-11-11', origin_name: 'تهران', origin_lat: tehran[0], origin_lng: tehran[1] }, stops, me.id);
assert.equal(approximate, false, 'routing service should be online');
let t = await getTrip(trip.id);
const order = [...t.trip_stops].sort((a, b) => a.load_seq - b.load_seq).map((x) => x.name);
console.log('order with priority:', order.join(' → '), Math.round(t.planned_distance_m / 1000), 'km', Math.round(t.planned_duration_s / 60), 'min');
assert.equal(order[0], 'اصفهان'); ok('priority stop first');

const { trip: t2 } = await saveTrip({ driver_id: me.id, title: 'تست۲', plan_date: '2026-11-11', origin_name: 'تهران', origin_lat: tehran[0], origin_lng: tehran[1] }, stops.map((x) => ({ ...x, priority: null })), me.id);
const o2 = (await getTrip(t2.id)).trip_stops.sort((a, b) => a.load_seq - b.load_seq).map((x) => x.name);
console.log('order without priority:', o2.join(' → ')); assert.equal(o2[0], 'قم'); ok('nearest-first without priority');

const r = await replan(t, [35.0, 51.0], { start: true }); console.log('replan changed?', r.changed);
t = await getTrip(trip.id); assert.equal(t.status, 'active'); assert.ok(t.started_at); assert.ok(pendingStops(t)[0].eta); ok('start trip + ETA');
const { error: gErr } = await sb.from('gps_points').insert([{ trip_id: t.id, driver_id: me.id, lat: 35.5, lng: 51.3 }, { trip_id: t.id, driver_id: me.id, lat: 35.3, lng: 51.2 }]);
assert.ifError(gErr);
const { error: lErr } = await sb.from('driver_locations').upsert({ driver_id: me.id, trip_id: t.id, lat: 35.3, lng: 51.2 }); assert.ifError(lErr); ok('gps insert');
const first = pendingStops(t)[0];
await markArrived(first); t = await getTrip(trip.id);
await markDelivered(t, pendingStops(t)[0]); t = await getTrip(trip.id);
assert.equal(t.trip_stops.filter((x) => x.status === 'delivered').length, 1); ok('deliver flow');

await login('e2e_d2', pw);
const { data: seen } = await sb.from('trips').select('id'); assert.equal(seen.length, 0); 
const { data: gp } = await sb.from('gps_points').select('id'); assert.equal(gp.length, 0);
const { error: fake } = await sb.from('gps_points').insert({ trip_id: t.id, driver_id: me.id, lat: 1, lng: 1 }); assert.ok(fake); ok('driver isolation (RLS)');

await login('e2e_sup', pw);
const all = await getTrip(trip.id); assert.equal(all.driver.full_name, 'راننده یک');
assert.equal((await tripPath(trip.id)).length, 2);
const { data: locs } = await sb.from('driver_locations').select('*'); assert.equal(locs.length, 1); ok('supervisor sees trip, path, live location');
console.log('ALL E2E PASSED');
