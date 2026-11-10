// پراکسی مسیریابی (OSRM) و جستجوی آدرس (Nominatim) — برای اینکه اپ در ایران هم به سرویس‌ها برسد
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const OSRM = Deno.env.get("OSRM_URL") ?? "https://router.project-osrm.org";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const UA = "tarabari-app/1.0 (github.com/saman882/tarabari)";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

type P = [number, number]; // [lat, lng]
function points(v: unknown, min: number, max: number): P[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new HttpError(400, "تعداد نقاط نامعتبر است");
  return v.map((p) => {
    const lat = Number((p as number[])[0]), lng = Number((p as number[])[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw new HttpError(400, "مختصات نامعتبر است");
    return [lat, lng] as P;
  });
}
const coordStr = (ps: P[]) => ps.map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)}`).join(";");

async function getJson(url: string, timeoutMs = 20000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fa,en" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new HttpError(502, `سرویس نقشه پاسخ نداد (${r.status})`);
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u.user) throw new HttpError(401, "ابتدا وارد شوید");

    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (b.action) {
      case "table": {
        const ps = points(b.points, 2, 60);
        const d = await getJson(`${OSRM}/table/v1/driving/${coordStr(ps)}?annotations=distance,duration`);
        if (d.code !== "Ok") throw new HttpError(502, "محاسبه‌ی فاصله‌ها ناموفق بود");
        return json(200, { distances: d.distances, durations: d.durations });
      }
      case "route": {
        const ps = points(b.points, 2, 60);
        const d = await getJson(`${OSRM}/route/v1/driving/${coordStr(ps)}?overview=full&geometries=geojson&steps=false`);
        if (d.code !== "Ok" || !d.routes?.length) throw new HttpError(502, "مسیر پیدا نشد");
        const r = d.routes[0];
        return json(200, {
          distance: r.distance, duration: r.duration,
          geometry: r.geometry.coordinates.map(([ln, la]: number[]) => [+la.toFixed(5), +ln.toFixed(5)]),
          legs: r.legs.map((l: { distance: number; duration: number }) => ({ distance: l.distance, duration: l.duration })),
        });
      }
      case "search": {
        const q = String(b.q ?? "").trim().slice(0, 200);
        if (q.length < 2) return json(200, { results: [] });
        const d = await getJson(`${NOMINATIM}/search?format=jsonv2&limit=8&countrycodes=ir&q=${encodeURIComponent(q)}`, 10000);
        return json(200, {
          results: d.map((x: { display_name: string; lat: string; lon: string; name?: string }) => ({
            name: x.name || x.display_name.split(",")[0], address: x.display_name, lat: +x.lat, lng: +x.lon,
          })),
        });
      }
      case "reverse": {
        const [p] = points([[b.lat, b.lng]], 1, 1);
        const d = await getJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=17&lat=${p[0]}&lon=${p[1]}`, 10000);
        return json(200, { address: d.display_name ?? "", city: d.address?.city ?? d.address?.town ?? d.address?.county ?? "" });
      }
      default:
        throw new HttpError(400, "درخواست نامعتبر");
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(502, { error: "ارتباط با سرویس نقشه برقرار نشد" });
  }
});
