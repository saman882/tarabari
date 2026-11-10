import { sb, must } from './api.js';
import { planRoute } from './routing.js';
import { SERVICE_MINUTES } from './config.js';

const SERVICE_S = SERVICE_MINUTES * 60;
export const sortStops = (stops) => [...stops].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || a.id - b.id);
export const pendingStops = (trip) => sortStops(trip.trip_stops).filter((s) => s.status === 'pending' || s.status === 'arrived');

function etas(startMs, legs) {
  let t = startMs;
  return legs.map((l, i) => { t += (l?.duration ?? 0) * 1000 + (i ? SERVICE_S * 1000 : 0); return new Date(t).toISOString(); });
}

// ساخت یا ویرایش سفر + محاسبه‌ی مسیر چیدمان بار
// data: {id?, driver_id, title, plan_date, origin_name, origin_lat, origin_lng}
// stops: [{name, address, lat, lng, priority, store_id}]
export async function saveTrip(data, stops, userId) {
  if (!stops.length) throw new Error('حداقل یک مقصد اضافه کنید');
  const plan = await planRoute([data.origin_lat, data.origin_lng], stops);
  const fields = {
    driver_id: data.driver_id, title: data.title, plan_date: data.plan_date,
    origin_name: data.origin_name, origin_lat: data.origin_lat, origin_lng: data.origin_lng,
    load_geometry: plan.geometry, load_distance_m: plan.distance, load_duration_s: plan.duration,
    planned_geometry: plan.geometry, planned_distance_m: plan.distance, planned_duration_s: plan.duration,
    status: 'planned', replanned_at: null, started_at: null, finished_at: null,
  };
  let trip;
  if (data.id) {
    trip = must(await sb.from('trips').update(fields).eq('id', data.id).select().single());
    must(await sb.from('trip_stops').delete().eq('trip_id', data.id));
  } else {
    trip = must(await sb.from('trips').insert({ ...fields, created_by: userId }).select().single());
  }
  const rows = plan.order.map((idx, i) => {
    const s = stops[idx];
    return {
      trip_id: trip.id, store_id: s.store_id ?? null, name: s.name, address: s.address ?? null,
      lat: s.lat, lng: s.lng, priority: s.priority || null, note: s.note ?? null,
      load_seq: i + 1, seq: i + 1,
      leg_distance_m: plan.legs[i]?.distance ?? null, leg_duration_s: plan.legs[i]?.duration ?? null,
    };
  });
  const inserted = must(await sb.from('trip_stops').insert(rows).select());
  const byLoad = [...inserted].sort((a, b) => a.load_seq - b.load_seq);
  must(await sb.from('trips').update({ load_order: byLoad.map((s) => s.id) }).eq('id', trip.id));
  return { trip, approximate: plan.approximate };
}

// محاسبه‌ی دوباره‌ی مسیر از موقعیت فعلی برای مقصدهای باقی‌مانده (با همان اولویت‌ها)
export async function replan(trip, pos, { start = false } = {}) {
  const rest = pendingStops(trip);
  const done = sortStops(trip.trip_stops).filter((s) => !rest.includes(s));
  const plan = await planRoute(pos, rest);
  const ordered = plan.order.map((i) => rest[i]);
  const eta = etas(Date.now(), plan.legs);
  const base = done.length;
  await Promise.all(ordered.map((s, i) => sb.from('trip_stops').update({
    seq: base + i + 1, eta: eta[i],
    leg_distance_m: plan.legs[i]?.distance ?? null, leg_duration_s: plan.legs[i]?.duration ?? null,
  }).eq('id', s.id).then(must)));
  const patch = {
    planned_geometry: plan.geometry, planned_distance_m: plan.distance, planned_duration_s: plan.duration,
    replanned_at: new Date().toISOString(),
  };
  if (start) Object.assign(patch, { status: 'active', started_at: new Date().toISOString() });
  must(await sb.from('trips').update(patch).eq('id', trip.id));
  // مقایسه با ترتیب چیدمان
  const loadOrder = [...rest].sort((a, b) => (a.load_seq ?? 0) - (b.load_seq ?? 0)).map((s) => s.id);
  const changed = ordered.some((s, i) => s.id !== loadOrder[i]);
  return { changed, ordered, approximate: plan.approximate };
}

export async function markArrived(stop) {
  must(await sb.from('trip_stops').update({ status: 'arrived', arrived_at: stop.arrived_at ?? new Date().toISOString() }).eq('id', stop.id));
}

export async function markDelivered(trip, stop) {
  const now = new Date().toISOString();
  must(await sb.from('trip_stops').update({ status: 'delivered', delivered_at: now, arrived_at: stop.arrived_at ?? now }).eq('id', stop.id));
  // به‌روزرسانی زمان رسیدن تخمینی بقیه
  const rest = pendingStops(trip).filter((s) => s.id !== stop.id);
  if (!rest.length) {
    must(await sb.from('trips').update({ status: 'done', finished_at: now }).eq('id', trip.id));
    return { finished: true };
  }
  const e = etas(Date.now(), rest.map((s) => ({ duration: s.leg_duration_s })));
  await Promise.all(rest.map((s, i) => sb.from('trip_stops').update({ eta: e[i] }).eq('id', s.id)));
  return { finished: false };
}

export async function skipStop(trip, stop) {
  must(await sb.from('trip_stops').update({ status: 'skipped' }).eq('id', stop.id));
  if (!pendingStops(trip).filter((s) => s.id !== stop.id).length)
    must(await sb.from('trips').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', trip.id));
}
