const API_BASE = '/api/cost-center';

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

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  department?: string;
  manager?: string;
  budget: number;
  actual_expense: number;
  actual_revenue: number;
  variance: number;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

export interface DepartmentPL {
  id: string;
  department: string;
  revenue: number;
  cost_of_sales: number;
  gross_profit: number;
  operating_expenses: number;
  operating_profit: number;
  net_profit: number;
  period?: string;
  property_id?: string;
  property_name?: string;
}

export interface ProfitCenter {
  id: string;
  code: string;
  name: string;
  department?: string;
  revenue: number;
  direct_costs: number;
  allocated_costs: number;
  net_profit: number;
  margin_pct: number;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

export interface ProfitabilityAnalysis {
  id: string;
  department: string;
  revenue: number;
  total_costs: number;
  net_profit: number;
  margin_pct: number;
  revenue_share: number;
  cost_share: number;
  rating: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Loss';
  period?: string;
  property_id?: string;
  property_name?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function mapCostCenterFromDb(row: any): CostCenter {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    manager: row.manager,
    budget: Number(row.budget) || 0,
    actual_expense: Number(row.actual_expense) || 0,
    actual_revenue: Number(row.actual_revenue) || 0,
    variance: Number(row.variance) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapDepartmentPLFromDb(row: any): DepartmentPL {
  return {
    id: row.id,
    department: row.department,
    revenue: Number(row.revenue) || 0,
    cost_of_sales: Number(row.cost_of_sales) || 0,
    gross_profit: Number(row.gross_profit) || 0,
    operating_expenses: Number(row.operating_expenses) || 0,
    operating_profit: Number(row.operating_profit) || 0,
    net_profit: Number(row.net_profit) || 0,
    period: row.period,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapProfitCenterFromDb(row: any): ProfitCenter {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    revenue: Number(row.revenue) || 0,
    direct_costs: Number(row.direct_costs) || 0,
    allocated_costs: Number(row.allocated_costs) || 0,
    net_profit: Number(row.net_profit) || 0,
    margin_pct: Number(row.margin_pct) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapProfitabilityAnalysisFromDb(row: any): ProfitabilityAnalysis {
  return {
    id: row.id,
    department: row.department,
    revenue: Number(row.revenue) || 0,
    total_costs: Number(row.total_costs) || 0,
    net_profit: Number(row.net_profit) || 0,
    margin_pct: Number(row.margin_pct) || 0,
    revenue_share: Number(row.revenue_share) || 0,
    cost_share: Number(row.cost_share) || 0,
    rating: row.rating,
    period: row.period,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function fetchCostCenters(propertyId?: string): Promise<CostCenter[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/cost-centers${qs}`);
  return Array.isArray(data) ? data.map(mapCostCenterFromDb) : [];
}

export async function fetchDepartmentPL(propertyId?: string): Promise<DepartmentPL[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/department-pl${qs}`);
  return Array.isArray(data) ? data.map(mapDepartmentPLFromDb) : [];
}

export async function fetchProfitCenters(propertyId?: string): Promise<ProfitCenter[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/profit-centers${qs}`);
  return Array.isArray(data) ? data.map(mapProfitCenterFromDb) : [];
}

export async function fetchProfitabilityAnalysis(propertyId?: string): Promise<ProfitabilityAnalysis[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/profitability-analysis${qs}`);
  return Array.isArray(data) ? data.map(mapProfitabilityAnalysisFromDb) : [];
}

// ── CRUD: Cost Centers ─────────────────────────────────────────────────────
export async function createCostCenter(payload: Partial<CostCenter> & { propertyId?: string }): Promise<CostCenter> {
  const data = await apiRequest<any>('/cost-centers', {
    method: 'POST',
    body: JSON.stringify({
      code: payload.code,
      name: payload.name,
      department: payload.department,
      manager: payload.manager,
      status: payload.status || 'Active',
      propertyId: payload.propertyId,
    }),
  });
  return mapCostCenterFromDb(data);
}

export async function deleteCostCenter(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/cost-centers/${id}`, { method: 'DELETE' });
}

// ── CRUD: Profit Centers ───────────────────────────────────────────────────
export async function createProfitCenter(payload: Partial<ProfitCenter> & { propertyId?: string }): Promise<ProfitCenter> {
  const data = await apiRequest<any>('/profit-centers', {
    method: 'POST',
    body: JSON.stringify({
      code: payload.code,
      name: payload.name,
      department: payload.department,
      manager: payload.manager,
      status: payload.status || 'Active',
      propertyId: payload.propertyId,
    }),
  });
  return mapProfitCenterFromDb(data);
}

export async function deleteProfitCenter(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/profit-centers/${id}`, { method: 'DELETE' });
}

// ── Revenue Allocation Rules ───────────────────────────────────────────────
export interface RevenueAllocationRule {
  id: string;
  cost_center: string;
  revenue_source: string;
  allocation_pct: number;
  allocated_amount: number;
  period?: string;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

export function mapRevenueAllocationRuleFromDb(row: any): RevenueAllocationRule {
  return {
    id: row.id,
    cost_center: row.cost_center,
    revenue_source: row.revenue_source,
    allocation_pct: Number(row.allocation_pct) || 0,
    allocated_amount: Number(row.allocated_amount) || 0,
    period: row.period,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export async function fetchRevenueAllocationRules(propertyId?: string): Promise<RevenueAllocationRule[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/revenue-allocation-rules${qs}`);
  return Array.isArray(data) ? data.map(mapRevenueAllocationRuleFromDb) : [];
}

export async function createRevenueAllocationRule(payload: Partial<RevenueAllocationRule> & { propertyId?: string }): Promise<RevenueAllocationRule> {
  const data = await apiRequest<any>('/revenue-allocation-rules', {
    method: 'POST',
    body: JSON.stringify({
      costCenter: payload.cost_center,
      revenueSource: payload.revenue_source,
      allocationPct: payload.allocation_pct,
      allocatedAmount: payload.allocated_amount,
      period: payload.period,
      status: payload.status || 'Active',
      propertyId: payload.propertyId,
    }),
  });
  return mapRevenueAllocationRuleFromDb(data);
}

export async function deleteRevenueAllocationRule(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/revenue-allocation-rules/${id}`, { method: 'DELETE' });
}

// ── Tax Rates ──────────────────────────────────────────────────────────────
export interface TaxRate {
  id: string;
  tax_code: string;
  rate: number;
  effective_date: string;
  jurisdiction?: string;
  status: string;
  property_id?: string;
  property_name?: string;
}

export function mapTaxRateFromDb(row: any): TaxRate {
  return {
    id: row.id,
    tax_code: row.tax_code,
    rate: Number(row.rate) || 0,
    effective_date: row.effective_date,
    jurisdiction: row.jurisdiction,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export async function fetchTaxRates(propertyId?: string): Promise<TaxRate[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/tax-rates${qs}`);
  return Array.isArray(data) ? data.map(mapTaxRateFromDb) : [];
}

export async function createTaxRate(payload: Partial<TaxRate> & { propertyId?: string }): Promise<TaxRate> {
  const data = await apiRequest<any>('/tax-rates', {
    method: 'POST',
    body: JSON.stringify({
      taxCode: payload.tax_code,
      rate: payload.rate,
      effectiveDate: payload.effective_date,
      jurisdiction: payload.jurisdiction,
      status: payload.status || 'Active',
      propertyId: payload.propertyId,
    }),
  });
  return mapTaxRateFromDb(data);
}

export async function deleteTaxRate(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/tax-rates/${id}`, { method: 'DELETE' });
}

// ── Spending Limits ────────────────────────────────────────────────────────
export interface SpendingLimit {
  id: string;
  role: string;
  limit_amount: number;
  approval_level?: string;
  currency: string;
  status: string;
  property_id?: string;
  property_name?: string;
}

export function mapSpendingLimitFromDb(row: any): SpendingLimit {
  return {
    id: row.id,
    role: row.role,
    limit_amount: Number(row.limit_amount) || 0,
    approval_level: row.approval_level,
    currency: row.currency,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export async function fetchSpendingLimits(propertyId?: string): Promise<SpendingLimit[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/spending-limits${qs}`);
  return Array.isArray(data) ? data.map(mapSpendingLimitFromDb) : [];
}

export async function createSpendingLimit(payload: Partial<SpendingLimit> & { propertyId?: string }): Promise<SpendingLimit> {
  const data = await apiRequest<any>('/spending-limits', {
    method: 'POST',
    body: JSON.stringify({
      role: payload.role,
      limitAmount: payload.limit_amount,
      approvalLevel: payload.approval_level,
      currency: payload.currency || 'ETB',
      status: payload.status || 'Active',
      propertyId: payload.propertyId,
    }),
  });
  return mapSpendingLimitFromDb(data);
}

export async function deleteSpendingLimit(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/spending-limits/${id}`, { method: 'DELETE' });
}
