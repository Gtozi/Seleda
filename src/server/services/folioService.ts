/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Folio Management Service — business logic for the Folio & Billing
 * rebuild (docs/Folio & billing.md). Route handlers in
 * src/server/routes/folios.routes.ts are thin wrappers around these
 * functions.
 *
 * All monetary values come from the DB (folio_lines / folio_payments).
 * The folio_transactions view, folio_audit_logs table, and the
 * split/transfer/reverse/close/reopen/void RPCs were added in
 * migration 246_folio_management_rebuild.sql.
 */

import { supabaseAdmin, hasSupabaseAdminConfig } from '../supabaseAdmin';
import type { User } from '../../types/erp';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface FolioRow {
  id: string;
  reservation_id: string | null;
  folio_type: string;
  target_folio: string | null;
  status: string;
  balance: number;
  total_charges: number;
  total_payments: number;
  tax_total: number;
  service_charge_total: number;
  currency: string;
  opened_at: string;
  closed_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  notes: string | null;
  owner_type: string | null;
  owner_id: string | null;
  operator_id: string | null;
  group_id: string | null;
  parent_folio_id: string | null;
  credit_limit: number | null;
  folio_number: string | null;
  split_rules: any;
  bill_to_entity_id: string | null;
  created_at: string;
}

export interface FolioTreeNode {
  id: string;
  folioType: string;
  status: string;
  balance: number;
  totalCharges: number;
  totalPayments: number;
  currency: string;
  folioNumber: string | null;
  parentFolioId: string | null;
  reservationId: string | null;
  ownerType: string | null;
  ownerId: string | null;
  groupId: string | null;
  openedAt: string;
  closedAt: string | null;
  guestName: string | null;
  roomNumber: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  ownerName: string | null;
  depth: number;
  children: FolioTreeNode[];
}

export interface FolioTransaction {
  transactionId: string;
  folioId: string;
  transactionNumber: number;
  transactionDate: string;
  createdAt: string;
  transactionType: 'charge' | 'payment' | 'refund';
  category: string;
  description: string;
  reference: string | null;
  department: string;
  debit: number;
  credit: number;
  isVoided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  postedBy: string | null;
  reservationId: string | null;
  windowId: string | null;
  invoiceId: string | null;
  isRouted: boolean;
  routedFromFolioId: string | null;
  runningBalance: number;
}

export interface FolioAuditEntry {
  id: string;
  folioId: string;
  userId: string | null;
  user: string;
  action: string;
  description: string | null;
  amount: number | null;
  reference: string | null;
  sourceFolioId: string | null;
  destFolioId: string | null;
  reason: string | null;
  timestamp: string;
  source: string;
}

export interface FolioSummary {
  folio: FolioRow & {
    guestName?: string | null;
    roomNumber?: string | null;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    ownerName?: string | null;
  };
  balanceBreakdown: {
    totalCharges: number;
    totalPayments: number;
    adjustments: number;
    transfersIn: number;
    transfersOut: number;
    currentBalance: number;
  };
  linkedFolios: Array<{
    id: string;
    folioType: string;
    folioNumber: string | null;
    status: string;
    totalCharges: number;
    totalPayments: number;
    balance: number;
    guestName: string | null;
    roomNumber: string | null;
  }>;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

class FolioServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function ensureDb() {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    throw new FolioServiceError(503, 'Database not configured');
  }
  return supabaseAdmin;
}

function userLabel(user?: User | null): { id: string | null; name: string | null } {
  if (!user) return { id: null, name: null };
  return { id: user.id, name: user.name || user.username || null };
}

function snakeToCamelFolio(row: any): FolioRow {
  return {
    id: row.id,
    reservation_id: row.reservation_id ?? null,
    folio_type: row.folio_type ?? 'Guest',
    target_folio: row.target_folio ?? null,
    status: row.status ?? 'Open',
    balance: Number(row.balance ?? 0),
    total_charges: Number(row.total_charges ?? 0),
    total_payments: Number(row.total_payments ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    service_charge_total: Number(row.service_charge_total ?? 0),
    currency: row.currency ?? 'USD',
    opened_at: row.opened_at ?? null,
    closed_at: row.closed_at ?? null,
    created_by: row.created_by ?? null,
    updated_at: row.updated_at ?? null,
    notes: row.notes ?? null,
    owner_type: row.owner_type ?? null,
    owner_id: row.owner_id ?? null,
    operator_id: row.operator_id ?? null,
    group_id: row.group_id ?? null,
    parent_folio_id: row.parent_folio_id ?? null,
    credit_limit: row.credit_limit != null ? Number(row.credit_limit) : null,
    folio_number: row.folio_number ?? null,
    split_rules: row.split_rules ?? {},
    bill_to_entity_id: row.bill_to_entity_id ?? null,
    created_at: row.created_at ?? null,
  };
}

// ----------------------------------------------------------------
// Read operations
// ----------------------------------------------------------------

/**
 * List all folios with optional filters. Joins reservations + group_profiles
 * so the caller can build the Account → Master → Group → Guest tree.
 */
export async function listFolios(filters: {
  reservationId?: string;
  folioType?: string;
  status?: string;
  groupId?: string;
  ownerId?: string;
  search?: string;
}): Promise<any[]> {
  const db = ensureDb();
  let q = db.from('folios').select(`
    *,
    reservations ( guest_name, room_number, check_in_date, check_out_date )
  `);

  if (filters.reservationId) q = q.eq('reservation_id', filters.reservationId);
  if (filters.folioType) q = q.eq('folio_type', filters.folioType);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.groupId) q = q.eq('group_id', filters.groupId);
  if (filters.ownerId) q = q.eq('owner_id', filters.ownerId);

  q = q.order('opened_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw new FolioServiceError(500, error.message);

  // Resolve owner/group names from group_profiles.
  // Folios store codes (not ids): Company/Master folios use owner_id = code,
  // Group folios use group_id = code. Both match group_profiles.code.
  const rows = data || [];
  const codes = Array.from(
    new Set(
      rows
        .map((r: any) => r.owner_id || r.group_id)
        .filter(Boolean)
    )
  );
  if (codes.length > 0) {
    const { data: profiles } = await db
      .from('group_profiles')
      .select('code, name, organization_name')
      .in('code', codes);
    const byCode = new Map((profiles || []).map((p: any) => [p.code, p.organization_name || p.name]));
    rows.forEach((r: any) => {
      const code = r.owner_id || r.group_id;
      if (code && byCode.has(code)) {
        r.ownerName = byCode.get(code);
      }
    });
  }
  return rows;
}

/**
 * Fetch a single folio by id, with reservation + owner profile.
 */
export async function getFolio(folioId: string): Promise<any> {
  const db = ensureDb();
  const { data, error } = await db
    .from('folios')
    .select(`*, reservations ( guest_name, room_number, check_in_date, check_out_date )`)
    .eq('id', folioId)
    .maybeSingle();
  if (error) throw new FolioServiceError(500, error.message);
  if (!data) throw new FolioServiceError(404, 'Folio not found');

  // Resolve owner/group name from group_profiles by code
  // (folios store codes in owner_id / group_id, not group_profiles.id)
  let ownerName: string | null = null;
  const lookupCode = data.owner_id || data.group_id;
  if (lookupCode) {
    const { data: profile } = await db
      .from('group_profiles')
      .select('name, organization_name')
      .eq('code', lookupCode)
      .maybeSingle();
    if (profile) ownerName = profile.organization_name || profile.name;
  }

  return { ...data, ownerName };
}

/**
 * Fetch the full folio tree rooted at a Company/Master folio.
 */
export async function getFolioTree(rootFolioId: string): Promise<FolioTreeNode[]> {
  const db = ensureDb();
  const { data, error } = await db.rpc('get_folio_tree', { p_root_folio_id: rootFolioId });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(404, data?.error || 'Folio not found');

  const nodes: FolioTreeNode[] = (data.nodes || []).map((n: any) => ({
    id: n.id,
    folioType: n.folioType,
    status: n.status,
    balance: Number(n.balance ?? 0),
    totalCharges: Number(n.totalCharges ?? 0),
    totalPayments: Number(n.totalPayments ?? 0),
    currency: n.currency ?? 'USD',
    folioNumber: n.folioNumber,
    parentFolioId: n.parentFolioId,
    reservationId: n.reservationId,
    ownerType: n.ownerType,
    ownerId: n.ownerId,
    groupId: n.groupId,
    openedAt: n.openedAt,
    closedAt: n.closedAt,
    guestName: n.guestName,
    roomNumber: n.roomNumber,
    checkInDate: n.checkInDate,
    checkOutDate: n.checkOutDate,
    ownerName: n.ownerName ?? null,
    depth: n.depth,
    children: [],
  }));

  // Build the nested tree from the flat depth-ordered list
  const byId = new Map<string, FolioTreeNode>();
  nodes.forEach((n) => byId.set(n.id, n));
  const roots: FolioTreeNode[] = [];
  nodes.forEach((n) => {
    if (n.parentFolioId && byId.has(n.parentFolioId)) {
      byId.get(n.parentFolioId)!.children.push(n);
    } else {
      roots.push(n);
    }
  });
  return roots;
}

/**
 * Fetch the unified transaction ledger for a folio with a running balance.
 */
export async function getFolioTransactions(
  folioId: string,
  filters: {
    type?: string;
    department?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  } = {}
): Promise<FolioTransaction[]> {
  const db = ensureDb();
  const { data: folio, error: folioErr } = await db
    .from('folios')
    .select('id')
    .eq('id', folioId)
    .maybeSingle();
  if (folioErr) throw new FolioServiceError(500, folioErr.message);
  if (!folio) throw new FolioServiceError(404, 'Folio not found');

  // Pull charges and payments separately so we can apply filters and
  // compute a running balance in JS (the view doesn't carry a balance).
  let lineQuery = db
    .from('folio_lines')
    .select('*')
    .eq('folio_id', folioId)
    .order('transaction_date', { ascending: true })
    .order('line_number', { ascending: true });

  let payQuery = db
    .from('folio_payments')
    .select('*')
    .eq('folio_id', folioId)
    .order('payment_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (filters.startDate) {
    lineQuery = lineQuery.gte('transaction_date', filters.startDate);
    payQuery = payQuery.gte('payment_date', filters.startDate);
  }
  if (filters.endDate) {
    lineQuery = lineQuery.lte('transaction_date', filters.endDate);
    payQuery = payQuery.lte('payment_date', filters.endDate);
  }

  const [{ data: lines, error: lineErr }, { data: payments, error: payErr }] = await Promise.all([
    lineQuery,
    payQuery,
  ]);
  if (lineErr) throw new FolioServiceError(500, lineErr.message);
  if (payErr) throw new FolioServiceError(500, payErr.message);

  const txns: FolioTransaction[] = [];

  for (const l of lines || []) {
    if (filters.type && filters.type !== 'charge') continue;
    if (filters.department && l.source_module !== filters.department) continue;
    if (filters.status === 'posted' && l.is_voided) continue;
    if (filters.status === 'voided' && !l.is_voided) continue;
    txns.push({
      transactionId: l.id,
      folioId,
      transactionNumber: l.line_number,
      transactionDate: l.transaction_date,
      createdAt: l.created_at,
      transactionType: 'charge',
      category: l.line_type,
      description: l.description,
      reference: l.source_reference ?? null,
      department: l.source_module ?? 'Front Office',
      debit: l.is_voided ? 0 : Number(l.amount ?? 0),
      credit: 0,
      isVoided: !!l.is_voided,
      voidedAt: l.voided_at ?? null,
      voidReason: l.void_reason ?? null,
      postedBy: l.created_by ?? null,
      reservationId: l.reservation_id ?? null,
      windowId: l.window_id ?? null,
      invoiceId: l.invoice_id ?? null,
      isRouted: !!l.is_routed,
      routedFromFolioId: l.routed_from_folio_id ?? null,
      runningBalance: 0,
    });
  }

  for (const p of payments || []) {
    if (filters.type && filters.type !== 'payment' && filters.type !== 'refund') continue;
    if (filters.status === 'posted' && p.is_voided) continue;
    if (filters.status === 'voided' && !p.is_voided) continue;
    const isRefund = !!p.is_refund;
    txns.push({
      transactionId: p.id,
      folioId,
      transactionNumber: 0,
      transactionDate: p.payment_date,
      createdAt: p.created_at,
      transactionType: isRefund ? 'refund' : 'payment',
      category: p.payment_method,
      description: p.notes || p.payment_method,
      reference: p.reference_number ?? null,
      department: 'Finance',
      debit: 0,
      credit: p.is_voided ? 0 : (isRefund ? -Number(p.amount ?? 0) : Number(p.amount ?? 0)),
      isVoided: !!p.is_voided,
      voidedAt: p.voided_at ?? null,
      voidReason: p.void_reason ?? null,
      postedBy: p.created_by ?? null,
      reservationId: p.reservation_id ?? null,
      windowId: null,
      invoiceId: p.invoice_id ?? null,
      isRouted: false,
      routedFromFolioId: null,
      runningBalance: 0,
    });
  }

  // Sort by date then created_at, assign sequential transaction numbers + running balance
  txns.sort((a, b) => {
    const da = a.transactionDate || a.createdAt;
    const db = b.transactionDate || b.createdAt;
    if (da < db) return -1;
    if (da > db) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  let running = 0;
  txns.forEach((t, i) => {
    t.transactionNumber = i + 1;
    running += t.debit - t.credit;
    t.runningBalance = Math.round(running * 100) / 100;
  });

  return txns;
}

/**
 * Fetch the folio summary (header info + balance breakdown + linked folios).
 */
export async function getFolioSummary(folioId: string): Promise<FolioSummary> {
  const db = ensureDb();
  const folio = await getFolio(folioId);

  // Linked folios = children via parent_folio_id
  const { data: children, error: childErr } = await db
    .from('folios')
    .select(`*, reservations ( guest_name, room_number )`)
    .eq('parent_folio_id', folioId);
  if (childErr) throw new FolioServiceError(500, childErr.message);

  const linkedFolios = (children || []).map((c: any) => ({
    id: c.id,
    folioType: c.folio_type,
    folioNumber: c.folio_number,
    status: c.status,
    totalCharges: Number(c.total_charges ?? 0),
    totalPayments: Number(c.total_payments ?? 0),
    balance: Number(c.balance ?? 0),
    guestName: c.reservations?.guest_name ?? null,
    roomNumber: c.reservations?.room_number ?? null,
  }));

  return {
    folio,
    balanceBreakdown: {
      totalCharges: Number(folio.total_charges ?? 0),
      totalPayments: Number(folio.total_payments ?? 0),
      adjustments: 0,
      transfersIn: 0,
      transfersOut: 0,
      currentBalance: Number(folio.balance ?? 0),
    },
    linkedFolios,
  };
}

/**
 * Fetch the immutable activity timeline for a folio.
 */
export async function getFolioAuditTimeline(folioId: string): Promise<FolioAuditEntry[]> {
  const db = ensureDb();
  const { data, error } = await db.rpc('get_folio_audit_timeline', { p_folio_id: folioId });
  if (error) throw new FolioServiceError(500, error.message);
  return (data || []).map((e: any) => ({
    id: e.id,
    folioId: e.folioId,
    userId: e.userId,
    user: e.user,
    action: e.action,
    description: e.description,
    amount: e.amount != null ? Number(e.amount) : null,
    reference: e.reference,
    sourceFolioId: e.sourceFolioId,
    destFolioId: e.destFolioId,
    reason: e.reason,
    timestamp: e.timestamp,
    source: e.source,
  }));
}

// ----------------------------------------------------------------
// Write operations
// ----------------------------------------------------------------

/**
 * Post a charge to a folio. Spec §14. Applies tax/discount and writes
 * an audit entry. Returns the new line + updated balance.
 */
export async function postCharge(
  folioId: string,
  payload: {
    description: string;
    amount: number;
    quantity?: number;
    unitPrice?: number;
    lineType?: string;
    department?: string;
    reference?: string;
    revenueAccountCode?: string;
    taxAmount?: number;
    discountPercent?: number;
    targetFolio?: string;
    windowId?: string;
    reservationId?: string;
  },
  user?: User | null
): Promise<{ lineId: string; lineNumber: number; newBalance: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);

  const { data: folio, error: folioErr } = await db
    .from('folios')
    .select('id, status, currency, reservation_id')
    .eq('id', folioId)
    .maybeSingle();
  if (folioErr) throw new FolioServiceError(500, folioErr.message);
  if (!folio) throw new FolioServiceError(404, 'Folio not found');
  if (folio.status === 'Closed' || folio.status === 'Void' || folio.status === 'Suspended') {
    throw new FolioServiceError(400, `Cannot post charge to ${folio.status} folio`);
  }

  const qty = payload.quantity ?? 1;
  const unitPrice = payload.unitPrice ?? payload.amount;
  const subtotal = Math.round(unitPrice * qty * 100) / 100;
  const discountAmount =
    payload.discountPercent && payload.discountPercent > 0
      ? Math.round(subtotal * payload.discountPercent * 100) / 10000
      : 0;
  const taxAmount = payload.taxAmount ?? 0;
  const grandTotal = Math.round((subtotal - discountAmount + taxAmount) * 100) / 100;

  // ── Evaluate routing rules ──────────────────────────────────
  // Walk up the parent_folio_id chain to find a matching routing rule.
  // If found, post the charge to the target folio (with origin_folio_id
  // pointing back to this folio for audit trail). If not, post here.
  const lineType = payload.lineType || 'Other';
  const reservationId = payload.reservationId ?? folio.reservation_id ?? null;
  let targetFolioId = folioId;
  let isRouted = false;

  try {
    const { data: routingResult, error: routingErr } = await db.rpc('evaluate_routing_rules', {
      p_origin_folio_id: folioId,
      p_line_type: lineType,
      p_transaction_date: new Date().toISOString().slice(0, 10),
      p_reservation_id: reservationId,
    });
    if (!routingErr && routingResult && Array.isArray(routingResult) && routingResult.length > 0) {
      const rule = routingResult[0];
      if (rule.target_folio_id) {
        // Check max_amount cap
        if (rule.max_amount && rule.max_amount > 0) {
          const { data: alreadyRouted } = await db
            .from('folio_lines')
            .select('amount')
            .eq('origin_folio_id', folioId)
            .eq('is_routed', true)
            .eq('folio_id', rule.target_folio_id);
          const routedSum = (alreadyRouted || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
          if (routedSum + grandTotal <= rule.max_amount) {
            targetFolioId = rule.target_folio_id;
            isRouted = true;
          }
        } else {
          targetFolioId = rule.target_folio_id;
          isRouted = true;
        }
      }
    }
  } catch (routingErr: any) {
    console.warn('[postCharge] Routing rule evaluation failed (non-fatal):', routingErr?.message);
  }

  // Next line number on the target folio
  const { data: maxRow } = await db
    .from('folio_lines')
    .select('line_number')
    .eq('folio_id', targetFolioId)
    .order('line_number', { ascending: false })
    .limit(1);
  const nextLineNo = (maxRow && maxRow.length > 0 ? maxRow[0].line_number : 0) + 1;

  const lineId = crypto.randomUUID();
  const { error: insertErr } = await db.from('folio_lines').insert({
    id: lineId,
    folio_id: targetFolioId,
    line_number: nextLineNo,
    transaction_date: new Date().toISOString().slice(0, 10),
    description: payload.description,
    amount: grandTotal,
    quantity: qty,
    unit_price: unitPrice,
    line_type: lineType,
    target_folio: payload.targetFolio ?? null,
    revenue_account_code: payload.revenueAccountCode ?? null,
    source_module: payload.department || 'Front Office',
    source_reference: payload.reference ?? null,
    tax_amount: taxAmount,
    window_id: payload.windowId ?? null,
    reservation_id: reservationId,
    origin_folio_id: folioId,
    is_routed: isRouted,
    routed_from_folio_id: isRouted ? folioId : null,
    created_by: userId,
  });
  if (insertErr) throw new FolioServiceError(500, insertErr.message);

  // Recompute totals for both folios
  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: targetFolioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);
  const newBalance = totals?.balance ?? 0;

  // If routed, also recompute the origin folio totals
  if (isRouted && targetFolioId !== folioId) {
    await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  }

  // Audit — write to both the target and origin folio
  await db.rpc('write_folio_audit', {
    p_folio_id: targetFolioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: isRouted ? 'charge_routed_in' : 'charge_posted',
    p_description: payload.description,
    p_amount: grandTotal,
    p_reference: payload.reference ?? null,
  });
  if (isRouted && targetFolioId !== folioId) {
    await db.rpc('write_folio_audit', {
      p_folio_id: folioId,
      p_user_id: userId,
      p_user_name: userName,
      p_action: 'charge_routed_out',
      p_description: payload.description,
      p_amount: grandTotal,
      p_reference: payload.reference ?? null,
    });
  }

  return { lineId, lineNumber: nextLineNo, newBalance, routedTo: isRouted ? targetFolioId : undefined };
}

/**
 * Post a payment to a folio. Spec §16.
 */
export async function postPayment(
  folioId: string,
  payload: {
    amount: number;
    paymentMethod: string;
    paymentSubType?: string;
    reference?: string;
    cardLastFour?: string;
    cardExpiry?: string;
    authorizationCode?: string;
    bankAccountId?: string;
    notes?: string;
    receiptUrl?: string;
    isRefund?: boolean;
    targetFolio?: string;
    reservationId?: string;
  },
  user?: User | null
): Promise<{ paymentId: string; newBalance: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);

  const { data: folio, error: folioErr } = await db
    .from('folios')
    .select('id, status, currency, reservation_id, balance')
    .eq('id', folioId)
    .maybeSingle();
  if (folioErr) throw new FolioServiceError(500, folioErr.message);
  if (!folio) throw new FolioServiceError(404, 'Folio not found');
  if (folio.status === 'Closed' || folio.status === 'Void' || folio.status === 'Suspended') {
    throw new FolioServiceError(400, `Cannot post payment to ${folio.status} folio`);
  }

  const paymentId = crypto.randomUUID();
  const { error: insertErr } = await db.from('folio_payments').insert({
    id: paymentId,
    folio_id: folioId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount: payload.amount,
    payment_method: payload.paymentMethod,
    payment_sub_type: payload.paymentSubType ?? null,
    reference_number: payload.reference ?? null,
    card_last_four: payload.cardLastFour ?? null,
    card_expiry: payload.cardExpiry ?? null,
    authorization_code: payload.authorizationCode ?? null,
    bank_account_id: payload.bankAccountId ?? null,
    notes: payload.notes ?? null,
    receipt_url: payload.receiptUrl ?? null,
    is_refund: payload.isRefund ?? false,
    target_folio: payload.targetFolio ?? null,
    reservation_id: payload.reservationId ?? folio.reservation_id,
    created_by: userId,
  });
  if (insertErr) throw new FolioServiceError(500, insertErr.message);

  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);
  const newBalance = totals?.balance ?? 0;

  await db.rpc('write_folio_audit', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: payload.isRefund ? 'refund_posted' : 'payment_posted',
    p_description: `${payload.isRefund ? 'Refund' : 'Payment'} — ${payload.paymentMethod}`,
    p_amount: payload.amount,
    p_reference: payload.reference ?? null,
  });

  return { paymentId, newBalance };
}

/**
 * Post split payments to a folio. Spec §16.
 * Each split has its own amount, method, reference, and bank account.
 */
export async function postSplitPayment(
  folioId: string,
  splits: Array<{
    amount: number;
    paymentMethod: string;
    paymentSubType?: string;
    reference?: string;
    cardLastFour?: string;
    cardExpiry?: string;
    authorizationCode?: string;
    bankAccountId?: string;
    notes?: string;
    receiptUrl?: string;
    isRefund?: boolean;
  }>,
  user?: User | null
): Promise<{ paymentIds: string[]; newBalance: number; totalPaid: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);

  const { data: folio, error: folioErr } = await db
    .from('folios')
    .select('id, status, currency, reservation_id, balance')
    .eq('id', folioId)
    .maybeSingle();
  if (folioErr) throw new FolioServiceError(500, folioErr.message);
  if (!folio) throw new FolioServiceError(404, 'Folio not found');
  if (folio.status === 'Closed' || folio.status === 'Void' || folio.status === 'Suspended') {
    throw new FolioServiceError(400, `Cannot post payment to ${folio.status} folio`);
  }

  if (!splits || splits.length === 0) {
    throw new FolioServiceError(400, 'At least one payment split is required');
  }

  const totalPaid = splits.reduce((sum, s) => sum + s.amount, 0);
  const paymentIds: string[] = [];

  for (const split of splits) {
    if (split.amount <= 0) throw new FolioServiceError(400, 'Each split amount must be positive');
    const paymentId = crypto.randomUUID();
    const { error: insertErr } = await db.from('folio_payments').insert({
      id: paymentId,
      folio_id: folioId,
      payment_date: new Date().toISOString().slice(0, 10),
      amount: split.amount,
      payment_method: split.paymentMethod,
      payment_sub_type: split.paymentSubType ?? null,
      reference_number: split.reference ?? null,
      card_last_four: split.cardLastFour ?? null,
      card_expiry: split.cardExpiry ?? null,
      authorization_code: split.authorizationCode ?? null,
      bank_account_id: split.bankAccountId ?? null,
      notes: split.notes ?? null,
      receipt_url: split.receiptUrl ?? null,
      is_refund: split.isRefund ?? false,
      reservation_id: folio.reservation_id,
      created_by: userId,
    });
    if (insertErr) throw new FolioServiceError(500, insertErr.message);
    paymentIds.push(paymentId);

    await db.rpc('write_folio_audit', {
      p_folio_id: folioId,
      p_user_id: userId,
      p_user_name: userName,
      p_action: split.isRefund ? 'refund_posted' : 'payment_posted',
      p_description: `${split.isRefund ? 'Refund' : 'Payment'} — ${split.paymentMethod}`,
      p_amount: split.amount,
      p_reference: split.reference ?? null,
    });
  }

  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);
  const newBalance = totals?.balance ?? 0;

  return { paymentIds, newBalance, totalPaid };
}

/**
 * Split selected lines from one folio to another. Spec §17.
 */
export async function splitFolio(
  sourceFolioId: string,
  lineIds: string[],
  options: {
    destFolioId?: string;
    destFolioType?: string;
    destReservationId?: string;
    reason?: string;
  },
  user?: User | null
): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('split_folio', {
    p_source_folio_id: sourceFolioId,
    p_line_ids: lineIds,
    p_dest_folio_id: options.destFolioId ?? null,
    p_dest_folio_type: options.destFolioType ?? 'Guest',
    p_dest_reservation_id: options.destReservationId ?? null,
    p_reason: options.reason ?? null,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Split failed');
  return data;
}

/**
 * Transfer transactions between folios. Spec §18.
 */
export async function transferFolio(
  sourceFolioId: string,
  destFolioId: string,
  options: {
    lineIds?: string[];
    transferType?: 'selected' | 'entire' | 'category';
    reason?: string;
    reference?: string;
  },
  user?: User | null
): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('transfer_folio_transactions', {
    p_source_folio_id: sourceFolioId,
    p_dest_folio_id: destFolioId,
    p_line_ids: options.lineIds ?? null,
    p_transfer_type: options.transferType ?? 'selected',
    p_reason: options.reason ?? null,
    p_reference: options.reference ?? null,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Transfer failed');
  return data;
}

/**
 * Reverse a posted charge. Spec §25.
 */
export async function reverseLine(
  lineId: string,
  reason: string,
  user?: User | null
): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('reverse_folio_line', {
    p_line_id: lineId,
    p_reason: reason,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Reverse failed');
  return data;
}

/**
 * Edit a folio line (description, amount, line type). Spec §24.
 * Only non-voided lines can be edited.
 */
export async function editLine(
  lineId: string,
  updates: {
    description?: string;
    amount?: number;
    lineType?: string;
    quantity?: number;
  },
  user?: User | null
): Promise<{ lineId: string; folioId: string; newBalance: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);

  // Fetch the line
  const { data: line, error: lineErr } = await db
    .from('folio_lines')
    .select('id, folio_id, is_voided, amount, description, line_type, quantity, unit_price')
    .eq('id', lineId)
    .maybeSingle();
  if (lineErr) throw new FolioServiceError(500, lineErr.message);
  if (!line) throw new FolioServiceError(404, 'Line not found');
  if (line.is_voided) throw new FolioServiceError(400, 'Cannot edit a voided line');

  const folioId = line.folio_id;
  const updateFields: Record<string, any> = {};

  if (updates.description !== undefined && updates.description !== line.description) {
    updateFields.description = updates.description;
  }
  if (updates.amount !== undefined && updates.amount !== Number(line.amount)) {
    updateFields.amount = updates.amount;
    // Recalculate unit_price if quantity is known
    const qty = updates.quantity ?? Number(line.quantity) ?? 1;
    updateFields.unit_price = qty > 0 ? Math.round(updates.amount / qty * 100) / 100 : updates.amount;
  }
  if (updates.lineType !== undefined && updates.lineType !== line.line_type) {
    updateFields.line_type = updates.lineType;
  }
  if (updates.quantity !== undefined && updates.quantity !== Number(line.quantity)) {
    updateFields.quantity = updates.quantity;
    const amt = updates.amount ?? Number(line.amount);
    updateFields.unit_price = updates.quantity > 0 ? Math.round(amt / updates.quantity * 100) / 100 : amt;
  }

  if (Object.keys(updateFields).length === 0) {
    // Nothing to update
    const { data: totals } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
    return { lineId, folioId, newBalance: totals?.balance ?? 0 };
  }

  const { error: updateErr } = await db.from('folio_lines').update(updateFields).eq('id', lineId);
  if (updateErr) throw new FolioServiceError(500, updateErr.message);

  // Recompute totals
  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);
  const newBalance = totals?.balance ?? 0;

  // Audit
  await db.rpc('write_folio_audit', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: 'line_edited',
    p_description: `Edited line ${lineId}`,
    p_reference: lineId,
  });

  return { lineId, folioId, newBalance };
}

/**
 * Void a folio line (soft delete — sets is_voided=true). Spec §25.
 * Unlike reverse, void does NOT create a reversal line.
 */
export async function voidLine(
  lineId: string,
  reason: string,
  user?: User | null
): Promise<{ lineId: string; folioId: string; newBalance: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);

  const { data: line, error: lineErr } = await db
    .from('folio_lines')
    .select('id, folio_id, is_voided, amount')
    .eq('id', lineId)
    .maybeSingle();
  if (lineErr) throw new FolioServiceError(500, lineErr.message);
  if (!line) throw new FolioServiceError(404, 'Line not found');
  if (line.is_voided) throw new FolioServiceError(400, 'Line already voided');

  const folioId = line.folio_id;

  const { error: updateErr } = await db
    .from('folio_lines')
    .update({
      is_voided: true,
      voided_at: new Date().toISOString(),
      void_reason: reason,
      voided_by: userId,
    })
    .eq('id', lineId);
  if (updateErr) throw new FolioServiceError(500, updateErr.message);

  // Recompute totals
  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);
  const newBalance = totals?.balance ?? 0;

  // Audit
  await db.rpc('write_folio_audit', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: 'line_voided',
    p_description: `Voided line ${lineId}`,
    p_amount: Math.abs(Number(line.amount)),
    p_reference: lineId,
    p_reason: reason,
  });

  return { lineId, folioId, newBalance };
}

/**
 * Void a payment.
 */
export async function voidPayment(
  folioId: string,
  paymentId: string,
  reason: string,
  user?: User | null
): Promise<{ newBalance: number }> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { error } = await db
    .from('folio_payments')
    .update({ is_voided: true, voided_at: new Date().toISOString(), void_reason: reason, voided_by: userId })
    .eq('id', paymentId)
    .eq('folio_id', folioId);
  if (error) throw new FolioServiceError(500, error.message);

  const { data: totals, error: totalsErr } = await db.rpc('recompute_folio_totals', { p_folio_id: folioId });
  if (totalsErr) throw new FolioServiceError(500, totalsErr.message);

  await db.rpc('write_folio_audit', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: 'payment_voided',
    p_description: 'Payment voided',
    p_reference: paymentId,
    p_reason: reason,
  });

  return { newBalance: totals?.balance ?? 0 };
}

/**
 * Close a folio. Spec §26.
 */
export async function closeFolio(folioId: string, reason?: string, user?: User | null): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('close_folio', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_reason: reason ?? null,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Close failed');
  return data;
}

/**
 * Reopen a closed folio. Spec §26.
 */
export async function reopenFolio(folioId: string, reason?: string, user?: User | null): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('reopen_folio', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_reason: reason ?? null,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Reopen failed');
  return data;
}

/**
 * Void a folio. Spec §26.
 */
export async function voidFolio(folioId: string, reason: string, user?: User | null): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const { data, error } = await db.rpc('void_folio', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_reason: reason,
  });
  if (error) throw new FolioServiceError(500, error.message);
  if (!data?.success) throw new FolioServiceError(400, data?.error || 'Void failed');
  return data;
}

/**
 * Update folio metadata (notes, credit_limit). Spec §9 Edit Folio.
 */
export async function updateFolio(
  folioId: string,
  updates: { notes?: string; credit_limit?: number; folio_number?: string },
  user?: User | null
): Promise<any> {
  const db = ensureDb();
  const { id: userId, name: userName } = userLabel(user);
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.credit_limit !== undefined) patch.credit_limit = updates.credit_limit;
  if (updates.folio_number !== undefined) patch.folio_number = updates.folio_number;

  const { data, error } = await db.from('folios').update(patch).eq('id', folioId).select().maybeSingle();
  if (error) throw new FolioServiceError(500, error.message);
  if (!data) throw new FolioServiceError(404, 'Folio not found');

  await db.rpc('write_folio_audit', {
    p_folio_id: folioId,
    p_user_id: userId,
    p_user_name: userName,
    p_action: 'folio_edited',
    p_description: 'Folio metadata updated',
    p_new_value: patch,
  });

  return data;
}

export { FolioServiceError };
