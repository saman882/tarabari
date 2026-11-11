import './style.css';
import { sb, fn, login, logout, myProfile } from './api.js';
import { $, esc, toast, busy } from './ui.js';
import { driverApp, stopDriver } from './driver.js';
import { supervisorApp } from './supervisor.js';

const app = $('#app');

async function boot() {
  let profile = null;
  try { profile = await myProfile(); } catch (e) { console.error(e); }
  if (!profile) return loginScreen();
  if (!profile.active) { await logout(); toast('حساب شما غیرفعال است', 'error'); return loginScreen(); }
  shell(profile);
}

function shell(profile) {
  const sup = profile.role === 'supervisor';
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#"><img src="./icon.svg" alt="" width="28" height="28"> رویای بیتا</a>
      ${sup ? `<nav class="tabs"><a href="#live">نقشه‌ی زنده</a><a href="#trips">سفرها</a><a href="#drivers">راننده‌ها</a><a href="#stores">فروشگاه‌ها</a></nav>` : ''}
      <div class="user"><span>${esc(profile.full_name)}<small>${sup ? 'سرپرست' : 'راننده'}</small></span><button class="btn sm ghost" data-logout>خروج</button></div>
    </header>
    <main id="main"></main>`;
  $('[data-logout]').onclick = async () => { stopDriver(); await logout(); location.hash = ''; boot(); };
  const main = $('#main');
  (sup ? supervisorApp : driverApp)(main, profile).catch((e) => { console.error(e); toast(e.message, 'error'); });
}

async function loginScreen() {
  window.onhashchange = null;
  app.innerHTML = `<div class="login"><form class="login-card">
    <img src="./icon.svg" alt="" width="56" height="56">
    <h1>رویای بیتا</h1><p class="muted">مسیریابی چندمقصدی و ردیابی راننده‌ها</p>
    <div id="boot-note"></div>
    <label>نام کاربری<input name="username" required dir="ltr" autocomplete="username" autocapitalize="off"></label>
    <label>رمز عبور<input name="password" type="password" required dir="ltr" autocomplete="current-password"></label>
    <label class="hidden-field" hidden>نام و نام خانوادگی<input name="full_name"></label>
    <button class="btn primary big block" type="submit">ورود</button>
  </form></div>`;
  const form = $('.login-card');
  let bootstrap = false;
  fn('admin', { action: 'status' }).then((s) => {
    if (!s.has_supervisor) {
      bootstrap = true;
      $('#boot-note').innerHTML = '<div class="callout">اولین ورود: حساب <b>سرپرست</b> را بسازید. بعداً از پنل سرپرست برای هر راننده حساب جدا می‌سازید.</div>';
      $('.hidden-field').hidden = false;
      $('[type=submit]', form).textContent = 'ساخت حساب سرپرست';
    }
  }).catch(() => {});
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    busy($('[type=submit]', form), async () => {
      if (bootstrap) await fn('admin', { action: 'bootstrap', ...f });
      await login(f.username, f.password);
      location.hash = '';
      await boot();
    });
  };
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { stopDriver(); } });
boot();
