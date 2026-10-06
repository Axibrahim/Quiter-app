import { api, errorText } from './modules/api-client.js';

const form = document.getElementById('reset-form');
const errorEl = document.getElementById('reset-error');
const token = new URLSearchParams(location.search).get('token');
history.replaceState(null, '', location.pathname);

if (!token) {
  errorEl.textContent = 'This link is missing its token — use the link from your email.';
  form.querySelector('button').disabled = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await api.post('/auth/password/reset', { token, password: document.getElementById('reset-password').value });
    form.hidden = true; form.style.display = 'none';
    const ok = document.getElementById('reset-success');
    ok.hidden = false; ok.style.display = 'block';
  } catch (ex) {
    errorEl.textContent = ex.message === 'weak_password' ? errorText('weak_password') : 'That link has expired — request a new one from the login form.';
    btn.disabled = false;
  }
});