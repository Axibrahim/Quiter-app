/**
 * Thin fetch() wrapper. Every request automatically gets:
 *   - credentials: 'include'  -> sends the HTTP-only session cookie
 *   - X-Quiter-Client header  -> satisfies the backend CSRF check
 *   - clean errors            -> callers get Error(<backend error code>)
 */
import { API_BASE } from '../config.js';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'X-Quiter-Client': 'web',
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('network_error');
  }

  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }

  if (!res.ok) throw new Error(body?.error || `http_${res.status}`);
  return body;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, data = {}) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: (path, data = {}) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
};

/** Human-readable text for the error codes the backend returns. */
export function errorText(code) {
  const map = {
    network_error: "Can't reach Quiter right now. Check your connection and try again.",
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    authentication_required: 'Please log in again.',
    invalid_credentials: 'Email or password is incorrect.',
    account_locked: 'Too many failed attempts. Try again in a few minutes.',
    email_already_registered: 'An account with this email already exists.',
    weak_password: 'Password needs at least 10 characters, with a letter and a number.',
    invalid_email: 'Please enter a valid email address.',
    invalid_display_name: 'Display name must be 2–40 characters.',
    max_plans_reached: 'You already have 3 active plans. Finish or exit one first.',
    already_logged_today: "You've already checked in today.",
    plan_not_active: 'This plan is no longer active.',
    invalid_or_expired_token: 'This link has expired.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}