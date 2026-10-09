/** Shared session state across pages. */
import { api } from './api-client.js';

let currentUser = null;
let lastError = null;

export async function loadUser() {
  try { currentUser = await api.get('/auth/me'); lastError = null; }
  catch (e) { currentUser = null; lastError = e.message; }
  document.dispatchEvent(new CustomEvent('quiter:auth', { detail: { user: currentUser } }));
  return currentUser;
}

export const getCurrentUser = () => currentUser;

/** True when the last session check failed because the network is down (not because you're logged out). */
export const sessionCheckWasOffline = () => lastError === 'network_error';

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* best effort */ }
  currentUser = null;
  window.location.href = 'index.html';
}