/**
 * Tenant Subdomain Resolution Middleware
 *
 * Maps `<code>.seledabet.com` → the matching `tenants` row and attaches it to
 * `req.tenant` so downstream handlers can scope settings, branding, and module
 * toggles per tenant. Because tenant subdomains are wildcard-routed, the tenant
 * "subdomain" is created automatically the moment a tenant row exists — its
 * `code` is the subdomain label.
 */

import { Request, Response, NextFunction } from 'express';
import { getTenantCodeFromSubdomain } from './subdomain';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

export interface RequestTenant {
  id: string;
  name: string;
  code: string;
  status: string;
  settings: Record<string, any>;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: RequestTenant | null;
    }
  }
}

// Subdomain labels that can never be tenant codes.
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'admin', 'supabase', 'api', 'app', 'mail', 'smtp', 'imap', 'pop',
  'ftp', 'ssh', 'vpn', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'docs',
  'status', 'support', 'help', 'blog', 'dev', 'staging', 'test', 'demo',
]);

// DNS label rules: 1–63 chars, lowercase alnum + hyphens, no leading/trailing
// hyphen. Enforced on tenant create/update so `<code>.seledabet.com` always
// resolves cleanly.
export const TENANT_CODE_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidTenantCode(code: string): boolean {
  return TENANT_CODE_PATTERN.test(code) && !RESERVED_SUBDOMAINS.has(code);
}

// Short-lived cache — tenant rows change rarely and this runs per request.
const CACHE_TTL_MS = 60_000;
const tenantCache = new Map<string, { tenant: RequestTenant | null; fetchedAt: number }>();

export function invalidateTenantCache(code?: string): void {
  if (code) tenantCache.delete(code);
  else tenantCache.clear();
}

async function lookupTenantByCode(code: string): Promise<RequestTenant | null> {
  const cached = tenantCache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.tenant;
  }

  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, code, status, settings')
    .eq('code', code)
    .maybeSingle();

  const tenant = (!error && data)
    ? { id: data.id, name: data.name, code: data.code, status: data.status, settings: data.settings || {} }
    : null;

  tenantCache.set(code, { tenant, fetchedAt: Date.now() });
  return tenant;
}

/**
 * Resolve the tenant from the request subdomain. Runs for every API request;
 * it is a no-op (one Map lookup) on the main domain and admin subdomain.
 * Unknown tenant codes get a 404 so typos/inactive tenants fail loudly.
 */
export async function resolveTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantCode = getTenantCodeFromSubdomain(req);
    if (!tenantCode) {
      req.tenant = null;
      return next();
    }

    const tenant = await lookupTenantByCode(tenantCode);
    if (!tenant || tenant.status !== 'Active') {
      return res.status(404).json({ error: 'Unknown or inactive tenant' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    console.error('[tenant] subdomain resolution failed:', error);
    next();
  }
}
