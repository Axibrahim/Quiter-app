/**
 * Shared session/auth state across pages.
 */
import { api } from './api-client.js';

let currentUser = null;

export async function initAuthState() {
  try {
    currentUser = await api.get('/auth/me');
  } catch {
    currentUser = null;
  }
  applyNavState();
  document.dispatchEvent(new CustomEvent('quiter:auth', { detail: { user: currentUser } }));
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export async function logout() {
  try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
  currentUser = null;
  window.location.href = 'index.html';
}

function applyNavState() {
  const slot = document.getElementById('nav-auth-slot');
  const navLinks = document.querySelector('.nav__links');
  if (!slot) return;

  if (currentUser) {
    // Keep only the User Profile pill (plus Admin, if applicable) in the right slot

    slot.innerHTML = `
      ${currentUser.is_admin ? '<a href="admin.html" class="liquid-glass btn btn--glass">Admin</a>' : ''}
      <a href="profile.html" class="liquid-glass btn btn--glass user-pill">${escapeHtml(currentUser.display_name)}</a>
      `;
  } else {
    // Remove Dashboard link if logged out
    document.getElementById('nav-dashboard-link')?.remove();

    slot.innerHTML = `
      <button class="btn btn--text" id="signup-trigger" type="button">Sign Up</button>
      <button class="liquid-glass btn btn--glass" id="login-trigger" type="button">Login</button>
    `;
    document.dispatchEvent(new CustomEvent('quiter:nav-rendered'));
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function requireAuth() {
  const user = await initAuthState();
  if (!user) {
    window.location.href = 'index.html?login=1';
    return null;
  }
  return user;
}