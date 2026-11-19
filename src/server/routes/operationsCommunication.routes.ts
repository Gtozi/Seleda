/**
 * Operational Communication Center routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/communication tab
 * (OperationalCommunicationCenter.tsx). No new tables — aggregates the
 * per-portal message tables into one unified feed and writes outbound
 * messages to the shared `communications` table (also used by the Front
 * Office) plus `notifications` so broadcasts surface in the bell.
 *
 *   GET   /communication?propertyId=
 *         Unified feed: communications (FO shared), housekeeping_communication_messages,
 *         eng_communication_messages, sec_messages, fb_kitchen_messages, notifications.
 *   POST  /communication                 — send a broadcast/department/direct
 *         message (communications row; broadcasts + department sends also
 *         write a notifications row for the bell).
 *   PATCH /communication/:source/:id/read — mark one message read in its
 *         originating portal table.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { writeAuditEvent } from '../services/sessionService';

const router = Router();
const CACHE_TTL_MS = 15 * 1000;

const SEND_TYPES = ['broadcast', 'department', 'message'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-comms] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-comms] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// GET /api/ops-portal/communication
router.get('/communication', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-comms:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [comms, hk, eng, sec, fb, notifs] = await Promise.all([
      fetchRows(supabaseAdmin!.from('communications')
        .select('id, message_number, type, from_name, from_type, to_name, to_type, subject, content, channel, priority, status, sent_at, read_at')
        .order('sent_at', { ascending: false }).limit(200), 'communications'),
      fetchRows(eqProp(supabaseAdmin!.from('housekeeping_communication_messages')
        .select('id, channel, from_name, body, timestamp, unread, created_at')
        .order('created_at', { ascending: false }).limit(100)), 'hk_messages'),
      fetchRows(eqProp(supabaseAdmin!.from('eng_communication_messages')
        .select('id, type, title, content, sender, recipients, status, priority, created_at')
        .order('created_at', { ascending: false }).limit(100)), 'eng_messages'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_messages')
        .select('id, msg_type, priority, channel, audience, recipient, subject, body, sender, status, sent_at, created_at')
        .order('created_at', { ascending: false }).limit(100)), 'sec_messages'),
      fetchRows(supabaseAdmin!.from('fb_kitchen_messages')
        .select('id, from_station, to_station, message, priority, created_at')
        .order('created_at', { ascending: false }).limit(100), 'fb_messages'),
      fetchRows(eqProp(supabaseAdmin!.from('notifications')
        .select('id, message, type, department, read, created_at')
        .order('created_at', { ascending: false }).limit(100)), 'notifications'),
    ]);

    const feed: any[] = [];

    for (const m of comms) {
      feed.push({
        id: m.id, source: 'front-office',
        type: m.type === 'broadcast' ? 'broadcast' : m.to_type === 'department' ? 'department' : 'chat',
        from: m.from_name || 'Front Desk', to: m.to_name || '—',
        subject: m.subject, content: m.content,
        channel: m.channel, priority: m.priority,
        sentAt: m.sent_at || m.created_at,
        read: m.status === 'read' || !!m.read_at,
      });
    }
    for (const m of hk) {
      feed.push({
        id: m.id, source: 'housekeeping', type: m.channel === 'announcement' ? 'broadcast' : 'department',
        from: m.from_name || 'Housekeeping', to: m.channel === 'announcement' ? 'All Departments' : `HK · ${m.channel || 'chat'}`,
        content: m.body, channel: m.channel, priority: 'medium',
        sentAt: m.timestamp || m.created_at, read: !m.unread,
      });
    }
    for (const m of eng) {
      feed.push({
        id: m.id, source: 'engineering', type: 'department',
        from: m.sender || 'Engineering', to: (m.recipients || []).join(', ') || 'Team',
        subject: m.title, content: m.content, priority: (m.priority || 'medium').toLowerCase(),
        sentAt: m.created_at, read: !!m.read_at,
      });
    }
    for (const m of sec) {
      feed.push({
        id: m.id, source: 'security', type: m.msg_type === 'broadcast' ? 'broadcast' : 'department',
        from: m.sender || 'Security', to: m.recipient || m.audience || 'Security Team',
        subject: m.subject, content: m.body, channel: m.channel,
        priority: (m.priority || 'medium').toLowerCase(),
        sentAt: m.sent_at || m.created_at, read: m.status === 'Read',
      });
    }
    for (const m of fb) {
      feed.push({
        id: m.id, source: 'f&b', type: 'department',
        from: m.from_station || 'Kitchen', to: m.to_station || 'Kitchen',
        content: m.message, priority: (m.priority || 'medium').toLowerCase(),
        sentAt: m.created_at, read: true,
      });
    }
    for (const n of notifs) {
      feed.push({
        id: n.id, source: 'system', type: 'broadcast',
        from: 'System', to: n.department || 'All',
        content: n.message, priority: n.type === 'warning' || n.type === 'alert' ? 'high' : 'medium',
        sentAt: n.created_at, read: !!n.read,
      });
    }

    feed.sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
    const today = new Date().toISOString().slice(0, 10);

    const payload = {
      generatedAt: new Date().toISOString(),
      messages: feed,
      stats: {
        total: feed.length,
        unread: feed.filter((m) => !m.read).length,
        broadcasts: feed.filter((m) => m.type === 'broadcast').length,
        today: feed.filter((m) => String(m.sentAt || '').startsWith(today)).length,
        sources: [...new Set(feed.map((m) => m.source))].length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load communications' });
  }
});

// POST /api/ops-portal/communication — send a message.
router.post('/communication', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, type, to, subject, content, priority } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (type === 'department' && !to?.trim()) return res.status(400).json({ error: 'target department is required' });
  if (type && !SEND_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${SEND_TYPES.join(', ')}` });
  }
  if (priority && !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
  }

  const msgType = (type || 'message') as string;
  const toName = msgType === 'broadcast' ? 'All Departments' : to?.trim();
  const toType = msgType === 'broadcast' ? 'all' : msgType === 'department' ? 'department' : 'staff';

  const { data, error } = await supabaseAdmin.from('communications').insert({
    id: crypto.randomUUID(),
    message_number: `MSG-OPS-${Date.now()}`,
    type: msgType === 'message' ? 'message' : msgType,
    from_name: req.user?.name || 'Operations',
    from_type: 'staff',
    to_name: toName,
    to_type: toType,
    subject: subject || null,
    content: content.trim(),
    channel: 'ops',
    priority: priority || 'medium',
    status: 'unread',
    sent_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Broadcasts + department sends also surface in the notification bell.
  if (msgType !== 'message') {
    await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: propertyId || null,
      message: `${subject ? `${subject}: ` : ''}${content.trim()}`.slice(0, 500),
      type: priority === 'urgent' || priority === 'high' ? 'warning' : 'info',
      department: toType === 'department' ? toName : 'all',
      read: false,
      created_at: new Date().toISOString(),
    }).then(({ error: nErr }: any) => {
      if (nErr) console.warn('[ops-comms] notification insert:', nErr.message);
    });
  }

  writeAuditEvent({
    req, user: req.user!, action: 'CREATE', module: 'operations',
    entityType: 'communication', entityId: data.id,
    details: { type: msgType, to: toName },
    outcome: 'success',
  }).catch(() => {});

  cacheService.invalidate('ops-comms:*');
  return res.status(201).json({ ok: true, message: data });
});

// PATCH /api/ops-portal/communication/:source/:id/read — mark read in the
// originating portal table.
router.patch('/communication/:source/:id/read', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { source, id } = req.params;
  const now = new Date().toISOString();
  let error: any = null;

  switch (source) {
    case 'front-office':
      ({ error } = await supabaseAdmin.from('communications')
        .update({ status: 'read', read_at: now, updated_at: now }).eq('id', id));
      break;
    case 'housekeeping':
      ({ error } = await supabaseAdmin.from('housekeeping_communication_messages')
        .update({ unread: false, updated_at: now }).eq('id', id));
      break;
    case 'engineering':
      ({ error } = await supabaseAdmin.from('eng_communication_messages')
        .update({ read_at: now, updated_at: now }).eq('id', id));
      break;
    case 'security':
      ({ error } = await supabaseAdmin.from('sec_messages')
        .update({ status: 'Read', updated_at: now }).eq('id', id));
      break;
    case 'system':
      ({ error } = await supabaseAdmin.from('notifications')
        .update({ read: true }).eq('id', id));
      break;
    default:
      return res.status(400).json({ error: `unsupported source: ${source}` });
  }
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-comms:*');
  return res.json({ ok: true });
});

export default router;
