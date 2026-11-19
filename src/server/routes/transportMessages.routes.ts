/**
 * Communication Center API
 * ──────────────────────────────────────────────────────────────────────────
 * Driver messages, dispatch/guest notifications, emergency alerts.
 * Mounted at /api/transport/messages.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { auditTransport, boundPropertyId, isNotFound, scopeRowWrite } from '../services/transportScope';
import crypto from 'crypto';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'transport-messages:';
const MESSAGE_TYPES = ['Driver Message', 'Guest Notification', 'Dispatch Notification', 'Emergency Alert'];
const MESSAGE_STATUSES = ['Pending', 'Sent', 'Delivered', 'Read', 'Failed'];
const PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];

const SELECT = '*, transport_requests(request_number, guest_name, status)';

// ── List messages ────────────────────────────────────────────────────────────
router.get('/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = boundPropertyId(req, req.params.propertyId);
  if (!propertyId) return res.status(403).json({ error: 'No property access' });
  const { type, status } = req.query as { type?: string; status?: string };

  const cacheKey = `${CACHE_PREFIX}${propertyId}:${type || 'all'}:${status || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let query = supabaseAdmin
    .from('transport_messages')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('sent_at', { ascending: false })
    .limit(500);
  if (type && MESSAGE_TYPES.includes(type)) query = query.eq('type', type);
  if (status && MESSAGE_STATUSES.includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = { messages: data || [] };
  cacheService.set(cacheKey, result, 30 * 1000);
  return res.json(result);
});

// ── Create / send message ────────────────────────────────────────────────────
router.post('/', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { type, from, to, subject, content, status, priority, relatedTripId } = req.body || {};
  const propertyId = boundPropertyId(req, req.body?.propertyId);

  if (!propertyId || !from || !to) return res.status(400).json({ error: 'propertyId, from and to are required' });
  if (type && !MESSAGE_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  if (status && !MESSAGE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

  const messageNumber = `MSG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('transport_messages').insert({
    property_id: propertyId,
    message_number: messageNumber,
    type: type || 'Driver Message',
    from_party: from,
    to_party: to,
    subject: subject || null,
    content: content || null,
    status: status || 'Sent',
    priority: priority || 'Normal',
    related_trip_id: relatedTripId || null,
  }).select(SELECT).single();
  if (error) return res.status(500).json({ error: error.message });

  // Deliver through the in-app notification feed (fire-and-forget).
  let delivered = false;
  try {
    const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: propertyId,
      message: subject ? `${subject} — ${content || ''}`.trim() : (content || `${type || 'Message'} for ${to}`),
      // notifications.type is CHECK-constrained to info/warning/success/task
      type: (priority === 'Critical' || type === 'Emergency Alert') ? 'warning' : 'info',
      department: type === 'Guest Notification' ? 'Front Office' : 'Transportation',
      read: false,
    });
    delivered = !notifErr;
    if (notifErr) console.warn('[transport-messages] notification insert failed:', notifErr.message);
  } catch (e: any) {
    console.warn('[transport-messages] notification delivery failed:', e?.message);
  }
  if (delivered && (status || 'Sent') === 'Sent') {
    await supabaseAdmin.from('transport_messages').update({ status: 'Delivered' }).eq('id', data.id);
    data.status = 'Delivered';
  }

  // Guest Notifications also land in the guest's mobile feed
  // (guest_notifications, migration 653) — resolve the guest from the related
  // trip or the `to` field (guest id or name).
  if ((type || 'Driver Message') === 'Guest Notification') {
    try {
      let guestId: string | null = null;
      if (relatedTripId) {
        const { data: trip } = await supabaseAdmin
          .from('transport_requests').select('guest_id').eq('id', relatedTripId).maybeSingle();
        guestId = trip?.guest_id || null;
      }
      if (!guestId && to) {
        const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(to);
        const { data: guest } = isId
          ? await supabaseAdmin.from('guests').select('id').eq('id', to).maybeSingle()
          : await supabaseAdmin.from('guests').select('id').ilike('name', to).maybeSingle();
        guestId = guest?.id || null;
      }
      if (guestId) {
        await supabaseAdmin.from('guest_notifications').insert({
          property_id: propertyId,
          guest_id: guestId,
          reservation_id: relatedTripId ? (await supabaseAdmin.from('transport_requests').select('reservation_id').eq('id', relatedTripId).maybeSingle()).data?.reservation_id || null : null,
          category: 'transportation',
          title: subject || 'Transportation update',
          message: content || '',
        });
      }
    } catch (e: any) {
      console.warn('[transport-messages] guest push insert failed:', e?.message);
    }
  }

  auditTransport(req, 'message.send', 'transport_message', data.id, { type: data.type, to: data.to_party });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

// ── Update message (e.g. mark read) ──────────────────────────────────────────
router.put('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (b.type !== undefined && !MESSAGE_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type' });
  if (b.status !== undefined && !MESSAGE_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Invalid priority' });

  const patch: any = {};
  const map: Record<string, string> = {
    type: 'type', from: 'from_party', to: 'to_party', subject: 'subject', content: 'content',
    status: 'status', priority: 'priority', relatedTripId: 'related_trip_id',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) patch[col] = b[key];
  }
  if (b.relatedTripId !== undefined) patch.related_trip_id = b.relatedTripId || null;

  const { data, error } = await scopeRowWrite(supabaseAdmin.from('transport_messages').update(patch).eq('id', req.params.id), req).select(SELECT).single();
  if (error) return res.status(isNotFound(error) ? 404 : 500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

// ── Delete message ───────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requirePermission('transport:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await scopeRowWrite(supabaseAdmin.from('transport_messages').delete().eq('id', req.params.id), req);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
