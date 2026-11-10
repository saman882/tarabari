// مدیریت حساب‌ها: ساخت سرپرست اول، ساخت/ویرایش/حذف راننده (فقط سرپرست)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const DOMAIN = "tarabari.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const toEn = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

function username(v: unknown) {
  const u = toEn(String(v ?? "")).trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,32}$/.test(u)) throw new HttpError(400, "نام کاربری باید ۳ تا ۳۲ حرف انگلیسی یا عدد باشد");
  return u;
}
function password(v: unknown) {
  const p = toEn(String(v ?? ""));
  if (p.length < 6) throw new HttpError(400, "رمز عبور باید حداقل ۶ کاراکتر باشد");
  return p;
}
const text = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

async function createAccount(b: Record<string, unknown>, role: "supervisor" | "driver") {
  const u = username(b.username);
  const full_name = text(b.full_name) || u;
  const { data: exists } = await admin.from("profiles").select("id").eq("username", u).maybeSingle();
  if (exists) throw new HttpError(409, "این نام کاربری قبلاً ثبت شده");
  const { data, error } = await admin.auth.admin.createUser({
    email: `${u}@${DOMAIN}`, password: password(b.password), email_confirm: true,
    user_metadata: { username: u, full_name, role },
  });
  if (error || !data.user) throw new HttpError(400, error?.message ?? "ساخت حساب ناموفق بود");
  const { error: e2 } = await admin.from("profiles").insert({
    id: data.user.id, username: u, full_name, role,
    phone: text(b.phone, 20) || null, vehicle: text(b.vehicle, 60) || null,
  });
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw new HttpError(400, e2.message); }
  return { id: data.user.id, username: u };
}

async function requireSupervisor(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = await admin.auth.getUser(token);
  if (!data.user) throw new HttpError(401, "ابتدا وارد شوید");
  const { data: p } = await admin.from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  if (!p || p.role !== "supervisor" || !p.active) throw new HttpError(403, "فقط سرپرست دسترسی دارد");
  return data.user.id;
}

async function driverOf(id: unknown) {
  const { data } = await admin.from("profiles").select("id, role").eq("id", String(id ?? "")).maybeSingle();
  if (!data || data.role !== "driver") throw new HttpError(404, "راننده پیدا نشد");
  return data.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (b.action) {
      case "status": {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "supervisor");
        return json(200, { has_supervisor: (count ?? 0) > 0 });
      }
      case "bootstrap": {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "supervisor");
        if ((count ?? 0) > 0) throw new HttpError(403, "حساب سرپرست قبلاً ساخته شده");
        return json(200, await createAccount(b, "supervisor"));
      }
      case "create_driver": {
        await requireSupervisor(req);
        return json(200, await createAccount(b, "driver"));
      }
      case "update_driver": {
        await requireSupervisor(req);
        const id = await driverOf(b.id);
        const patch: Record<string, unknown> = {};
        if (b.full_name !== undefined) patch.full_name = text(b.full_name) || "راننده";
        if (b.phone !== undefined) patch.phone = text(b.phone, 20) || null;
        if (b.vehicle !== undefined) patch.vehicle = text(b.vehicle, 60) || null;
        if (b.active !== undefined) patch.active = !!b.active;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("profiles").update(patch).eq("id", id);
          if (error) throw new HttpError(400, error.message);
        }
        if (b.password) {
          const { error } = await admin.auth.admin.updateUserById(id, { password: password(b.password) });
          if (error) throw new HttpError(400, error.message);
        }
        if (b.active === false) await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
        if (b.active === true) await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
        return json(200, { ok: true });
      }
      case "delete_driver": {
        await requireSupervisor(req);
        const id = await driverOf(b.id);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new HttpError(400, error.message);
        return json(200, { ok: true });
      }
      default:
        throw new HttpError(400, "درخواست نامعتبر");
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: "خطای سرور" });
  }
});
