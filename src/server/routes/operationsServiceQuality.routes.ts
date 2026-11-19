/**
 * Service Quality routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/service-quality tab (ServiceQualityManagement.tsx).
 * Pure cross-portal aggregation — no new tables needed:
 *
 *   GET  /service-quality?propertyId=&period=week|month|quarter
 *        Metrics computed live from:
 *          guest_feedback / guest_feedbacks / fb_guest_feedback /
 *            banquet_event_feedback / guest_requests.rating  → satisfaction
 *          room_inspections                                  → HK pass rate
 *          fb_quality_service_standards                      → F&B standards
 *          fb_compliance_audits                              → F&B audit score
 *          guest_requests (submitted→completed)              → FO response
 *          eng_inspections                                   → Engineering
 *          sec_compliance_audits + sec_safety_inspections    → Security
 *        Plus a normalized audit feed from fb_compliance_audits,
 *        sec_compliance_audits, sec_safety_inspections,
 *        eng_inspections and room_inspections.
 *        Trend = current period vs. the immediately preceding equal window.
 *
 *   POST /service-quality/audits — schedule a real Quality Standards audit in
 *        sec_compliance_audits (visible in the Security portal).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();
const CACHE_TTL_MS = 30 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-quality] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-quality] ${tag}: ${e?.message || e}`);
    return [];
  }
}

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90 };

const inWindow = (ts: any, from: Date, to: Date) => {
  if (!ts) return false;
  const d = new Date(String(ts).replace(' ', 'T'));
  return !isNaN(d.getTime()) && d >= from && d <= to;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

function trendOf(cur: number | null, prev: number | null): 'up' | 'down' | 'stable' {
  if (cur == null || prev == null) return 'stable';
  const diff = cur - prev;
  const tol = Math.max(0.05, Math.abs(prev) * 0.02);
  return diff > tol ? 'up' : diff < -tol ? 'down' : 'stable';
}

const findingsList = (raw: any): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'object') {
    return Object.entries(raw).filter(([, v]) => v && String(v).toLowerCase() !== 'pass')
      .map(([k, v]) => (v === true || v === 'Fail' ? k : `${k}: ${v}`));
  }
  return String(raw).split(/[.\n;]/).map((s) => s.trim()).filter(Boolean);
};

// GET /api/ops-portal/service-quality
router.get('/service-quality', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const period = String(req.query.period || 'month');
  const days = PERIOD_DAYS[period] || 30;

  const now = new Date();
  const curFrom = new Date(now.getTime() - days * 864e5);
  const prevFrom = new Date(curFrom.getTime() - days * 864e5);
  const fromStr = curFrom.toISOString().slice(0, 10);

  const eqProp = (q: any): any => (propertyId ? q.eq('property_id', propertyId) : q);
  const cacheKey = `ops-quality:${propertyId || 'all'}:${period}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [
      fbMain, fbLegacy, fbFood, fbBanquet, ratedRequests, allRequests,
      roomInsp, fbStandards, fbAudits, engInsp, secAudits, secSafety,
    ] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('guest_feedback').select('rating, submitted_at')), 'guest_feedback'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_feedbacks').select('rating, feedback_date')), 'guest_feedbacks'),
      fetchRows(eqProp(supabaseAdmin!.from('fb_guest_feedback').select('rating, date')), 'fb_guest_feedback'),
      fetchRows(eqProp(supabaseAdmin!.from('banquet_event_feedback').select('rating, created_at')), 'banquet_event_feedback'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_requests').select('rating, completed_at')), 'rated requests'),
      fetchRows(eqProp(supabaseAdmin!.from('guest_requests')
        .select('id, status, submitted_at, completed_at, created_at')), 'guest_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('room_inspections')
        .select('id, room_number, result, inspection_date, inspector, items')), 'room_inspections'),
      fetchRows(eqProp(supabaseAdmin!.from('fb_quality_service_standards')
        .select('id, standard, category, score, max_score, last_audited, auditor')), 'fb_standards'),
      fetchRows(eqProp(supabaseAdmin!.from('fb_compliance_audits')
        .select('id, title, type, status, score, max_score, auditor, audit_date, findings')), 'fb_audits'),
      fetchRows(eqProp(supabaseAdmin!.from('eng_inspections')
        .select('id, ins_number, type, category, location, status, scheduled_date, completed_at, inspector, findings')), 'eng_inspections'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_compliance_audits')
        .select('id, title, audit_type, auditor, status, result, findings, scheduled_at, completed_at')), 'sec_audits'),
      fetchRows(eqProp(supabaseAdmin!.from('sec_safety_inspections')
        .select('id, title, inspection_type, area, inspector, status, result, findings, scheduled_at, completed_at')), 'sec_safety'),
    ]);

    // ── Satisfaction (all feedback + request ratings) ────────────────────
    const satRows = [
      ...fbMain.map((r) => ({ rating: r.rating, at: r.submitted_at })),
      ...fbLegacy.map((r) => ({ rating: r.rating, at: r.feedback_date })),
      ...fbFood.map((r) => ({ rating: r.rating, at: r.date })),
      ...fbBanquet.map((r) => ({ rating: r.rating, at: r.created_at })),
      ...ratedRequests.map((r) => ({ rating: r.rating, at: r.completed_at })),
    ].filter((r) => typeof r.rating === 'number');
    const satCur = avg(satRows.filter((r) => inWindow(r.at, curFrom, now)).map((r) => r.rating));
    const satPrev = avg(satRows.filter((r) => inWindow(r.at, prevFrom, curFrom)).map((r) => r.rating));

    // ── Room inspection pass rate ────────────────────────────────────────
    const inspCur = roomInsp.filter((r) => inWindow(r.inspection_date, curFrom, now) && r.result !== 'Pending');
    const inspPrev = roomInsp.filter((r) => inWindow(r.inspection_date, prevFrom, curFrom) && r.result !== 'Pending');
    const passRate = (rows: any[]) =>
      rows.length ? (rows.filter((r) => r.result === 'Pass').length / rows.length) * 100 : null;
    const inspCurRate = passRate(inspCur);
    const inspPrevRate = passRate(inspPrev);

    // ── F&B standards (score/max_score) ──────────────────────────────────
    const stdScores = fbStandards
      .filter((s) => s.score != null && s.max_score)
      .map((s) => (s.score / s.max_score) * 100);
    const stdAvg = avg(stdScores);

    // ── F&B audit score ──────────────────────────────────────────────────
    const fbAuditScores = fbAudits
      .filter((a) => a.score != null && a.max_score)
      .map((a) => (a.score / a.max_score) * 100);
    const fbAuditAvg = avg(fbAuditScores);

    // ── Concierge response (submitted → completed hours) + completion ────
    const respRows = allRequests.filter((r) => r.completed_at && r.submitted_at);
    const respHours = (rows: any[]) =>
      avg(rows.map((r) => (new Date(r.completed_at).getTime() - new Date(r.submitted_at).getTime()) / 36e5)
        .filter((h) => h >= 0));
    const respCur = respHours(respRows.filter((r) => inWindow(r.completed_at, curFrom, now)));
    const respPrev = respHours(respRows.filter((r) => inWindow(r.completed_at, prevFrom, curFrom)));

    const reqCur = allRequests.filter((r) => inWindow(r.created_at || r.submitted_at, curFrom, now));
    const reqPrev = allRequests.filter((r) => inWindow(r.created_at || r.submitted_at, prevFrom, curFrom));
    const done = new Set(['Completed', 'completed', 'Done', 'Resolved', 'resolved']);
    const compRate = (rows: any[]) =>
      rows.length ? (rows.filter((r) => done.has(r.status)).length / rows.length) * 100 : null;

    // ── Engineering inspections ──────────────────────────────────────────
    const engCur = engInsp.filter((r) => inWindow(r.scheduled_date || r.completed_at, curFrom, now));
    const engRate = engCur.length
      ? (engCur.filter((r) => String(r.status).toLowerCase() === 'completed').length / engCur.length) * 100
      : null;

    // ── Security audits + safety inspections ─────────────────────────────
    const secAll = [
      ...secAudits.map((a) => ({ result: a.result, at: a.completed_at || a.scheduled_at })),
      ...secSafety.map((s) => ({ result: s.result, at: s.completed_at || s.scheduled_at })),
    ];
    const secCur = secAll.filter((r) => r.result && inWindow(r.at, prevFrom, now));
    const secRate = secCur.length
      ? (secCur.filter((r) => String(r.result).toLowerCase().startsWith('pass')).length / secCur.length) * 100
      : null;

    const metrics = [
      {
        id: 'guest-satisfaction', name: 'Guest Satisfaction', category: 'Guest Experience',
        unit: 'rating', currentScore: satCur != null ? round1(satCur) : null, targetScore: 4.5,
        trend: trendOf(satCur, satPrev), sampleSize: satRows.filter((r) => inWindow(r.at, curFrom, now)).length,
      },
      {
        id: 'room-cleanliness', name: 'Room Inspection Pass Rate', category: 'Housekeeping',
        unit: 'percent', currentScore: inspCurRate != null ? round1(inspCurRate) : null, targetScore: 95,
        trend: trendOf(inspCurRate, inspPrevRate), sampleSize: inspCur.length,
      },
      {
        id: 'fb-standards', name: 'F&B Service Standards', category: 'Food & Beverage',
        unit: 'percent', currentScore: stdAvg != null ? round1(stdAvg) : null, targetScore: 90,
        trend: 'stable' as const, sampleSize: stdScores.length,
      },
      {
        id: 'fb-audit-score', name: 'F&B Compliance Audits', category: 'Food & Beverage',
        unit: 'percent', currentScore: fbAuditAvg != null ? round1(fbAuditAvg) : null, targetScore: 90,
        trend: 'stable' as const, sampleSize: fbAuditScores.length,
      },
      {
        id: 'response-time', name: 'Concierge Response Time', category: 'Front Office',
        unit: 'hours', lowerIsBetter: true, currentScore: respCur != null ? round1(respCur) : null, targetScore: 4,
        trend: respCur != null && respPrev != null
          ? (respCur < respPrev ? 'up' as const : respCur > respPrev ? 'down' as const : 'stable' as const)
          : 'stable' as const,
        sampleSize: respRows.filter((r) => inWindow(r.completed_at, curFrom, now)).length,
      },
      {
        id: 'request-completion', name: 'Request Completion Rate', category: 'Front Office',
        unit: 'percent', currentScore: compRate(reqCur) != null ? round1(compRate(reqCur)!) : null, targetScore: 95,
        trend: trendOf(compRate(reqCur), compRate(reqPrev)), sampleSize: reqCur.length,
      },
      {
        id: 'eng-inspections', name: 'Engineering Inspections', category: 'Engineering',
        unit: 'percent', currentScore: engRate != null ? round1(engRate) : null, targetScore: 90,
        trend: 'stable' as const, sampleSize: engCur.length,
      },
      {
        id: 'safety-compliance', name: 'Safety & Compliance Pass Rate', category: 'Security',
        unit: 'percent', currentScore: secRate != null ? round1(secRate) : null, targetScore: 95,
        trend: 'stable' as const, sampleSize: secCur.length,
      },
    ];

    // ── Audit feed ───────────────────────────────────────────────────────
    const audits: any[] = [];
    for (const a of fbAudits) {
      audits.push({
        id: `fb-${a.id}`, department: 'F&B', auditType: a.type || 'Compliance',
        score: a.score != null && a.max_score ? round1((a.score / a.max_score) * 100) : null,
        status: a.status, date: a.audit_date, auditor: a.auditor,
        findings: findingsList(a.findings), title: a.title,
      });
    }
    for (const a of secAudits) {
      audits.push({
        id: `sec-${a.id}`, department: 'Security', auditType: a.audit_type || 'Compliance',
        score: a.result === 'Pass' ? 100 : a.result === 'Pass with Findings' ? 85 : a.result === 'Fail' ? 40 : null,
        status: a.status, date: a.completed_at || a.scheduled_at, auditor: a.auditor,
        findings: findingsList(a.findings), title: a.title,
      });
    }
    for (const s of secSafety) {
      audits.push({
        id: `safe-${s.id}`, department: 'Security', auditType: s.inspection_type || 'Safety Inspection',
        score: s.result === 'Pass' ? 100 : s.result === 'Pass with Notes' ? 90 : s.result === 'Fail' ? 40 : null,
        status: s.status, date: s.completed_at || s.scheduled_at, auditor: s.inspector,
        findings: findingsList(s.findings), title: s.title, location: s.area,
      });
    }
    for (const e of engInsp) {
      audits.push({
        id: `eng-${e.id}`, department: 'Engineering', auditType: e.type || e.category || 'Inspection',
        score: String(e.status).toLowerCase() === 'completed' ? 100 : null,
        status: e.status, date: e.completed_at || e.scheduled_date, auditor: e.inspector,
        findings: findingsList(e.findings), title: e.ins_number || e.description || 'Engineering inspection',
        location: e.location,
      });
    }
    for (const r of roomInsp.slice(0, 15)) {
      const items = r.items && typeof r.items === 'object' ? Object.entries(r.items) : [];
      const fails = items.filter(([, v]) => String(v) === 'Fail').map(([k]) => k);
      const score = items.length ? round1(((items.length - fails.length) / items.length) * 100) : (r.result === 'Pass' ? 100 : r.result === 'Fail' ? 0 : null);
      audits.push({
        id: `hk-${r.id}`, department: 'Housekeeping', auditType: 'Room Inspection',
        score, status: r.result, date: r.inspection_date, auditor: r.inspector,
        findings: fails.length ? fails.map((f) => `Failed: ${f}`) : r.result === 'Pass' ? ['All items passed'] : [],
        title: `Room ${r.room_number} inspection`, location: `Room ${r.room_number}`,
      });
    }
    audits.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const payload = {
      generatedAt: new Date().toISOString(),
      period, days,
      metrics,
      audits,
      stats: {
        metricsOnTarget: metrics.filter((m) =>
          m.currentScore != null && (m.lowerIsBetter ? m.currentScore <= m.targetScore : m.currentScore >= m.targetScore)).length,
        auditsCompleted: audits.filter((a) => a.score != null).length,
        avgSatisfaction: satCur != null ? round1(satCur) : null,
        feedbackCount: satRows.filter((r) => inWindow(r.at, curFrom, now)).length,
      },
    };
    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load service quality' });
  }
});

// POST /api/ops-portal/service-quality/audits — schedule a Quality Standards
// audit in sec_compliance_audits (visible in the Security portal).
router.post('/service-quality/audits', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' });

  const { data, error } = await supabaseAdmin.from('sec_compliance_audits').insert({
    id: `QA-${Date.now()}`,
    property_id: b.propertyId || null,
    title: b.title.trim(),
    // audit_type CHECK only allows External/Internal/Regulatory/Insurance.
    audit_type: 'Internal',
    auditor: req.user?.name || 'Quality Manager',
    scope: `Quality Standards — ${b.scope || b.department || 'Operations'}`,
    status: 'Scheduled',
    scheduled_at: b.date || new Date().toISOString(),
    created_by: req.user?.name || 'manager',
    created_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('ops-quality:*');
  return res.status(201).json({ ok: true, audit: data });
});

export default router;
