/**
 * Notifications API
 * ──────────────────────────────────────────────────────────────────────────
 * Read path for the global `notifications` table. Server-side writers
 * (transport messages, lifecycle alerts, HR events) insert rows here; this
 * router lets the signed-in user's client actually see and manage them.
 * Rows are property-scoped to the caller's system_users.property_id.
 * Mounted at /api/notifications.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { isUuid } from '../services/transportScope';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function callerPropertyId(req: any): string | null {
  return isUuid(req?.user?.propertyId) ? req.user.propertyId : null;
}

// ── List the caller's property notifications (newest first) ─────────────────
router.get('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = callerPropertyId(req);
  if (!propertyId) return res.json({ notifications: [] });

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, created_at, message, type, department, read')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notifications: data || [] });
});

// ── Mark a notification read ────────────────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = callerPropertyId(req);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read: true })
    .eq('id', req.params.id)
    .eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// ── Dismiss (delete) a notification ─────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = callerPropertyId(req);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });

  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', req.params.id)
    .eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;
