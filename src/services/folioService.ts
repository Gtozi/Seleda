/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Folio & Billing Service
 * Centralized client-side wrappers for all folio/billing API endpoints.
 *
 * All monetary values are sourced from the database via these endpoints — the
 * deprecated frontend helpers in src/utils/billing.ts should NOT be used for
 * monetary calculations.
 */

import {
  MappedFolio,
  MappedFolioLine,
  MappedFolioPayment,
} from './dataMapper';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface FolioListItem extends MappedFolio {
  guestName?: string;
  roomNumber?: string;
  checkInDate?: string;
  checkOutDate?: string;
}

export interface ReservationFolioResponse {
  folios: MappedFolio[];
  lines: MappedFolioLine[];
  payments: MappedFolioPayment[];
  consolidatedBalance: number;
  consolidatedCharges: number;
  consolidatedPayments: number;
  billingBreakdown: any | null;
}

export interface FolioBalanceResponse {
  folioId: string;
  folioType: string;
  totalCharges: number;
  totalPayments: number;
  outstandingBalance: number;
}

export interface AddChargePayload {
  description: string;
  amount: number;
  quantity?: number;
  lineType?: string;
  revenueAccountCode?: string | null;
  sourceReference?: string | null;
  discountPercent?: number;
  targetFolio?: 'A' | 'B' | null;
  usaliCode?: string | null;
  usaliRevenueCode?: string | null;
  usaliCostCode?: string | null;
  department?: string | null;
}

export interface AddChargeResponse {
  success: boolean;
  folioId: string;
  lineId: string;
  lineNumber: number;
  newBalance: number;
}

export interface PaymentSplit {
  amount: number;
  paymentMethod: string;
  reference?: string | null;
  receiptUrl?: string | null;
  bankAccountId?: string | null;
  idempotencyKey?: string | null;
}

export interface PaymentResult {
  success: boolean;
  folioId: string;
  paymentId: string;
  idempotent?: boolean;
  message?: string;
  amount: number;
  method: string;
}

export interface InvoiceDocument {
  id: string;
  folio_id: string;
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
  amount_paid: number;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_tin: string | null;
  customer_vat_no: string | null;
  notes: string | null;
}

export interface GenerateInvoiceResponse {
  success: boolean;
  invoice: InvoiceDocument;
  paymentsLinked: number;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data?.error || data?.message || fallback;
  } catch {
    return fallback;
  }
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
}

// ----------------------------------------------------------------
// Read endpoints
// ----------------------------------------------------------------

/**
 * Fetch all folios (optionally filtered by reservation_id). The endpoint joins
 * the reservations table so each folio carries guest_name / room_number for the
 * list view.
 */
export async function fetchFolios(reservationId?: string): Promise<FolioListItem[]> {
  const params = new URLSearchParams();
  if (reservationId) params.append('reservation_id', reservationId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const response = await authFetch(`/api/folios${qs}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folios'));
  const data = await response.json();

  return (data.folios || []).map((row: any) => ({
    id: String(row.id ?? ''),
    reservationId: String(row.reservation_id ?? ''),
    folioType: String(row.folio_type ?? 'Guest'),
    targetFolio: row.target_folio ? String(row.target_folio) : undefined,
    status: String(row.status ?? 'Open'),
    balance: Number(row.balance ?? 0),
    totalCharges: Number(row.total_charges ?? 0),
    totalPayments: Number(row.total_payments ?? 0),
    taxTotal: Number(row.tax_total ?? 0),
    serviceChargeTotal: Number(row.service_charge_total ?? 0),
    currency: String(row.currency ?? 'USD'),
    openedAt: String(row.opened_at ?? ''),
    closedAt: row.closed_at ? String(row.closed_at) : undefined,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    // joined reservation fields
    guestName: row.reservations?.guest_name ? String(row.reservations.guest_name) : undefined,
    roomNumber: row.reservations?.room_number ? String(row.reservations.room_number) : undefined,
    checkInDate: row.reservations?.check_in_date ? String(row.reservations.check_in_date) : undefined,
    checkOutDate: row.reservations?.check_out_date ? String(row.reservations.check_out_date) : undefined,
    groupId: row.group_id ? String(row.group_id) : undefined,
    ownerType: row.owner_type ? String(row.owner_type) : undefined,
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    parentFolioId: row.parent_folio_id ? String(row.parent_folio_id) : undefined,
  }));
}

/**
 * Fetch all folios for a group booking, grouped by folio type.
 */
export async function fetchGroupFolios(groupId: string): Promise<{
  groupFolio: FolioListItem | null;
  companyFolio: FolioListItem | null;
  guestFolios: FolioListItem[];
  masterFolios: FolioListItem[];
  incidentalFolios: FolioListItem[];
  all: FolioListItem[];
}> {
  const response = await authFetch(`/api/folios/group/${encodeURIComponent(groupId)}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch group folios'));
  const data = await response.json();

  const mapFolio = (row: any): FolioListItem => ({
    id: String(row.id ?? ''),
    reservationId: String(row.reservation_id ?? ''),
    folioType: String(row.folio_type ?? 'Guest'),
    targetFolio: row.target_folio ? String(row.target_folio) : undefined,
    status: String(row.status ?? 'Open'),
    balance: Number(row.balance ?? 0),
    totalCharges: Number(row.total_charges ?? 0),
    totalPayments: Number(row.total_payments ?? 0),
    taxTotal: 0,
    serviceChargeTotal: 0,
    currency: String(row.currency ?? 'USD'),
    openedAt: String(row.opened_at ?? ''),
    closedAt: row.closed_at ? String(row.closed_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    groupId: row.group_id ? String(row.group_id) : undefined,
    ownerType: row.owner_type ? String(row.owner_type) : undefined,
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    guestName: row.reservations?.guest_name ? String(row.reservations.guest_name) : undefined,
    roomNumber: row.reservations?.room_number ? String(row.reservations.room_number) : undefined,
    checkInDate: row.reservations?.check_in_date ? String(row.reservations.check_in_date) : undefined,
    checkOutDate: row.reservations?.check_out_date ? String(row.reservations.check_out_date) : undefined,
  });

  return {
    groupFolio: data.groupFolio ? mapFolio(data.groupFolio) : null,
    companyFolio: data.companyFolio ? mapFolio(data.companyFolio) : null,
    guestFolios: (data.guestFolios || []).map(mapFolio),
    masterFolios: (data.masterFolios || []).map(mapFolio),
    incidentalFolios: (data.incidentalFolios || []).map(mapFolio),
    all: (data.all || []).map(mapFolio),
  };
}

/**
 * Fetch consolidated charges + payments across all folios in a group.
 */
export async function fetchGroupConsolidatedFolio(groupId: string): Promise<{
  charges: any[];
  payments: any[];
  folios: any[];
  totals: { charges: number; payments: number; balance: number };
}> {
  const response = await authFetch(`/api/folios/group/${encodeURIComponent(groupId)}/consolidated`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch consolidated group folio'));
  return response.json();
}

/**
 * Fetch company folios for a corporate account / group profile.
 */
export async function fetchCompanyFolios(profileId: string): Promise<{
  folios: FolioListItem[];
  profile: any;
}> {
  const response = await authFetch(`/api/folios/company/${encodeURIComponent(profileId)}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch company folios'));
  const data = await response.json();

  const mapFolio = (row: any): FolioListItem => ({
    id: String(row.id ?? ''),
    reservationId: String(row.reservation_id ?? ''),
    folioType: String(row.folio_type ?? 'Company'),
    status: String(row.status ?? 'Open'),
    balance: Number(row.balance ?? 0),
    totalCharges: Number(row.total_charges ?? 0),
    totalPayments: Number(row.total_payments ?? 0),
    taxTotal: 0,
    serviceChargeTotal: 0,
    currency: String(row.currency ?? 'USD'),
    openedAt: String(row.opened_at ?? ''),
    closedAt: row.closed_at ? String(row.closed_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    groupId: row.group_id ? String(row.group_id) : undefined,
    ownerType: row.owner_type ? String(row.owner_type) : undefined,
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
  });

  return {
    folios: (data.folios || []).map(mapFolio),
    profile: data.profile,
  };
}

/**
 * Fetch the full Company → Group → Guest folio tree for a corporate account / group profile.
 * Includes A/R (invoices + payments) at each level.
 */
export interface CompanyFolioTree {
  profile: any;
  companyFolios: Array<{
    id: string;
    folio_type: string;
    status: string;
    balance: number;
    total_charges: number;
    total_payments: number;
    currency: string;
    group_id?: string;
    parent_folio_id?: string;
    opened_at: string;
    closed_at?: string;
    notes?: string;
    groupFolios: Array<{
      id: string;
      folio_type: string;
      status: string;
      balance: number;
      total_charges: number;
      total_payments: number;
      currency: string;
      group_id: string;
      parent_folio_id?: string;
      opened_at: string;
      closed_at?: string;
      notes?: string;
      guestFolios: any[];
      invoices: any[];
      payments: any[];
    }>;
    invoices: any[];
    payments: any[];
  }>;
  totals: { charges: number; payments: number; balance: number; invoiceCount: number; paymentCount: number };
}

export async function fetchCompanyFolioTree(profileId: string): Promise<CompanyFolioTree> {
  const response = await authFetch(`/api/folios/company/${encodeURIComponent(profileId)}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch company folio tree'));
  return response.json();
}

/**
 * Post a charge directly to a Group folio (transportation, banquet, etc.)
 */
export async function postGroupCharge(
  groupId: string,
  charge: { description: string; amount: number; quantity?: number; lineType?: string; discountPercent?: number }
): Promise<{ success: boolean; folioId: string; lineId?: string }> {
  const response = await authFetch(`/api/folios/group/${encodeURIComponent(groupId)}/charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(charge),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post group charge'));
  return response.json();
}

/**
 * Fetch the canonical folio (folios + lines + payments + billing breakdown) for
 * a reservation. This is the source of truth for the folio detail view.
 */
export async function fetchReservationFolio(
  reservationId: string,
  guestId?: string
): Promise<ReservationFolioResponse> {
  const qs = guestId ? `?guestId=${encodeURIComponent(guestId)}` : '';
  const response = await authFetch(`/api/${encodeURIComponent(reservationId)}/folio${qs}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio'));
  return response.json();
}

/**
 * Fetch a consolidated/A/B folio balance for a reservation.
 */
export async function fetchFolioBalance(
  reservationId: string,
  folioType: 'consolidated' | 'folio-a' | 'folio-b' = 'consolidated'
): Promise<FolioBalanceResponse> {
  const response = await authFetch(
    `/api/${encodeURIComponent(reservationId)}/folio-balance?folioType=${folioType}`
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio balance'));
  return response.json();
}

// ----------------------------------------------------------------
// Charge endpoints
// ----------------------------------------------------------------

/**
 * Post a charge to a reservation's folio. Creates the folio if it doesn't exist.
 */
export async function addCharge(reservationId: string, payload: AddChargePayload): Promise<AddChargeResponse> {
  const response = await authFetch(`/api/${encodeURIComponent(reservationId)}/charges`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post charge'));
  return response.json();
}

/**
 * Void a folio line (charge). Requires a reason.
 */
export async function voidCharge(
  reservationId: string,
  chargeId: string,
  reason: string,
  approvedBy?: string
): Promise<{ success: boolean; lineId: string; amountReversed: number }> {
  const response = await authFetch(
    `/api/${encodeURIComponent(reservationId)}/charges/${encodeURIComponent(chargeId)}/void`,
    {
      method: 'POST',
      body: JSON.stringify({ reason, approvedBy: approvedBy || null }),
    }
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void charge'));
  return response.json();
}

/**
 * Update a folio line (description, amount, quantity, line type, and/or target folio routing).
 */
export async function updateCharge(
  reservationId: string,
  chargeId: string,
  updates: { targetFolio?: 'A' | 'B' | null; amount?: number; description?: string; quantity?: number; lineType?: string }
): Promise<{ success: boolean; lineId: string }> {
  const response = await authFetch(
    `/api/${encodeURIComponent(reservationId)}/charges/${encodeURIComponent(chargeId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to update charge'));
  return response.json();
}

/**
 * Move a folio line to a different folio (e.g. Guest → Master, or A → B split).
 */
export async function moveCharge(
  lineId: string,
  targetFolioId: string
): Promise<{ success: boolean; lineId: string; fromFolio: string; toFolio: string }> {
  const response = await authFetch(
    `/api/folios/folio-lines/${encodeURIComponent(lineId)}/move`,
    {
      method: 'POST',
      body: JSON.stringify({ targetFolioId }),
    }
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to move charge'));
  return response.json();
}

// ----------------------------------------------------------------
// Payment endpoints
// ----------------------------------------------------------------

export interface BankAccount {
  id: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  accountType: string;
  currency: string;
  isDefaultForSales: boolean;
}

/**
 * Fetch active bank accounts for the payment dropdown.
 */
export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const response = await authFetch('/api/finance/bank-accounts');
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch bank accounts'));
  const data = await response.json();
  const accounts = data?.bankAccounts || [];
  return accounts
    .filter((a: any) => a.is_active !== false)
    .map((a: any) => ({
      id: a.id,
      accountName: a.account_name,
      bankName: a.bank_name,
      accountNumber: a.account_number,
      accountType: a.account_type,
      currency: a.currency,
      isDefaultForSales: !!a.is_default_for_sales,
    }))
    .sort((a: BankAccount, b: BankAccount) => {
      // Default-for-sales first, then alphabetical by bank name
      if (a.isDefaultForSales !== b.isDefaultForSales) return a.isDefaultForSales ? -1 : 1;
      return a.bankName.localeCompare(b.bankName);
    });
}

/**
 * Post a single payment or a set of split payments to a reservation's folio.
 */
export async function postPayment(
  reservationId: string,
  payment: PaymentSplit | PaymentSplit[],
  guestId?: string
): Promise<PaymentResult[]> {
  const body = Array.isArray(payment)
    ? { paymentSplits: payment, guestId: guestId || undefined }
    : {
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        receiptUrl: payment.receiptUrl,
        bankAccountId: payment.bankAccountId,
        idempotencyKey: payment.idempotencyKey,
        guestId: guestId || undefined,
      };

  const response = await authFetch(`/api/${encodeURIComponent(reservationId)}/payments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post payment'));
  const data = await response.json();
  // Endpoint returns either a single result or { paymentResults: [...] }
  if (Array.isArray(data?.paymentResults)) return data.paymentResults;
  return [data];
}

/**
 * Void a folio payment. Requires a reason.
 */
export async function voidPayment(
  reservationId: string,
  paymentId: string,
  reason: string
): Promise<{ success: boolean }> {
  const response = await authFetch(
    `/api/${encodeURIComponent(reservationId)}/payments/${encodeURIComponent(paymentId)}/void`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void payment'));
  return response.json();
}

// ----------------------------------------------------------------
// Invoice / folio close endpoints
// ----------------------------------------------------------------

/**
 * Generate an invoice document for a folio.
 * Pass lineIds to invoice only specific charge lines (partial invoicing).
 * When omitted, invoices all non-voided, non-invoiced lines.
 */
export async function generateInvoice(
  folioId: string,
  options?: { invoiceType?: string; dueDate?: string; notes?: string; lineIds?: string[] }
): Promise<GenerateInvoiceResponse> {
  console.log('[folioService] generateInvoice START', folioId);
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/generate-invoice`, {
    method: 'POST',
    body: JSON.stringify({
      invoiceType: options?.invoiceType || 'Guest',
      dueDate: options?.dueDate || null,
      notes: options?.notes || null,
      lineIds: options?.lineIds || null,
    }),
  });
  console.log('[folioService] generateInvoice response status:', response.status, response.ok);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to generate invoice'));
  const data = await response.json();
  console.log('[folioService] generateInvoice parsed data:', data);
  return data;
}

/**
 * Close a folio and generate its final invoice in one step.
 */
export async function closeFolioWithInvoice(folioId: string): Promise<any> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/close-with-invoice`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to close folio'));
  return response.json();
}

// ----------------------------------------------------------------
// Consolidated View — all charges across the folio hierarchy
// ----------------------------------------------------------------

export interface ConsolidatedFolioLine {
  id: string;
  folio_id: string;
  description: string;
  amount: number;
  quantity: number;
  line_type: string;
  is_voided: boolean;
  created_at: string;
  transaction_date?: string;
  window_id?: string;
  origin_folio_id?: string;
  is_routed?: boolean;
  routed_from_folio_id?: string;
  is_disputed?: boolean;
  invoice_id?: string;
  folio_type?: string;
  target_folio?: string;
  reservation_id?: string;
}

export interface ConsolidatedFolioData {
  folios: any[];
  lines: ConsolidatedFolioLine[];
  payments: any[];
  totals: {
    charges: number;
    payments: number;
    balance: number;
    folioCount: number;
  };
}

export async function fetchConsolidatedFolio(folioId: string): Promise<ConsolidatedFolioData> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/consolidated`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch consolidated folio'));
  return response.json();
}

// ----------------------------------------------------------------
// Move a folio line to a different folio
// ----------------------------------------------------------------

export async function moveFolioLine(lineId: string, targetFolioId: string, targetWindowId?: string): Promise<any> {
  const response = await authFetch(`/api/folios/folio-lines/${encodeURIComponent(lineId)}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetFolioId, targetWindowId }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to move charge'));
  return response.json();
}

/**
 * Fetch a single invoice document with full folio/payment details for preview/print.
 */
export async function fetchInvoice(invoiceId: string): Promise<any> {
  const response = await authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch invoice'));
  return response.json();
}

/**
 * Void an invoice document.
 */
export async function voidInvoice(invoiceId: string, reason?: string): Promise<{ success: boolean }> {
  const response = await authFetch(`/api/invoices/${encodeURIComponent(invoiceId)}/void`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void invoice'));
  return response.json();
}

export interface FolioInvoiceSummary {
  id: string;
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
  amount_paid: number;
  status: string;
  is_voided: boolean;
  created_at: string;
}

/**
 * Fetch all invoice documents for a folio.
 */
export async function fetchFolioInvoices(folioId: string): Promise<FolioInvoiceSummary[]> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/invoices`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio invoices'));
  const data = await response.json();
  return data?.invoices || [];
}

// ----------------------------------------------------------------
// Folio Windows — sub-folio windows for split billing
// ----------------------------------------------------------------

export interface FolioWindow {
  id: string;
  folio_id: string;
  window_number: number;
  label: string;
  payment_method_id?: string;
  routing_rule_id?: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function fetchFolioWindows(folioId: string): Promise<FolioWindow[]> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/windows`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio windows'));
  const data = await response.json();
  return data?.windows || [];
}

export async function createFolioWindow(
  folioId: string,
  options: { label?: string; paymentMethodId?: string; isDefault?: boolean }
): Promise<FolioWindow> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/windows`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to create folio window'));
  const data = await response.json();
  return data.window;
}

export async function updateFolioWindow(
  windowId: string,
  updates: { label?: string; paymentMethodId?: string; isDefault?: boolean }
): Promise<FolioWindow> {
  const response = await authFetch(`/api/folios/windows/${encodeURIComponent(windowId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to update folio window'));
  const data = await response.json();
  return data.window;
}

export async function deleteFolioWindow(windowId: string): Promise<void> {
  const response = await authFetch(`/api/folios/windows/${encodeURIComponent(windowId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to delete folio window'));
}

// ----------------------------------------------------------------
// Routing Rules — auto-sweep rules for charge routing
// ----------------------------------------------------------------

export interface RoutingRule {
  id: string;
  scope_folio_id: string;
  applies_to: 'all_charges' | 'charge_category' | 'specific_reservation';
  charge_category_filter: string[];
  specific_reservation_id?: string;
  target_folio_id?: string;
  target_window_id?: string;
  effective_from?: string;
  effective_to?: string;
  max_amount?: number;
  is_active: boolean;
  priority: number;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  notes?: string;
}

export async function fetchRoutingRules(folioId: string): Promise<RoutingRule[]> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/routing-rules`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch routing rules'));
  const data = await response.json();
  return data?.rules || [];
}

export async function createRoutingRule(
  folioId: string,
  rule: Partial<RoutingRule>
): Promise<RoutingRule> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/routing-rules`, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to create routing rule'));
  const data = await response.json();
  return data.rule;
}

export async function updateRoutingRule(
  ruleId: string,
  updates: Partial<RoutingRule>
): Promise<RoutingRule> {
  const response = await authFetch(`/api/folios/routing-rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to update routing rule'));
  const data = await response.json();
  return data.rule;
}

export async function deleteRoutingRule(ruleId: string): Promise<void> {
  const response = await authFetch(`/api/folios/routing-rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to delete routing rule'));
}

// ----------------------------------------------------------------
// Mass Post — post a charge to all member folios of a group
// ----------------------------------------------------------------

export interface MassPostResult {
  folioId: string;
  reservationId: string;
  success: boolean;
  isRouted: boolean;
  targetFolioId?: string;
  error?: string | null;
}

export async function massPostCharges(
  groupId: string,
  charge: {
    description: string;
    amount: number;
    lineType?: string;
    reservationIds?: string[];
  }
): Promise<{ posted: number; routed: number; failed: number; results: MassPostResult[] }> {
  const response = await authFetch(`/api/folios/group/${encodeURIComponent(groupId)}/mass-post`, {
    method: 'POST',
    body: JSON.stringify(charge),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to mass post charges'));
  return response.json();
}

// ----------------------------------------------------------------
// Charge Posting with Routing
// ----------------------------------------------------------------

export async function addChargeWithRouting(
  folioId: string,
  payload: {
    description: string;
    amount: number;
    quantity?: number;
    lineType?: string;
    revenueAccountCode?: string;
    sourceReference?: string;
    discountPercent?: number;
    reservationId?: string;
    sourceModule?: string;
  }
): Promise<{
  success: boolean;
  folioId: string;
  originFolioId: string;
  isRouted: boolean;
  ruleId?: string;
  lineId?: string;
}> {
  const response = await authFetch(`/api/folios/${encodeURIComponent(folioId)}/charges-routed`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post charge with routing'));
  return response.json();
}

// ================================================================
// V2 API — Folio Management rebuild (docs/Folio & billing.md)
// These wrappers hit the /api/folios/v2/* endpoints backed by the
// new folioService (src/server/services/folioService.ts) + migration 246.
// ================================================================

export interface FolioV2 {
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
  notes: string | null;
  owner_type: string | null;
  owner_id: string | null;
  group_id: string | null;
  parent_folio_id: string | null;
  credit_limit: number | null;
  folio_number: string | null;
  bill_to_entity_id: string | null;
  created_at: string;
  ownerName?: string | null;
  reservations?: { guest_name: string | null; room_number: string | null; check_in_date: string | null; check_out_date: string | null } | null;
}

export interface FolioTreeNodeV2 {
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
  children: FolioTreeNodeV2[];
}

export interface FolioTransactionV2 {
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

export interface FolioAuditEntryV2 {
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

export interface FolioSummaryV2 {
  folio: FolioV2;
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

// ── List folios (v2) ────────────────────────────────────────────
export async function listFoliosV2(filters: {
  reservationId?: string;
  folioType?: string;
  status?: string;
  groupId?: string;
  ownerId?: string;
} = {}): Promise<FolioV2[]> {
  const params = new URLSearchParams();
  if (filters.reservationId) params.append('reservationId', filters.reservationId);
  if (filters.folioType) params.append('folioType', filters.folioType);
  if (filters.status) params.append('status', filters.status);
  if (filters.groupId) params.append('groupId', filters.groupId);
  if (filters.ownerId) params.append('ownerId', filters.ownerId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(`/api/folios/v2${qs}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to list folios'));
  const data = await response.json();
  return data.folios || [];
}

// ── Get single folio (v2) ───────────────────────────────────────
export async function getFolioV2(folioId: string): Promise<FolioV2> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio'));
  const data = await response.json();
  return data.folio;
}

// ── Get folio tree (v2) ─────────────────────────────────────────
export async function getFolioTreeV2(folioId: string): Promise<FolioTreeNodeV2[]> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/tree`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio tree'));
  const data = await response.json();
  return data.tree || [];
}

// ── Get folio summary (v2) ──────────────────────────────────────
export async function getFolioSummaryV2(folioId: string): Promise<FolioSummaryV2> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/summary`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch folio summary'));
  return response.json();
}

// ── Get folio transactions (v2) ─────────────────────────────────
export async function getFolioTransactionsV2(
  folioId: string,
  filters: { type?: string; department?: string; startDate?: string; endDate?: string; status?: string } = {}
): Promise<FolioTransactionV2[]> {
  const params = new URLSearchParams();
  if (filters.type) params.append('type', filters.type);
  if (filters.department) params.append('department', filters.department);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.status) params.append('status', filters.status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/transactions${qs}`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch transactions'));
  const data = await response.json();
  return data.transactions || [];
}

// ── Get folio activity timeline (v2) ────────────────────────────
export async function getFolioActivityV2(folioId: string): Promise<FolioAuditEntryV2[]> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/activity`);
  if (!response.ok) throw new Error(await parseError(response, 'Failed to fetch activity timeline'));
  const data = await response.json();
  return data.entries || [];
}

// ── Post charge (v2) ────────────────────────────────────────────
export async function postChargeV2(
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
  }
): Promise<{ success: boolean; lineId: string; lineNumber: number; newBalance: number }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/charges`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post charge'));
  return response.json();
}

// ── Post payment (v2) ───────────────────────────────────────────
export async function postPaymentV2(
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
  }
): Promise<{ success: boolean; paymentId: string; newBalance: number }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/payments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post payment'));
  return response.json();
}

// ── Post split payments (v2) ────────────────────────────────────
export async function postSplitPaymentV2(
  folioId: string,
  splits: Array<{
    amount: number;
    paymentMethod: string;
    reference?: string;
    bankAccountId?: string;
    cardLastFour?: string;
    notes?: string;
  }>
): Promise<{ success: boolean; paymentIds: string[]; newBalance: number; totalPaid: number }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/payments`, {
    method: 'POST',
    body: JSON.stringify({ paymentSplits: splits }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to post split payment'));
  return response.json();
}

// ── Split folio (v2) ────────────────────────────────────────────
export async function splitFolioV2(
  folioId: string,
  payload: {
    lineIds: string[];
    destFolioId?: string;
    destFolioType?: string;
    destReservationId?: string;
    reason?: string;
  }
): Promise<{ success: boolean; sourceFolioId: string; destFolioId: string; movedCount: number; movedAmount: number }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/split`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to split folio'));
  return response.json();
}

// ── Transfer folio (v2) ─────────────────────────────────────────
export async function transferFolioV2(
  folioId: string,
  payload: {
    destFolioId: string;
    lineIds?: string[];
    transferType?: 'selected' | 'entire' | 'category';
    reason?: string;
    reference?: string;
  }
): Promise<{ success: boolean; sourceFolioId: string; destFolioId: string; movedCount: number; movedAmount: number }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to transfer folio'));
  return response.json();
}

// ── Reverse a charge (v2) ───────────────────────────────────────
export async function reverseChargeV2(
  lineId: string,
  reason: string
): Promise<{ success: boolean; folioId: string; originalLineId: string; reversalLineId: string; amountReversed: number }> {
  const response = await authFetch(`/api/folios/v2/lines/${encodeURIComponent(lineId)}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to reverse charge'));
  return response.json();
}

// ── Edit a charge line (v2) ─────────────────────────────────────
export async function editFolioLineV2(
  lineId: string,
  updates: { description?: string; amount?: number; lineType?: string; quantity?: number }
): Promise<{ success: boolean; lineId: string; folioId: string; newBalance: number }> {
  const response = await authFetch(`/api/folios/v2/lines/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to edit charge'));
  return response.json();
}

// ── Void a charge line (v2) ─────────────────────────────────────
export async function voidFolioLineV2(
  lineId: string,
  reason: string
): Promise<{ success: boolean; lineId: string; folioId: string; newBalance: number }> {
  const response = await authFetch(`/api/folios/v2/lines/${encodeURIComponent(lineId)}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void charge'));
  return response.json();
}

// ── Void a payment (v2) ─────────────────────────────────────────
export async function voidPaymentV2(
  folioId: string,
  paymentId: string,
  reason: string
): Promise<{ success: boolean; newBalance: number }> {
  const response = await authFetch(
    `/api/folios/v2/${encodeURIComponent(folioId)}/payments/${encodeURIComponent(paymentId)}/void`,
    { method: 'POST', body: JSON.stringify({ reason }) }
  );
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void payment'));
  return response.json();
}

// ── Close / reopen / void folio (v2) ────────────────────────────
export async function closeFolioV2(folioId: string, reason?: string): Promise<{ success: boolean; folioId: string; status: string }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/close`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to close folio'));
  return response.json();
}

export async function reopenFolioV2(folioId: string, reason?: string): Promise<{ success: boolean; folioId: string; status: string }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/reopen`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to reopen folio'));
  return response.json();
}

export async function voidFolioV2(folioId: string, reason: string): Promise<{ success: boolean; folioId: string; status: string }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}/void`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to void folio'));
  return response.json();
}

// ── Update folio metadata (v2) ──────────────────────────────────
export async function updateFolioV2(
  folioId: string,
  updates: { notes?: string; credit_limit?: number; folio_number?: string }
): Promise<{ success: boolean; folio: FolioV2 }> {
  const response = await authFetch(`/api/folios/v2/${encodeURIComponent(folioId)}`, {
    method: 'PATCH', body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(await parseError(response, 'Failed to update folio'));
  return response.json();
}
