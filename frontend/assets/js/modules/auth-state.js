/** Shared session state across pages. */
import { api } from './api-client.js';

let currentUser = null;

export async function loadUser() {
  try { currentUser = await api.get('/auth/me'); } catch { currentUser = null; }
  document.dispatchEvent(new CustomEvent('quiter:auth', { detail: { user: currentUser } }));
  return currentUser;
}

export const getCurrentUser = () => currentUser;

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* best effort */ }
  currentUser = null;
  window.location.href = 'index.html';
}