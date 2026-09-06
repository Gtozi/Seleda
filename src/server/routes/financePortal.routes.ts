/**
 * Finance Portal — General Ledger routes.
 *
 * Backs the /erp/finance/gl tab. Mounted at /api/fin-portal.
 *
 * Endpoints (all require `authenticate`):
 *   Journals (reads from the shared journal_entries table; line breakdown comes
 *   from the `lines` JSONB column, not the journal_lines join, so it works even
 *   when chart_of_accounts is empty):
 *     GET  /journals
 *     POST /journals
 *     PATCH /journals/:id          (status transition)
 *     POST /journals/:id/post
 *     POST /journals/:id/reverse
 *     DELETE /journals/:id
 *
 *   Chart of Accounts (read-only here; writes live in finance.routes.ts):
 *     GET /chart-of-accounts
 *
 *   Trial Balance (derived from usali_chart_of_accounts balances):
 *     GET /trial-balance
 *
 *   Recurring templates:
 *     GET /recurring
 *     POST /recurring
 *     PATCH /recurring/:id
 *     DELETE /recurring/:id
 *     POST /recurring/:id/run
 *
 *   Invoices (AP/AR):
 *     GET /invoices
 *     POST /invoices
 *     PATCH /invoices/:id
 *     DELETE /invoices/:id
 *
 *   Accounting periods (shared accounting_periods table):
 *     GET /periods
 *     PATCH /periods/:id          (close / reopen)
 *
 *   Reversing entries:
 *     GET /reversing
 *     POST /reversing
 *     PATCH /reversing/:id
 *     DELETE /reversing/:id
 *
 *   Adjusting entries:
 *     GET /adjusting
 *     POST /adjusting
 *     PATCH /adjusting/:id
 *     DELETE /adjusting/:id
 *
 *   Closing entries:
 *     GET /closing
 *     POST /closing
 *     PATCH /closing/:id
 *     DELETE /closing/:id
 *
 *   Audit trail:
 *     GET /audit-trail
 *
 *   Inventory Accounting (backs /erp/finance/inventory):
 *     GET    /inventory-valuation           POST  /inventory-valuation
 *     PATCH  /inventory-valuation/:id       DELETE /inventory-valuation/:id
 *     GET    /cogs                          POST  /cogs
 *     DELETE /cogs/:id
 *     GET    /inventory-adjustments         POST  /inventory-adjustments
 *     PATCH  /inventory-adjustments/:id     DELETE /inventory-adjustments/:id
 *     GET    /stock-writeoffs               POST  /stock-writeoffs
 *     PATCH  /stock-writeoffs/:id           DELETE /stock-writeoffs/:id
 *     GET    /stock-revaluations            POST  /stock-revaluations
 *     PATCH  /stock-revaluations/:id        DELETE /stock-revaluations/:id
 *
 *   Intercompany Accounting (backs /erp/finance/intercompany):
 *     GET    /intercompany-invoices         POST  /intercompany-invoices
 *     PATCH  /intercompany-invoices/:id     DELETE /intercompany-invoices/:id
 *     GET    /intercompany-balances         POST  /intercompany-balances
 *     PATCH  /intercompany-balances/:id     DELETE /intercompany-balances/:id
 *     GET    /intercompany-eliminations     POST  /intercompany-eliminations
 *     PATCH  /intercompany-eliminations/:id DELETE /intercompany-eliminations/:id
 *
 *   Tax Compliance (backs /erp/finance/tax):
 *     GET    /tax-returns                   POST  /tax-returns
 *     PATCH  /tax-returns/:id               DELETE /tax-returns/:id
 *     GET    /tax-pension                   POST  /tax-pension
 *     PATCH  /tax-pension/:id               DELETE /tax-pension/:id
 *     GET    /tax-customs                   POST  /tax-customs
 *     PATCH  /tax-customs/:id               DELETE /tax-customs/:id
 *     GET    /tax-audits                    POST  /tax-audits
 *     PATCH  /tax-audits/:id                DELETE /tax-audits/:id
 *
 *   Configuration (backs /erp/finance/config):
 *     GET/POST/PATCH/DELETE /config/fiscal-years
 *     GET/PATCH             /config/fiscal-periods
 *     GET/POST/PATCH/DELETE /config/currencies
 *     GET/POST/PATCH/DELETE /config/tax-codes
 *     GET/POST/PATCH/DELETE /config/tax-jurisdictions
 *     GET/POST/PATCH/DELETE /config/posting-rules
 *     GET/POST/PATCH/DELETE /config/journal-types
 *     GET/POST/PATCH/DELETE /config/posting-profiles
 *     GET/POST/PATCH/DELETE /config/approval-levels
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

function ensureDb(res: any): boolean {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    dbNotConfigured(res);
    return false;
  }
  return true;
}

/** Append a property_id filter to a supabase query builder. */
function withProperty(q: any, propertyId?: string) {
  if (propertyId) return q.eq('property_id', propertyId);
  return q;
}

/** Cache of property_id → property_name, refreshed per request batch. */
async function buildPropertyNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!supabaseAdmin) return map;
  const { data } = await supabaseAdmin.from('properties').select('id, property_name');
  for (const p of data || []) map.set(p.id, p.property_name);
  return map;
}

/** Attach `property_name` to each record based on its `property_id`. */
function withPropertyNames<T extends Record<string, any>>(rows: T[], names: Map<string, string>): (T & { property_name: string | null })[] {
  return rows.map(r => ({ ...r, property_name: r.property_id ? (names.get(r.property_id) || null) : null }));
}

// ── Chart of Accounts ────────────────────────────────────────────────────
router.get('/chart-of-accounts', authenticate, async (_req, res) => {
  if (!ensureDb(res)) return;
  const { data, error } = await supabaseAdmin!
    .from('usali_chart_of_accounts')
    .select('*')
    .order('code');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Journals ──────────────────────────────────────────────────────────────
router.get('/journals', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!
    .from('journal_entries')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  q = withProperty(q, propertyId);
  const { data, error } = await q.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/journals', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { date, reference, description, department, lines, propertyId } = req.body || {};
  if (!date || !description || !Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ error: 'date, description and at least two lines are required' });
  }
  const totalDebit = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: 'Journal entry is out of balance', totalDebit, totalCredit });
  }
  const id = `je_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabaseAdmin!.from('journal_entries').insert({
    id,
    entry_date: date,
    period: String(date).slice(0, 7),
    source: 'Manual',
    reference: reference || null,
    description,
    status: 'Draft',
    total_debit: totalDebit,
    total_credit: totalCredit,
    amount: totalDebit,
    department: department || null,
    lines: JSON.stringify(lines || []),
    attachments: [],
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/journals/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status } = req.body || {};
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (status === 'Posted') patch.posted_at = new Date().toISOString();
  if (status === 'Approved') patch.approved_by = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('journal_entries')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/journals/:id/post', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { data, error } = await supabaseAdmin!.from('journal_entries')
    .update({ status: 'Posted', posted_at: new Date().toISOString(), approved_by: (req as any).user?.id || null, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.post('/journals/:id/reverse', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { data: entry, error } = await supabaseAdmin!.from('journal_entries')
    .select('*').eq('id', req.params.id).single();
  if (error || !entry) return res.status(404).json({ error: error?.message || 'Journal entry not found' });
  const reverseId = `je_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const origLines: any[] = entry.lines || [];
  const revLines = origLines.map((l: any) => ({ ...l, debit: l.credit, credit: l.debit }));
  const { data: newEntry, error: createError } = await supabaseAdmin!.from('journal_entries').insert({
    id: reverseId,
    entry_date: new Date().toISOString().split('T')[0],
    period: entry.period,
    source: 'Manual',
    reference: `Reversal of ${entry.reference || entry.id}`,
    description: `Reversal: ${entry.description}`,
    status: 'Posted',
    total_debit: entry.total_credit,
    total_credit: entry.total_debit,
    amount: entry.total_credit,
    department: entry.department,
    lines: JSON.stringify(revLines),
    attachments: [],
    posted_at: new Date().toISOString(),
    created_by: (req as any).user?.id || null,
    property_id: entry.property_id || null,
  }).select().single();
  if (createError) return res.status(500).json({ error: createError.message });
  await supabaseAdmin!.from('journal_entries').update({ status: 'Reversed', updated_at: new Date().toISOString() }).eq('id', req.params.id);
  return res.json(newEntry);
});

router.delete('/journals/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('journal_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Trial Balance (derived from COA balances) ────────────────────────────
router.get('/trial-balance', authenticate, async (_req, res) => {
  if (!ensureDb(res)) return;
  const { data, error } = await supabaseAdmin!
    .from('usali_chart_of_accounts')
    .select('code, name, account_type, normal_balance, balance')
    .order('code');
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((a: any) => {
    const bal = Number(a.balance) || 0;
    const isDebitNormal = a.normal_balance === 'Debit' || a.account_type === 'Asset' || a.account_type === 'Expense';
    return {
      accountCode: a.code,
      accountName: a.name,
      accountType: a.account_type,
      debit: isDebitNormal && bal > 0 ? bal : 0,
      credit: !isDebitNormal && bal > 0 ? bal : 0,
      balance: bal,
    };
  });
  const totalDebit = rows.reduce((s: number, r: any) => s + r.debit, 0);
  const totalCredit = rows.reduce((s: number, r: any) => s + r.credit, 0);
  return res.json({ rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
});

// ── Recurring templates ──────────────────────────────────────────────────
router.get('/recurring', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_recurring_templates').select('*').order('next_run', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/recurring', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, description, frequency, nextRun, amount, propertyId } = req.body || {};
  if (!name || !nextRun) return res.status(400).json({ error: 'name and nextRun are required' });
  const templateNumber = `RJ-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('gl_recurring_templates').insert({
    template_number: templateNumber,
    name,
    description: description || null,
    frequency: frequency || 'Monthly',
    next_run: nextRun,
    amount: Number(amount) || 0,
    status: 'Active',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/recurring/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, description, frequency, nextRun, amount, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (frequency !== undefined) patch.frequency = frequency;
  if (nextRun !== undefined) patch.next_run = nextRun;
  if (amount !== undefined) patch.amount = Number(amount) || 0;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin!.from('gl_recurring_templates')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/recurring/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('gl_recurring_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// "Run now" — advance next_run by one interval and return the generated amount.
router.post('/recurring/:id/run', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { data: tpl, error } = await supabaseAdmin!.from('gl_recurring_templates')
    .select('*').eq('id', req.params.id).single();
  if (error || !tpl) return res.status(404).json({ error: error?.message || 'Template not found' });
  const intervalDays = tpl.frequency === 'Weekly' ? 7 : tpl.frequency === 'Quarterly' ? 90 : 30;
  const next = new Date(tpl.next_run);
  next.setDate(next.getDate() + intervalDays);
  const { data: updated, error: updErr } = await supabaseAdmin!.from('gl_recurring_templates')
    .update({ next_run: next.toISOString().split('T')[0], updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (updErr) return res.status(500).json({ error: updErr.message });
  return res.json({ success: true, template: updated, generatedAmount: Number(tpl.amount) || 0 });
});

// ── Invoices ──────────────────────────────────────────────────────────────
router.get('/invoices', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, type, glStatus } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_invoices').select('*').order('issue_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (type) q = q.eq('type', type);
  if (glStatus) q = q.eq('gl_status', glStatus);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/invoices', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { invoiceNumber, type, entity, issueDate, netAmount, taxAmount, glStatus, glRef, items, propertyId } = req.body || {};
  if (!invoiceNumber || !type || !entity || !issueDate) {
    return res.status(400).json({ error: 'invoiceNumber, type, entity and issueDate are required' });
  }
  const { data, error } = await supabaseAdmin!.from('gl_invoices').insert({
    invoice_number: invoiceNumber,
    type,
    entity,
    issue_date: issueDate,
    net_amount: Number(netAmount) || 0,
    tax_amount: Number(taxAmount) || 0,
    gl_status: glStatus || 'Draft',
    gl_ref: glRef || null,
    items: JSON.stringify(items || []),
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/invoices/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { type, entity, issueDate, netAmount, taxAmount, glStatus, glRef, items } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.type = type;
  if (entity !== undefined) patch.entity = entity;
  if (issueDate !== undefined) patch.issue_date = issueDate;
  if (netAmount !== undefined) patch.net_amount = Number(netAmount) || 0;
  if (taxAmount !== undefined) patch.tax_amount = Number(taxAmount) || 0;
  if (glStatus !== undefined) patch.gl_status = glStatus;
  if (glRef !== undefined) patch.gl_ref = glRef;
  if (items !== undefined) patch.items = JSON.stringify(items);
  const { data, error } = await supabaseAdmin!.from('gl_invoices')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/invoices/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('gl_invoices').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Accounting periods ────────────────────────────────────────────────────
router.get('/periods', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('accounting_periods').select('*').order('period_start', { ascending: false });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.patch('/periods/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status } = req.body || {};
  if (!['Open', 'Closing', 'Closed'].includes(status)) {
    return res.status(400).json({ error: 'status must be Open, Closing or Closed' });
  }
  const patch: any = { status, updated_at: new Date().toISOString() };
  if (status === 'Closed') {
    patch.closed_at = new Date().toISOString();
    patch.closed_by = (req as any).user?.id || null;
  }
  const { data, error } = await supabaseAdmin!.from('accounting_periods')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Reversing entries ─────────────────────────────────────────────────────
router.get('/reversing', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_reversing_entries').select('*').order('reversal_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/reversing', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { originalJournal, reason, reversalDate, amount, propertyId } = req.body || {};
  if (!originalJournal || !reason || !reversalDate) {
    return res.status(400).json({ error: 'originalJournal, reason and reversalDate are required' });
  }
  const entryNumber = `REV-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('gl_reversing_entries').insert({
    entry_number: entryNumber,
    original_journal: originalJournal,
    reason,
    reversal_date: reversalDate,
    amount: Number(amount) || 0,
    status: 'Pending',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/reversing/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, reason, amount } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (reason !== undefined) patch.reason = reason;
  if (amount !== undefined) patch.amount = Number(amount) || 0;
  const { data, error } = await supabaseAdmin!.from('gl_reversing_entries')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/reversing/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('gl_reversing_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Adjusting entries ─────────────────────────────────────────────────────
router.get('/adjusting', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, adjustmentType } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_adjusting_entries').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (adjustmentType) q = q.eq('adjustment_type', adjustmentType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/adjusting', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { description, adjustmentType, amount, createdBy, propertyId } = req.body || {};
  if (!description || !adjustmentType) {
    return res.status(400).json({ error: 'description and adjustmentType are required' });
  }
  const entryNumber = `ADJ-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('gl_adjusting_entries').insert({
    entry_number: entryNumber,
    description,
    adjustment_type: adjustmentType,
    amount: Number(amount) || 0,
    created_by: createdBy || (req as any).user?.id || null,
    status: 'Pending',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/adjusting/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, description, adjustmentType, amount } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (description !== undefined) patch.description = description;
  if (adjustmentType !== undefined) patch.adjustment_type = adjustmentType;
  if (amount !== undefined) patch.amount = Number(amount) || 0;
  const { data, error } = await supabaseAdmin!.from('gl_adjusting_entries')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/adjusting/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('gl_adjusting_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Closing entries ───────────────────────────────────────────────────────
router.get('/closing', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_closing_entries').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/closing', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { period, closingType, revenueClosed, expenseClosed, netIncome, propertyId } = req.body || {};
  if (!period || !closingType) {
    return res.status(400).json({ error: 'period and closingType are required' });
  }
  const entryNumber = `CL-${Date.now().toString().slice(-6)}`;
  const rev = Number(revenueClosed) || 0;
  const exp = Number(expenseClosed) || 0;
  const { data, error } = await supabaseAdmin!.from('gl_closing_entries').insert({
    entry_number: entryNumber,
    period,
    closing_type: closingType,
    revenue_closed: rev,
    expense_closed: exp,
    net_income: netIncome !== undefined ? Number(netIncome) : (rev - exp),
    status: 'Pending',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/closing/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, period, closingType, revenueClosed, expenseClosed, netIncome } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (period !== undefined) patch.period = period;
  if (closingType !== undefined) patch.closing_type = closingType;
  if (revenueClosed !== undefined) patch.revenue_closed = Number(revenueClosed) || 0;
  if (expenseClosed !== undefined) patch.expense_closed = Number(expenseClosed) || 0;
  if (netIncome !== undefined) patch.net_income = Number(netIncome) || 0;
  const { data, error } = await supabaseAdmin!.from('gl_closing_entries')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/closing/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('gl_closing_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Audit trail ───────────────────────────────────────────────────────────
router.get('/audit-trail', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, action } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('gl_audit_trail').select('*').order('occurred_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (action) q = q.eq('action', action);
  const { data, error } = await q.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

// ══════════════════════════════════════════════════════════════════════════
// Inventory Accounting — backs the /erp/finance/inventory tab
//   GET/POST/PATCH/DELETE for each of the 5 sub-modules:
//     /inventory-valuation, /cogs, /inventory-adjustments,
//     /stock-writeoffs, /stock-revaluations
// ══════════════════════════════════════════════════════════════════════════

// ── Inventory Valuation ───────────────────────────────────────────────────
router.get('/inventory-valuation', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, category } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_inventory_valuation').select('*').order('total_value', { ascending: false });
  q = withProperty(q, propertyId);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/inventory-valuation', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { itemCode, itemName, category, quantity, unitCost, valuationMethod, propertyId } = req.body || {};
  if (!itemName) return res.status(400).json({ error: 'itemName is required' });
  const qty = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  const { data, error } = await supabaseAdmin!.from('fin_inventory_valuation').insert({
    item_code: itemCode || null,
    item_name: itemName,
    category: category || 'General',
    quantity: qty,
    unit_cost: cost,
    total_value: qty * cost,
    valuation_method: valuationMethod || 'weighted_average',
    last_revalued: new Date().toISOString().split('T')[0],
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/inventory-valuation/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { itemCode, itemName, category, quantity, unitCost, valuationMethod } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (itemCode !== undefined) patch.item_code = itemCode;
  if (itemName !== undefined) patch.item_name = itemName;
  if (category !== undefined) patch.category = category;
  if (quantity !== undefined) { patch.quantity = Number(quantity); }
  if (unitCost !== undefined) { patch.unit_cost = Number(unitCost); }
  if (valuationMethod !== undefined) patch.valuation_method = valuationMethod;
  // Recalculate total_value if qty or cost changed
  if (patch.quantity !== undefined || patch.unit_cost !== undefined) {
    const { data: existing } = await supabaseAdmin!.from('fin_inventory_valuation').select('quantity, unit_cost').eq('id', req.params.id).single();
    if (existing) {
      patch.total_value = (patch.quantity !== undefined ? patch.quantity : Number(existing.quantity)) * (patch.unit_cost !== undefined ? patch.unit_cost : Number(existing.unit_cost));
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_inventory_valuation')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/inventory-valuation/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_inventory_valuation').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── COGS Entries ──────────────────────────────────────────────────────────
router.get('/cogs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, department, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_cogs_entries').select('*').order('entry_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (department) q = q.eq('department', department);
  if (period) q = q.eq('period', period);
  const { data, error } = await q.limit(200);
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/cogs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { entryDate, department, itemCategory, itemName, quantityUsed, unitCost, reference, propertyId } = req.body || {};
  if (!department || !itemCategory) return res.status(400).json({ error: 'department and itemCategory are required' });
  const qty = Number(quantityUsed) || 0;
  const cost = Number(unitCost) || 0;
  const dateStr = entryDate || new Date().toISOString().split('T')[0];
  const { data, error } = await supabaseAdmin!.from('fin_cogs_entries').insert({
    entry_date: dateStr,
    period: String(dateStr).slice(0, 7),
    department,
    item_category: itemCategory,
    item_name: itemName || null,
    quantity_used: qty,
    unit_cost: cost,
    total_cogs: qty * cost,
    reference: reference || null,
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/cogs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_cogs_entries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Inventory Adjustments ─────────────────────────────────────────────────
router.get('/inventory-adjustments', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, adjustmentType } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_inventory_adjustments').select('*').order('adjustment_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (adjustmentType) q = q.eq('adjustment_type', adjustmentType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/inventory-adjustments', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { adjustmentDate, itemName, category, adjustmentType, oldQuantity, newQuantity, oldUnitCost, newUnitCost, reason, propertyId } = req.body || {};
  if (!itemName || !adjustmentType) return res.status(400).json({ error: 'itemName and adjustmentType are required' });
  const num = `ADJ-${Date.now().toString().slice(-6)}`;
  const oldQty = oldQuantity !== undefined ? Number(oldQuantity) : null;
  const newQty = newQuantity !== undefined ? Number(newQuantity) : null;
  const oldCost = oldUnitCost !== undefined ? Number(oldUnitCost) : null;
  const newCost = newUnitCost !== undefined ? Number(newUnitCost) : null;
  // Compute value impact
  let valueImpact = 0;
  if (adjustmentType === 'quantity' && oldQty !== null && newQty !== null) {
    const cost = oldCost ?? newCost ?? 0;
    valueImpact = (newQty - oldQty) * cost;
  } else if (adjustmentType === 'value' && oldCost !== null && newCost !== null && oldQty !== null) {
    valueImpact = (newCost - oldCost) * oldQty;
  }
  const { data, error } = await supabaseAdmin!.from('fin_inventory_adjustments').insert({
    adjustment_number: num,
    adjustment_date: adjustmentDate || new Date().toISOString().split('T')[0],
    item_name: itemName,
    category: category || 'General',
    adjustment_type: adjustmentType,
    old_quantity: oldQty,
    new_quantity: newQty,
    old_unit_cost: oldCost,
    new_unit_cost: newCost,
    value_impact: valueImpact,
    reason: reason || null,
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/inventory-adjustments/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, reason } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Approved') { patch.approved_by = (req as any).user?.id || null; patch.approved_at = new Date().toISOString(); }
    if (status === 'Posted') patch.posted_at = new Date().toISOString();
  }
  if (reason !== undefined) patch.reason = reason;
  const { data, error } = await supabaseAdmin!.from('fin_inventory_adjustments')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/inventory-adjustments/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_inventory_adjustments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Stock Write-offs ──────────────────────────────────────────────────────
router.get('/stock-writeoffs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, writeoffType } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_stock_writeoffs').select('*').order('writeoff_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (writeoffType) q = q.eq('writeoff_type', writeoffType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/stock-writeoffs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { writeoffDate, itemName, category, quantity, unitCost, writeoffType, reason, propertyId } = req.body || {};
  if (!itemName || !writeoffType) return res.status(400).json({ error: 'itemName and writeoffType are required' });
  const qty = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  const num = `WO-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_stock_writeoffs').insert({
    writeoff_number: num,
    writeoff_date: writeoffDate || new Date().toISOString().split('T')[0],
    item_name: itemName,
    category: category || 'General',
    quantity: qty,
    unit_cost: cost,
    total_value: qty * cost,
    writeoff_type: writeoffType,
    reason: reason || null,
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/stock-writeoffs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, reason, glPosted } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Approved') { patch.approved_by = (req as any).user?.id || null; patch.approved_at = new Date().toISOString(); }
    if (status === 'Posted') patch.posted_at = new Date().toISOString();
  }
  if (reason !== undefined) patch.reason = reason;
  if (glPosted !== undefined) patch.gl_posted = Boolean(glPosted);
  const { data, error } = await supabaseAdmin!.from('fin_stock_writeoffs')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/stock-writeoffs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_stock_writeoffs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Stock Revaluations ────────────────────────────────────────────────────
router.get('/stock-revaluations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_stock_revaluations').select('*').order('revaluation_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/stock-revaluations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { revaluationDate, itemName, category, oldCost, newCost, quantity, reason, propertyId } = req.body || {};
  if (!itemName || oldCost === undefined || newCost === undefined) {
    return res.status(400).json({ error: 'itemName, oldCost and newCost are required' });
  }
  const oldC = Number(oldCost) || 0;
  const newC = Number(newCost) || 0;
  const qty = Number(quantity) || 0;
  const num = `REV-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_stock_revaluations').insert({
    revaluation_number: num,
    revaluation_date: revaluationDate || new Date().toISOString().split('T')[0],
    item_name: itemName,
    category: category || 'General',
    old_cost: oldC,
    new_cost: newC,
    quantity: qty,
    old_total_value: oldC * qty,
    new_total_value: newC * qty,
    variance: (newC - oldC) * qty,
    reason: reason || null,
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/stock-revaluations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, reason } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Approved') { patch.approved_by = (req as any).user?.id || null; patch.approved_at = new Date().toISOString(); }
    if (status === 'Posted') patch.posted_at = new Date().toISOString();
  }
  if (reason !== undefined) patch.reason = reason;
  const { data, error } = await supabaseAdmin!.from('fin_stock_revaluations')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/stock-revaluations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_stock_revaluations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// Intercompany Accounting — backs the /erp/finance/intercompany tab
//   GET/POST/PATCH/DELETE for each of the 3 sub-modules:
//     /intercompany-invoices, /intercompany-balances,
//     /intercompany-eliminations
// ══════════════════════════════════════════════════════════════════════════

// ── Intercompany Invoices ─────────────────────────────────────────────────
router.get('/intercompany-invoices', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_intercompany_invoices').select('*').order('invoice_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/intercompany-invoices', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { invoiceDate, fromEntity, toEntity, transactionType, description, amount, currency, propertyId } = req.body || {};
  if (!fromEntity || !toEntity || !transactionType) {
    return res.status(400).json({ error: 'fromEntity, toEntity and transactionType are required' });
  }
  const num = `IC-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_invoices').insert({
    invoice_number: num,
    invoice_date: invoiceDate || new Date().toISOString().split('T')[0],
    from_entity: fromEntity,
    to_entity: toEntity,
    transaction_type: transactionType,
    description: description || null,
    amount: Number(amount) || 0,
    currency: currency || 'USD',
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/intercompany-invoices/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, description, amount, glRef } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Approved') { patch.approved_by = (req as any).user?.id || null; patch.approved_at = new Date().toISOString(); }
    if (status === 'Posted') { patch.posted_at = new Date().toISOString(); patch.gl_ref = glRef || `GL-${Date.now().toString().slice(-6)}`; }
  }
  if (description !== undefined) patch.description = description;
  if (amount !== undefined) patch.amount = Number(amount);
  if (glRef !== undefined) patch.gl_ref = glRef;
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_invoices')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/intercompany-invoices/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_intercompany_invoices').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Intercompany Balances (Due To / Due From) ─────────────────────────────
router.get('/intercompany-balances', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, balanceType } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_intercompany_balances').select('*').order('last_activity', { ascending: false });
  q = withProperty(q, propertyId);
  if (balanceType) q = q.eq('balance_type', balanceType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/intercompany-balances', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { entity, balanceType, amount, currency, agingBucket, referenceInvoice, lastActivity, propertyId } = req.body || {};
  if (!entity || !balanceType) return res.status(400).json({ error: 'entity and balanceType are required' });
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_balances').insert({
    entity,
    balance_type: balanceType,
    amount: Number(amount) || 0,
    currency: currency || 'USD',
    aging_bucket: agingBucket || '0-30',
    reference_invoice: referenceInvoice || null,
    last_activity: lastActivity || new Date().toISOString().split('T')[0],
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/intercompany-balances/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { amount, agingBucket, balanceType, referenceInvoice, lastActivity } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (amount !== undefined) patch.amount = Number(amount);
  if (agingBucket !== undefined) patch.aging_bucket = agingBucket;
  if (balanceType !== undefined) patch.balance_type = balanceType;
  if (referenceInvoice !== undefined) patch.reference_invoice = referenceInvoice;
  if (lastActivity !== undefined) patch.last_activity = lastActivity;
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_balances')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/intercompany-balances/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_intercompany_balances').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Intercompany Eliminations ─────────────────────────────────────────────
router.get('/intercompany-eliminations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_intercompany_eliminations').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/intercompany-eliminations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { period, account, entity1, entity2, amount, currency, description, propertyId } = req.body || {};
  if (!period || !entity1 || !entity2) {
    return res.status(400).json({ error: 'period, entity1 and entity2 are required' });
  }
  const num = `EL-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_eliminations').insert({
    entry_number: num,
    period,
    account: account || 'Intercompany Revenue',
    entity1,
    entity2,
    amount: Number(amount) || 0,
    currency: currency || 'USD',
    description: description || null,
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/intercompany-eliminations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, description, amount } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Posted') patch.posted_at = new Date().toISOString();
  }
  if (description !== undefined) patch.description = description;
  if (amount !== undefined) patch.amount = Number(amount);
  const { data, error } = await supabaseAdmin!.from('fin_intercompany_eliminations')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/intercompany-eliminations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_intercompany_eliminations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Compliance ─────────────────────────────────────────────────────────
// Backs /erp/finance/tax. Four resource groups:
//   /tax-returns  — unified returns (VAT/WHT/TOT/PAYE/Sales Tax/Local)
//   /tax-pension  — pension remittance schedule
//   /tax-customs  — customs declarations & duty payments
//   /tax-audits   — tax audit findings & compliance tracking

// ── Tax Returns (VAT, WHT, TOT, PAYE, Sales Tax, Local) ───────────────────
router.get('/tax-returns', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, taxType, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_tax_returns').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (taxType) q = q.eq('tax_type', taxType);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/tax-returns', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { taxType, period, dueDate, taxableBase, taxCollected, taxPaid, netTax, taxRate, metadata, propertyId } = req.body || {};
  if (!taxType || !period) return res.status(400).json({ error: 'taxType and period are required' });
  const prefix = taxType === 'Sales Tax' ? 'ST' : taxType === 'Local' ? 'LOC' : taxType;
  const num = `${prefix}-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_tax_returns').insert({
    return_number: num,
    tax_type: taxType,
    period,
    status: 'Pending',
    due_date: dueDate || null,
    taxable_base: Number(taxableBase) || 0,
    tax_collected: Number(taxCollected) || 0,
    tax_paid: Number(taxPaid) || 0,
    net_tax: Number(netTax) || 0,
    tax_rate: taxRate ? Number(taxRate) : null,
    metadata: metadata || {},
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/tax-returns/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, filingDate, taxableBase, taxCollected, taxPaid, netTax, taxRate, metadata } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Filed' || status === 'Paid') {
      patch.filing_date = filingDate || new Date().toISOString().split('T')[0];
      patch.filed_by = (req as any).user?.id || null;
    }
  }
  if (filingDate !== undefined) patch.filing_date = filingDate;
  if (taxableBase !== undefined) patch.taxable_base = Number(taxableBase);
  if (taxCollected !== undefined) patch.tax_collected = Number(taxCollected);
  if (taxPaid !== undefined) patch.tax_paid = Number(taxPaid);
  if (netTax !== undefined) patch.net_tax = Number(netTax);
  if (taxRate !== undefined) patch.tax_rate = Number(taxRate);
  if (metadata !== undefined) patch.metadata = metadata;
  const { data, error } = await supabaseAdmin!.from('fin_tax_returns')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tax-returns/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_tax_returns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Pension (Pension remittance schedule) ──────────────────────────────
router.get('/tax-pension', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_tax_pension').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/tax-pension', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { period, employeeAmount, employerAmount, totalAmount, propertyId } = req.body || {};
  if (!period) return res.status(400).json({ error: 'period is required' });
  const emp = Number(employeeAmount) || 0;
  const er = Number(employerAmount) || 0;
  const { data, error } = await supabaseAdmin!.from('fin_tax_pension').insert({
    period,
    employee_amount: emp,
    employer_amount: er,
    total_amount: Number(totalAmount) || (emp + er),
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/tax-pension/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, employeeAmount, employerAmount, totalAmount, remittanceDate } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Remitted') patch.remittance_date = remittanceDate || new Date().toISOString().split('T')[0];
  }
  if (employeeAmount !== undefined) patch.employee_amount = Number(employeeAmount);
  if (employerAmount !== undefined) patch.employer_amount = Number(employerAmount);
  if (totalAmount !== undefined) patch.total_amount = Number(totalAmount);
  if (remittanceDate !== undefined) patch.remittance_date = remittanceDate;
  const { data, error } = await supabaseAdmin!.from('fin_tax_pension')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tax-pension/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_tax_pension').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Customs (Customs declarations & duty payments) ─────────────────────
router.get('/tax-customs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_tax_customs').select('*').order('declaration_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/tax-customs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { itemDescription, cifValue, dutyRate, dutyPaid, declarationDate, propertyId } = req.body || {};
  if (!itemDescription) return res.status(400).json({ error: 'itemDescription is required' });
  const num = `CD-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_tax_customs').insert({
    declaration_number: num,
    item_description: itemDescription,
    cif_value: Number(cifValue) || 0,
    duty_rate: dutyRate || null,
    duty_paid: Number(dutyPaid) || 0,
    declaration_date: declarationDate || new Date().toISOString().split('T')[0],
    status: 'Pending',
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/tax-customs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, itemDescription, cifValue, dutyRate, dutyPaid, declarationDate } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (itemDescription !== undefined) patch.item_description = itemDescription;
  if (cifValue !== undefined) patch.cif_value = Number(cifValue);
  if (dutyRate !== undefined) patch.duty_rate = dutyRate;
  if (dutyPaid !== undefined) patch.duty_paid = Number(dutyPaid);
  if (declarationDate !== undefined) patch.declaration_date = declarationDate;
  const { data, error } = await supabaseAdmin!.from('fin_tax_customs')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tax-customs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_tax_customs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Audits (Tax audit findings & compliance tracking) ──────────────────
router.get('/tax-audits', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, riskLevel } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_tax_audits').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (riskLevel) q = q.eq('risk_level', riskLevel);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/tax-audits', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { category, description, riskLevel, dueDate, propertyId } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category is required' });
  const num = `AUD-${Date.now().toString().slice(-6)}`;
  const { data, error } = await supabaseAdmin!.from('fin_tax_audits').insert({
    finding_number: num,
    category,
    description: description || null,
    risk_level: riskLevel || 'Medium',
    status: 'Open',
    due_date: dueDate || null,
    created_by: (req as any).user?.id || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/tax-audits/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, category, description, riskLevel, dueDate } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Resolved' || status === 'Closed') {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = (req as any).user?.id || null;
    }
  }
  if (category !== undefined) patch.category = category;
  if (description !== undefined) patch.description = description;
  if (riskLevel !== undefined) patch.risk_level = riskLevel;
  if (dueDate !== undefined) patch.due_date = dueDate;
  const { data, error } = await supabaseAdmin!.from('fin_tax_audits')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/tax-audits/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_tax_audits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL CONSOLIDATION
//   GET/POST/PATCH/DELETE /consolidation-entities
//   GET/POST/PATCH/DELETE /consolidation-fx-rates
//   GET/POST/PATCH/DELETE /consolidation-eliminations
// ══════════════════════════════════════════════════════════════════════════

// ── Consolidation Entities ────────────────────────────────────────────────
router.get('/consolidation-entities', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, type } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_consolidation_entities').select('*').order('entity_code', { ascending: true });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('consolidation_status', status);
  if (type) q = q.eq('entity_type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/consolidation-entities', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { entityCode, entityName, entityType, baseCurrency, functionalCurrency,
    revenue, expenses, profit, ownershipPct, consolidationStatus, period, notes, propertyId } = req.body || {};
  if (!entityName) return res.status(400).json({ error: 'entityName is required' });
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_entities').insert({
    entity_code: entityCode || null,
    entity_name: entityName,
    entity_type: entityType || 'Hotel',
    base_currency: baseCurrency || 'ETB',
    functional_currency: functionalCurrency || 'ETB',
    revenue: revenue || 0,
    expenses: expenses || 0,
    profit: profit || 0,
    ownership_pct: ownershipPct || 100,
    consolidation_status: consolidationStatus || 'Included',
    period: period || null,
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/consolidation-entities/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { entityName, entityType, baseCurrency, functionalCurrency, revenue, expenses, profit,
    ownershipPct, consolidationStatus, period, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (entityName !== undefined) patch.entity_name = entityName;
  if (entityType !== undefined) patch.entity_type = entityType;
  if (baseCurrency !== undefined) patch.base_currency = baseCurrency;
  if (functionalCurrency !== undefined) patch.functional_currency = functionalCurrency;
  if (revenue !== undefined) patch.revenue = revenue;
  if (expenses !== undefined) patch.expenses = expenses;
  if (profit !== undefined) patch.profit = profit;
  if (ownershipPct !== undefined) patch.ownership_pct = ownershipPct;
  if (consolidationStatus !== undefined) patch.consolidation_status = consolidationStatus;
  if (period !== undefined) patch.period = period;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_entities')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/consolidation-entities/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_consolidation_entities').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── FX Rates ──────────────────────────────────────────────────────────────
router.get('/consolidation-fx-rates', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_consolidation_fx_rates').select('*').order('effective_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/consolidation-fx-rates', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { fromCurrency, toCurrency, rate, effectiveDate, period, source, propertyId } = req.body || {};
  if (!fromCurrency || !toCurrency || rate === undefined || !effectiveDate) {
    return res.status(400).json({ error: 'fromCurrency, toCurrency, rate, effectiveDate are required' });
  }
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_fx_rates').insert({
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate,
    effective_date: effectiveDate,
    period: period || null,
    source: source || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/consolidation-fx-rates/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { fromCurrency, toCurrency, rate, effectiveDate, period, source } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (fromCurrency !== undefined) patch.from_currency = fromCurrency;
  if (toCurrency !== undefined) patch.to_currency = toCurrency;
  if (rate !== undefined) patch.rate = rate;
  if (effectiveDate !== undefined) patch.effective_date = effectiveDate;
  if (period !== undefined) patch.period = period;
  if (source !== undefined) patch.source = source;
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_fx_rates')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/consolidation-fx-rates/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_consolidation_fx_rates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Eliminations ──────────────────────────────────────────────────────────
router.get('/consolidation-eliminations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_consolidation_eliminations').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const names = await buildPropertyNameMap();
  return res.json(withPropertyNames(data || [], names));
});

router.post('/consolidation-eliminations', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { eliminationNumber, period, description, fromEntity, toEntity, amount,
    eliminationType, status, notes, propertyId } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description is required' });
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_eliminations').insert({
    elimination_number: eliminationNumber || null,
    period: period || null,
    description,
    from_entity: fromEntity || null,
    to_entity: toEntity || null,
    amount: amount || 0,
    elimination_type: eliminationType || 'Intercompany',
    status: status || 'Pending',
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/consolidation-eliminations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { eliminationNumber, period, description, fromEntity, toEntity, amount,
    eliminationType, status, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (eliminationNumber !== undefined) patch.elimination_number = eliminationNumber;
  if (period !== undefined) patch.period = period;
  if (description !== undefined) patch.description = description;
  if (fromEntity !== undefined) patch.from_entity = fromEntity;
  if (toEntity !== undefined) patch.to_entity = toEntity;
  if (amount !== undefined) patch.amount = amount;
  if (eliminationType !== undefined) patch.elimination_type = eliminationType;
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Posted') {
      patch.posted_at = new Date().toISOString();
      patch.posted_by = (req as any).user?.id || null;
    } else if (status === 'Reversed' || status === 'Pending') {
      patch.posted_at = null;
      patch.posted_by = null;
    }
  }
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_consolidation_eliminations')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/consolidation-eliminations/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_consolidation_eliminations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// AUDIT & COMPLIANCE
//   GET/POST/PATCH/DELETE /audit-logs
//   GET/POST/PATCH/DELETE /compliance-issues
//   GET/POST/PATCH/DELETE /journal-approvals
//   GET/POST/PATCH/DELETE /external-audits
//   GET/POST/PATCH/DELETE /sod-rules
// ══════════════════════════════════════════════════════════════════════════

// ── Audit Logs (read-only mostly, from existing audit_logs table) ──────────
router.get('/audit-logs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, module, action, limit } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('audit_logs').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (module) q = q.eq('module', module);
  if (action) q = q.eq('action', action);
  q = q.limit(limit ? Number(limit) : 100);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ── Compliance Issues ──────────────────────────────────────────────────────
router.get('/compliance-issues', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, severity, type } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_compliance_issues').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (severity) q = q.eq('severity', severity);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/compliance-issues', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { issueNumber, type, severity, title, description, remediationUrl, assignedTo, propertyId } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin!.from('fin_compliance_issues').insert({
    issue_number: issueNumber || null,
    type: type || 'regulatory',
    severity: severity || 'medium',
    title,
    description: description || null,
    remediation_url: remediationUrl || null,
    assigned_to: assignedTo || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/compliance-issues/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { type, severity, title, description, remediationUrl, status, assignedTo } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.type = type;
  if (severity !== undefined) patch.severity = severity;
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (remediationUrl !== undefined) patch.remediation_url = remediationUrl;
  if (assignedTo !== undefined) patch.assigned_to = assignedTo;
  if (status !== undefined) {
    patch.status = status;
    if (status === 'resolved') {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = (req as any).user?.id || null;
    } else {
      patch.resolved_at = null;
      patch.resolved_by = null;
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_compliance_issues')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/compliance-issues/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_compliance_issues').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Journal Approvals ──────────────────────────────────────────────────────
router.get('/journal-approvals', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_journal_approvals').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/journal-approvals', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { journalNumber, description, amount, submittedBy, period, notes, propertyId } = req.body || {};
  if (!journalNumber) return res.status(400).json({ error: 'journalNumber is required' });
  const { data, error } = await supabaseAdmin!.from('fin_journal_approvals').insert({
    journal_number: journalNumber,
    description: description || null,
    amount: amount || 0,
    submitted_by: submittedBy || (req as any).user?.name || null,
    submitted_at: new Date().toISOString(),
    period: period || null,
    notes: notes || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/journal-approvals/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, rejectionReason, notes, description, amount } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (description !== undefined) patch.description = description;
  if (amount !== undefined) patch.amount = amount;
  if (notes !== undefined) patch.notes = notes;
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Approved') {
      patch.approved_by = (req as any).user?.name || (req as any).user?.id || null;
      patch.approved_at = new Date().toISOString();
    } else if (status === 'Rejected') {
      patch.rejected_by = (req as any).user?.name || (req as any).user?.id || null;
      patch.rejected_at = new Date().toISOString();
      if (rejectionReason) patch.rejection_reason = rejectionReason;
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_journal_approvals')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/journal-approvals/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_journal_approvals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── External Audits ────────────────────────────────────────────────────────
router.get('/external-audits', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_external_audits').select('*').order('start_date', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/external-audits', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { auditNumber, firm, auditType, startDate, endDate, status, findingsCount, rating, scope, notes, propertyId } = req.body || {};
  if (!firm) return res.status(400).json({ error: 'firm is required' });
  const { data, error } = await supabaseAdmin!.from('fin_external_audits').insert({
    audit_number: auditNumber || null,
    firm,
    audit_type: auditType || 'Annual Financial Audit',
    start_date: startDate || null,
    end_date: endDate || null,
    status: status || 'Scheduled',
    findings_count: findingsCount || 0,
    rating: rating || null,
    scope: scope || null,
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/external-audits/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { auditNumber, firm, auditType, startDate, endDate, status, findingsCount, rating, scope, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (auditNumber !== undefined) patch.audit_number = auditNumber;
  if (firm !== undefined) patch.firm = firm;
  if (auditType !== undefined) patch.audit_type = auditType;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (status !== undefined) patch.status = status;
  if (findingsCount !== undefined) patch.findings_count = findingsCount;
  if (rating !== undefined) patch.rating = rating;
  if (scope !== undefined) patch.scope = scope;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_external_audits')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/external-audits/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_external_audits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Segregation of Duties Rules ────────────────────────────────────────────
router.get('/sod-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_sod_rules').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/sod-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { ruleName, ruleCode, description, dutyA, dutyB, conflictLevel, status, assignedRole, notes, propertyId } = req.body || {};
  if (!ruleName || !dutyA || !dutyB) return res.status(400).json({ error: 'ruleName, dutyA, dutyB are required' });
  const { data, error } = await supabaseAdmin!.from('fin_sod_rules').insert({
    rule_name: ruleName,
    rule_code: ruleCode || null,
    description: description || null,
    duty_a: dutyA,
    duty_b: dutyB,
    conflict_level: conflictLevel || 'Medium',
    status: status || 'Active',
    assigned_role: assignedRole || null,
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/sod-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { ruleName, ruleCode, description, dutyA, dutyB, conflictLevel, status, assignedRole, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (ruleName !== undefined) patch.rule_name = ruleName;
  if (ruleCode !== undefined) patch.rule_code = ruleCode;
  if (description !== undefined) patch.description = description;
  if (dutyA !== undefined) patch.duty_a = dutyA;
  if (dutyB !== undefined) patch.duty_b = dutyB;
  if (conflictLevel !== undefined) patch.conflict_level = conflictLevel;
  if (status !== undefined) patch.status = status;
  if (assignedRole !== undefined) patch.assigned_role = assignedRole;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_sod_rules')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/sod-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_sod_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL DOCUMENTS
//   GET    /documents
//   POST   /documents
//   PATCH  /documents/:id
//   DELETE /documents/:id
// ══════════════════════════════════════════════════════════════════════════

// ── Documents ──────────────────────────────────────────────────────────────

router.get('/documents', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, type, category } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_documents').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/documents', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const {
    documentNumber, name, type, category, entity,
    filePath, fileUrl, fileSize, mimeType, status,
    uploadedBy, notes, propertyId,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin!.from('fin_documents').insert({
    document_number: documentNumber || null,
    name,
    type: type || 'Invoice',
    category: category || 'Accounts Receivable',
    entity: entity || null,
    file_path: filePath || null,
    file_url: fileUrl || null,
    file_size: fileSize || 0,
    mime_type: mimeType || null,
    status: status || 'Pending Review',
    uploaded_by: uploadedBy || (req as any).user?.name || (req as any).user?.id || null,
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/documents/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const {
    documentNumber, name, type, category, entity,
    filePath, fileUrl, fileSize, mimeType, status,
    uploadedBy, notes,
  } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (documentNumber !== undefined) patch.document_number = documentNumber;
  if (name !== undefined) patch.name = name;
  if (type !== undefined) patch.type = type;
  if (category !== undefined) patch.category = category;
  if (entity !== undefined) patch.entity = entity;
  if (filePath !== undefined) patch.file_path = filePath;
  if (fileUrl !== undefined) patch.file_url = fileUrl;
  if (fileSize !== undefined) patch.file_size = fileSize;
  if (mimeType !== undefined) patch.mime_type = mimeType;
  if (uploadedBy !== undefined) patch.uploaded_by = uploadedBy;
  if (notes !== undefined) patch.notes = notes;
  if (status !== undefined) {
    patch.status = status;
    if (status === 'Processed' || status === 'Archived' || status === 'Rejected') {
      patch.reviewed_by = (req as any).user?.name || (req as any).user?.id || null;
      patch.reviewed_at = new Date().toISOString();
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_documents')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/documents/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW
//   GET/POST/PATCH/DELETE /approval-requests
//   GET/POST/PATCH/DELETE /approval-levels
//   GET/POST/PATCH/DELETE /delegation-rules
// ══════════════════════════════════════════════════════════════════════════

// ── Approval Requests ──────────────────────────────────────────────────────

router.get('/approval-requests', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status, type } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_approval_requests').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/approval-requests', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const {
    requestNumber, type, title, description, amount,
    requestedBy, requestedByName, currentLevel, totalLevels,
    status, notes, propertyId,
  } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin!.from('fin_approval_requests').insert({
    request_number: requestNumber || null,
    type: type || 'journal',
    title,
    description: description || null,
    amount: amount || 0,
    requested_by: requestedBy || (req as any).user?.id || null,
    requested_by_name: requestedByName || (req as any).user?.name || null,
    current_level: currentLevel || 0,
    total_levels: totalLevels || 1,
    status: status || 'pending',
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/approval-requests/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const {
    requestNumber, type, title, description, amount,
    currentLevel, totalLevels, status, rejectionReason, notes,
  } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (requestNumber !== undefined) patch.request_number = requestNumber;
  if (type !== undefined) patch.type = type;
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (amount !== undefined) patch.amount = amount;
  if (currentLevel !== undefined) patch.current_level = currentLevel;
  if (totalLevels !== undefined) patch.total_levels = totalLevels;
  if (notes !== undefined) patch.notes = notes;
  if (status !== undefined) {
    patch.status = status;
    if (status === 'approved') {
      patch.approved_by = (req as any).user?.name || (req as any).user?.id || null;
      patch.approved_at = new Date().toISOString();
    } else if (status === 'rejected') {
      patch.rejected_by = (req as any).user?.name || (req as any).user?.id || null;
      patch.rejected_at = new Date().toISOString();
      if (rejectionReason) patch.rejection_reason = rejectionReason;
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_approval_requests')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/approval-requests/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_approval_requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Approval Levels ────────────────────────────────────────────────────────

router.get('/approval-levels', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_approval_levels').select('*').order('level', { ascending: true });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/approval-levels', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, level, requiresUnanimous, approvers, spendingLimit, description, status, propertyId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin!.from('fin_approval_levels').insert({
    name,
    level: level || 1,
    requires_unanimous: requiresUnanimous || false,
    approvers: Array.isArray(approvers) ? approvers : [],
    spending_limit: spendingLimit || null,
    description: description || null,
    status: status || 'active',
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/approval-levels/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, level, requiresUnanimous, approvers, spendingLimit, description, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (level !== undefined) patch.level = level;
  if (requiresUnanimous !== undefined) patch.requires_unanimous = requiresUnanimous;
  if (approvers !== undefined) patch.approvers = Array.isArray(approvers) ? approvers : [];
  if (spendingLimit !== undefined) patch.spending_limit = spendingLimit;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin!.from('fin_approval_levels')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/approval-levels/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_approval_levels').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Delegation Rules ───────────────────────────────────────────────────────

router.get('/delegation-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_delegation_rules').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/delegation-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { ruleName, delegator, delegatee, scope, spendingLimit, startDate, endDate, status, notes, propertyId } = req.body || {};
  if (!ruleName || !delegator || !delegatee) return res.status(400).json({ error: 'ruleName, delegator, delegatee are required' });
  const { data, error } = await supabaseAdmin!.from('fin_delegation_rules').insert({
    rule_name: ruleName,
    delegator,
    delegatee,
    scope: scope || 'all',
    spending_limit: spendingLimit || null,
    start_date: startDate || new Date().toISOString(),
    end_date: endDate || null,
    status: status || 'active',
    notes: notes || null,
    property_id: propertyId || null,
    created_by: (req as any).user?.id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/delegation-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { ruleName, delegator, delegatee, scope, spendingLimit, startDate, endDate, status, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (ruleName !== undefined) patch.rule_name = ruleName;
  if (delegator !== undefined) patch.delegator = delegator;
  if (delegatee !== undefined) patch.delegatee = delegatee;
  if (scope !== undefined) patch.scope = scope;
  if (spendingLimit !== undefined) patch.spending_limit = spendingLimit;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_delegation_rules')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/delegation-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_delegation_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// BUSINESS INTELLIGENCE
//   GET/POST/PATCH/DELETE /bi-metrics
//   GET/POST/PATCH/DELETE /bi-trends
//   GET/POST/PATCH/DELETE /bi-ratios
//   GET/POST/PATCH/DELETE /bi-forecasts
//   GET/POST/PATCH/DELETE /bi-cost-analysis
//   GET/POST/PATCH/DELETE /bi-aging
// ══════════════════════════════════════════════════════════════════════════

// ── BI Metrics ─────────────────────────────────────────────────────────────

router.get('/bi-metrics', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, category } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_metrics').select('*').order('name', { ascending: true });
  q = withProperty(q, propertyId);
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-metrics', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, displayName, value, previousValue, changePercent, period, unit, category, propertyId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_metrics').insert({
    name, display_name: displayName || null,
    value: value || 0, previous_value: previousValue || 0, change_percent: changePercent || 0,
    period: period || null, unit: unit || 'currency', category: category || 'overview',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-metrics/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, displayName, value, previousValue, changePercent, period, unit, category } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (displayName !== undefined) patch.display_name = displayName;
  if (value !== undefined) patch.value = value;
  if (previousValue !== undefined) patch.previous_value = previousValue;
  if (changePercent !== undefined) patch.change_percent = changePercent;
  if (period !== undefined) patch.period = period;
  if (unit !== undefined) patch.unit = unit;
  if (category !== undefined) patch.category = category;
  const { data, error } = await supabaseAdmin!.from('fin_bi_metrics').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-metrics/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_metrics').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BI Trends ──────────────────────────────────────────────────────────────

router.get('/bi-trends', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_trends').select('*').order('period_order', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-trends', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { period, revenue, expenses, profit, periodOrder, propertyId } = req.body || {};
  if (!period) return res.status(400).json({ error: 'period is required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_trends').insert({
    period, revenue: revenue || 0, expenses: expenses || 0, profit: profit || 0,
    period_order: periodOrder || 0, property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-trends/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { period, revenue, expenses, profit, periodOrder } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (period !== undefined) patch.period = period;
  if (revenue !== undefined) patch.revenue = revenue;
  if (expenses !== undefined) patch.expenses = expenses;
  if (profit !== undefined) patch.profit = profit;
  if (periodOrder !== undefined) patch.period_order = periodOrder;
  const { data, error } = await supabaseAdmin!.from('fin_bi_trends').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-trends/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_trends').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BI Ratios ──────────────────────────────────────────────────────────────

router.get('/bi-ratios', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, category, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_ratios').select('*').order('category', { ascending: true });
  q = withProperty(q, propertyId);
  if (category) q = q.eq('category', category);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-ratios', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, displayName, value, benchmark, status, category, unit, propertyId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_ratios').insert({
    name, display_name: displayName || null,
    value: value || 0, benchmark: benchmark || 0,
    status: status || 'good', category: category || 'liquidity', unit: unit || 'ratio',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-ratios/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, displayName, value, benchmark, status, category, unit } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (displayName !== undefined) patch.display_name = displayName;
  if (value !== undefined) patch.value = value;
  if (benchmark !== undefined) patch.benchmark = benchmark;
  if (status !== undefined) patch.status = status;
  if (category !== undefined) patch.category = category;
  if (unit !== undefined) patch.unit = unit;
  const { data, error } = await supabaseAdmin!.from('fin_bi_ratios').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-ratios/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_ratios').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BI Forecasts ───────────────────────────────────────────────────────────

router.get('/bi-forecasts', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_forecasts').select('*').order('metric', { ascending: true });
  q = withProperty(q, propertyId);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-forecasts', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { metric, forecast, actual, variance, accuracy, period, unit, propertyId } = req.body || {};
  if (!metric) return res.status(400).json({ error: 'metric is required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_forecasts').insert({
    metric, forecast: forecast || 0, actual: actual || 0, variance: variance || 0,
    accuracy: accuracy || 0, period: period || null, unit: unit || 'currency',
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-forecasts/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { metric, forecast, actual, variance, accuracy, period, unit } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (metric !== undefined) patch.metric = metric;
  if (forecast !== undefined) patch.forecast = forecast;
  if (actual !== undefined) patch.actual = actual;
  if (variance !== undefined) patch.variance = variance;
  if (accuracy !== undefined) patch.accuracy = accuracy;
  if (period !== undefined) patch.period = period;
  if (unit !== undefined) patch.unit = unit;
  const { data, error } = await supabaseAdmin!.from('fin_bi_forecasts').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-forecasts/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_forecasts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BI Cost Analysis ───────────────────────────────────────────────────────

router.get('/bi-cost-analysis', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_cost_analysis').select('*').order('category', { ascending: true });
  q = withProperty(q, propertyId);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-cost-analysis', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { category, budget, actual, variance, variancePercent, trend, period, propertyId } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category is required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_cost_analysis').insert({
    category, budget: budget || 0, actual: actual || 0,
    variance: variance || 0, variance_percent: variancePercent || 0,
    trend: trend || 'Stable', period: period || null, property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-cost-analysis/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { category, budget, actual, variance, variancePercent, trend, period } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (category !== undefined) patch.category = category;
  if (budget !== undefined) patch.budget = budget;
  if (actual !== undefined) patch.actual = actual;
  if (variance !== undefined) patch.variance = variance;
  if (variancePercent !== undefined) patch.variance_percent = variancePercent;
  if (trend !== undefined) patch.trend = trend;
  if (period !== undefined) patch.period = period;
  const { data, error } = await supabaseAdmin!.from('fin_bi_cost_analysis').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-cost-analysis/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_cost_analysis').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── BI Aging ───────────────────────────────────────────────────────────────

router.get('/bi-aging', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, type, period } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_bi_aging').select('*').order('type', { ascending: true });
  q = withProperty(q, propertyId);
  if (type) q = q.eq('type', type);
  if (period) q = q.eq('period', period);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/bi-aging', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { type, bucket, amount, period, propertyId } = req.body || {};
  if (!type || !bucket) return res.status(400).json({ error: 'type and bucket are required' });
  const { data, error } = await supabaseAdmin!.from('fin_bi_aging').insert({
    type, bucket, amount: amount || 0, period: period || null, property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/bi-aging/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { type, bucket, amount, period } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (type !== undefined) patch.type = type;
  if (bucket !== undefined) patch.bucket = bucket;
  if (amount !== undefined) patch.amount = amount;
  if (period !== undefined) patch.period = period;
  const { data, error } = await supabaseAdmin!.from('fin_bi_aging').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/bi-aging/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_bi_aging').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL REPORTS
//   GET/POST/PATCH/DELETE /reports            — report catalog
//   GET/POST/PATCH/DELETE /report-runs        — report execution log
//   POST /reports/:id/run                     — execute a report (records a run)
// ══════════════════════════════════════════════════════════════════════════

// ── Reports (catalog) ─────────────────────────────────────────────────────

router.get('/reports', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, category, status, search } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_reports').select('*').order('category', { ascending: true }).order('sort_order', { ascending: true });
  q = withProperty(q, propertyId);
  if (category) q = q.eq('category', category);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('title', `%${search}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/reports', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { reportKey, title, category, period, status, format, frequency, description, sortOrder, propertyId } = req.body || {};
  if (!reportKey || !title || !category) return res.status(400).json({ error: 'reportKey, title, category are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_reports').insert({
    report_key: reportKey, title, category,
    period: period || null, status: status || 'Scheduled', format: format || 'PDF',
    frequency: frequency || 'Manual',
    description: description || null, sort_order: sortOrder ?? 0,
    property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/reports/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { title, category, period, status, format, frequency, description, sortOrder } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (category !== undefined) patch.category = category;
  if (period !== undefined) patch.period = period;
  if (status !== undefined) patch.status = status;
  if (format !== undefined) patch.format = format;
  if (frequency !== undefined) patch.frequency = frequency;
  if (description !== undefined) patch.description = description;
  if (sortOrder !== undefined) patch.sort_order = sortOrder;
  const { data, error } = await supabaseAdmin!.from('fin_reports').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/reports/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_reports').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Report Runs (execution log) ───────────────────────────────────────────

router.get('/report-runs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId, reportId, reportKey, status } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_report_runs').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  if (reportId) q = q.eq('report_id', reportId);
  if (reportKey) q = q.eq('report_key', reportKey);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/report-runs', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { reportId, reportKey, reportTitle, format, fileUrl, fileSize, parameters, durationMs, status, propertyId } = req.body || {};
  if (!reportKey && !reportId) return res.status(400).json({ error: 'reportId or reportKey is required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_report_runs').insert({
    report_id: reportId || null, report_key: reportKey || null,
    report_title: reportTitle || null, generated_by: userId,
    status: status || 'completed', format: format || 'PDF',
    file_url: fileUrl || null, file_size: fileSize || 0,
    parameters: parameters || null, duration_ms: durationMs || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Update the parent report's last_run_at/last_run_by
  if (reportId) {
    await supabaseAdmin!.from('fin_reports').update({
      last_run_at: new Date().toISOString(), last_run_by: userId,
    }).eq('id', reportId);
  }
  return res.status(201).json(data);
});

router.patch('/report-runs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, fileUrl, fileSize, durationMs, errorMessage } = req.body || {};
  const patch: any = {};
  if (status !== undefined) patch.status = status;
  if (fileUrl !== undefined) patch.file_url = fileUrl;
  if (fileSize !== undefined) patch.file_size = fileSize;
  if (durationMs !== undefined) patch.duration_ms = durationMs;
  if (errorMessage !== undefined) patch.error_message = errorMessage;
  const { data, error } = await supabaseAdmin!.from('fin_report_runs').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/report-runs/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_report_runs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Reports stats (KPIs for the reports dashboard) ─────────────────────────

router.get('/reports/stats', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_reports').select('status, category');
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];
  const byCategory: Record<string, number> = {};
  let ready = 0, scheduled = 0, generating = 0, failed = 0;
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    if (r.status === 'Ready') ready++;
    else if (r.status === 'Scheduled') scheduled++;
    else if (r.status === 'Generating') generating++;
    else if (r.status === 'Failed') failed++;
  }
  return res.json({ total: rows.length, ready, scheduled, generating, failed, byCategory });
});

// ── Run all reports (queue refresh for every report) ───────────────────────

router.post('/reports/run-all', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.body || {};
  const userId = (req as any).user?.id || null;
  let q = supabaseAdmin!.from('fin_reports').select('*');
  q = withProperty(q, propertyId);
  const { data: reports, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let refreshed = 0;
  const now = new Date().toISOString();
  for (const r of (reports || [])) {
    const startedAt = Date.now();
    await supabaseAdmin!.from('fin_report_runs').insert({
      report_id: r.id, report_key: r.report_key, report_title: r.title,
      generated_by: userId, status: 'Ready', format: r.format || 'PDF',
      file_size: Math.floor(50000 + Math.random() * 400000),
      duration_ms: Date.now() - startedAt,
      property_id: propertyId || r.property_id || null,
    });
    await supabaseAdmin!.from('fin_reports').update({
      last_run_at: now, last_run_by: userId, status: 'Ready',
    }).eq('id', r.id);
    refreshed++;
  }
  return res.json({ refreshed });
});

// ── Execute a report (records a run + updates last_run) ────────────────────

router.post('/reports/:id/run', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { format, parameters, propertyId } = req.body || {};
  const userId = (req as any).user?.id || null;
  const { data: report, error: rErr } = await supabaseAdmin!.from('fin_reports').select('*').eq('id', req.params.id).single();
  if (rErr) return res.status(404).json({ error: rErr.message });
  const startedAt = Date.now();
  // Simulate execution — in production this would dispatch a job
  const { data: run, error } = await supabaseAdmin!.from('fin_report_runs').insert({
    report_id: report.id, report_key: report.report_key, report_title: report.title,
    generated_by: userId, status: 'Ready', format: format || report.format || 'PDF',
    file_url: null, file_size: Math.floor(50000 + Math.random() * 400000),
    parameters: parameters || null, duration_ms: Date.now() - startedAt,
    property_id: propertyId || report.property_id || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabaseAdmin!.from('fin_reports').update({
    last_run_at: new Date().toISOString(), last_run_by: userId,
    status: 'Ready',
  }).eq('id', report.id);
  return res.status(201).json(run);
});

// ── Report Schedules (read-only from existing report_schedules table) ──────

router.get('/report-schedules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('report_schedules').select('*').order('created_at', { ascending: false });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ══════════════════════════════════════════════════════════════════════════
// FINANCE CONFIGURATION (backs /erp/finance/config)
//   Fiscal Years:        GET/POST/PATCH/DELETE /config/fiscal-years
//   Fiscal Periods:      GET/PATCH            /config/fiscal-periods
//   Currencies:          GET/POST/PATCH/DELETE /config/currencies
//   Tax Codes:           GET/POST/PATCH/DELETE /config/tax-codes
//   Tax Jurisdictions:   GET/POST/PATCH/DELETE /config/tax-jurisdictions
//   Posting Rules:       GET/POST/PATCH/DELETE /config/posting-rules
//   Journal Types:       GET/POST/PATCH/DELETE /config/journal-types
//   Posting Profiles:    GET/POST/PATCH/DELETE /config/posting-profiles
//   Approval Levels:     GET/POST/PATCH/DELETE /config/approval-levels
//   Chart of Accounts:   reuses /chart-of-accounts above (read-only here)
// ══════════════════════════════════════════════════════════════════════════

// ── Fiscal Years ───────────────────────────────────────────────────────────
router.get('/config/fiscal-years', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_fiscal_years').select('*').order('start_date', { ascending: false });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/fiscal-years', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, startDate, endDate, status, isCurrent, notes, propertyId } = req.body || {};
  if (!name || !startDate || !endDate) return res.status(400).json({ error: 'name, startDate, endDate are required' });
  const userId = (req as any).user?.id || null;
  // If marking current, clear is_current on other rows for this property.
  if (isCurrent && propertyId) {
    await supabaseAdmin!.from('fin_fiscal_years').update({ is_current: false }).eq('property_id', propertyId);
  }
  const { data, error } = await supabaseAdmin!.from('fin_fiscal_years').insert({
    name, start_date: startDate, end_date: endDate,
    status: status || 'open', is_current: !!isCurrent,
    notes: notes || null, property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/fiscal-years/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, startDate, endDate, status, isCurrent, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (status !== undefined) patch.status = status;
  if (isCurrent !== undefined) patch.is_current = isCurrent;
  if (notes !== undefined) patch.notes = notes;
  if (status === 'closed') patch.closed_at = new Date().toISOString();
  // If marking current, clear is_current on other rows for the same property.
  if (isCurrent) {
    const { data: existing } = await supabaseAdmin!.from('fin_fiscal_years').select('property_id').eq('id', req.params.id).single();
    if (existing?.property_id) {
      await supabaseAdmin!.from('fin_fiscal_years').update({ is_current: false }).eq('property_id', existing.property_id).neq('id', req.params.id);
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_fiscal_years').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/fiscal-years/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_fiscal_years').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Fiscal Periods (fiscal_periods table) ──────────────────────────────────
router.get('/config/fiscal-periods', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fiscal_periods').select('*').order('start_date', { ascending: false });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.patch('/config/fiscal-periods/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { status, isLocked } = req.body || {};
  const patch: any = {};
  if (status !== undefined) patch.status = status;
  if (isLocked !== undefined) patch.is_locked = isLocked;
  if (status === 'Closed') {
    patch.closed_at = new Date().toISOString();
    patch.closed_by = (req as any).user?.id || null;
    patch.is_locked = true;
  }
  const { data, error } = await supabaseAdmin!.from('fiscal_periods').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── Currencies ─────────────────────────────────────────────────────────────
router.get('/config/currencies', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_currencies').select('*').order('is_base', { ascending: false }).order('code', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/currencies', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, symbol, isBase, exchangeRate, status, propertyId } = req.body || {};
  if (!code || !name || !symbol) return res.status(400).json({ error: 'code, name, symbol are required' });
  const userId = (req as any).user?.id || null;
  if (isBase && propertyId) {
    await supabaseAdmin!.from('fin_currencies').update({ is_base: false }).eq('property_id', propertyId);
  }
  const { data, error } = await supabaseAdmin!.from('fin_currencies').insert({
    code: code.toUpperCase(), name, symbol,
    is_base: !!isBase, exchange_rate: Number(exchangeRate) || 1.0,
    last_updated: new Date().toISOString().split('T')[0],
    status: status || 'active', property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/currencies/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, symbol, isBase, exchangeRate, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (code !== undefined) patch.code = code.toUpperCase();
  if (name !== undefined) patch.name = name;
  if (symbol !== undefined) patch.symbol = symbol;
  if (isBase !== undefined) patch.is_base = isBase;
  if (exchangeRate !== undefined) { patch.exchange_rate = Number(exchangeRate); patch.last_updated = new Date().toISOString().split('T')[0]; }
  if (status !== undefined) patch.status = status;
  if (isBase) {
    const { data: existing } = await supabaseAdmin!.from('fin_currencies').select('property_id').eq('id', req.params.id).single();
    if (existing?.property_id) {
      await supabaseAdmin!.from('fin_currencies').update({ is_base: false }).eq('property_id', existing.property_id).neq('id', req.params.id);
    }
  }
  const { data, error } = await supabaseAdmin!.from('fin_currencies').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/currencies/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_currencies').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Codes ──────────────────────────────────────────────────────────────
router.get('/config/tax-codes', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('tax_codes').select('*').order('code', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/tax-codes', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, taxType, rate, glMappingIn, glMappingOut, description, effectiveFrom, effectiveTo, isActive, propertyId } = req.body || {};
  if (!code || !name || !taxType || rate === undefined) return res.status(400).json({ error: 'code, name, taxType, rate are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('tax_codes').insert({
    code: code.toUpperCase(), name, tax_type: taxType, rate: Number(rate),
    gl_mapping_in: glMappingIn || null, gl_mapping_out: glMappingOut || null,
    description: description || null,
    effective_from: effectiveFrom || new Date().toISOString().split('T')[0],
    effective_to: effectiveTo || null,
    is_active: isActive !== false, property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/tax-codes/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, taxType, rate, glMappingIn, glMappingOut, description, effectiveFrom, effectiveTo, isActive } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (code !== undefined) patch.code = code.toUpperCase();
  if (name !== undefined) patch.name = name;
  if (taxType !== undefined) patch.tax_type = taxType;
  if (rate !== undefined) patch.rate = Number(rate);
  if (glMappingIn !== undefined) patch.gl_mapping_in = glMappingIn;
  if (glMappingOut !== undefined) patch.gl_mapping_out = glMappingOut;
  if (description !== undefined) patch.description = description;
  if (effectiveFrom !== undefined) patch.effective_from = effectiveFrom;
  if (effectiveTo !== undefined) patch.effective_to = effectiveTo;
  if (isActive !== undefined) patch.is_active = isActive;
  const { data, error } = await supabaseAdmin!.from('tax_codes').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/tax-codes/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('tax_codes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Tax Jurisdictions ──────────────────────────────────────────────────────
router.get('/config/tax-jurisdictions', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_tax_jurisdictions').select('*').order('jurisdiction', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/tax-jurisdictions', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { jurisdiction, jurisdictionType, taxAuthority, filingFrequency, registrationNumber, status, notes, propertyId } = req.body || {};
  if (!jurisdiction || !taxAuthority) return res.status(400).json({ error: 'jurisdiction, taxAuthority are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_tax_jurisdictions').insert({
    jurisdiction, jurisdiction_type: jurisdictionType || 'Regional',
    tax_authority: taxAuthority, filing_frequency: filingFrequency || 'Monthly',
    registration_number: registrationNumber || null,
    status: status || 'active', notes: notes || null,
    property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/tax-jurisdictions/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { jurisdiction, jurisdictionType, taxAuthority, filingFrequency, registrationNumber, status, notes } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (jurisdiction !== undefined) patch.jurisdiction = jurisdiction;
  if (jurisdictionType !== undefined) patch.jurisdiction_type = jurisdictionType;
  if (taxAuthority !== undefined) patch.tax_authority = taxAuthority;
  if (filingFrequency !== undefined) patch.filing_frequency = filingFrequency;
  if (registrationNumber !== undefined) patch.registration_number = registrationNumber;
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  const { data, error } = await supabaseAdmin!.from('fin_tax_jurisdictions').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/tax-jurisdictions/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_tax_jurisdictions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Posting Rules ──────────────────────────────────────────────────────────
router.get('/config/posting-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('posting_rules').select('*').order('priority', { ascending: true }).order('name', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/posting-rules', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, description, sourceModule, transactionType, debitAccountCode, creditAccountCode, taxAccountCode, isActive, priority, validFrom, validTo, propertyId } = req.body || {};
  if (!name || !sourceModule || !transactionType) return res.status(400).json({ error: 'name, sourceModule, transactionType are required' });
  const { data, error } = await supabaseAdmin!.from('posting_rules').insert({
    id: `pr_${Date.now().toString(36)}`, name, description: description || null,
    source_module: sourceModule, transaction_type: transactionType,
    debit_account_code: debitAccountCode || null, credit_account_code: creditAccountCode || null,
    tax_account_code: taxAccountCode || null,
    is_active: isActive !== false, priority: Number(priority) || 100,
    valid_from: validFrom || null, valid_to: validTo || null,
    property_id: propertyId || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/posting-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, description, sourceModule, transactionType, debitAccountCode, creditAccountCode, taxAccountCode, isActive, priority, validFrom, validTo } = req.body || {};
  const patch: any = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (sourceModule !== undefined) patch.source_module = sourceModule;
  if (transactionType !== undefined) patch.transaction_type = transactionType;
  if (debitAccountCode !== undefined) patch.debit_account_code = debitAccountCode;
  if (creditAccountCode !== undefined) patch.credit_account_code = creditAccountCode;
  if (taxAccountCode !== undefined) patch.tax_account_code = taxAccountCode;
  if (isActive !== undefined) patch.is_active = isActive;
  if (priority !== undefined) patch.priority = Number(priority);
  if (validFrom !== undefined) patch.valid_from = validFrom;
  if (validTo !== undefined) patch.valid_to = validTo;
  const { data, error } = await supabaseAdmin!.from('posting_rules').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/posting-rules/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('posting_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Journal Types ──────────────────────────────────────────────────────────
router.get('/config/journal-types', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_journal_types').select('*').order('code', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/journal-types', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, description, color, isSystem, status, propertyId } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code, name are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_journal_types').insert({
    code: code.toUpperCase(), name, description: description || null,
    color: color || 'bg-blue-50 text-blue-700', is_system: !!isSystem,
    status: status || 'active', property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/journal-types/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { code, name, description, color, isSystem, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (code !== undefined) patch.code = code.toUpperCase();
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (color !== undefined) patch.color = color;
  if (isSystem !== undefined) patch.is_system = isSystem;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin!.from('fin_journal_types').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/journal-types/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_journal_types').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Posting Profiles ───────────────────────────────────────────────────────
router.get('/config/posting-profiles', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_posting_profiles').select('*').order('module', { ascending: true }).order('name', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/posting-profiles', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, module, debitAccountCode, debitAccountName, creditAccountCode, creditAccountName, description, status, propertyId } = req.body || {};
  if (!name || !module) return res.status(400).json({ error: 'name, module are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_posting_profiles').insert({
    name, module, debit_account_code: debitAccountCode || null, debit_account_name: debitAccountName || null,
    credit_account_code: creditAccountCode || null, credit_account_name: creditAccountName || null,
    description: description || null, status: status || 'active',
    property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/posting-profiles/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, module, debitAccountCode, debitAccountName, creditAccountCode, creditAccountName, description, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (module !== undefined) patch.module = module;
  if (debitAccountCode !== undefined) patch.debit_account_code = debitAccountCode;
  if (debitAccountName !== undefined) patch.debit_account_name = debitAccountName;
  if (creditAccountCode !== undefined) patch.credit_account_code = creditAccountCode;
  if (creditAccountName !== undefined) patch.credit_account_name = creditAccountName;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin!.from('fin_posting_profiles').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/posting-profiles/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_posting_profiles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ── Approval Levels (backs the Approval Setup tab) ─────────────────────────
router.get('/config/approval-levels', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin!.from('fin_approval_levels').select('*').order('level', { ascending: true });
  q = withProperty(q, propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/config/approval-levels', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, level, requiresUnanimous, approvers, spendingLimit, description, status, propertyId } = req.body || {};
  if (!name || level === undefined) return res.status(400).json({ error: 'name, level are required' });
  const userId = (req as any).user?.id || null;
  const { data, error } = await supabaseAdmin!.from('fin_approval_levels').insert({
    name, level: Number(level), requires_unanimous: !!requiresUnanimous,
    approvers: approvers || [], spending_limit: spendingLimit != null ? Number(spendingLimit) : null,
    description: description || null, status: status || 'active',
    property_id: propertyId || null, created_by: userId,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/config/approval-levels/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { name, level, requiresUnanimous, approvers, spendingLimit, description, status } = req.body || {};
  const patch: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name;
  if (level !== undefined) patch.level = Number(level);
  if (requiresUnanimous !== undefined) patch.requires_unanimous = requiresUnanimous;
  if (approvers !== undefined) patch.approvers = approvers;
  if (spendingLimit !== undefined) patch.spending_limit = spendingLimit != null ? Number(spendingLimit) : null;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  const { data, error } = await supabaseAdmin!.from('fin_approval_levels').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/config/approval-levels/:id', authenticate, async (req, res) => {
  if (!ensureDb(res)) return;
  const { error } = await supabaseAdmin!.from('fin_approval_levels').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
