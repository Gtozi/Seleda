/**
 * Finance Portal — General Ledger service.
 *
 * Frontend wrapper for /api/fin-portal. Mirrors the engineeringService.ts
 * pattern (apiRequest helper + typed exports). All payloads use camelCase
 * on the frontend and are snake_cased by the route handlers.
 */

const API_BASE = '/api/fin-portal';

async function apiRequest<T = any>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&');
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface JournalLineFE {
  id?: string;
  accountId: string;
  accountName: string;
  description?: string;
  debit: number;
  credit: number;
}

export type JournalStatus = 'Draft' | 'Pending' | 'Approved' | 'Posted' | 'Reversed';

export interface JournalEntryFE {
  id: string;
  entry_date: string;
  reference: string | null;
  description: string;
  status: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at?: string | null;
  amount: number;
  total_debit: number;
  total_credit: number;
  department: string | null;
  period: string | null;
  source: string | null;
  posted_at: string | null;
  lines: JournalLineFE[];
  attachments?: string[];
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChartOfAccountFE {
  id: string;
  code: string;
  name: string;
  account_type: string;
  category?: string;
  subcategory?: string | null;
  department?: string | null;
  normal_balance?: string;
  parent_code?: string | null;
  balance?: number;
  currency?: string;
  is_active?: boolean;
  is_control_account?: boolean;
  description?: string | null;
  property_id?: string | null;
  property_name?: string | null;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface RecurringTemplateFE {
  id: string;
  template_number: string;
  name: string;
  description: string | null;
  frequency: string;
  next_run: string;
  amount: number;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InvoiceItemFE {
  desc: string;
  qty: number;
  rate: number;
  total: number;
}

export interface InvoiceFE {
  id: string;
  invoice_number: string;
  type: string;
  entity: string;
  issue_date: string;
  net_amount: number;
  tax_amount: number;
  gl_status: string;
  gl_ref: string | null;
  items: InvoiceItemFE[];
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AccountingPeriodFE {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  status: string;
  journal_count: number;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReversingEntryFE {
  id: string;
  entry_number: string;
  original_journal: string;
  reason: string;
  reversal_date: string;
  amount: number;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdjustingEntryFE {
  id: string;
  entry_number: string;
  description: string;
  adjustment_type: string;
  amount: number;
  created_by: string | null;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ClosingEntryFE {
  id: string;
  entry_number: string;
  period: string;
  closing_type: string;
  revenue_closed: number;
  expense_closed: number;
  net_income: number;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuditTrailFE {
  id: string;
  occurred_at: string;
  journal_id: string;
  action: string;
  description: string | null;
  amount: number;
  user_name: string | null;
  ip_address: string | null;
  property_id?: string | null;
  property_name?: string | null;
}

// ── Journals ───────────────────────────────────────────────────────────────

export const fetchJournals = (params: { status?: string; propertyId?: string } = {}) =>
  apiRequest<JournalEntryFE[]>(`${API_BASE}/journals${qs(params)}`);

export const createJournal = (payload: {
  date: string;
  reference?: string;
  description: string;
  department?: string;
  lines: JournalLineFE[];
  propertyId?: string;
}) => apiRequest<JournalEntryFE>(`${API_BASE}/journals`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateJournal = (id: string, patch: { status?: JournalStatus }) =>
  apiRequest<JournalEntryFE>(`${API_BASE}/journals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const postJournal = (id: string) =>
  apiRequest<JournalEntryFE>(`${API_BASE}/journals/${id}/post`, { method: 'POST' });

export const reverseJournal = (id: string) =>
  apiRequest<JournalEntryFE>(`${API_BASE}/journals/${id}/reverse`, { method: 'POST' });

export const deleteJournal = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/journals/${id}`, { method: 'DELETE' });

// ── Chart of Accounts ──────────────────────────────────────────────────────

export const fetchChartOfAccounts = (params: { propertyId?: string; category?: string } = {}) =>
  apiRequest<ChartOfAccountFE[]>(`${API_BASE}/chart-of-accounts${qs(params)}`);

export const createChartOfAccount = (body: {
  code: string; name: string; category: string; subcategory?: string;
  department?: string; accountType?: string; parentCode?: string;
  description?: string; normalBalance?: string; currency?: string;
  isControlAccount?: boolean; propertyId?: string;
}) => apiRequest<ChartOfAccountFE>(`${API_BASE}/chart-of-accounts`, {
  method: 'POST', body: JSON.stringify(body),
});

export const updateChartOfAccount = (id: string, patch: Partial<{
  name: string; subcategory: string; department: string; description: string;
  normalBalance: string; currency: string; isControlAccount: boolean;
  isActive: boolean; propertyId: string; balance: number;
}>) => apiRequest<ChartOfAccountFE>(`${API_BASE}/chart-of-accounts/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteChartOfAccount = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/chart-of-accounts/${id}`, { method: 'DELETE' });

// ── Trial Balance ──────────────────────────────────────────────────────────

export const fetchTrialBalance = () =>
  apiRequest<TrialBalance>(`${API_BASE}/trial-balance`);

// ── Recurring templates ────────────────────────────────────────────────────

export const fetchRecurringTemplates = (params: { propertyId?: string } = {}) =>
  apiRequest<RecurringTemplateFE[]>(`${API_BASE}/recurring${qs(params)}`);

export const createRecurringTemplate = (payload: {
  name: string;
  description?: string;
  frequency?: string;
  nextRun: string;
  amount: number;
  propertyId?: string;
}) => apiRequest<RecurringTemplateFE>(`${API_BASE}/recurring`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateRecurringTemplate = (id: string, patch: Partial<RecurringTemplateFE> & { status?: string }) =>
  apiRequest<RecurringTemplateFE>(`${API_BASE}/recurring/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteRecurringTemplate = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/recurring/${id}`, { method: 'DELETE' });

export const runRecurringTemplate = (id: string) =>
  apiRequest<{ success: boolean; template: RecurringTemplateFE; generatedAmount: number }>(
    `${API_BASE}/recurring/${id}/run`,
    { method: 'POST' }
  );

// ── Invoices ───────────────────────────────────────────────────────────────

export const fetchInvoices = (params: { propertyId?: string; type?: string; glStatus?: string } = {}) =>
  apiRequest<InvoiceFE[]>(`${API_BASE}/invoices${qs(params)}`);

export const createInvoice = (payload: Partial<InvoiceFE> & { propertyId?: string }) =>
  apiRequest<InvoiceFE>(`${API_BASE}/invoices`, {
    method: 'POST',
    body: JSON.stringify({
      invoiceNumber: payload.invoice_number,
      type: payload.type,
      entity: payload.entity,
      issueDate: payload.issue_date,
      netAmount: payload.net_amount,
      taxAmount: payload.tax_amount,
      glStatus: payload.gl_status,
      glRef: payload.gl_ref,
      items: payload.items,
      propertyId: payload.propertyId,
    }),
  });

export const updateInvoice = (id: string, patch: Partial<InvoiceFE>) =>
  apiRequest<InvoiceFE>(`${API_BASE}/invoices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      type: patch.type,
      entity: patch.entity,
      issueDate: patch.issue_date,
      netAmount: patch.net_amount,
      taxAmount: patch.tax_amount,
      glStatus: patch.gl_status,
      glRef: patch.gl_ref,
      items: patch.items,
    }),
  });

export const deleteInvoice = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/invoices/${id}`, { method: 'DELETE' });

// ── Accounting periods ─────────────────────────────────────────────────────

export const fetchPeriods = (params: { propertyId?: string } = {}) =>
  apiRequest<AccountingPeriodFE[]>(`${API_BASE}/periods${qs(params)}`);

export const updatePeriod = (id: string, status: 'Open' | 'Closing' | 'Closed') =>
  apiRequest<AccountingPeriodFE>(`${API_BASE}/periods/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ── Reversing entries ──────────────────────────────────────────────────────

export const fetchReversingEntries = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<ReversingEntryFE[]>(`${API_BASE}/reversing${qs(params)}`);

export const createReversingEntry = (payload: {
  originalJournal: string;
  reason: string;
  reversalDate: string;
  amount: number;
  propertyId?: string;
}) => apiRequest<ReversingEntryFE>(`${API_BASE}/reversing`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateReversingEntry = (id: string, patch: Partial<ReversingEntryFE>) =>
  apiRequest<ReversingEntryFE>(`${API_BASE}/reversing/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteReversingEntry = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/reversing/${id}`, { method: 'DELETE' });

// ── Adjusting entries ──────────────────────────────────────────────────────

export const fetchAdjustingEntries = (params: { propertyId?: string; status?: string; adjustmentType?: string } = {}) =>
  apiRequest<AdjustingEntryFE[]>(`${API_BASE}/adjusting${qs(params)}`);

export const createAdjustingEntry = (payload: {
  description: string;
  adjustmentType: string;
  amount: number;
  createdBy?: string;
  propertyId?: string;
}) => apiRequest<AdjustingEntryFE>(`${API_BASE}/adjusting`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateAdjustingEntry = (id: string, patch: Partial<AdjustingEntryFE>) =>
  apiRequest<AdjustingEntryFE>(`${API_BASE}/adjusting/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteAdjustingEntry = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/adjusting/${id}`, { method: 'DELETE' });

// ── Closing entries ────────────────────────────────────────────────────────

export const fetchClosingEntries = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<ClosingEntryFE[]>(`${API_BASE}/closing${qs(params)}`);

export const createClosingEntry = (payload: {
  period: string;
  closingType: string;
  revenueClosed?: number;
  expenseClosed?: number;
  netIncome?: number;
  propertyId?: string;
}) => apiRequest<ClosingEntryFE>(`${API_BASE}/closing`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateClosingEntry = (id: string, patch: Partial<ClosingEntryFE>) =>
  apiRequest<ClosingEntryFE>(`${API_BASE}/closing/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteClosingEntry = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/closing/${id}`, { method: 'DELETE' });

// ── Audit trail ────────────────────────────────────────────────────────────

export const fetchAuditTrail = (params: { propertyId?: string; action?: string } = {}) =>
  apiRequest<AuditTrailFE[]>(`${API_BASE}/audit-trail${qs(params)}`);

// ══════════════════════════════════════════════════════════════════════════
// Inventory Accounting — backs the /erp/finance/inventory tab
// ══════════════════════════════════════════════════════════════════════════

export interface InventoryValuationFE {
  id: string;
  item_code: string | null;
  item_name: string;
  category: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  valuation_method: string;
  last_revalued: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CogsEntryFE {
  id: string;
  entry_date: string;
  department: string;
  item_category: string;
  item_name: string | null;
  quantity_used: number;
  unit_cost: number;
  total_cogs: number;
  reference: string | null;
  period: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
}

export interface InventoryAdjustmentFE {
  id: string;
  adjustment_number: string | null;
  adjustment_date: string;
  item_name: string;
  category: string;
  adjustment_type: string;
  old_quantity: number | null;
  new_quantity: number | null;
  old_unit_cost: number | null;
  new_unit_cost: number | null;
  value_impact: number;
  reason: string | null;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StockWriteoffFE {
  id: string;
  writeoff_number: string | null;
  writeoff_date: string;
  item_name: string;
  category: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  writeoff_type: string;
  reason: string | null;
  status: string;
  gl_posted: boolean;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StockRevaluationFE {
  id: string;
  revaluation_number: string | null;
  revaluation_date: string;
  item_name: string;
  category: string;
  old_cost: number;
  new_cost: number;
  quantity: number;
  old_total_value: number;
  new_total_value: number;
  variance: number;
  reason: string | null;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Inventory Valuation ───────────────────────────────────────────────────

export const fetchInventoryValuation = (params: { propertyId?: string; category?: string } = {}) =>
  apiRequest<InventoryValuationFE[]>(`${API_BASE}/inventory-valuation${qs(params)}`);

export const createInventoryValuation = (payload: {
  itemCode?: string; itemName: string; category?: string;
  quantity?: number; unitCost?: number; valuationMethod?: string;
  propertyId?: string;
}) => apiRequest<InventoryValuationFE>(`${API_BASE}/inventory-valuation`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateInventoryValuation = (id: string, patch: Partial<{
  itemCode: string; itemName: string; category: string;
  quantity: number; unitCost: number; valuationMethod: string;
}>) => apiRequest<InventoryValuationFE>(`${API_BASE}/inventory-valuation/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteInventoryValuation = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/inventory-valuation/${id}`, { method: 'DELETE' });

// ── COGS Entries ──────────────────────────────────────────────────────────

export const fetchCogsEntries = (params: { propertyId?: string; department?: string; period?: string } = {}) =>
  apiRequest<CogsEntryFE[]>(`${API_BASE}/cogs${qs(params)}`);

export const createCogsEntry = (payload: {
  entryDate?: string; department: string; itemCategory: string;
  itemName?: string; quantityUsed?: number; unitCost?: number;
  reference?: string; propertyId?: string;
}) => apiRequest<CogsEntryFE>(`${API_BASE}/cogs`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const deleteCogsEntry = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/cogs/${id}`, { method: 'DELETE' });

// ── Inventory Adjustments ─────────────────────────────────────────────────

export const fetchInventoryAdjustments = (params: { propertyId?: string; status?: string; adjustmentType?: string } = {}) =>
  apiRequest<InventoryAdjustmentFE[]>(`${API_BASE}/inventory-adjustments${qs(params)}`);

export const createInventoryAdjustment = (payload: {
  adjustmentDate?: string; itemName: string; category?: string;
  adjustmentType: string; oldQuantity?: number; newQuantity?: number;
  oldUnitCost?: number; newUnitCost?: number; reason?: string;
  propertyId?: string;
}) => apiRequest<InventoryAdjustmentFE>(`${API_BASE}/inventory-adjustments`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateInventoryAdjustment = (id: string, patch: { status?: string; reason?: string }) =>
  apiRequest<InventoryAdjustmentFE>(`${API_BASE}/inventory-adjustments/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });

export const deleteInventoryAdjustment = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/inventory-adjustments/${id}`, { method: 'DELETE' });

// ── Stock Write-offs ──────────────────────────────────────────────────────

export const fetchStockWriteoffs = (params: { propertyId?: string; status?: string; writeoffType?: string } = {}) =>
  apiRequest<StockWriteoffFE[]>(`${API_BASE}/stock-writeoffs${qs(params)}`);

export const createStockWriteoff = (payload: {
  writeoffDate?: string; itemName: string; category?: string;
  quantity?: number; unitCost?: number; writeoffType: string;
  reason?: string; propertyId?: string;
}) => apiRequest<StockWriteoffFE>(`${API_BASE}/stock-writeoffs`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateStockWriteoff = (id: string, patch: { status?: string; reason?: string; glPosted?: boolean }) =>
  apiRequest<StockWriteoffFE>(`${API_BASE}/stock-writeoffs/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });

export const deleteStockWriteoff = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/stock-writeoffs/${id}`, { method: 'DELETE' });

// ── Stock Revaluations ────────────────────────────────────────────────────

export const fetchStockRevaluations = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<StockRevaluationFE[]>(`${API_BASE}/stock-revaluations${qs(params)}`);

export const createStockRevaluation = (payload: {
  revaluationDate?: string; itemName: string; category?: string;
  oldCost: number; newCost: number; quantity?: number;
  reason?: string; propertyId?: string;
}) => apiRequest<StockRevaluationFE>(`${API_BASE}/stock-revaluations`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateStockRevaluation = (id: string, patch: { status?: string; reason?: string }) =>
  apiRequest<StockRevaluationFE>(`${API_BASE}/stock-revaluations/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });

export const deleteStockRevaluation = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/stock-revaluations/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// Intercompany Accounting — backs the /erp/finance/intercompany tab
// ══════════════════════════════════════════════════════════════════════════

export interface IntercompanyInvoiceFE {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  from_entity: string;
  to_entity: string;
  transaction_type: string;
  description: string | null;
  amount: number;
  currency: string;
  status: string;
  gl_ref: string | null;
  posted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IntercompanyBalanceFE {
  id: string;
  entity: string;
  balance_type: string;
  amount: number;
  currency: string;
  aging_bucket: string;
  reference_invoice: string | null;
  last_activity: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IntercompanyEliminationFE {
  id: string;
  entry_number: string | null;
  period: string;
  account: string;
  entity1: string;
  entity2: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  posted_at: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Intercompany Invoices ─────────────────────────────────────────────────

export const fetchIntercompanyInvoices = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<IntercompanyInvoiceFE[]>(`${API_BASE}/intercompany-invoices${qs(params)}`);

export const createIntercompanyInvoice = (payload: {
  invoiceDate?: string; fromEntity: string; toEntity: string;
  transactionType: string; description?: string; amount?: number;
  currency?: string; propertyId?: string;
}) => apiRequest<IntercompanyInvoiceFE>(`${API_BASE}/intercompany-invoices`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateIntercompanyInvoice = (id: string, patch: {
  status?: string; description?: string; amount?: number; glRef?: string;
}) => apiRequest<IntercompanyInvoiceFE>(`${API_BASE}/intercompany-invoices/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteIntercompanyInvoice = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/intercompany-invoices/${id}`, { method: 'DELETE' });

// ── Intercompany Balances ─────────────────────────────────────────────────

export const fetchIntercompanyBalances = (params: { propertyId?: string; balanceType?: string } = {}) =>
  apiRequest<IntercompanyBalanceFE[]>(`${API_BASE}/intercompany-balances${qs(params)}`);

export const createIntercompanyBalance = (payload: {
  entity: string; balanceType: string; amount?: number; currency?: string;
  agingBucket?: string; referenceInvoice?: string; lastActivity?: string;
  propertyId?: string;
}) => apiRequest<IntercompanyBalanceFE>(`${API_BASE}/intercompany-balances`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateIntercompanyBalance = (id: string, patch: {
  amount?: number; agingBucket?: string; balanceType?: string;
  referenceInvoice?: string; lastActivity?: string;
}) => apiRequest<IntercompanyBalanceFE>(`${API_BASE}/intercompany-balances/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteIntercompanyBalance = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/intercompany-balances/${id}`, { method: 'DELETE' });

// ── Intercompany Eliminations ─────────────────────────────────────────────

export const fetchIntercompanyEliminations = (params: { propertyId?: string; status?: string; period?: string } = {}) =>
  apiRequest<IntercompanyEliminationFE[]>(`${API_BASE}/intercompany-eliminations${qs(params)}`);

export const createIntercompanyElimination = (payload: {
  period: string; account?: string; entity1: string; entity2: string;
  amount?: number; currency?: string; description?: string; propertyId?: string;
}) => apiRequest<IntercompanyEliminationFE>(`${API_BASE}/intercompany-eliminations`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateIntercompanyElimination = (id: string, patch: {
  status?: string; description?: string; amount?: number;
}) => apiRequest<IntercompanyEliminationFE>(`${API_BASE}/intercompany-eliminations/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteIntercompanyElimination = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/intercompany-eliminations/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// Tax Compliance — backs the /erp/finance/tax tab
// ══════════════════════════════════════════════════════════════════════════

export interface TaxReturnFE {
  id: string;
  return_number: string | null;
  tax_type: string;
  period: string;
  status: string;
  filing_date: string | null;
  due_date: string | null;
  taxable_base: number;
  tax_collected: number;
  tax_paid: number;
  net_tax: number;
  tax_rate: number | null;
  metadata: Record<string, any>;
  filed_by: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaxPensionFE {
  id: string;
  period: string;
  employee_amount: number;
  employer_amount: number;
  total_amount: number;
  status: string;
  remittance_date: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaxCustomsFE {
  id: string;
  declaration_number: string | null;
  item_description: string;
  cif_value: number;
  duty_rate: string | null;
  duty_paid: number;
  declaration_date: string | null;
  status: string;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaxAuditFE {
  id: string;
  finding_number: string | null;
  category: string;
  description: string | null;
  risk_level: string;
  status: string;
  due_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Tax Returns (VAT, WHT, TOT, PAYE, Sales Tax, Local) ───────────────────

export const fetchTaxReturns = (params: { propertyId?: string; taxType?: string; status?: string } = {}) =>
  apiRequest<TaxReturnFE[]>(`${API_BASE}/tax-returns${qs(params)}`);

export const createTaxReturn = (payload: {
  taxType: string; period: string; dueDate?: string;
  taxableBase?: number; taxCollected?: number; taxPaid?: number;
  netTax?: number; taxRate?: number; metadata?: Record<string, any>; propertyId?: string;
}) => apiRequest<TaxReturnFE>(`${API_BASE}/tax-returns`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateTaxReturn = (id: string, patch: {
  status?: string; filingDate?: string; taxableBase?: number;
  taxCollected?: number; taxPaid?: number; netTax?: number;
  taxRate?: number; metadata?: Record<string, any>;
}) => apiRequest<TaxReturnFE>(`${API_BASE}/tax-returns/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteTaxReturn = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tax-returns/${id}`, { method: 'DELETE' });

// ── Tax Pension ────────────────────────────────────────────────────────────

export const fetchTaxPension = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<TaxPensionFE[]>(`${API_BASE}/tax-pension${qs(params)}`);

export const createTaxPension = (payload: {
  period: string; employeeAmount?: number; employerAmount?: number;
  totalAmount?: number; propertyId?: string;
}) => apiRequest<TaxPensionFE>(`${API_BASE}/tax-pension`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateTaxPension = (id: string, patch: {
  status?: string; employeeAmount?: number; employerAmount?: number;
  totalAmount?: number; remittanceDate?: string;
}) => apiRequest<TaxPensionFE>(`${API_BASE}/tax-pension/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteTaxPension = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tax-pension/${id}`, { method: 'DELETE' });

// ── Tax Customs ────────────────────────────────────────────────────────────

export const fetchTaxCustoms = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<TaxCustomsFE[]>(`${API_BASE}/tax-customs${qs(params)}`);

export const createTaxCustoms = (payload: {
  itemDescription: string; cifValue?: number; dutyRate?: string;
  dutyPaid?: number; declarationDate?: string; propertyId?: string;
}) => apiRequest<TaxCustomsFE>(`${API_BASE}/tax-customs`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateTaxCustoms = (id: string, patch: {
  status?: string; itemDescription?: string; cifValue?: number;
  dutyRate?: string; dutyPaid?: number; declarationDate?: string;
}) => apiRequest<TaxCustomsFE>(`${API_BASE}/tax-customs/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteTaxCustoms = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tax-customs/${id}`, { method: 'DELETE' });

// ── Tax Audits ─────────────────────────────────────────────────────────────

export const fetchTaxAudits = (params: { propertyId?: string; status?: string; riskLevel?: string } = {}) =>
  apiRequest<TaxAuditFE[]>(`${API_BASE}/tax-audits${qs(params)}`);

export const createTaxAudit = (payload: {
  category: string; description?: string; riskLevel?: string;
  dueDate?: string; propertyId?: string;
}) => apiRequest<TaxAuditFE>(`${API_BASE}/tax-audits`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateTaxAudit = (id: string, patch: {
  status?: string; category?: string; description?: string;
  riskLevel?: string; dueDate?: string;
}) => apiRequest<TaxAuditFE>(`${API_BASE}/tax-audits/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteTaxAudit = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tax-audits/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL CONSOLIDATION
// ══════════════════════════════════════════════════════════════════════════

export interface ConsolidationEntityFE {
  id: string;
  entity_code: string | null;
  entity_name: string;
  entity_type: string;
  base_currency: string;
  functional_currency: string;
  revenue: number;
  expenses: number;
  profit: number;
  ownership_pct: number;
  consolidation_status: string;
  period: string | null;
  notes: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConsolidationFxRateFE {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  period: string | null;
  source: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConsolidationEliminationFE {
  id: string;
  elimination_number: string | null;
  period: string | null;
  description: string;
  from_entity: string | null;
  to_entity: string | null;
  amount: number;
  elimination_type: string;
  status: string;
  posted_by: string | null;
  posted_at: string | null;
  notes: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Consolidation Entities ─────────────────────────────────────────────────

export const fetchConsolidationEntities = (params: { propertyId?: string; status?: string; type?: string } = {}) =>
  apiRequest<ConsolidationEntityFE[]>(`${API_BASE}/consolidation-entities${qs(params)}`);

export const createConsolidationEntity = (payload: {
  entityCode?: string; entityName: string; entityType?: string;
  baseCurrency?: string; functionalCurrency?: string;
  revenue?: number; expenses?: number; profit?: number;
  ownershipPct?: number; consolidationStatus?: string;
  period?: string; notes?: string; propertyId?: string;
}) => apiRequest<ConsolidationEntityFE>(`${API_BASE}/consolidation-entities`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateConsolidationEntity = (id: string, patch: {
  entityName?: string; entityType?: string; baseCurrency?: string;
  functionalCurrency?: string; revenue?: number; expenses?: number;
  profit?: number; ownershipPct?: number; consolidationStatus?: string;
  period?: string; notes?: string;
}) => apiRequest<ConsolidationEntityFE>(`${API_BASE}/consolidation-entities/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteConsolidationEntity = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/consolidation-entities/${id}`, { method: 'DELETE' });

// ── FX Rates ───────────────────────────────────────────────────────────────

export const fetchConsolidationFxRates = (params: { propertyId?: string; period?: string } = {}) =>
  apiRequest<ConsolidationFxRateFE[]>(`${API_BASE}/consolidation-fx-rates${qs(params)}`);

export const createConsolidationFxRate = (payload: {
  fromCurrency: string; toCurrency: string; rate: number;
  effectiveDate: string; period?: string; source?: string; propertyId?: string;
}) => apiRequest<ConsolidationFxRateFE>(`${API_BASE}/consolidation-fx-rates`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateConsolidationFxRate = (id: string, patch: {
  fromCurrency?: string; toCurrency?: string; rate?: number;
  effectiveDate?: string; period?: string; source?: string;
}) => apiRequest<ConsolidationFxRateFE>(`${API_BASE}/consolidation-fx-rates/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteConsolidationFxRate = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/consolidation-fx-rates/${id}`, { method: 'DELETE' });

// ── Eliminations ───────────────────────────────────────────────────────────

export const fetchConsolidationEliminations = (params: { propertyId?: string; status?: string; period?: string } = {}) =>
  apiRequest<ConsolidationEliminationFE[]>(`${API_BASE}/consolidation-eliminations${qs(params)}`);

export const createConsolidationElimination = (payload: {
  eliminationNumber?: string; period?: string; description: string;
  fromEntity?: string; toEntity?: string; amount?: number;
  eliminationType?: string; status?: string; notes?: string; propertyId?: string;
}) => apiRequest<ConsolidationEliminationFE>(`${API_BASE}/consolidation-eliminations`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateConsolidationElimination = (id: string, patch: {
  eliminationNumber?: string; period?: string; description?: string;
  fromEntity?: string; toEntity?: string; amount?: number;
  eliminationType?: string; status?: string; notes?: string;
}) => apiRequest<ConsolidationEliminationFE>(`${API_BASE}/consolidation-eliminations/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteConsolidationElimination = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/consolidation-eliminations/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// AUDIT & COMPLIANCE
// ══════════════════════════════════════════════════════════════════════════

export interface AuditLogFE {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  device: string | null;
  ip_address: string | null;
  module: string | null;
  record_id: string | null;
  action: string | null;
  details: string | null;
  property_id?: string | null;
}

export interface ComplianceIssueFE {
  id: string;
  issue_number: string | null;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  remediation_url: string | null;
  status: string;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface JournalApprovalFE {
  id: string;
  journal_number: string;
  description: string | null;
  amount: number;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  status: string;
  period: string | null;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExternalAuditFE {
  id: string;
  audit_number: string | null;
  firm: string;
  audit_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  findings_count: number;
  rating: string | null;
  scope: string | null;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SodRuleFE {
  id: string;
  rule_name: string;
  rule_code: string | null;
  description: string | null;
  duty_a: string;
  duty_b: string;
  conflict_level: string;
  status: string;
  assigned_role: string | null;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Audit Logs (read-only) ─────────────────────────────────────────────────

export const fetchAuditLogs = (params: { propertyId?: string; module?: string; action?: string; limit?: number } = {}) =>
  apiRequest<AuditLogFE[]>(`${API_BASE}/audit-logs${qs(params)}`);

// ── Compliance Issues ──────────────────────────────────────────────────────

export const fetchComplianceIssues = (params: { propertyId?: string; status?: string; severity?: string; type?: string } = {}) =>
  apiRequest<ComplianceIssueFE[]>(`${API_BASE}/compliance-issues${qs(params)}`);

export const createComplianceIssue = (payload: {
  issueNumber?: string; type?: string; severity?: string; title: string;
  description?: string; remediationUrl?: string; assignedTo?: string; propertyId?: string;
}) => apiRequest<ComplianceIssueFE>(`${API_BASE}/compliance-issues`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateComplianceIssue = (id: string, patch: {
  type?: string; severity?: string; title?: string; description?: string;
  remediationUrl?: string; status?: string; assignedTo?: string;
}) => apiRequest<ComplianceIssueFE>(`${API_BASE}/compliance-issues/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteComplianceIssue = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/compliance-issues/${id}`, { method: 'DELETE' });

// ── Journal Approvals ──────────────────────────────────────────────────────

export const fetchJournalApprovals = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<JournalApprovalFE[]>(`${API_BASE}/journal-approvals${qs(params)}`);

export const createJournalApproval = (payload: {
  journalNumber: string; description?: string; amount?: number;
  submittedBy?: string; period?: string; notes?: string; propertyId?: string;
}) => apiRequest<JournalApprovalFE>(`${API_BASE}/journal-approvals`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateJournalApproval = (id: string, patch: {
  status?: string; rejectionReason?: string; notes?: string;
  description?: string; amount?: number;
}) => apiRequest<JournalApprovalFE>(`${API_BASE}/journal-approvals/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteJournalApproval = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/journal-approvals/${id}`, { method: 'DELETE' });

// ── External Audits ────────────────────────────────────────────────────────

export const fetchExternalAudits = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<ExternalAuditFE[]>(`${API_BASE}/external-audits${qs(params)}`);

export const createExternalAudit = (payload: {
  auditNumber?: string; firm: string; auditType?: string;
  startDate?: string; endDate?: string; status?: string;
  findingsCount?: number; rating?: string; scope?: string; notes?: string; propertyId?: string;
}) => apiRequest<ExternalAuditFE>(`${API_BASE}/external-audits`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateExternalAudit = (id: string, patch: {
  auditNumber?: string; firm?: string; auditType?: string;
  startDate?: string; endDate?: string; status?: string;
  findingsCount?: number; rating?: string; scope?: string; notes?: string;
}) => apiRequest<ExternalAuditFE>(`${API_BASE}/external-audits/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteExternalAudit = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/external-audits/${id}`, { method: 'DELETE' });

// ── Segregation of Duties Rules ────────────────────────────────────────────

export const fetchSodRules = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<SodRuleFE[]>(`${API_BASE}/sod-rules${qs(params)}`);

export const createSodRule = (payload: {
  ruleName: string; ruleCode?: string; description?: string;
  dutyA: string; dutyB: string; conflictLevel?: string;
  status?: string; assignedRole?: string; notes?: string; propertyId?: string;
}) => apiRequest<SodRuleFE>(`${API_BASE}/sod-rules`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateSodRule = (id: string, patch: {
  ruleName?: string; ruleCode?: string; description?: string;
  dutyA?: string; dutyB?: string; conflictLevel?: string;
  status?: string; assignedRole?: string; notes?: string;
}) => apiRequest<SodRuleFE>(`${API_BASE}/sod-rules/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteSodRule = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/sod-rules/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL DOCUMENTS
// ══════════════════════════════════════════════════════════════════════════

export interface DocumentFE {
  id: string;
  document_number: string | null;
  name: string;
  type: string;
  category: string;
  entity: string | null;
  file_path: string | null;
  file_url: string | null;
  file_size: number;
  mime_type: string | null;
  status: string;
  uploaded_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Documents ──────────────────────────────────────────────────────────────

export const fetchDocuments = (params: { propertyId?: string; status?: string; type?: string; category?: string } = {}) =>
  apiRequest<DocumentFE[]>(`${API_BASE}/documents${qs(params)}`);

export const createDocument = (payload: {
  documentNumber?: string; name: string; type?: string; category?: string;
  entity?: string; filePath?: string; fileUrl?: string; fileSize?: number;
  mimeType?: string; status?: string; uploadedBy?: string; notes?: string; propertyId?: string;
}) => apiRequest<DocumentFE>(`${API_BASE}/documents`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateDocument = (id: string, patch: {
  documentNumber?: string; name?: string; type?: string; category?: string;
  entity?: string; filePath?: string; fileUrl?: string; fileSize?: number;
  mimeType?: string; status?: string; uploadedBy?: string; notes?: string;
}) => apiRequest<DocumentFE>(`${API_BASE}/documents/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteDocument = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/documents/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW
// ══════════════════════════════════════════════════════════════════════════

export interface ApprovalRequestFE {
  id: string;
  request_number: string | null;
  type: string;
  title: string;
  description: string | null;
  amount: number;
  requested_by: string | null;
  requested_by_name: string | null;
  current_level: number;
  total_levels: number;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalLevelFE {
  id: string;
  name: string;
  level: number;
  requires_unanimous: boolean;
  approvers: string[];
  spending_limit: number | null;
  description: string | null;
  status: string;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DelegationRuleFE {
  id: string;
  rule_name: string;
  delegator: string;
  delegatee: string;
  scope: string;
  spending_limit: number | null;
  start_date: string;
  end_date: string | null;
  status: string;
  notes: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── Approval Requests ──────────────────────────────────────────────────────

export const fetchApprovalRequests = (params: { propertyId?: string; status?: string; type?: string } = {}) =>
  apiRequest<ApprovalRequestFE[]>(`${API_BASE}/approval-requests${qs(params)}`);

export const createApprovalRequest = (payload: {
  requestNumber?: string; type?: string; title: string; description?: string;
  amount?: number; requestedBy?: string; requestedByName?: string;
  currentLevel?: number; totalLevels?: number; status?: string; notes?: string; propertyId?: string;
}) => apiRequest<ApprovalRequestFE>(`${API_BASE}/approval-requests`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateApprovalRequest = (id: string, patch: {
  requestNumber?: string; type?: string; title?: string; description?: string;
  amount?: number; currentLevel?: number; totalLevels?: number;
  status?: string; rejectionReason?: string; notes?: string;
}) => apiRequest<ApprovalRequestFE>(`${API_BASE}/approval-requests/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteApprovalRequest = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/approval-requests/${id}`, { method: 'DELETE' });

// ── Approval Levels ────────────────────────────────────────────────────────

export const fetchApprovalLevels = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<ApprovalLevelFE[]>(`${API_BASE}/approval-levels${qs(params)}`);

export const createApprovalLevel = (payload: {
  name: string; level?: number; requiresUnanimous?: boolean;
  approvers?: string[]; spendingLimit?: number; description?: string;
  status?: string; propertyId?: string;
}) => apiRequest<ApprovalLevelFE>(`${API_BASE}/approval-levels`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateApprovalLevel = (id: string, patch: {
  name?: string; level?: number; requiresUnanimous?: boolean;
  approvers?: string[]; spendingLimit?: number; description?: string; status?: string;
}) => apiRequest<ApprovalLevelFE>(`${API_BASE}/approval-levels/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteApprovalLevel = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/approval-levels/${id}`, { method: 'DELETE' });

// ── Delegation Rules ───────────────────────────────────────────────────────

export const fetchDelegationRules = (params: { propertyId?: string; status?: string } = {}) =>
  apiRequest<DelegationRuleFE[]>(`${API_BASE}/delegation-rules${qs(params)}`);

export const createDelegationRule = (payload: {
  ruleName: string; delegator: string; delegatee: string;
  scope?: string; spendingLimit?: number; startDate?: string;
  endDate?: string; status?: string; notes?: string; propertyId?: string;
}) => apiRequest<DelegationRuleFE>(`${API_BASE}/delegation-rules`, {
  method: 'POST', body: JSON.stringify(payload),
});

export const updateDelegationRule = (id: string, patch: {
  ruleName?: string; delegator?: string; delegatee?: string;
  scope?: string; spendingLimit?: number; startDate?: string;
  endDate?: string; status?: string; notes?: string;
}) => apiRequest<DelegationRuleFE>(`${API_BASE}/delegation-rules/${id}`, {
  method: 'PATCH', body: JSON.stringify(patch),
});

export const deleteDelegationRule = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/delegation-rules/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// BUSINESS INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════

export interface BiMetricFE {
  id: string;
  name: string;
  display_name: string | null;
  value: number;
  previous_value: number;
  change_percent: number;
  period: string | null;
  unit: string;
  category: string;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiTrendFE {
  id: string;
  period: string;
  revenue: number;
  expenses: number;
  profit: number;
  period_order: number;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiRatioFE {
  id: string;
  name: string;
  display_name: string | null;
  value: number;
  benchmark: number;
  status: string;
  category: string;
  unit: string;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiForecastFE {
  id: string;
  metric: string;
  forecast: number;
  actual: number;
  variance: number;
  accuracy: number;
  period: string | null;
  unit: string;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiCostAnalysisFE {
  id: string;
  category: string;
  budget: number;
  actual: number;
  variance: number;
  variance_percent: number;
  trend: string;
  period: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiAgingFE {
  id: string;
  type: string;
  bucket: string;
  amount: number;
  period: string | null;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ── BI Metrics ─────────────────────────────────────────────────────────────

export const fetchBiMetrics = (params: { propertyId?: string; category?: string } = {}) =>
  apiRequest<BiMetricFE[]>(`${API_BASE}/bi-metrics${qs(params)}`);

export const createBiMetric = (payload: {
  name: string; displayName?: string; value?: number; previousValue?: number;
  changePercent?: number; period?: string; unit?: string; category?: string; propertyId?: string;
}) => apiRequest<BiMetricFE>(`${API_BASE}/bi-metrics`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiMetric = (id: string, patch: Partial<{
  name: string; displayName: string; value: number; previousValue: number;
  changePercent: number; period: string; unit: string; category: string;
}>) => apiRequest<BiMetricFE>(`${API_BASE}/bi-metrics/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiMetric = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-metrics/${id}`, { method: 'DELETE' });

// ── BI Trends ──────────────────────────────────────────────────────────────

export const fetchBiTrends = (params: { propertyId?: string } = {}) =>
  apiRequest<BiTrendFE[]>(`${API_BASE}/bi-trends${qs(params)}`);

export const createBiTrend = (payload: {
  period: string; revenue?: number; expenses?: number; profit?: number;
  periodOrder?: number; propertyId?: string;
}) => apiRequest<BiTrendFE>(`${API_BASE}/bi-trends`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiTrend = (id: string, patch: Partial<{
  period: string; revenue: number; expenses: number; profit: number; periodOrder: number;
}>) => apiRequest<BiTrendFE>(`${API_BASE}/bi-trends/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiTrend = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-trends/${id}`, { method: 'DELETE' });

// ── BI Ratios ──────────────────────────────────────────────────────────────

export const fetchBiRatios = (params: { propertyId?: string; category?: string; status?: string } = {}) =>
  apiRequest<BiRatioFE[]>(`${API_BASE}/bi-ratios${qs(params)}`);

export const createBiRatio = (payload: {
  name: string; displayName?: string; value?: number; benchmark?: number;
  status?: string; category?: string; unit?: string; propertyId?: string;
}) => apiRequest<BiRatioFE>(`${API_BASE}/bi-ratios`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiRatio = (id: string, patch: Partial<{
  name: string; displayName: string; value: number; benchmark: number;
  status: string; category: string; unit: string;
}>) => apiRequest<BiRatioFE>(`${API_BASE}/bi-ratios/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiRatio = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-ratios/${id}`, { method: 'DELETE' });

// ── BI Forecasts ───────────────────────────────────────────────────────────

export const fetchBiForecasts = (params: { propertyId?: string; period?: string } = {}) =>
  apiRequest<BiForecastFE[]>(`${API_BASE}/bi-forecasts${qs(params)}`);

export const createBiForecast = (payload: {
  metric: string; forecast?: number; actual?: number; variance?: number;
  accuracy?: number; period?: string; unit?: string; propertyId?: string;
}) => apiRequest<BiForecastFE>(`${API_BASE}/bi-forecasts`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiForecast = (id: string, patch: Partial<{
  metric: string; forecast: number; actual: number; variance: number;
  accuracy: number; period: string; unit: string;
}>) => apiRequest<BiForecastFE>(`${API_BASE}/bi-forecasts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiForecast = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-forecasts/${id}`, { method: 'DELETE' });

// ── BI Cost Analysis ───────────────────────────────────────────────────────

export const fetchBiCostAnalysis = (params: { propertyId?: string; period?: string } = {}) =>
  apiRequest<BiCostAnalysisFE[]>(`${API_BASE}/bi-cost-analysis${qs(params)}`);

export const createBiCostAnalysis = (payload: {
  category: string; budget?: number; actual?: number; variance?: number;
  variancePercent?: number; trend?: string; period?: string; propertyId?: string;
}) => apiRequest<BiCostAnalysisFE>(`${API_BASE}/bi-cost-analysis`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiCostAnalysis = (id: string, patch: Partial<{
  category: string; budget: number; actual: number; variance: number;
  variancePercent: number; trend: string; period: string;
}>) => apiRequest<BiCostAnalysisFE>(`${API_BASE}/bi-cost-analysis/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiCostAnalysis = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-cost-analysis/${id}`, { method: 'DELETE' });

// ── BI Aging ───────────────────────────────────────────────────────────────

export const fetchBiAging = (params: { propertyId?: string; type?: string; period?: string } = {}) =>
  apiRequest<BiAgingFE[]>(`${API_BASE}/bi-aging${qs(params)}`);

export const createBiAging = (payload: {
  type: string; bucket: string; amount?: number; period?: string; propertyId?: string;
}) => apiRequest<BiAgingFE>(`${API_BASE}/bi-aging`, { method: 'POST', body: JSON.stringify(payload) });

export const updateBiAging = (id: string, patch: Partial<{
  type: string; bucket: string; amount: number; period: string;
}>) => apiRequest<BiAgingFE>(`${API_BASE}/bi-aging/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteBiAging = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/bi-aging/${id}`, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════
// FINANCIAL REPORTS
// ══════════════════════════════════════════════════════════════════════════

export interface FinReportFE {
  id: string;
  property_id: string | null;
  report_key: string;
  title: string;
  category: string;
  period: string | null;
  status: string;
  format: string;
  frequency: string;
  last_run_at: string | null;
  last_run_by: string | null;
  description: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinReportRunFE {
  id: string;
  property_id: string | null;
  report_id: string | null;
  report_key: string | null;
  report_title: string | null;
  generated_by: string | null;
  status: string;
  format: string;
  file_url: string | null;
  file_size: number;
  parameters: Record<string, unknown> | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface FinReportStats {
  total: number;
  ready: number;
  scheduled: number;
  generating: number;
  failed: number;
  byCategory: Record<string, number>;
}

// ── Reports (catalog) ─────────────────────────────────────────────────────

export const fetchReports = (params: {
  propertyId?: string; category?: string; status?: string; search?: string;
} = {}) => apiRequest<FinReportFE[]>(`${API_BASE}/reports${qs(params)}`);

export const fetchReportStats = (params: { propertyId?: string } = {}) =>
  apiRequest<FinReportStats>(`${API_BASE}/reports/stats${qs(params)}`);

export const runAllReports = (payload: { propertyId?: string } = {}) =>
  apiRequest<{ refreshed: number }>(`${API_BASE}/reports/run-all`, { method: 'POST', body: JSON.stringify(payload) });

export const createReport = (payload: {
  reportKey: string; title: string; category: string;
  period?: string; status?: string; format?: string; frequency?: string;
  description?: string; sortOrder?: number; propertyId?: string;
}) => apiRequest<FinReportFE>(`${API_BASE}/reports`, { method: 'POST', body: JSON.stringify(payload) });

export const updateReport = (id: string, patch: Partial<{
  title: string; category: string; period: string; status: string;
  format: string; frequency: string; description: string; sortOrder: number;
}>) => apiRequest<FinReportFE>(`${API_BASE}/reports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteReport = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/reports/${id}`, { method: 'DELETE' });

// ── Report Runs (execution log) ───────────────────────────────────────────

export const fetchReportRuns = (params: {
  propertyId?: string; reportId?: string; reportKey?: string; status?: string;
} = {}) => apiRequest<FinReportRunFE[]>(`${API_BASE}/report-runs${qs(params)}`);

export const createReportRun = (payload: {
  reportId?: string; reportKey?: string; reportTitle?: string;
  format?: string; fileUrl?: string; fileSize?: number;
  parameters?: Record<string, unknown>; durationMs?: number;
  status?: string; propertyId?: string;
}) => apiRequest<FinReportRunFE>(`${API_BASE}/report-runs`, { method: 'POST', body: JSON.stringify(payload) });

export const updateReportRun = (id: string, patch: Partial<{
  status: string; fileUrl: string; fileSize: number;
  durationMs: number; errorMessage: string;
}>) => apiRequest<FinReportRunFE>(`${API_BASE}/report-runs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteReportRun = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/report-runs/${id}`, { method: 'DELETE' });

// ── Execute a report ──────────────────────────────────────────────────────

export const runReport = (id: string, payload: {
  format?: string; parameters?: Record<string, unknown>; propertyId?: string;
} = {}) => apiRequest<FinReportRunFE>(`${API_BASE}/reports/${id}/run`, { method: 'POST', body: JSON.stringify(payload) });

// ══════════════════════════════════════════════════════════════════════════
// FINANCE CONFIGURATION (backs /erp/finance/config)
// ══════════════════════════════════════════════════════════════════════════

export interface FinFiscalYearFE {
  id: string;
  property_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  is_current: boolean;
  closed_by: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FinFiscalPeriodFE {
  id: string;
  property_id: string | null;
  fiscal_year: number;
  period_number: number;
  period_name: string;
  start_date: string;
  end_date: string;
  status: string;
  is_locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at?: string;
}

export interface FinCurrencyFE {
  id: string;
  property_id: string | null;
  code: string;
  name: string;
  symbol: string;
  is_base: boolean;
  exchange_rate: number;
  last_updated: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface FinTaxCodeFE {
  id: string;
  property_id: string | null;
  code: string;
  name: string;
  tax_type: string;
  rate: number;
  gl_mapping_in: string | null;
  gl_mapping_out: string | null;
  description: string | null;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FinTaxJurisdictionFE {
  id: string;
  property_id: string | null;
  jurisdiction: string;
  jurisdiction_type: 'National' | 'Regional' | 'Local';
  tax_authority: string;
  filing_frequency: 'Monthly' | 'Quarterly' | 'Annual';
  registration_number: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FinPostingRuleFE {
  id: string;
  property_id: string | null;
  name: string;
  description: string | null;
  source_module: string;
  transaction_type: string;
  debit_account_code: string | null;
  credit_account_code: string | null;
  tax_account_code: string | null;
  is_active: boolean;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  created_at?: string;
}

export interface FinJournalTypeFE {
  id: string;
  property_id: string | null;
  code: string;
  name: string;
  description: string | null;
  color: string;
  is_system: boolean;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface FinPostingProfileFE {
  id: string;
  property_id: string | null;
  name: string;
  module: string;
  debit_account_code: string | null;
  debit_account_name: string | null;
  credit_account_code: string | null;
  credit_account_name: string | null;
  description: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

export interface FinApprovalLevelFE {
  id: string;
  property_id: string | null;
  name: string;
  level: number;
  requires_unanimous: boolean;
  approvers: string[];
  spending_limit: number | null;
  description: string | null;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
}

// ── Fiscal Years ───────────────────────────────────────────────────────────

export const fetchFiscalYears = (params: { propertyId?: string } = {}) =>
  apiRequest<FinFiscalYearFE[]>(`${API_BASE}/config/fiscal-years${qs(params)}`);

export const createFiscalYear = (payload: {
  name: string; startDate: string; endDate: string;
  status?: 'open' | 'closed'; isCurrent?: boolean;
  notes?: string; propertyId?: string;
}) => apiRequest<FinFiscalYearFE>(`${API_BASE}/config/fiscal-years`, { method: 'POST', body: JSON.stringify(payload) });

export const updateFiscalYear = (id: string, patch: Partial<{
  name: string; startDate: string; endDate: string;
  status: 'open' | 'closed'; isCurrent: boolean; notes: string;
}>) => apiRequest<FinFiscalYearFE>(`${API_BASE}/config/fiscal-years/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteFiscalYear = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/fiscal-years/${id}`, { method: 'DELETE' });

// ── Fiscal Periods ─────────────────────────────────────────────────────────

export const fetchFiscalPeriods = (params: { propertyId?: string } = {}) =>
  apiRequest<FinFiscalPeriodFE[]>(`${API_BASE}/config/fiscal-periods${qs(params)}`);

export const updateFiscalPeriod = (id: string, patch: { status?: string; isLocked?: boolean }) =>
  apiRequest<FinFiscalPeriodFE>(`${API_BASE}/config/fiscal-periods/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

// ── Currencies ─────────────────────────────────────────────────────────────

export const fetchCurrencies = (params: { propertyId?: string } = {}) =>
  apiRequest<FinCurrencyFE[]>(`${API_BASE}/config/currencies${qs(params)}`);

export const createCurrency = (payload: {
  code: string; name: string; symbol: string;
  isBase?: boolean; exchangeRate?: number;
  status?: 'active' | 'inactive'; propertyId?: string;
}) => apiRequest<FinCurrencyFE>(`${API_BASE}/config/currencies`, { method: 'POST', body: JSON.stringify(payload) });

export const updateCurrency = (id: string, patch: Partial<{
  code: string; name: string; symbol: string;
  isBase: boolean; exchangeRate: number; status: 'active' | 'inactive';
}>) => apiRequest<FinCurrencyFE>(`${API_BASE}/config/currencies/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteCurrency = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/currencies/${id}`, { method: 'DELETE' });

// ── Tax Codes ──────────────────────────────────────────────────────────────

export const fetchTaxCodesConfig = (params: { propertyId?: string } = {}) =>
  apiRequest<FinTaxCodeFE[]>(`${API_BASE}/config/tax-codes${qs(params)}`);

export const createTaxCodeConfig = (payload: {
  code: string; name: string; taxType: string; rate: number;
  glMappingIn?: string; glMappingOut?: string; description?: string;
  effectiveFrom?: string; effectiveTo?: string; isActive?: boolean; propertyId?: string;
}) => apiRequest<FinTaxCodeFE>(`${API_BASE}/config/tax-codes`, { method: 'POST', body: JSON.stringify(payload) });

export const updateTaxCodeConfig = (id: string, patch: Partial<{
  code: string; name: string; taxType: string; rate: number;
  glMappingIn: string; glMappingOut: string; description: string;
  effectiveFrom: string; effectiveTo: string; isActive: boolean;
}>) => apiRequest<FinTaxCodeFE>(`${API_BASE}/config/tax-codes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteTaxCodeConfig = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/tax-codes/${id}`, { method: 'DELETE' });

// ── Tax Jurisdictions ──────────────────────────────────────────────────────

export const fetchTaxJurisdictions = (params: { propertyId?: string } = {}) =>
  apiRequest<FinTaxJurisdictionFE[]>(`${API_BASE}/config/tax-jurisdictions${qs(params)}`);

export const createTaxJurisdiction = (payload: {
  jurisdiction: string; jurisdictionType?: 'National' | 'Regional' | 'Local';
  taxAuthority: string; filingFrequency?: 'Monthly' | 'Quarterly' | 'Annual';
  registrationNumber?: string; status?: 'active' | 'inactive';
  notes?: string; propertyId?: string;
}) => apiRequest<FinTaxJurisdictionFE>(`${API_BASE}/config/tax-jurisdictions`, { method: 'POST', body: JSON.stringify(payload) });

export const updateTaxJurisdiction = (id: string, patch: Partial<{
  jurisdiction: string; jurisdictionType: 'National' | 'Regional' | 'Local';
  taxAuthority: string; filingFrequency: 'Monthly' | 'Quarterly' | 'Annual';
  registrationNumber: string; status: 'active' | 'inactive'; notes: string;
}>) => apiRequest<FinTaxJurisdictionFE>(`${API_BASE}/config/tax-jurisdictions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteTaxJurisdiction = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/tax-jurisdictions/${id}`, { method: 'DELETE' });

// ── Posting Rules ──────────────────────────────────────────────────────────

export const fetchPostingRulesConfig = (params: { propertyId?: string } = {}) =>
  apiRequest<FinPostingRuleFE[]>(`${API_BASE}/config/posting-rules${qs(params)}`);

export const createPostingRuleConfig = (payload: {
  name: string; description?: string; sourceModule: string; transactionType: string;
  debitAccountCode?: string; creditAccountCode?: string; taxAccountCode?: string;
  isActive?: boolean; priority?: number; validFrom?: string; validTo?: string; propertyId?: string;
}) => apiRequest<FinPostingRuleFE>(`${API_BASE}/config/posting-rules`, { method: 'POST', body: JSON.stringify(payload) });

export const updatePostingRuleConfig = (id: string, patch: Partial<{
  name: string; description: string; sourceModule: string; transactionType: string;
  debitAccountCode: string; creditAccountCode: string; taxAccountCode: string;
  isActive: boolean; priority: number; validFrom: string; validTo: string;
}>) => apiRequest<FinPostingRuleFE>(`${API_BASE}/config/posting-rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deletePostingRuleConfig = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/posting-rules/${id}`, { method: 'DELETE' });

// ── Journal Types ──────────────────────────────────────────────────────────

export const fetchJournalTypes = (params: { propertyId?: string } = {}) =>
  apiRequest<FinJournalTypeFE[]>(`${API_BASE}/config/journal-types${qs(params)}`);

export const createJournalType = (payload: {
  code: string; name: string; description?: string; color?: string;
  isSystem?: boolean; status?: 'active' | 'inactive'; propertyId?: string;
}) => apiRequest<FinJournalTypeFE>(`${API_BASE}/config/journal-types`, { method: 'POST', body: JSON.stringify(payload) });

export const updateJournalType = (id: string, patch: Partial<{
  code: string; name: string; description: string; color: string;
  isSystem: boolean; status: 'active' | 'inactive';
}>) => apiRequest<FinJournalTypeFE>(`${API_BASE}/config/journal-types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteJournalType = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/journal-types/${id}`, { method: 'DELETE' });

// ── Posting Profiles ───────────────────────────────────────────────────────

export const fetchPostingProfiles = (params: { propertyId?: string } = {}) =>
  apiRequest<FinPostingProfileFE[]>(`${API_BASE}/config/posting-profiles${qs(params)}`);

export const createPostingProfile = (payload: {
  name: string; module: string;
  debitAccountCode?: string; debitAccountName?: string;
  creditAccountCode?: string; creditAccountName?: string;
  description?: string; status?: 'active' | 'inactive'; propertyId?: string;
}) => apiRequest<FinPostingProfileFE>(`${API_BASE}/config/posting-profiles`, { method: 'POST', body: JSON.stringify(payload) });

export const updatePostingProfile = (id: string, patch: Partial<{
  name: string; module: string;
  debitAccountCode: string; debitAccountName: string;
  creditAccountCode: string; creditAccountName: string;
  description: string; status: 'active' | 'inactive';
}>) => apiRequest<FinPostingProfileFE>(`${API_BASE}/config/posting-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deletePostingProfile = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/posting-profiles/${id}`, { method: 'DELETE' });

// ── Approval Levels ────────────────────────────────────────────────────────

export const fetchApprovalLevelsConfig = (params: { propertyId?: string } = {}) =>
  apiRequest<FinApprovalLevelFE[]>(`${API_BASE}/config/approval-levels${qs(params)}`);

export const createApprovalLevelConfig = (payload: {
  name: string; level: number; requiresUnanimous?: boolean;
  approvers?: string[]; spendingLimit?: number;
  description?: string; status?: 'active' | 'inactive'; propertyId?: string;
}) => apiRequest<FinApprovalLevelFE>(`${API_BASE}/config/approval-levels`, { method: 'POST', body: JSON.stringify(payload) });

export const updateApprovalLevelConfig = (id: string, patch: Partial<{
  name: string; level: number; requiresUnanimous: boolean;
  approvers: string[]; spendingLimit: number;
  description: string; status: 'active' | 'inactive';
}>) => apiRequest<FinApprovalLevelFE>(`${API_BASE}/config/approval-levels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteApprovalLevelConfig = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/config/approval-levels/${id}`, { method: 'DELETE' });
