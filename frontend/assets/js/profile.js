import { api, errorText } from './modules/api-client.js';
import { logout } from './modules/auth-state.js';

const $ = (id) => document.getElementById(id);

export function initProfile(user) {
  $('p-name').value = user.display_name;
  $('p-email').value = user.email;

  // Optional "about you" (max 200 chars) — read by the coach and AI tips.
  const about = $('p-about');
  const countAbout = () => { $('p-about-count').textContent = `${about.value.length} / 200`; };
  about.value = user.about_me || '';
  countAbout();
  about.addEventListener('input', countAbout);
  $('about-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('a-error').textContent = ''; $('a-success').textContent = '';
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const saved = await api.patch('/auth/about', { about_me: about.value.trim() });
      user.about_me = saved.about_me;
      $('a-success').textContent = 'Saved.';
    } catch (ex) {
      $('a-error').textContent = errorText(ex.message);
    } finally { btn.disabled = false; }
  });

  $('logout-btn').addEventListener('click', logout);

  if (!user.is_verified) {
    $('verify-banner').hidden = false;
    $('resend-verify-btn').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Sending…';
      try { await api.post('/auth/verify/resend', {}); e.target.textContent = 'Sent!'; }
      catch { e.target.textContent = 'Try again'; e.target.disabled = false; }
    });
  }

  $('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('p-error').textContent = ''; $('p-success').textContent = '';
    const email = $('p-email').value.trim();
    const password = $('p-new').value;
    const payload = { current_password: $('p-current').value };
    if (email && email !== user.email) payload.email = email;
    if (password) payload.password = password;
    if (!payload.current_password) { $('p-error').textContent = 'Enter your current password to save.'; return; }
    if (!payload.email && !payload.password) { $('p-error').textContent = 'Nothing to change — edit your email or set a new password.'; return; }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api.patch('/auth/profile', payload);
      $('p-success').textContent = payload.email ? 'Saved. Check your inbox — your new email needs verifying.' : 'Saved.';
      $('p-new').value = ''; $('p-current').value = '';
    } catch (ex) {
      $('p-error').textContent = ex.message === 'invalid_credentials' ? 'Current password is incorrect.' : errorText(ex.message);
    } finally { btn.disabled = false; }
  });
}