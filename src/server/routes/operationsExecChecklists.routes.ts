/**
 * Executive Checklists routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/executive-checklists tab
 * (ExecutiveChecklists.tsx). Recurring daily/weekly/monthly executive
 * checklist templates persisted in `ops_exec_checklists` (migration 640).
 *
 *   GET    /executive-checklists?propertyId=
 *          Templates with effective status derived from frequency vs the
 *          current period (daily=today, weekly=ISO week, monthly=month):
 *          completed_at in period → completed, started_at in period →
 *          in-progress, else pending — auto-resets each period, no cron.
 *          Also attaches a live cross-portal `context` line per item
 *          (open escalations, critical incidents, pending audits…).
 *   POST   /executive-checklists          — new checklist item.
 *   PATCH  /executive-checklists/:id      — status action
 *          (start|complete|reset) or field edits (assigned_to, due_label,
 *          notes, frequency, category, title, active).
 *   DELETE /executive-checklists/:id      — remove.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

type Frequency = 'daily' | 'weekly' | 'monthly';
type ChecklistStatus = 'pending' | 'in-progress' | 'completed';

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'monthly'];

function periodStart(frequency: Frequency): Date {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (frequency === 'daily') return d;
  if (frequency === 'weekly') {
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  }
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function effectiveStatus(row: any): ChecklistStatus {
  const start = periodStart(row.frequency as Frequency).getTime();
  if (row.completed_at && new Date(row.completed_at).getTime() >= start) return 'completed';
  if (row.started_at && new Date(row.started_at).getTime() >= start) return 'in-progress';
  return 'pending';
}

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-exec-checklists] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-exec-checklists] ${tag}: ${e?.message || e}`);
    return [];
  }
}

async function countRows(query: any, tag: string): Promise<number> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-exec-checklists] ${tag}: ${r.error.message}`);
      return 0;
    }
    return r.count ?? ((r.data as any[]) || []).length;
  } catch (e: any) {
    console.warn(`[ops-exec-checklists] ${tag}: ${e?.message || e}`);
    return 0;
  }
}

function scoped(query: any, propertyId: string | null) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

// Registry tables (ops_exec_checklists) treat NULL property_id as global — include them under any scope.
function scopedRegistry(query: any, propertyId: string | null) {
  return propertyId ? query.or(`property_id.is.null,property_id.eq.${propertyId}`) : query;
}

function contextLine(category: string, ctx: Record<string, number>): string | null {
  switch (category) {
    case 'walkthrough':
      return ctx.openRequests > 0 ? `${ctx.openRequests} open guest request(s) to review` : null;
    case 'inspection': {
      const parts: string[] = [];
      if (ctx.openWorkOrders > 0) parts.push(`${ctx.openWorkOrders} open work order(s)`);
      if (ctx.failedInspections > 0) parts.push(`${ctx.failedInspections} failed inspection(s) last 30d`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'safety':
      return ctx.criticalIncidents > 0 ? `${ctx.criticalIncidents} open critical/high incident(s)` : null;
    case 'review':
      return ctx.openEscalations > 0 ? `${ctx.openEscalations} open escalation(s) awaiting review` : null;
    case 'audit':
      return ctx.scheduledAudits > 0 ? `${ctx.scheduledAudits} audit(s) scheduled` : null;
    case 'compliance':
      return ctx.nonCompliantRisk > 0 ? `${ctx.nonCompliantRisk} risk/compliance item(s) not Good` : null;
    default:
      return null;
  }
}

router.get('/executive-checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const cacheKey = `ops-exec-checklists:${propertyId || 'all'}`;

  try {
    const cached = cacheService.get<any>(cacheKey);
    if (cached) return res.json(cached);

    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const [rows, ctx] = await Promise.all([
      fetchRows(
        scopedRegistry(
          supabaseAdmin!.from('ops_exec_checklists')
            .select('*')
            .eq('active', true)
            .order('sort_order', { ascending: true }),
          propertyId
        ),
        'checklists'
      ),
      (async () => ({
        openWorkOrders: await countRows(
          scoped(supabaseAdmin!.from('work_orders').select('id', { count: 'exact', head: true }).neq('status', 'Closed').neq('status', 'Cancelled').neq('status', 'Completed'), propertyId),
          'ctx work_orders'
        ),
        criticalIncidents: await countRows(
          scoped(supabaseAdmin!.from('sec_incidents').select('id', { count: 'exact', head: true }).in('priority', ['Critical', 'High']).in('status', ['Draft', 'Reported', 'Classified', 'Assigned', 'In Progress', 'Investigation', 'Corrective Action', 'Active', 'Pending']), propertyId),
          'ctx sec_incidents'
        ),
        openEscalations: await countRows(
          scoped(supabaseAdmin!.from('ops_escalations').select('id', { count: 'exact', head: true }).neq('status', 'resolved'), propertyId),
          'ctx escalations'
        ),
        nonCompliantRisk: await countRows(
          scoped(supabaseAdmin!.from('risk_compliance').select('id', { count: 'exact', head: true }).neq('status', 'Good'), propertyId),
          'ctx risk'
        ),
        scheduledAudits: await countRows(
          scoped(supabaseAdmin!.from('sec_compliance_audits').select('id', { count: 'exact', head: true }).eq('status', 'Scheduled'), propertyId),
          'ctx audits'
        ),
        failedInspections: await countRows(
          scoped(supabaseAdmin!.from('room_inspections').select('id', { count: 'exact', head: true }).eq('result', 'Fail').gte('inspection_date', monthAgo), propertyId),
          'ctx inspections'
        ),
        openRequests: await countRows(
          scoped(supabaseAdmin!.from('guest_requests').select('id', { count: 'exact', head: true }).eq('status', 'Open'), propertyId),
          'ctx requests'
        ),
      }))(),
    ]);

    const items = rows.map((row: any) => {
      const status = effectiveStatus(row);
      return {
        id: row.id,
        title: row.title,
        frequency: row.frequency,
        category: row.category,
        status,
        assignedTo: row.assigned_to,
        dueBy: row.due_label,
        lastCompleted: row.completed_at,
        completedBy: row.completed_by,
        notes: row.notes,
        context: contextLine(row.category, ctx),
      };
    });

    const stats = {
      total: items.length,
      completed: items.filter((i: any) => i.status === 'completed').length,
      inProgress: items.filter((i: any) => i.status === 'in-progress').length,
      pending: items.filter((i: any) => i.status === 'pending').length,
      daily: items.filter((i: any) => i.frequency === 'daily').length,
      weekly: items.filter((i: any) => i.frequency === 'weekly').length,
      monthly: items.filter((i: any) => i.frequency === 'monthly').length,
    };

    const payload = { items, stats };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (e: any) {
    console.error('[ops-exec-checklists] GET failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load executive checklists' });
  }
});

router.post('/executive-checklists', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const body = req.body || {};
  const frequency = String(body.frequency || 'daily');
  if (!FREQUENCIES.includes(frequency as Frequency)) {
    return res.status(400).json({ error: 'frequency must be daily, weekly or monthly' });
  }
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const row: Record<string, any> = {
      id: `exc-${Date.now()}`,
      title,
      frequency,
      category: String(body.category || 'operational'),
      assigned_to: body.assignedTo ? String(body.assignedTo) : null,
      due_label: body.dueBy ? String(body.dueBy) : null,
      notes: body.notes ? String(body.notes) : null,
      created_by: user?.name || user?.username || 'system',
    };
    if (body.propertyId) row.property_id = body.propertyId;

    const { data, error } = await supabaseAdmin
      .from('ops_exec_checklists')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json({ ok: true, item: data });
  } catch (e: any) {
    console.error('[ops-exec-checklists] POST failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to create checklist item' });
  }
});

router.patch('/executive-checklists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const id = req.params.id;
  const body = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };

  const action = body.action ? String(body.action) : null;
  if (action === 'start') {
    patch.started_at = new Date().toISOString();
    patch.completed_at = null;
    patch.completed_by = null;
  } else if (action === 'complete') {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = user?.name || user?.username || 'system';
  } else if (action === 'reset') {
    patch.started_at = null;
    patch.completed_at = null;
    patch.completed_by = null;
  }

  if (body.title !== undefined) patch.title = String(body.title);
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo ? String(body.assignedTo) : null;
  if (body.dueBy !== undefined) patch.due_label = body.dueBy ? String(body.dueBy) : null;
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes) : null;
  if (body.frequency !== undefined && FREQUENCIES.includes(body.frequency)) patch.frequency = body.frequency;
  if (body.category !== undefined) patch.category = String(body.category);
  if (body.active !== undefined) patch.active = !!body.active;

  try {
    const { data, error } = await supabaseAdmin
      .from('ops_exec_checklists')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Checklist item not found' });
    return res.json({ ok: true, item: { ...data, status: effectiveStatus(data) } });
  } catch (e: any) {
    console.error('[ops-exec-checklists] PATCH failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to update checklist item' });
  }
});

router.delete('/executive-checklists/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { error } = await supabaseAdmin
      .from('ops_exec_checklists')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[ops-exec-checklists] DELETE failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to delete checklist item' });
  }
});

export default router;
