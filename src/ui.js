// ابزارهای رابط کاربری
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const faNum = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
export const num = (n) => faNum.format(n);
export const km = (m) => (m == null ? '—' : m < 1000 ? `${num(Math.round(m))} متر` : `${num(Math.round(m / 100) / 10)} کیلومتر`);
export const dur = (s) => {
  if (s == null) return '—';
  const m = Math.round(s / 60);
  if (m < 60) return `${num(m)} دقیقه`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${num(h)} ساعت و ${num(r)} دقیقه` : `${num(h)} ساعت`;
};
const tf = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' });
const df = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tehran' });
const dtf = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' });
export const time = (t) => (t ? tf.format(new Date(t)) : '—');
export const dateFa = (d) => (d ? df.format(new Date(d.length === 10 ? d + 'T12:00:00' : d)) : '—');
export const dateTime = (t) => (t ? dtf.format(new Date(t)) : '—');
export const ago = (t) => {
  if (!t) return 'نامشخص';
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'همین الان';
  if (s < 3600) return `${num(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${num(Math.floor(s / 3600))} ساعت پیش`;
  return dateTime(t);
};
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function toast(msg, type = 'info') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

export function modal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="بستن">×</button>${html}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => e.key === 'Escape' && close();
  wrap.addEventListener('mousedown', (e) => e.target === wrap && close());
  $('.modal-x', wrap).onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { el: $('.modal', wrap), close };
}

export function confirmBox(msg, okText = 'تأیید') {
  return new Promise((res) => {
    const m = modal(`<p class="confirm-msg">${esc(msg)}</p><div class="row end"><button class="btn ghost" data-no>انصراف</button><button class="btn primary" data-ok>${esc(okText)}</button></div>`, { onClose: () => res(false) });
    $('[data-ok]', m.el).onclick = () => { res(true); m.close(); };
    $('[data-no]', m.el).onclick = () => m.close();
  });
}

// اجرای یک کار async با حالت در حال انجام روی دکمه
export async function busy(btn, work) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span> ${old}`;
  try { return await work(); }
  catch (e) { console.error(e); toast(e.message || 'خطا', 'error'); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

export const STATUS_FA = { planned: 'برنامه‌ریزی‌شده', active: 'در حال حرکت', done: 'تمام‌شده', cancelled: 'لغو شده' };
export const STOP_FA = { pending: 'در انتظار', arrived: 'رسیده', delivered: 'تحویل شد', skipped: 'رد شد' };
