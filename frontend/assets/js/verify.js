import { api } from './modules/api-client.js';

const $ = (id) => document.getElementById(id);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function done(ok, title, body) {
  $('v-icon').className = 'result__icon' + (ok ? '' : ' result__icon--error');
  $('v-icon').innerHTML = ok ? CHECK : CROSS;
  $('verify-title').textContent = title;
  $('verify-body').textContent = body;
  $('verify-home').hidden = false;
}

(async () => {
  const token = new URLSearchParams(location.search).get('token');
  history.replaceState(null, '', location.pathname);
  if (!token) { done(false, 'Missing verification link', 'Use the link from your email.'); return; }
  try {
    await api.post('/auth/verify/confirm', { token });
    done(true, "You're verified", 'Your email is confirmed. Welcome to Quiter.');
  } catch {
    done(false, 'That link has expired', 'Verification links last 48 hours. Request a new one from your profile page.');
  }
})();