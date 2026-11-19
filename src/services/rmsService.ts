/**
 * RMS portal API client.
 *
 * Single entry point for every /api/rms-portal/* call so components don't
 * hand-roll auth headers, propertyId plumbing, or error extraction.
 *
 * - Auth: Bearer token from localStorage (custom session model — there is
 *   no session cookie, so every request MUST send this header).
 * - propertyId: appended as ?propertyId= for GET/DELETE, merged into the
 *   JSON body for POST/PUT/PATCH. The backend's enforcePropertyScope pins
 *   non-full-access users to their own property regardless; this just keeps
 *   full-access users' context explicit.
 * - Errors: surfaces the server's `{ error }` message when present.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function rmsAuthHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? JSON_HEADERS : {}),
  };
}

export interface RmsRequestOptions {
  method?: string;
  body?: unknown;
  propertyId?: string | null;
  /** Extra query params (appended to the URL; skipped when null/empty). */
  query?: Record<string, string | number | boolean | null | undefined>;
}

export async function rmsRequest<T = any>(path: string, opts: RmsRequestOptions = {}): Promise<T> {
  const method = opts.method || 'GET';
  const isRead = method === 'GET' || method === 'DELETE';

  const params = new URLSearchParams();
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== null && v !== undefined && v !== '') params.set(k, String(v));
    }
  }
  if (isRead && opts.propertyId) params.set('propertyId', opts.propertyId);
  const qs = params.toString();
  const url = qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;

  // propertyId rides in the query for GET/DELETE (propQuery) AND the JSON body
  // for mutations (propBody); DELETE sends both since handlers read either.
  const mergeProp = !isRead || method === 'DELETE';
  const body =
    opts.body === undefined && !(mergeProp && opts.propertyId)
      ? undefined
      : JSON.stringify(
          mergeProp && opts.propertyId
            ? { ...(opts.body as object), propertyId: opts.propertyId }
            : opts.body,
        );

  const res = await fetch(url, { method, headers: rmsAuthHeaders(body !== undefined), body });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error || `${method} ${path} failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const rmsGet = <T = any>(path: string, opts: Omit<RmsRequestOptions, 'method' | 'body'> = {}) =>
  rmsRequest<T>(path, { ...opts, method: 'GET' });

export const rmsPost = <T = any>(path: string, body?: unknown, opts: Omit<RmsRequestOptions, 'method' | 'body'> = {}) =>
  rmsRequest<T>(path, { ...opts, method: 'POST', body });

export const rmsPut = <T = any>(path: string, body?: unknown, opts: Omit<RmsRequestOptions, 'method' | 'body'> = {}) =>
  rmsRequest<T>(path, { ...opts, method: 'PUT', body });

export const rmsPatch = <T = any>(path: string, body?: unknown, opts: Omit<RmsRequestOptions, 'method' | 'body'> = {}) =>
  rmsRequest<T>(path, { ...opts, method: 'PATCH', body });

export const rmsDelete = <T = any>(path: string, opts: Omit<RmsRequestOptions, 'method' | 'body'> = {}) =>
  rmsRequest<T>(path, { ...opts, method: 'DELETE' });
