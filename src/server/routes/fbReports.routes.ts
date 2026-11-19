/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Reports routes — backs the /erp/fb/reports screen.
 *
 * Read/write endpoints over the `fb_reports` registry table:
 *   - GET  /                  list reports (optional ?category=outlet|menu|cost|discount|labor|waste|procurement|banquet|pnl)
 *   - GET  /stats             aggregated KPI counts (total / ready / scheduled / failed)
 *   - GET  /:id               fetch a single report
 *   - POST   /:id/run         re-run a single report (sets status Ready + last_run = now())
 *   - POST   /run-all         queue all reports for refresh (sets each to Ready + last_run = now())
 *   - PATCH  /:id             update a report's frequency and/or format and/or status
 *
 * All endpoints gated by `authenticate`.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const VALID_CATEGORIES = ['outlet', 'menu', 'cost', 'discount', 'labor', 'waste', 'procurement', 'banquet', 'pnl'] as const;
type Category = typeof VALID_CATEGORIES[number];

const VALID_STATUSES = ['Ready', 'Scheduled', 'Generating', 'Failed'] as const;
const VALID_FORMATS = ['PDF', 'Excel', 'CSV'] as const;

function resolveCategory(p?: string): Category | undefined {
  return (VALID_CATEGORIES as readonly string[]).includes(p || '') ? (p as Category) : undefined;
}

// ── List reports ─────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const category = resolveCategory(req.query.category as string);
  let q = supabaseAdmin
    .from('fb_reports')
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .order('id', { ascending: true });
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Aggregated stats ─────────────────────────────────────────────────
router.get('/stats', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_reports')
    .select('category, status');
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const total = rows.length;
  const ready = rows.filter((r: any) => r.status === 'Ready').length;
  const scheduled = rows.filter((r: any) => r.status === 'Scheduled').length;
  const failed = rows.filter((r: any) => r.status === 'Failed').length;
  const byCategory: Record<string, number> = { outlet: 0, menu: 0, cost: 0, discount: 0, labor: 0, waste: 0, procurement: 0, banquet: 0, pnl: 0 };
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  return res.json({ total, ready, scheduled, failed, byCategory });
});

// ── Single report ────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('fb_reports')
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── Run a single report ──────────────────────────────────────────────
router.post('/:id/run', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('fb_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .eq('id', id)
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

// ── Run all reports ──────────────────────────────────────────────────
router.post('/run-all', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('fb_reports')
    .update({ status: 'Ready', last_run: new Date().toISOString() })
    .neq('status', 'Ready')
    .select('id, category, name, description, last_run, status, format, frequency, updated_at');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ refreshed: data?.length || 0, reports: data || [] });
});

// ── Update a report (frequency / format / status) ────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const body = req.body || {};
  const updates: Record<string, any> = {};
  if (typeof body.frequency === 'string' && body.frequency.trim()) updates.frequency = body.frequency.trim();
  if (typeof body.format === 'string' && (VALID_FORMATS as readonly string[]).includes(body.format)) updates.format = body.format;
  if (typeof body.status === 'string' && (VALID_STATUSES as readonly string[]).includes(body.status)) updates.status = body.status;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update (frequency, format, status)' });
  }
  const { data, error } = await supabaseAdmin
    .from('fb_reports')
    .update(updates)
    .eq('id', id)
    .select('id, category, name, description, last_run, status, format, frequency, updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Report not found' });
  return res.json(data);
});

export default router;
