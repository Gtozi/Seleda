/**
 * HR notification + audit helpers
 * ──────────────────────────────────────────────────────────────────────────
 * Thin wrappers around the existing audit_events and notifications tables so
 * HR state changes (leave approvals, payroll posting, overtime, attendance)
 * leave an audit trail and surface an in-app notification to the HR
 * department feed. Both writes are fire-and-forget — a notification failure
 * must never block a business operation.
 */
import crypto from 'crypto';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from './sessionService';
import type express from 'express';

export async function hrAudit(params: {
  req: express.Request;
  user?: any;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  outcome?: 'success' | 'failure' | 'denied';
}) {
  try {
    await writeAuditEvent({
      req: params.req,
      user: params.user,
      action: params.action,
      module: 'hr',
      entityType: params.entityType,
      entityId: params.entityId,
      outcome: params.outcome,
      details: params.details,
    });
  } catch (_) { /* non-fatal */ }
}

export async function hrNotify(params: {
  propertyId: string;
  message: string;
  type?: string;
  department?: string;
}) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;
  try {
    await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: params.propertyId,
      message: params.message,
      type: params.type || 'hr',
      department: params.department || 'Human Resources',
      read: false,
    });
  } catch (_) { /* non-fatal */ }
}
