/**
 * Thin fetch() wrapper. Centralizing this means every request automatically
 * gets:
 *   - credentials: 'include'   -> sends the HTTP-only session cookie
 *   - X-Quiter-Client header   -> satisfies the backend's CSRF check
 *     (see backend/app/security/session_auth.py)
 *   - uniform error handling   -> callers always get a clean Error with
 *     the backend's error code as the message, never a raw Response object
 */
const API_BASE ='http://127.0.0.1:5000/api/v1';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Quiter-Client': 'web',
      ...(options.headers || {}),
    },
    ...options,
  });

  let body = null;
  try { body = await res.json(); } catch { /* empty body, e.g. 204 */ }

  if (!res.ok) {
    const code = body?.error || `http_${res.status}`;
    throw new Error(code);
  }
  return body;
}

export const api = {
baseUrl: BASE_URL,  get: (path) => request(path, { method: 'GET' }),
  post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
