const API_BASE = '/api/budgeting';

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null) {
    throw new Error((data as any)?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface BudgetEntry {
  id: string;
  budget_name: string;
  period: string;
  account_code: string;
  department?: string;
  budgeted_amount: number;
  actual_amount: number;
  variance: number;
  variance_percent: number;
  version: 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';
  approved_by?: string | null;
  created_at?: string;
  property_id?: string;
  property_name?: string;
}

export interface BudgetType {
  id: string;
  code: string;
  name: string;
  description?: string;
  entry_count: number;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

export interface BudgetForecast {
  id: string;
  department: string;
  q3_forecast: number;
  q4_forecast: number;
  fy_total: number;
  trend: 'Up' | 'Stable' | 'Down';
  confidence: number;
  period?: string;
  property_id?: string;
  property_name?: string;
}

export interface BudgetTransfer {
  id: string;
  transfer_number: string;
  from_department: string;
  to_department: string;
  amount: number;
  transfer_date?: string;
  reason?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approved_by?: string | null;
  property_id?: string;
  property_name?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function mapBudgetEntryFromDb(row: any): BudgetEntry {
  return {
    id: row.id,
    budget_name: row.budget_name,
    period: row.period,
    account_code: row.account_code,
    department: row.department,
    budgeted_amount: Number(row.budgeted_amount) || 0,
    actual_amount: Number(row.actual_amount) || 0,
    variance: Number(row.variance) || 0,
    variance_percent: Number(row.variance_percent) || 0,
    version: row.version,
    approved_by: row.approved_by,
    created_at: row.created_at,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapBudgetTypeFromDb(row: any): BudgetType {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    entry_count: Number(row.entry_count) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapBudgetForecastFromDb(row: any): BudgetForecast {
  return {
    id: row.id,
    department: row.department,
    q3_forecast: Number(row.q3_forecast) || 0,
    q4_forecast: Number(row.q4_forecast) || 0,
    fy_total: Number(row.fy_total) || 0,
    trend: row.trend,
    confidence: Number(row.confidence) || 0,
    period: row.period,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapBudgetTransferFromDb(row: any): BudgetTransfer {
  return {
    id: row.id,
    transfer_number: row.transfer_number,
    from_department: row.from_department,
    to_department: row.to_department,
    amount: Number(row.amount) || 0,
    transfer_date: row.transfer_date,
    reason: row.reason,
    status: row.status,
    approved_by: row.approved_by,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function fetchBudgetEntries(propertyId?: string): Promise<BudgetEntry[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/entries${qs}`);
  return Array.isArray(data) ? data.map(mapBudgetEntryFromDb) : [];
}

export async function fetchBudgetTypes(propertyId?: string): Promise<BudgetType[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/types${qs}`);
  return Array.isArray(data) ? data.map(mapBudgetTypeFromDb) : [];
}

export async function fetchBudgetForecasts(propertyId?: string): Promise<BudgetForecast[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/forecasts${qs}`);
  return Array.isArray(data) ? data.map(mapBudgetForecastFromDb) : [];
}

export async function fetchBudgetTransfers(propertyId?: string): Promise<BudgetTransfer[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/transfers${qs}`);
  return Array.isArray(data) ? data.map(mapBudgetTransferFromDb) : [];
}

export async function fetchPendingApprovals(propertyId?: string): Promise<BudgetEntry[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/approvals${qs}`);
  return Array.isArray(data) ? data.map(mapBudgetEntryFromDb) : [];
}

export async function createBudgetEntry(payload: {
  budgetName: string;
  period: string;
  accountCode: string;
  department: string;
  budgetedAmount: number;
}): Promise<BudgetEntry> {
  const data = await apiRequest<any>('/entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return mapBudgetEntryFromDb(data);
}
