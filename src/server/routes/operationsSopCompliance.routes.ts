/**
 * SOP & Compliance Monitoring routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/sop-compliance tab (SOPComplianceMonitoring.tsx).
 * No new tables — aggregates the per-portal compliance registers into one
 * normalized board and writes updates back to the originating table:
 *
 *   GET   /sop-compliance?propertyId=
 *         sec_compliance_items (Security), eng_compliance_items
 *         (Engineering), risk_compliance (Risk), fb_service_standards (F&B),
 *         fin_compliance_issues (Finance open issues), plus an audit-activity
 *         feed from sec_compliance_audits + fb_compliance_audits.
 *   PATCH /sop-compliance/:source/:id    — set normalized compliance status
 *         (mapped back to each table's own vocabulary) + stamps last_audit.
 *   POST  /sop-compliance/audit          — record an audit result in
 *         sec_compliance_audits and mark the item's last_audit.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

type NormStatus = 'compliant' | 'non-compliant' | 'pending-audit';

// Normalized status → each source table's own vocabulary.
const SOURCE_STATUS_MAP: Record<string, Record<NormStatus, string>> = {
  security: { 'compliant': 'Compliant', 'non-compliant': 'Non-Compliant', 'pending-audit': 'Pending' },
  engineering: { 'compliant': 'Valid', 'non-compliant': 'Overdue', 'pending-audit': 'Scheduled' },
  risk: { 'compliant': 'Good', 'non-compliant': 'Critical', 'pending-audit': 'Warning' },
  'f&b': { 'compliant': 'Meeting', 'non-compliant': 'Below', 'pending-audit': 'Meeting' },
};

const SOURCE_TABLE: Record<string, { table: string; dateCol: string }> = {
  security: { table: 'sec_compliance_items', dateCol: 'last_audit' },
  engineering: { table: 'eng_compliance_items', dateCol: 'last_inspected_date' },
  risk: { table: 'risk_compliance', dateCol: 'updated_at' },
};

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-sop] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-sop] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const secStatus = (s: string): NormStatus =>
  s === 'Compliant' ? 'compliant' : s === 'Non-Compliant' || s === 'Expired' ? 'non-compliant' : 'pending-audit';
const engStatus = (s: string): NormStatus =>
  s === 'Valid' ? 'compliant' : s === 'Overdue' ? 'non-compliant' : 'pending-audit';
const riskStatus = (s: string): NormStatus =>
  s === 'Good' ? 'compliant' : s === 'Warning' ? 'pending-audit' : 'non-compliant';
const fbStatus = (s: string): NormStatus =>
  s === 'Below' ? 'non-compliant' : s === 'Meeting' || s === 'Exceeded' ? 'compliant' : 'pending-audit';

// GET /api/ops-portal/sop-compliance
router.get('/sop-compliance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);

  const cacheKey = `ops-sop:${propertyId || 'all'}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [sec, eng, risk, fbStd, finIssues, secAudits, fbAudits] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('sec_compliance_items')
        .select('id, title, category, authority, status, expiry_date, last_audit, responsible, notes')), 'sec_items'),
      fetchRows(eqProp(supabaseAdmin!.from('eng_compliance_items')
        .select('id, comp_number, title, category, type, authority, status, result, expiry_date, last_inspected_date, next_inspection_date, responsible_person, notes')), 'eng_items'),
      fetchRows(eqProp(supabaseAdmin!.from('risk_compliance')
        .select('id, title, category, status, expiry_date, owner, description')), 'risk_items'),
      // fb_service_standards has no property_id — scope comes via outlet_id.
      fetchRows(supabaseAdmin!.from('fb_service_standards')
        .select('id, name, target_value, actual_value, unit, status, measured_at'), 'fb_standards'),
      fetchRows(eqProp(supabaseAdmin!.from('fin_compliance_issues')
        .select('id, issue_number, type, severity, title, description, status, assigned_to, created_at')
        .not('status', 'in', '("Resolved","Closed")')), 'fin_issues'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_compliance_audits')
        .select('id, title, audit_type, auditor, scope, status, result, findings, scheduled_at, completed_at')
        .order('scheduled_at', { ascending: false }).limit(25)), 'sec_audits'),
      fetchRows(eqProp(supabaseAdmin!.from('fb_compliance_audits')
        .select('id, title, type, status, score, max_score, auditor, audit_date, findings')
        .order('audit_date', { ascending: false }).limit(25)), 'fb_audits'),
    ]);

    const items: any[] = [];

    for (const i of sec) {
      const expired = i.expiry_date && new Date(i.expiry_date).getTime() < Date.now();
      items.push({
        id: i.id, source: 'security', department: 'Security', category: i.category || 'safety',
        name: i.title, status: expired ? 'non-compliant' : secStatus(i.status),
        lastAudit: i.last_audit, nextAudit: i.expiry_date,
        findings: [i.authority && `Authority: ${i.authority}`, i.responsible && `Owner: ${i.responsible}`, i.notes].filter(Boolean),
      });
    }
    for (const i of eng) {
      const expired = i.expiry_date && new Date(i.expiry_date).getTime() < Date.now();
      const pct = typeof i.result === 'string' && i.result.endsWith('%') ? parseInt(i.result, 10) : undefined;
      items.push({
        id: i.id, source: 'engineering', department: 'Engineering', category: i.category || i.type || 'operational',
        name: i.title, status: expired ? 'non-compliant' : engStatus(i.status),
        score: Number.isFinite(pct) ? pct : undefined,
        lastAudit: i.last_inspected_date, nextAudit: i.next_inspection_date || i.expiry_date,
        findings: [i.result && `Result: ${i.result}`, i.authority && `Authority: ${i.authority}`, i.responsible_person && `Owner: ${i.responsible_person}`, i.notes].filter(Boolean),
      });
    }
    for (const i of risk) {
      items.push({
        id: i.id, source: 'risk', department: 'Risk & Compliance', category: i.category || 'operational',
        name: i.title, status: riskStatus(i.status),
        lastAudit: undefined, nextAudit: i.expiry_date,
        findings: [i.owner && `Owner: ${i.owner}`, i.description].filter(Boolean),
      });
    }
    for (const i of fbStd) {
      items.push({
        id: i.id, source: 'f&b', department: 'F&B', category: 'brand-standards',
        name: i.name, status: fbStatus(i.status),
        lastAudit: i.measured_at,
        findings: [`Target: ${i.target_value ?? '—'} ${i.unit || ''}`, `Actual: ${i.actual_value ?? '—'} ${i.unit || ''}`],
      });
    }
    for (const i of finIssues) {
      items.push({
        id: i.id, source: 'finance', department: 'Finance', category: 'operational',
        name: i.title || i.issue_number, status: 'non-compliant' as NormStatus,
        lastAudit: i.created_at,
        findings: [i.severity && `Severity: ${i.severity}`, i.assigned_to && `Assigned: ${i.assigned_to}`, i.description].filter(Boolean),
      });
    }

    const audits = [
      ...secAudits.map((a) => ({
        id: a.id, source: 'security', title: a.title, auditor: a.auditor, scope: a.scope,
        status: a.status, result: a.result, findings: a.findings,
        at: a.completed_at || a.scheduled_at, score: undefined as number | undefined,
      })),
      ...fbAudits.map((a) => ({
        id: a.id, source: 'f&b', title: a.title, auditor: a.auditor, scope: a.type,
        status: a.status, result: undefined as string | undefined, findings: a.findings,
        at: a.audit_date, score: a.max_score ? Math.round((a.score / a.max_score) * 100) : undefined,
      })),
    ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

    const norm = items.map((i) => i.status);
    const payload = {
      generatedAt: new Date().toISOString(),
      items,
      audits,
      stats: {
        total: items.length,
        compliant: norm.filter((s) => s === 'compliant').length,
        nonCompliant: norm.filter((s) => s === 'non-compliant').length,
        pendingAudit: norm.filter((s) => s === 'pending-audit').length,
        score: items.length ? Math.round((norm.filter((s) => s === 'compliant').length / items.length) * 100) : 0,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load compliance data' });
  }
});

// PATCH /api/ops-portal/sop-compliance/:source/:id — write status back to the
// originating portal table (mapped to its own vocabulary) + stamp last audit.
router.patch('/sop-compliance/:source/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { source, id } = req.params;
  const status = req.body?.status as NormStatus | undefined;
  if (!status || !['compliant', 'non-compliant', 'pending-audit'].includes(status)) {
    return res.status(400).json({ error: 'status must be compliant | non-compliant | pending-audit' });
  }
  const meta = SOURCE_TABLE[source];
  const mapped = SOURCE_STATUS_MAP[source]?.[status];
  if (!meta || !mapped) {
    return res.status(400).json({ error: `source ${source} is not writable (supported: ${Object.keys(SOURCE_TABLE).join(', ')})` });
  }

  const { data, error } = await supabaseAdmin.from(meta.table).update({
    status: mapped,
    [meta.dateCol]: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-sop:*');
  return res.json({ ok: true, item: data, mappedStatus: mapped });
});

// POST /api/ops-portal/sop-compliance/audit — record an audit result in
// sec_compliance_audits (visible in the Security portal) and, when linked to
// a compliance item, stamp its last_audit.
router.post('/sop-compliance/audit', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, title, scope, result, findings, source, itemId } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const { data, error } = await supabaseAdmin.from('sec_compliance_audits').insert({
    id: `AUD-OPS-${Date.now()}`,
    property_id: propertyId || null,
    title: title.trim(),
    audit_type: 'Internal',
    auditor: req.user?.name || null,
    scope: scope || null,
    status: 'Completed',
    result: result || null,
    findings: findings || null,
    scheduled_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    created_by: req.user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Stamp the audited item's last-audit date when linked.
  const meta = SOURCE_TABLE[source];
  if (meta && itemId) {
    await supabaseAdmin.from(meta.table).update({
      [meta.dateCol]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', itemId);
  }

  cacheService.invalidate('ops-sop:*');
  cacheService.invalidate('sec-*');
  return res.status(201).json({ ok: true, audit: data });
});

export default router;
