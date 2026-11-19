/**
 * Operations Configuration routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/configuration tab (Configuration.tsx) —
 * expanded to four areas, all persisted:
 *
 *   GET  /configuration?propertyId=
 *        - approvalLevels: real shared matrix from fin_approval_levels
 *          (same table the Finance approval workflows use)
 *        - opsConfig: section-keyed JSONB rows from ops_config (mig. 643)
 *        - globalSettings: whitelisted fields from the global_settings
 *          singleton (hotel name, check-in/out, tax, night audit, …)
 *        - deptConfigs: read-only overview of each portal's config table
 *          (hk_config, eng_config, sec_config, uinv_config, proc_config,
 *          hr_configuration) — section counts + last updated.
 *
 *   POST   /configuration/approval-levels      — create level
 *   PATCH  /configuration/approval-levels/:id  — update level
 *   DELETE /configuration/approval-levels/:id  — remove level
 *   PUT    /configuration/section/:section     — upsert ops_config JSONB
 *   PATCH  /configuration/global               — update whitelisted
 *                                                global_settings fields
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

/** global_settings columns this module is allowed to read/write. */
const GLOBAL_FIELDS = [
  'custom_hotel_name', 'contact_phone', 'contact_email',
  'check_in_time', 'check_out_time', 'tax_percent', 'service_charge_percent',
  'exchange_rate', 'session_timeout', 'auto_night_audit_time',
  'maintenance_mode', 'public_booking_enabled', 'guest_portal_enabled',
  'vip_spend_threshold', 'cancellation_grace_hours', 'cancellation_penalty_percent',
] as const;

const DEPT_CONFIG_TABLES: { dept: string; table: string; sectionCol: string | null; dataCol: string }[] = [
  { dept: 'Housekeeping', table: 'hk_config', sectionCol: 'section', dataCol: 'data' },
  { dept: 'Engineering', table: 'eng_config', sectionCol: 'section', dataCol: 'data' },
  { dept: 'Security', table: 'sec_config', sectionCol: 'section', dataCol: 'data' },
  { dept: 'Unified Inventory', table: 'uinv_config', sectionCol: 'section', dataCol: 'config' },
  { dept: 'Procurement', table: 'proc_config', sectionCol: 'config_key', dataCol: 'config_value' },
  { dept: 'HR', table: 'hr_configuration', sectionCol: 'setting_name', dataCol: 'setting_value' },
];

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-config] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-config] ${tag}: ${e?.message || e}`);
    return [];
  }
}

function scoped(query: any, propertyId: string | null) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

// Registry tables (ops_config) treat NULL property_id as global — include them under any scope.
function scopedRegistry(query: any, propertyId: string | null) {
  return propertyId ? query.or(`property_id.is.null,property_id.eq.${propertyId}`) : query;
}

router.get('/configuration', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query.propertyId as string) || null;
  const cacheKey = `ops-config:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [levels, opsSections, globalRows, ...deptResults] = await Promise.all([
      fetchRows(scoped(supabaseAdmin!.from('fin_approval_levels')
        .select('id, name, level, spending_limit, approvers, requires_unanimous, description, status')
        .order('level', { ascending: true }), propertyId), 'approval_levels'),
      fetchRows(scopedRegistry(supabaseAdmin!.from('ops_config')
        .select('id, section, data, updated_by, updated_at'), propertyId), 'ops_config'),
      fetchRows(supabaseAdmin!.from('global_settings')
        .select(GLOBAL_FIELDS.join(',')).limit(1), 'global_settings'),
      ...DEPT_CONFIG_TABLES.map(d =>
        fetchRows(
          supabaseAdmin!.from(d.table)
            .select(`${d.sectionCol as string}, updated_at`)
            .limit(200),
          `dept ${d.table}`
        ).then(rows => ({
          dept: d.dept,
          table: d.table,
          sections: rows.map(r => r[d.sectionCol as string]).filter(Boolean),
          count: rows.length,
          lastUpdated: rows.map(r => r.updated_at).filter(Boolean).sort().pop() || null,
        }))
      ),
    ]);

    const payload = {
      approvalLevels: levels.map(l => ({
        id: l.id,
        name: l.name,
        level: l.level,
        spendingLimit: Number(l.spending_limit) || 0,
        approvers: l.approvers || [],
        requiresUnanimous: !!l.requires_unanimous,
        description: l.description,
        status: l.status,
      })),
      opsConfig: opsSections.map(s => ({
        id: s.id,
        section: s.section,
        data: s.data || {},
        updatedBy: s.updated_by,
        updatedAt: s.updated_at,
      })),
      globalSettings: globalRows[0] || {},
      deptConfigs: deptResults,
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (e: any) {
    console.error('[ops-config] GET failed:', e?.message || e);
    return res.status(500).json({ error: 'Failed to load configuration' });
  }
});

router.post('/configuration/approval-levels', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const row: Record<string, any> = {
      id: crypto.randomUUID(),
      name,
      level: Number(body.level) || 1,
      spending_limit: Number(body.spendingLimit) || 0,
      approvers: Array.isArray(body.approvers) ? body.approvers.map(String) : [],
      requires_unanimous: !!body.requiresUnanimous,
      description: body.description ? String(body.description) : null,
      status: body.status === 'inactive' ? 'inactive' : 'active',
      created_by: user?.name || user?.username || 'system',
    };
    if (body.propertyId) row.property_id = body.propertyId;
    const { data, error } = await supabaseAdmin!.from('fin_approval_levels').insert(row).select().single();
    if (error) throw error;
    return res.status(201).json({ ok: true, level: data });
  } catch (e: any) {
    console.error('[ops-config] create level failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to create approval level' });
  }
});

router.patch('/configuration/approval-levels/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.level !== undefined) patch.level = Number(body.level);
  if (body.spendingLimit !== undefined) patch.spending_limit = Number(body.spendingLimit);
  if (body.approvers !== undefined) patch.approvers = Array.isArray(body.approvers) ? body.approvers.map(String) : [];
  if (body.requiresUnanimous !== undefined) patch.requires_unanimous = !!body.requiresUnanimous;
  if (body.description !== undefined) patch.description = body.description ? String(body.description) : null;
  if (body.status !== undefined && ['active', 'inactive'].includes(body.status)) patch.status = body.status;
  try {
    const { data, error } = await supabaseAdmin!
      .from('fin_approval_levels').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Approval level not found' });
    return res.json({ ok: true, level: data });
  } catch (e: any) {
    console.error('[ops-config] update level failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to update approval level' });
  }
});

router.delete('/configuration/approval-levels/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  try {
    const { error } = await supabaseAdmin!.from('fin_approval_levels').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('[ops-config] delete level failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to delete approval level' });
  }
});

router.put('/configuration/section/:section', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const section = req.params.section;
  const propertyId = (req.body?.propertyId as string) || (req.query.propertyId as string) || null;
  const data = req.body?.data;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data (object) is required' });
  }
  try {
    const row: Record<string, any> = {
      id: `ops-cfg-${section}${propertyId ? '-' + propertyId.slice(0, 8) : ''}`,
      property_id: propertyId,
      section,
      data,
      updated_by: user?.name || user?.username || 'system',
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabaseAdmin!
      .from('ops_config')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return res.json({ ok: true, section: saved });
  } catch (e: any) {
    console.error('[ops-config] save section failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to save section' });
  }
});

router.patch('/configuration/global', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const user = (req as any).user;
  const body = req.body || {};
  const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: user?.name || user?.username || 'system' };
  for (const f of GLOBAL_FIELDS) {
    if (body[f] !== undefined) patch[f] = body[f];
  }
  if (Object.keys(patch).length === 2) {
    return res.status(400).json({ error: 'No valid global settings fields provided' });
  }
  try {
    // global_settings is a singleton — update the first row.
    const { data: existing } = await supabaseAdmin!.from('global_settings').select('id').limit(1).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'global_settings row not found' });
    const { data, error } = await supabaseAdmin!
      .from('global_settings').update(patch).eq('id', existing.id).select(GLOBAL_FIELDS.join(',')).single();
    if (error) throw error;
    return res.json({ ok: true, globalSettings: data });
  } catch (e: any) {
    console.error('[ops-config] global update failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Failed to update global settings' });
  }
});

export default router;
