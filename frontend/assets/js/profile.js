import { api, errorText } from './modules/api-client.js';

const $ = (id) => document.getElementById(id);

export function initProfile(user) {
  $('p-name').value = user.display_name;
  $('p-email').value = user.email;

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