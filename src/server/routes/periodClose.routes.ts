import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function ensureDb(res: any): boolean {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) { dbNotConfigured(res); return false; }
  return true;
}

function withProperty(q: any, propertyId?: string) {
  if (propertyId) return q.eq('property_id', propertyId);
  return q;
}

// ── Accounting Periods ─────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('accounting_periods').select('*').order('period_start', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { periodName, periodStart, periodEnd, notes } = req.body || {};
  if (!periodName || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodName, periodStart and periodEnd are required' });
  }

  const { data, error } = await supabaseAdmin.from('accounting_periods').insert({
    period_name: periodName,
    period_start: periodStart,
    period_end: periodEnd,
    notes,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.post('/:id/close', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { notes } = req.body || {};
  const closedBy = (req as any).user?.id;

  const { data, error } = await supabaseAdmin.rpc('close_accounting_period', {
    p_period_id: req.params.id,
    p_closed_by: closedBy,
    p_notes: notes,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

router.post('/:id/reopen', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin.rpc('reopen_accounting_period', {
    p_period_id: req.params.id,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || { success: true });
});

// ── Period Close Checklist ────────────────────────────────────────────────
// Backs the /erp/finance/financial_close checklist tab.
//   GET    /checklist                  POST   /checklist
//   PATCH  /checklist/:id              DELETE /checklist/:id

router.get('/checklist', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, periodId, category, completed } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_period_close_checklist').select('*').order('sort_order', { ascending: true });
  q = withProperty(q, propertyId);
  if (periodId) q = q.eq('period_id', periodId);
  if (category) q = q.eq('category', category);
  if (completed !== undefined) q = q.eq('completed', completed === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/checklist', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { periodId, category, task, assignedTo, notes, propertyId } = req.body || {};
  if (!task) return res.status(400).json({ error: 'task is required' });
  const { data, error } = await supabaseAdmin!.from('fin_period_close_checklist').insert({
    period_id: periodId || null,
    category: category || 'General Ledger',
    task,
    assigned_to: assignedTo || null,
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/checklist/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { completed, category, task, assignedTo, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (completed !== undefined) {
    patch.completed = completed;
    if (completed) {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = (req as any).user?.id || null;
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }
  }
  if (category !== undefined) patch.category = category;
  if (task !== undefined) patch.task = task;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_period_close_checklist')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/checklist/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_period_close_checklist').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
