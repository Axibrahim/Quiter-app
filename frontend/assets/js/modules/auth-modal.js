/**
 * Login / sign-up / forgot-password modal. Injected by the shell, so no page
 * needs its own copy of the markup.
 */
import { api, errorText } from './api-client.js';

let overlay, mode = 'login', nextUrl = null;

const TEMPLATE = `
<div class="modal-overlay" id="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title">
  <div class="modal liquid-glass liquid-glass--panel">
    <button class="icon-btn modal__close" type="button" data-auth-close aria-label="Close">✕</button>
    <div class="modal__tabs" id="auth-tabs">
      <button type="button" class="modal__tab" data-mode="login">Log in</button>
      <button type="button" class="modal__tab" data-mode="signup">Sign up</button>
    </div>
    <h2 class="h3" id="auth-title"></h2>
    <p id="auth-sub" style="margin:.4rem 0 1.4rem"></p>
    <form id="auth-form" novalidate>
      <div class="field" id="f-name"><label for="a-name">Name</label><input id="a-name" type="text" autocomplete="name" maxlength="40" placeholder="What should we call you?"></div>
      <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" placeholder="you@email.com" required></div>
      <div class="field" id="f-pass"><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="current-password" placeholder="••••••••••" required></div>
      <div class="modal__row" id="a-row">
        <label class="q-check q-check--sm"><input type="checkbox" id="a-remember" checked><span class="q-check__box"></span><span class="q-check__label">Remember me</span></label>
        <a href="#" class="modal__link" id="a-forgot">Forgot password?</a>
      </div>
      <p class="error" id="a-error" role="alert"></p>
      <p class="success" id="a-ok" role="status"></p>
      <button class="btn btn--solid modal__submit" type="submit" id="a-submit"></button>
    </form>
  </div>
</div>`;

const COPY = {
  login:  { title: 'Welcome back', sub: 'Pick up where your coach left off.', btn: 'Log in' },
  signup: { title: 'Meet your coach', sub: 'Create your account — it takes 20 seconds.', btn: 'Create account' },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a reset link.", btn: 'Send reset link' },
};

function setMode(m) {
  mode = m;
  const c = COPY[m];
  overlay.querySelector('#auth-title').textContent = c.title;
  overlay.querySelector('#auth-sub').textContent = c.sub;
  overlay.querySelector('#a-submit').textContent = c.btn;
  overlay.querySelector('#f-name').hidden = m !== 'signup';
  overlay.querySelector('#f-pass').hidden = m === 'forgot';
  overlay.querySelector('#a-row').hidden = m !== 'login';   // Remember me + Forgot password: sign-in only
  overlay.querySelector('#auth-tabs').hidden = m === 'forgot';
  overlay.querySelector('#a-pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  overlay.querySelectorAll('.modal__tab').forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
  overlay.querySelector('#a-error').textContent = '';
  overlay.querySelector('#a-ok').textContent = '';
}

export function openAuthModal(m = 'login', next = null) {
  nextUrl = next;
  setMode(m);
  overlay.classList.add('is-open');
  setTimeout(() => overlay.querySelector(m === 'signup' ? '#a-name' : '#a-email').focus(), 50);
}
export function closeAuthModal() { overlay.classList.remove('is-open'); }

async function submit(e) {
  e.preventDefault();
  const err = overlay.querySelector('#a-error');
  const ok = overlay.querySelector('#a-ok');
  const btn = overlay.querySelector('#a-submit');
  err.textContent = ''; ok.textContent = '';

  const email = overlay.querySelector('#a-email').value.trim();
  const password = overlay.querySelector('#a-pass').value;
  const name = overlay.querySelector('#a-name').value.trim();
  if (!email) { err.textContent = 'Please enter your email.'; return; }
  if (mode !== 'forgot' && !password) { err.textContent = 'Please enter your password.'; return; }
  if (mode === 'signup' && name.length < 2) { err.textContent = 'Please enter your name.'; return; }

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'One moment…';
  try {
    if (mode === 'forgot') {
      await api.post('/auth/password/forgot', { email });
      ok.textContent = 'If that email has an account, a reset link is on its way.';
    } else if (mode === 'signup') {
      await api.post('/auth/register', { email, password, display_name: name });
      window.location.href = nextUrl || 'plans.html';
    } else {
      await api.post('/auth/login', { email, password, remember_me: overlay.querySelector('#a-remember').checked });
      window.location.href = nextUrl || 'dashboard.html';
    }
  } catch (ex) {
    err.textContent = errorText(ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

export function initAuthModal() {
  if (overlay) return;
  document.body.insertAdjacentHTML('beforeend', TEMPLATE);
  overlay = document.getElementById('auth-overlay');

  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-auth-close]')) closeAuthModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAuthModal(); });
  overlay.querySelectorAll('.modal__tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  overlay.querySelector('#a-forgot').addEventListener('click', (e) => { e.preventDefault(); setMode('forgot'); });
  overlay.querySelector('#auth-form').addEventListener('submit', submit);

  // Deep links: ?login=1  ?auth=login|signup  (&next=page.html — same-site pages only)
  const q = new URLSearchParams(window.location.search);
  const next = q.get('next');
  const safeNext = next && /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next) ? next : null;
  if (q.get('login') === '1' || q.get('auth') === 'login') openAuthModal('login', safeNext);
  else if (q.get('auth') === 'signup') openAuthModal('signup', safeNext);
}