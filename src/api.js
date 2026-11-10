import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tarabari-auth' },
});

export const toEn = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const emailOf = (u) => `${toEn(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

// فراخوانی edge function و برگرداندن پیام خطای فارسی
export async function fn(name, body) {
  const { data: s } = await sb.auth.getSession();
  const token = s.session?.access_token ?? SUPABASE_ANON_KEY;
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('اتصال به سرور برقرار نشد. اینترنت را بررسی کنید.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `خطای سرور (${r.status})`);
  return j;
}

export async function login(username, password) {
  const { error } = await sb.auth.signInWithPassword({ email: emailOf(username), password: toEn(password) });
  if (error) throw new Error(error.message.includes('Invalid') ? 'نام کاربری یا رمز عبور اشتباه است' : error.message.includes('banned') ? 'حساب شما غیرفعال شده است' : error.message);
}
export const logout = () => sb.auth.signOut();

export async function myProfile() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', s.session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// --- دسترسی به داده ---
export const listStores = async () => must(await sb.from('stores').select('*').order('name'));
export const listDrivers = async () => must(await sb.from('profiles').select('*').eq('role', 'driver').order('full_name'));
export const getTrip = async (id) => must(await sb.from('trips').select('*, trip_stops(*), driver:profiles!trips_driver_id_fkey(id, full_name, username, phone, vehicle)').eq('id', id).single());
export const tripPath = async (tripId) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await sb.from('gps_points').select('lat,lng,recorded_at,speed').eq('trip_id', tripId).order('recorded_at').range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
};
