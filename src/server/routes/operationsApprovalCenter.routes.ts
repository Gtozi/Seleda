/**
 * Operations Approval Center routes — mounted at /api/ops-portal.
 *
 * Backs the /erp/operations/approvals tab (ManagerApprovalCenter.tsx).
 *
 *   GET  /approvals?propertyId=
 *        Aggregates pending/decided approval requests from the *real*
 *        department tables — fin_approval_requests (multi-level finance
 *        workflow), fin_journal_approvals, hr_approval_requests,
 *        hr_manager_approvals, hr_overtime_requests,
 *        uinv_approval_requests — plus ops-native requests from
 *        ops_approval_requests (migration 632, seeded with the former
 *        mock items). Normalized into one shape and sorted by urgency.
 *
 *   POST /approvals/:source/:id/decide   { decision, notes? }
 *        decision: 'approve' | 'reject' | 'escalate'.
 *        Writes the decision back to the *source* table so the
 *        originating portal sees its request resolved. Escalate is only
 *        supported where the source model allows it: fin_approval_requests
 *        (advances current_level) and ops_approval_requests
 *        (status='escalated'); other sources report canEscalate=false.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

const CACHE_TTL_MS = 15 * 1000;

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

async function fetchRows(query: any, tag: string): Promise<any[]> {
  try {
    const r = await query;
    if (r.error) {
      console.warn(`[ops-approvals] ${tag}: ${r.error.message}`);
      return [];
    }
    return (r.data as any[]) || [];
  } catch (e: any) {
    console.warn(`[ops-approvals] ${tag}: ${e?.message || e}`);
    return [];
  }
}

// ── Normalization ────────────────────────────────────────────────────────

type Urgency = 'low' | 'medium' | 'high' | 'critical';
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

const URGENCY_RANK: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<ApprovalStatus, number> = { pending: 0, escalated: 1, approved: 2, rejected: 3 };

const normStatus = (s: any): ApprovalStatus => {
  const v = String(s || 'pending').toLowerCase();
  return (['pending', 'approved', 'rejected', 'escalated'] as const).includes(v as ApprovalStatus)
    ? (v as ApprovalStatus)
    : 'pending';
};

const amountUrgency = (amount: number): Urgency =>
  amount >= 100000 ? 'critical' : amount >= 50000 ? 'high' : amount >= 10000 ? 'medium' : 'low';

const normPriority = (p: any): Urgency => {
  const v = String(p || '').toLowerCase();
  if (v === 'urgent' || v === 'critical' || v === 'emergency') return 'critical';
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
};

interface ApprovalRequest {
  id: string;
  source: string;
  sourceId: string;
  type: string;
  category: string;
  department: string;
  title: string;
  description: string;
  amount: number | null;
  requestedBy: string;
  requestedAt: string;
  urgency: Urgency;
  status: ApprovalStatus;
  details: Record<string, any>;
  canEscalate: boolean;
}

function normalize(src: {
  fin: any[]; journals: any[]; hr: any[]; hrm: any[]; ot: any[]; uinv: any[]; ops: any[];
}): ApprovalRequest[] {
  const out: ApprovalRequest[] = [];

  for (const r of src.fin) {
    out.push({
      id: `fin-${r.id}`, source: 'fin', sourceId: r.id,
      type: r.type || 'Approval', category: 'Finance', department: 'Finance',
      title: r.title || r.request_number || 'Finance approval',
      description: r.description || '',
      amount: r.amount != null ? Number(r.amount) : null,
      requestedBy: r.requested_by_name || r.requested_by || '—',
      requestedAt: r.created_at,
      urgency: amountUrgency(Number(r.amount) || 0),
      status: normStatus(r.status),
      details: {
        requestNumber: r.request_number,
        approvalLevel: `${r.current_level}/${r.total_levels}`,
        requestType: r.type,
      },
      canEscalate: normStatus(r.status) === 'pending' &&
        Number(r.current_level) < Number(r.total_levels),
    });
  }

  for (const r of src.journals) {
    out.push({
      id: `fj-${r.id}`, source: 'fj', sourceId: r.id,
      type: 'Journal Entry', category: 'Finance', department: 'Finance',
      title: `Journal ${r.journal_number || r.id}`,
      description: r.description || '',
      amount: r.amount != null ? Number(r.amount) : null,
      requestedBy: r.submitted_by || '—',
      requestedAt: r.submitted_at || r.created_at,
      urgency: amountUrgency(Number(r.amount) || 0),
      status: normStatus(r.status),
      details: { journalNumber: r.journal_number, period: r.period },
      canEscalate: false,
    });
  }

  for (const r of src.hr) {
    out.push({
      id: `hr-${r.id}`, source: 'hr', sourceId: r.id,
      type: r.request_type || 'HR Request', category: 'Human Resources', department: 'HR',
      title: `${r.request_type || 'Request'} — ${r.employee || 'employee'}`,
      description: r.details || '',
      amount: null,
      requestedBy: r.employee || '—',
      requestedAt: r.submitted_date || r.created_at,
      urgency: normPriority(r.priority),
      status: normStatus(r.request_status),
      details: {
        employee: r.employee,
        employeeDepartment: r.department,
        workflowStage: r.workflow_stage,
        currentApprover: r.current_approver,
      },
      canEscalate: false,
    });
  }

  for (const r of src.hrm) {
    out.push({
      id: `hrm-${r.id}`, source: 'hrm', sourceId: r.id,
      type: r.type || 'HR Request', category: 'Human Resources', department: 'HR',
      title: `${r.type || 'Request'} — ${r.employee_name || 'employee'}`,
      description: r.details || '',
      amount: null,
      requestedBy: r.employee_name || '—',
      requestedAt: r.request_date || r.created_at,
      urgency: normPriority(r.priority),
      status: normStatus(r.status),
      details: { employeeId: r.employee_id },
      canEscalate: false,
    });
  }

  for (const r of src.ot) {
    out.push({
      id: `ot-${r.id}`, source: 'ot', sourceId: r.id,
      type: 'Overtime', category: 'Human Resources', department: 'HR',
      title: `Overtime — ${r.employee_name || 'employee'}`,
      description: `${r.type || 'Overtime'}: ${r.hours || '?'}h on ${r.overtime_date || '?'}` +
        (r.reason ? ` — ${r.reason}` : ''),
      amount: null,
      requestedBy: r.employee_name || '—',
      requestedAt: r.overtime_date || r.created_at,
      urgency: 'medium',
      status: normStatus(r.status),
      details: {
        employeeDepartment: r.department,
        hours: r.hours,
        rate: r.rate,
        window: r.start_time && r.end_time ? `${r.start_time}–${r.end_time}` : undefined,
      },
      canEscalate: false,
    });
  }

  for (const r of src.uinv) {
    out.push({
      id: `uinv-${r.id}`, source: 'uinv', sourceId: r.id,
      type: r.approval_type || 'Inventory Approval', category: 'Procurement', department: 'Procurement',
      title: `${r.approval_type || 'Approval'} — ${r.request_number || r.id}`,
      description: r.reason || '',
      amount: r.value != null ? Number(r.value) : null,
      requestedBy: r.requester || '—',
      requestedAt: r.created_at,
      urgency: amountUrgency(Number(r.value) || 0),
      status: normStatus(r.status),
      details: {
        requestNumber: r.request_number,
        entityType: r.entity_type,
        entityId: r.entity_id,
        quantity: r.quantity,
        requesterDepartment: r.requester_department,
      },
      canEscalate: false,
    });
  }

  for (const r of src.ops) {
    out.push({
      id: `ops-${r.id}`, source: 'ops', sourceId: r.id,
      type: r.type, category: r.category, department: r.department,
      title: r.title,
      description: r.description || '',
      amount: r.amount != null ? Number(r.amount) : null,
      requestedBy: r.requested_by || '—',
      requestedAt: r.created_at,
      urgency: (r.urgency as Urgency) || 'medium',
      status: normStatus(r.status),
      details: (r.details as Record<string, any>) || {},
      canEscalate: normStatus(r.status) === 'pending',
    });
  }

  return out.sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    String(b.requestedAt).localeCompare(String(a.requestedAt)));
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /api/ops-portal/approvals — aggregated inbox.
router.get('/approvals', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const propertyId = (req.query as Record<string, string>).propertyId || undefined;
  const cacheKey = `ops-approvals:${propertyId || 'all'}`;

  const cached = cacheService.get<any>(cacheKey);
  if (cached) return res.json(cached);

  const eqProp = (q: any): any => propertyId ? q.eq('property_id', propertyId) : q;

  try {
    const [fin, journals, hr, hrm, ot, uinv, ops] = await Promise.all([
      fetchRows(eqProp(supabaseAdmin!.from('fin_approval_requests')
        .select('id, request_number, type, title, description, amount, requested_by, requested_by_name, current_level, total_levels, status, created_at')), 'fin_approval_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('fin_journal_approvals')
        .select('id, journal_number, description, amount, submitted_by, submitted_at, status, period')), 'fin_journal_approvals'),
      fetchRows(eqProp(supabaseAdmin!.from('hr_approval_requests')
        .select('id, request_type, category, employee, department, details, submitted_date, priority, current_approver, workflow_stage, request_status, created_at')), 'hr_approval_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('hr_manager_approvals')
        .select('id, employee_id, employee_name, type, details, request_date, priority, status, created_at')), 'hr_manager_approvals'),
      fetchRows(eqProp(supabaseAdmin!.from('hr_overtime_requests')
        .select('id, employee_name, department, type, overtime_date, start_time, end_time, hours, rate, reason, status, created_at')), 'hr_overtime_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('uinv_approval_requests')
        .select('id, request_number, approval_type, entity_type, entity_id, requester, requester_department, value, quantity, reason, status, created_at')), 'uinv_approval_requests'),
      fetchRows(eqProp(supabaseAdmin!.from('ops_approval_requests')
        .select('*')), 'ops_approval_requests'),
    ]);

    const requests = normalize({ fin, journals, hr, hrm, ot, uinv, ops });
    const pending = requests.filter(r => r.status === 'pending' || r.status === 'escalated');

    const payload = {
      generatedAt: new Date().toISOString(),
      requests,
      stats: {
        pending: pending.length,
        critical: pending.filter(r => r.urgency === 'critical').length,
        total: requests.length,
      },
    };

    cacheService.set(cacheKey, payload, CACHE_TTL_MS);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load approvals' });
  }
});

// POST /api/ops-portal/approvals/:source/:id/decide — write the decision
// back to the source table.
router.post('/approvals/:source/:id/decide', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { source, id } = req.params;
  const decision = String(req.body?.decision || '').toLowerCase();
  const notes = req.body?.notes || null;
  const user = req.user?.name || req.user?.id || 'manager';
  const now = new Date().toISOString();

  if (!['approve', 'reject', 'escalate'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approve', 'reject' or 'escalate'" });
  }

  try {
    let error: any = null;

    if (source === 'fin') {
      if (decision === 'escalate') {
        const { data: row } = await supabaseAdmin
          .from('fin_approval_requests').select('current_level, total_levels, status').eq('id', id).maybeSingle();
        if (!row) return res.status(404).json({ error: 'Request not found' });
        if (Number(row.current_level) >= Number(row.total_levels)) {
          return res.status(400).json({ error: 'Already at final approval level' });
        }
        ({ error } = await supabaseAdmin.from('fin_approval_requests')
          .update({ current_level: Number(row.current_level) + 1 })
          .eq('id', id));
      } else {
        ({ error } = await supabaseAdmin.from('fin_approval_requests')
          .update(decision === 'approve'
            ? { status: 'approved', approved_by: user, approved_at: now, notes }
            : { status: 'rejected', rejected_by: user, rejected_at: now, rejection_reason: notes })
          .eq('id', id));
      }
    } else if (source === 'fj') {
      if (decision === 'escalate') return res.status(400).json({ error: 'Escalation not supported for journal approvals' });
      ({ error } = await supabaseAdmin.from('fin_journal_approvals')
        .update(decision === 'approve'
          ? { status: 'Approved', approved_by: user, approved_at: now }
          : { status: 'Rejected', rejected_by: user, rejected_at: now, rejection_reason: notes })
        .eq('id', id));
    } else if (source === 'hr') {
      if (decision === 'escalate') return res.status(400).json({ error: 'Escalation not supported for HR requests' });
      ({ error } = await supabaseAdmin.from('hr_approval_requests')
        .update(decision === 'approve'
          ? { request_status: 'Approved', approved_date: now, approved_by: user, comments: notes }
          : { request_status: 'Rejected', rejected_date: now, rejected_by: user, reason: notes })
        .eq('id', id));
    } else if (source === 'hrm') {
      if (decision === 'escalate') return res.status(400).json({ error: 'Escalation not supported for manager approvals' });
      ({ error } = await supabaseAdmin.from('hr_manager_approvals')
        .update({ status: decision === 'approve' ? 'Approved' : 'Rejected' })
        .eq('id', id));
    } else if (source === 'ot') {
      if (decision === 'escalate') return res.status(400).json({ error: 'Escalation not supported for overtime requests' });
      ({ error } = await supabaseAdmin.from('hr_overtime_requests')
        .update({ status: decision === 'approve' ? 'Approved' : 'Rejected', reviewed_by: user, reviewed_at: now })
        .eq('id', id));
    } else if (source === 'uinv') {
      if (decision === 'escalate') return res.status(400).json({ error: 'Escalation not supported for inventory approvals' });
      ({ error } = await supabaseAdmin.from('uinv_approval_requests')
        .update({
          status: decision === 'approve' ? 'Approved' : 'Rejected',
          approver: user,
          approved_at: now,
          decision_notes: notes,
        })
        .eq('id', id));
    } else if (source === 'ops') {
      ({ error } = await supabaseAdmin.from('ops_approval_requests')
        .update({
          status: decision === 'escalate' ? 'escalated' : decision === 'approve' ? 'approved' : 'rejected',
          decided_by: user,
          decided_at: now,
          decision_notes: notes,
        })
        .eq('id', id));
    } else {
      return res.status(400).json({ error: `Unknown approval source '${source}'` });
    }

    if (error) return res.status(500).json({ error: error.message });

    cacheService.invalidate('ops-approvals:*');
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to record decision' });
  }
});

export default router;
