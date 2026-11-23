/**
 * Tenant Scoping Helpers
 *
 * The backend talks to Supabase with the service-role key, which bypasses
 * Postgres RLS — so tenant isolation is enforced at the application layer.
 * These helpers resolve the request's tenant context and expose the filters
 * route handlers need:
 *
 *  - `getRequestTenantId(req)`     → tenants.id for tenant-scoped tables
 *  - `getTenantPropertyIds(req)`   → property ids owned by the tenant
 *  - `scopeTenant(query, tid)`     → sync .eq('tenant_id', …) when scoped
 *  - `scopeProperty(query, ids)`   → sync .in('property_id', …) when scoped
 *
 * On the main domain / admin subdomain (no tenant context) the ids are null
 * and the scope helpers return the query unchanged — preserving existing
 * platform-wide behaviour. On `<tenant>.seledabet.com` every query on
 * tenant/property-scoped tables must go through these helpers.
 */

import type { Request } from 'express';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';

/** tenants.id for this request, or null on non-tenant hosts. */
export function getRequestTenantId(req: Request): string | null {
  return req.tenant?.id || req.user?.activeTenantId || null;
}

/**
 * Property ids belonging to the request's tenant.
 * Returns null when there is no tenant context; [] when the tenant owns no
 * properties (callers must then match nothing, never everything).
 * Cached per-request.
 */
export async function getTenantPropertyIds(req: Request): Promise<string[] | null> {
  const tenantId = getRequestTenantId(req);
  if (!tenantId) return null;

  const cache = (req as any).__tenantPropertyIds as Promise<string[]> | undefined;
  if (cache) return cache;

  const promise = (async () => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('tenant_id', tenantId);
    if (error) {
      console.error('[tenantScope] failed to load tenant properties:', error.message);
      return [];
    }
    return (data || []).map((p: any) => p.id);
  })();

  (req as any).__tenantPropertyIds = promise;
  return promise;
}

/**
 * room_types ids visible to the request's tenant (via property ownership).
 * null = no tenant context; [] = tenant sees no room types.
 */
export async function getTenantRoomTypeIds(req: Request): Promise<string[] | null> {
  const propIds = await getTenantPropertyIds(req);
  if (propIds === null) return null;
  if (propIds.length === 0) return [];

  const cache = (req as any).__tenantRoomTypeIds as Promise<string[]> | undefined;
  if (cache) return cache;

  const promise = (async () => {
    if (!hasSupabaseAdminConfig || !supabaseAdmin) return [];
    const { data, error } = await supabaseAdmin
      .from('room_types')
      .select('id')
      .in('property_id', propIds);
    if (error) {
      console.error('[tenantScope] failed to load tenant room types:', error.message);
      return [];
    }
    return (data || []).map((r: any) => r.id);
  })();

  (req as any).__tenantRoomTypeIds = promise;
  return promise;
}

interface Filterable {
  eq(column: string, value: unknown): any;
  in(column: string, values: readonly unknown[]): any;
  or(filters: string): any;
}

/** Sync tenant_id filter — no-op without tenant context. */
export function scopeTenant<Q extends Filterable>(query: Q, tenantId: string | null): Q {
  return tenantId ? (query.eq('tenant_id', tenantId) as Q) : query;
}

/**
 * Sync property_id filter.
 *  - propIds === null  → no tenant context → unchanged
 *  - propIds === []    → tenant owns nothing → matches nothing
 *  - allowNull         → also keeps rows where property_id IS NULL (global rows)
 */
export function scopeProperty<Q extends Filterable>(
  query: Q,
  propIds: string[] | null,
  opts: { allowNull?: boolean } = {},
): Q {
  if (propIds === null) return query;
  if (propIds.length === 0) return query.in('property_id', [EMPTY_ID]) as Q;
  if (opts.allowNull) {
    return query.or(`property_id.is.null,property_id.in.(${propIds.join(',')})`) as Q;
  }
  return query.in('property_id', propIds) as Q;
}

/**
 * Async convenience wrapper for handlers that don't batch queries:
 * resolves tenant + property ids then applies the chosen column scope.
 */
export async function applyTenantScope<Q extends Filterable>(
  query: Q,
  req: Request,
  opts: { column?: 'tenant_id' | 'property_id'; allowNullProperty?: boolean } = {},
): Promise<Q> {
  const tenantId = getRequestTenantId(req);
  if (!tenantId) return query;
  if ((opts.column || 'tenant_id') === 'tenant_id') {
    return scopeTenant(query, tenantId);
  }
  return scopeProperty(query, await getTenantPropertyIds(req), { allowNull: opts.allowNullProperty });
}

/**
 * Guard for write endpoints: true when the referenced property_id belongs to
 * the request's tenant (or there is no tenant context).
 */
export async function tenantOwnsProperty(req: Request, propertyId: string | null | undefined): Promise<boolean> {
  if (!propertyId) return true;
  const propIds = await getTenantPropertyIds(req);
  if (!propIds) return true; // no tenant context → platform-wide
  return propIds.includes(propertyId);
}
