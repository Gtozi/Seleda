/**
 * Admin Reports routes — backs the /erp/admin/reports screen.
 * Mirrors fbReports.routes.ts: a DB-backed report registry (`admin_reports`)
 * where each report is bound to a live admin dataset (DATASETS in
 * adminControl.routes.ts). Running a report executes the real dataset query
 * and persists status + last_run back to the registry.
 *
 *   - GET   /             list reports (?category= filter)
 *   - GET   /stats        aggregated KPI counts
 *   - POST  /:id/run      execute the dataset live, mark Ready/Failed, return rows
 *   - POST  /run-all      mark all reports Ready + last_run = now()
 *   - PATCH /:id          update frequency / format / status
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { writeAuditEvent } from '../services/sharedServices';
import { DATASETS } from './adminControl.routes';

const router = Router();
const guard = [authenticate, requirePermission('settings:manage')];

const VALID_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const VALID_FORMATS = ['PDF', 'Excel', 'CSV'] as const;
const REPORT_COLS = 'id, dataset, category, name, description, last_run, status, format, frequency, updated_at';

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function withDatasetMeta(rows: any[]) {
  return (rows || []).map(r => ({
    ...r,
    datasetLabel: DATASETS[r.dataset]?.label || r.dataset,
    datasetAvailable: !!DATASETS[r.dataset],
    dateColumn: DATASETS[r.dataset]?.dateColumn || null,
  }));
}

// ── List reports ─────────────────────────────────────────────────────
router.get('/', ...guard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  let q = supabaseAdmin.from('admin_reports').select(REPORT_COLS).order('id', { ascending: true });
  if (req.query.category) q = q.eq('category', String(req.query.category));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(withDatasetMeta(data));
});

// ── Aggregated stats ─────────────────────────────────────────────────
router.get('/stats', ...guard, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('admin_reports').select('category, status');
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({
    total: rows.length,
    ready: rows.filter((r: any) => r.status === 'Ready').length,
    scheduled: rows.filter((r: any) => r.status === 'Scheduled').length,
    failed: rows.filter((r: any) => r.status === 'Failed').length,
    generating: rows.filter((r: any) => r.status === 'Generating').length,
    byCategory,
  });
});

// ── Run a single report: executes the live dataset query ─────────────
router.post('/:id/run', ...guard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { data: report, error: fetchErr } = await supabaseAdmin
    .from('admin_reports').select(REPORT_COLS).eq('id', id).maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const ds = DATASETS[report.dataset];
  if (!ds) {
    await supabaseAdmin.from('admin_reports').update({ status: 'Failed' }).eq('id', id);
    return res.status(400).json({ error: `Dataset '${report.dataset}' is not available` });
  }

  const limit = Math.min(Number(req.query.limit) || 1000, 5000);
  let q = supabaseAdmin
    .from(ds.table).select(ds.select)
    .order(ds.orderBy, { ascending: ds.ascending ?? true }).limit(limit);

  // Optional period filter (Today/WTD/MTD/YTD/Custom → ?from=&to=)
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  if (ds.dateColumn && from) q = q.gte(ds.dateColumn, from);
  if (ds.dateColumn && to) q = q.lte(ds.dateColumn, to);

  const { data: rows, error: qErr } = await q;

  const now = new Date().toISOString();
  if (qErr) {
    await supabaseAdmin.from('admin_reports').update({ status: 'Failed', last_run: now }).eq('id', id);
    return res.status(500).json({ error: qErr.message });
  }
  const { data: updated } = await supabaseAdmin
    .from('admin_reports').update({ status: 'Ready', last_run: now })
    .eq('id', id).select(REPORT_COLS).single();

  await writeAuditEvent({ req, user: req.user!, action: 'report.run', entityType: 'AdminReport', entityId: id, module: 'admin' });
  return res.json({ report: withDatasetMeta([updated])[0], rows: rows || [], rowCount: (rows || []).length, limit, period: { from, to, dateColumn: ds.dateColumn || null } });
});

// ── Run all reports ──────────────────────────────────────────────────
router.post('/run-all', ...guard, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('admin_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .neq('status', 'Ready')
    .select(REPORT_COLS);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ refreshed: data?.length || 0, reports: withDatasetMeta(data || []) });
});

// ── Update a report (frequency / format / status) ────────────────────
router.patch('/:id', ...guard, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (VALID_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin
    .from('admin_reports').update(updates).eq('id', req.params.id)
    .select(REPORT_COLS).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  await writeAuditEvent({ req, user: req.user!, action: 'report.updated', entityType: 'AdminReport', entityId: req.params.id, module: 'admin' });
  return res.json(withDatasetMeta([data])[0]);
});

export default router;
