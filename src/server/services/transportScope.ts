/**
 * Transport property scoping helpers
 * ──────────────────────────────────────────────────────────────────────────
 * Mirrors the spaWellness pattern: a user whose dataRestrictions.propertyAccess
 * is 'Single' is locked to system_users.property_id — client-supplied property
 * ids are ignored and id-based writes are filtered so foreign rows no-match.
 * Multi-property / full-access users are unrestricted.
 */
import { isFullAccessRole } from '../../types/erp';
import { writeAuditEvent } from './sharedServices';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function isSinglePropertyUser(req: any): boolean {
  return req?.user?.dataRestrictions?.propertyAccess === 'Single' && !isFullAccessRole(req?.user?.role);
}

/**
 * Effective property for list/read/create paths. Single-property users always
 * get their assigned property; others get the requested id (validated).
 */
export function boundPropertyId(req: any, requested?: unknown): string | null {
  const userProp = isUuid(req?.user?.propertyId) ? req.user.propertyId : null;
  if (isSinglePropertyUser(req)) return userProp;
  return isUuid(requested) ? (requested as string) : userProp;
}

/**
 * Restrict an update/delete/select-by-id query to rows the caller may touch.
 * Single-property users without an assigned property match nothing
 * (transport tables have NOT NULL property_id).
 */
export function scopeRowWrite<T>(query: T, req: any): T {
  if (!isSinglePropertyUser(req)) return query;
  const userProp = isUuid(req?.user?.propertyId) ? req.user.propertyId : null;
  if (!userProp) return (query as any).is('property_id', null);
  return (query as any).eq('property_id', userProp);
}

/** True when a PostgREST error means "row not found / not in scope". */
export function isNotFound(err: any): boolean {
  return err?.code === 'PGRST116';
}

/**
 * Write an audit_events row for a transport write path (spec §28 "Complete
 * audit trail"). Fire-and-forget — never awaited by callers and never throws.
 */
export function auditTransport(req: any, action: string, entityType: string, entityId?: string, details?: any): void {
  writeAuditEvent({ req, user: req?.user, action, module: 'transportation', entityType, entityId, details }).catch(() => {});
}
