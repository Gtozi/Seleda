/**
 * Shared fetch helper for Concierge portal API calls.
 * Attaches the auth token so requests pass the `authenticate` middleware
 * on /api/concierge/*.
 */

export function conciergeAuthHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export function conciergeFetch(url: string, options: RequestInit & { json?: boolean } = {}) {
  const { json, headers, ...rest } = options;
  return fetch(url, {
    ...rest,
    headers: { ...conciergeAuthHeaders(json), ...(headers || {}) },
  });
}
