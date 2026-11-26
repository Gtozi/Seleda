/**
 * Pure hostname / subdomain parser shared between browser (`src/lib/subdomain.ts`)
 * and server (`src/server/middleware/subdomain.ts`) without environment globals.
 */

export const ADMIN_SUBDOMAIN = 'admin';
export const WWW_SUBDOMAIN = 'www';

export function isLocalDevHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().split(':')[0].replace(/\.+$/, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized.endsWith('.localhost');
}

/**
 * Extract the single subdomain label for `<label>.<baseDomain>` hosts, returning
 * `null` for the apex domain, `www.<baseDomain>`, nested multi-label prefixes,
 * or lookalike domains whose full suffix does not match `.${baseDomain}`.
 */
export function parseSubdomainFromHost(
  rawHost: string,
  rawBaseDomain: string,
  querySubdomain?: string | null
): string | null {
  const host = String(rawHost || '').trim().toLowerCase();
  const hostname = host.split(':')[0].replace(/\.+$/, '');
  const baseDomain = String(rawBaseDomain || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
    .replace(/^\.+|\.+$/g, '');

  if (!hostname) return null;

  if (isLocalDevHostname(hostname)) {
    const query = typeof querySubdomain === 'string' ? querySubdomain.trim().toLowerCase() : '';
    if (query) {
      return query === WWW_SUBDOMAIN ? null : query;
    }
    if (hostname.endsWith('.localhost')) {
      const prefix = hostname.slice(0, -'.localhost'.length);
      if (prefix && !prefix.includes('.') && prefix !== WWW_SUBDOMAIN) {
        return prefix;
      }
    }
    return null;
  }

  if (!baseDomain || hostname === baseDomain) {
    return null;
  }

  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const prefix = hostname.slice(0, -suffix.length);
  if (!prefix || prefix.includes('.') || prefix === WWW_SUBDOMAIN) {
    return null;
  }

  return prefix;
}
