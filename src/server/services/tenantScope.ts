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
import { AsyncLocalStorage } from 'async_hooks';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const EMPTY_ID = '00000000-0000-0000-0000-000000000000';

// ─────────────────────────────────────────────────────────────────────────
// Request-scoped tenant context (AsyncLocalStorage)
//
// `resolveTenant` establishes the store for every /api request; `authenticate`
// upgrades it for staff users whose active tenant differs from the subdomain.
// `installTenantScopeFilter()` wraps supabaseAdmin.from() so every query on a
// tenant-scoped table is automatically constrained — covering all ~100 route
// files without per-handler edits.
// ─────────────────────────────────────────────────────────────────────────

export interface TenantScopeContext {
  tenantId: string;
  propertyIds: string[];   // [] = tenant owns no properties → match nothing
  outletIds: string[];
}

interface TenantStore {
  scope: TenantScopeContext | null;
}

const tenantALS = new AsyncLocalStorage<TenantStore>();

/** Run `fn` inside a fresh tenant store (used by resolveTenant middleware). */
export function runWithTenantStore<T>(fn: () => T): T {
  return tenantALS.run({ scope: null }, fn);
}

export function getTenantStore(): TenantStore | undefined {
  return tenantALS.getStore();
}

// Global scope cache — the id lists change rarely; 60s TTL keeps the extra
// DB lookups off the per-request hot path.
const SCOPE_TTL_MS = 60_000;
const scopeCache = new Map<string, { scope: TenantScopeContext; fetchedAt: number }>();

export function invalidateTenantScopeCache(tenantId?: string): void {
  if (tenantId) scopeCache.delete(tenantId);
  else scopeCache.clear();
}

/** Build (or fetch cached) scope ids for a tenant. */
export async function buildTenantScope(tenantId: string): Promise<TenantScopeContext> {
  const cached = scopeCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < SCOPE_TTL_MS) return cached.scope;

  const scope: TenantScopeContext = { tenantId, propertyIds: [], outletIds: [] };
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const [props, outlets] = await Promise.all([
      supabaseAdmin.from('properties').select('id').eq('tenant_id', tenantId),
      supabaseAdmin.from('outlets').select('id').eq('tenant_id', tenantId),
    ]);
    scope.propertyIds = (props.data || []).map((p: any) => p.id);
    scope.outletIds = (outlets.data || []).map((o: any) => o.id);
  }
  scopeCache.set(tenantId, { scope, fetchedAt: Date.now() });
  return scope;
}

/** Set the ALS scope for the current request (tenant subdomain path). */
export async function setResolvedTenantScope(tenantId: string): Promise<void> {
  const store = tenantALS.getStore();
  if (store && !store.scope) {
    store.scope = await buildTenantScope(tenantId);
  }
}

/**
 * Populate the ALS scope for authenticated staff requests on non-tenant
 * hosts (main domain / admin subdomain). No-op when a scope already exists
 * (tenant subdomain). Everyone — including super-admins — is confined to
 * their active tenant here; cross-tenant visibility is only available on
 * tenant subdomains (where the URL picks the tenant) or for accounts with
 * no tenant assignment at all.
 */
export async function ensureStaffTenantScope(req: Request): Promise<void> {
  const store = tenantALS.getStore();
  if (!store || store.scope || !req.user) return;
  const tenantId = req.user.activeTenantId || null;
  if (tenantId) store.scope = await buildTenantScope(tenantId);
}

// ─────────────────────────────────────────────────────────────────────────
// Table → scope mapping
//
// 'tenant_id'            strict .eq('tenant_id', tid)
// 'tenant_id_null_ok'    tenant rows OR unscoped (NULL tenant_id) rows — for
//                        config/content tables that also hold global rows
// 'property_id'          .in('property_id', propIds)
// 'property_id_null_ok'  property rows OR shared (NULL property_id) rows
// 'outlet_id'            .in('outlet_id', outletIds) — F&B tables keyed by outlet
// 'tenant_or_property'   .or(tenant_id match, property_id in tenant props) — guests
// ─────────────────────────────────────────────────────────────────────────

type ScopeSpec = 'tenant_id' | 'tenant_id_null_ok' | 'property_id' | 'property_id_null_ok' | 'outlet_id' | 'tenant_or_property';

const TENANT_TABLES = new Set([
  'accounting_periods', 'action_item', 'airport_shuttle_requests', 'alert_instances',
  'alert_rules', 'ap_bills', 'ap_payments', 'audit_events', 'bank_accounts',
  'bank_statement_lines', 'banquet_events', 'chart_of_accounts', 'corporate_accounts',
  'daily_briefing', 'dashboard_views', 'depreciation_schedules', 'digital_keys',
  'drill_down_links', 'employees', 'escalation', 'fixed_assets', 'folio_lines',
  'folio_payments', 'folios', 'forecast_entries', 'group_audit_log', 'group_blocks',
  'group_bookings', 'group_profiles', 'guest_feedbacks', 'guest_group_relationships',
  'guest_notifications', 'guest_requests', 'guest_services', 'guests', 'hk_amenity_stock',
  'hk_linen_stock', 'housekeeping_communication_messages', 'housekeeping_maintenance_issues',
  'housekeeping_task_mgmt', 'ingredients', 'inventory_grns', 'inventory_items',
  'inventory_requisitions', 'inventory_stock_movements', 'inventory_stores',
  'inventory_suppliers', 'journal_entries', 'journal_lines', 'lost_found', 'menu_items',
  'allotments', 'allotment_pickup_log', 'pre_registrations', 'vouchers',
  'work_requests', 'guest_communications', 'guest_feedback',
  'metric_history', 'mobile_check_ins', 'orders', 'outlets', 'packages', 'pm_schedules',
  'properties', 'rate_plans', 'recipes', 'reconciliation_batches', 'report_schedules',
  'reporting_snapshots', 'requisitions', 'reservations', 'rooms', 'sales_contracts',
  'sales_leads', 'sales_proposals', 'seasons', 'security_incidents', 'spa_appointments',
  'spare_parts', 'staffing_status', 'stock_counts', 'stock_locations', 'stock_transactions',
  'transport_requests', 'uinv_items', 'uinv_stock_balances', 'uinv_stock_ledger',
  'uinv_stores', 'vendors', 'wastage_logs', 'work_orders', 'yield_policies',
]);

// Config/content tables that also contain global (NULL tenant_id) rows.
const TENANT_NULL_OK_TABLES = new Set([
  'guest_faqs', 'metric_definitions', 'dashboard_views', 'report_schedules',
  'alert_rules', 'drill_down_links',
]);

const PROPERTY_TABLES = new Set([
  'room_types', 'banquet_venues', 'transport_config_items',
]);

const PROPERTY_NULL_OK_TABLES = new Set([
  'spa_treatments', 'rms_promotions', 'rms_daily_rate_overrides', 'public_testimonials',
]);

const OUTLET_TABLES = new Set([
  'fb_table_reservations', 'fb_room_service_orders', 'fb_room_service_menu_items',
]);

// Tables deliberately NOT auto-filtered: auth/session stores, platform
// registries, and tenant management. (Parent-keyed tables gained tenant_id
// via migration 705 and are filtered normally.)
const SKIP_TABLES = new Set([
  'system_users', 'user_sessions', 'guest_sessions', 'tenants',
  'tenant_user_assignments', 'modules', 'global_settings', 'custom_roles',
]);

function specForTable(table: string): ScopeSpec | null {
  if (SKIP_TABLES.has(table)) return null;
  if (table === 'guests') return 'tenant_or_property';
  if (TENANT_NULL_OK_TABLES.has(table)) return 'tenant_id_null_ok';
  if (TENANT_TABLES.has(table)) return 'tenant_id';
  if (PROPERTY_NULL_OK_TABLES.has(table)) return 'property_id_null_ok';
  if (PROPERTY_TABLES.has(table)) return 'property_id';
  if (OUTLET_TABLES.has(table)) return 'outlet_id';
  return null;
}

function idsOrEmpty(ids: string[]): string[] {
  return ids.length ? ids : [EMPTY_ID];
}

/** Apply the scope filter to a PostgREST filter builder (select/update/delete). */
function applyReadFilter<Q extends Filterable>(q: Q, spec: ScopeSpec, scope: TenantScopeContext, forWrite: boolean): Q {
  switch (spec) {
    case 'tenant_id':
      return q.eq('tenant_id', scope.tenantId) as Q;
    case 'tenant_id_null_ok':
      return forWrite
        ? (q.eq('tenant_id', scope.tenantId) as Q)
        : (q.or(`tenant_id.eq.${scope.tenantId},tenant_id.is.null`) as Q);
    case 'property_id':
      return q.in('property_id', idsOrEmpty(scope.propertyIds)) as Q;
    case 'property_id_null_ok':
      return forWrite
        ? (q.in('property_id', idsOrEmpty(scope.propertyIds)) as Q)
        : (q.or(`property_id.is.null,property_id.in.(${idsOrEmpty(scope.propertyIds).join(',')})`) as Q);
    case 'outlet_id':
      return q.in('outlet_id', idsOrEmpty(scope.outletIds)) as Q;
    case 'tenant_or_property': {
      const clauses = [`tenant_id.eq.${scope.tenantId}`];
      if (scope.propertyIds.length) clauses.push(`property_id.in.(${scope.propertyIds.join(',')})`);
      return q.or(clauses.join(',')) as Q;
    }
  }
}

/** Stamp tenant_id into insert/upsert payloads for tenant-scoped tables. */
function stampPayload(payload: any, spec: ScopeSpec, scope: TenantScopeContext): any {
  if (spec !== 'tenant_id' && spec !== 'tenant_or_property' && spec !== 'tenant_id_null_ok') return payload;
  const stamp = (row: any) =>
    row && typeof row === 'object' && !Array.isArray(row) && row.tenant_id === undefined
      ? { ...row, tenant_id: scope.tenantId }
      : row;
  return Array.isArray(payload) ? payload.map(stamp) : stamp(payload);
}

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

// ─────────────────────────────────────────────────────────────────────────
// supabaseAdmin.from() interceptor
//
// Wraps select/insert/update/delete/upsert on the query builder:
//  - select            → inject the scope filter into the WHERE clause
//  - update / delete   → same (writes can only touch this tenant's rows)
//  - insert / upsert   → stamp tenant_id into row payloads when missing
// No-ops entirely when there is no ALS scope (main domain, super-admin,
// unauthenticated platform routes, background jobs).
// ─────────────────────────────────────────────────────────────────────────

const FILTER_METHODS = new Set(['select', 'insert', 'update', 'delete', 'upsert']);
const WRITE_PAYLOAD_METHODS = new Set(['insert', 'upsert']);
const FILTERED_METHODS = new Set(['select', 'update', 'delete']);

function wrapTableBuilder(builder: any, table: string, scope: TenantScopeContext): any {
  const spec = specForTable(table);
  if (!spec) return builder;

  for (const method of FILTER_METHODS) {
    const original = builder[method];
    if (typeof original !== 'function') continue;
    builder[method] = function (...args: any[]) {
      if (WRITE_PAYLOAD_METHODS.has(method)) {
        // Stamp tenant_id into the payload; do NOT re-wrap the result —
        // .select() after insert/update is a RETURNING clause, not a read.
        const stamped = args.map((a) => stampPayload(a, spec, scope));
        return original.apply(this, stamped);
      }
      const result = original.apply(this, args);
      if (FILTERED_METHODS.has(method) && result && typeof result.or === 'function') {
        return applyReadFilter(result, spec, scope, method !== 'select');
      }
      return wrapTableBuilder(result, table, scope);
    };
  }
  return builder;
}

let installed = false;

/**
 * Install the tenant-scope interceptor on the shared service-role client.
 * Idempotent — call once at server startup.
 */
export function installTenantScopeFilter(): void {
  if (installed || !supabaseAdmin) return;
  installed = true;

  const client = supabaseAdmin as any;
  const originalFrom = client.from.bind(client);
  client.from = (table: string) => {
    const builder = originalFrom(table);
    const store = tenantALS.getStore();
    const scope = store?.scope;
    if (!scope) return builder;
    return wrapTableBuilder(builder, table, scope);
  };
}
