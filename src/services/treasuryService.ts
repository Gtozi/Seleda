const API_BASE = '/api/treasury';

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

export interface CashForecast {
  id: string;
  period: string;
  opening_balance: number;
  inflows: number;
  outflows: number;
  net_cash_flow: number;
  closing_balance: number;
  property_id?: string;
  property_name?: string;
}

export interface Investment {
  id: string;
  name: string;
  type: string;
  amount: number;
  maturity_date: string;
  interest_rate: number;
  status: 'active' | 'matured' | 'redeemed';
  property_id?: string;
  property_name?: string;
}

export interface Loan {
  id: string;
  lender: string;
  principal: number;
  interest_rate: number;
  outstanding_balance: number;
  next_payment_date: string;
  monthly_payment: number;
  status: 'active' | 'paid' | 'defaulted';
  property_id?: string;
  property_name?: string;
}

export interface FxRate {
  id: string;
  currency: string;
  rate: number;
  change_pct: number;
  last_updated: string;
  property_id?: string;
  property_name?: string;
}

export interface FxTransaction {
  id: string;
  from_currency: string;
  to_currency: string;
  amount: number;
  rate: number;
  converted_amount: number;
  transaction_date: string;
  status: 'Completed' | 'Pending' | 'Cancelled';
  property_id?: string;
  property_name?: string;
}

export interface LiquidityForecast {
  id: string;
  week_label: string;
  opening: number;
  inflows: number;
  outflows: number;
  closing: number;
  status: 'Surplus' | 'Watch' | 'Deficit';
  property_id?: string;
  property_name?: string;
}

export interface CashPoolParticipant {
  id: string;
  account_name: string;
  entity?: string;
  balance: number;
  sweep_amount: number;
  role: 'Header' | 'Participant' | 'Reserve';
  property_id?: string;
  property_name?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function mapCashForecastFromDb(row: any): CashForecast {
  return {
    id: row.id,
    period: row.period,
    opening_balance: Number(row.opening_balance) || 0,
    inflows: Number(row.inflows) || 0,
    outflows: Number(row.outflows) || 0,
    net_cash_flow: Number(row.net_cash_flow) || 0,
    closing_balance: Number(row.closing_balance) || 0,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapInvestmentFromDb(row: any): Investment {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: Number(row.amount) || 0,
    maturity_date: row.maturity_date,
    interest_rate: Number(row.interest_rate) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapLoanFromDb(row: any): Loan {
  return {
    id: row.id,
    lender: row.lender,
    principal: Number(row.principal) || 0,
    interest_rate: Number(row.interest_rate) || 0,
    outstanding_balance: Number(row.outstanding_balance) || 0,
    next_payment_date: row.next_payment_date,
    monthly_payment: Number(row.monthly_payment) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapFxRateFromDb(row: any): FxRate {
  return {
    id: row.id,
    currency: row.currency,
    rate: Number(row.rate) || 0,
    change_pct: Number(row.change_pct) || 0,
    last_updated: row.last_updated,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapFxTransactionFromDb(row: any): FxTransaction {
  return {
    id: row.id,
    from_currency: row.from_currency,
    to_currency: row.to_currency,
    amount: Number(row.amount) || 0,
    rate: Number(row.rate) || 0,
    converted_amount: Number(row.converted_amount) || 0,
    transaction_date: row.transaction_date,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapLiquidityForecastFromDb(row: any): LiquidityForecast {
  return {
    id: row.id,
    week_label: row.week_label,
    opening: Number(row.opening) || 0,
    inflows: Number(row.inflows) || 0,
    outflows: Number(row.outflows) || 0,
    closing: Number(row.closing) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapCashPoolParticipantFromDb(row: any): CashPoolParticipant {
  return {
    id: row.id,
    account_name: row.account_name,
    entity: row.entity,
    balance: Number(row.balance) || 0,
    sweep_amount: Number(row.sweep_amount) || 0,
    role: row.role,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function fetchCashForecasts(propertyId?: string): Promise<CashForecast[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/cash-forecasts${qs}`);
  return Array.isArray(data) ? data.map(mapCashForecastFromDb) : [];
}

export async function createCashForecast(payload: Partial<CashForecast> & { propertyId?: string }): Promise<CashForecast> {
  const data = await apiRequest<any>('/cash-forecasts', {
    method: 'POST',
    body: JSON.stringify({
      period: payload.period,
      openingBalance: payload.opening_balance,
      inflows: payload.inflows,
      outflows: payload.outflows,
      closingBalance: payload.closing_balance,
      propertyId: payload.propertyId,
    }),
  });
  return mapCashForecastFromDb(data);
}

export async function deleteCashForecast(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/cash-forecasts/${id}`, { method: 'DELETE' });
}

export async function fetchInvestments(propertyId?: string): Promise<Investment[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/investments${qs}`);
  return Array.isArray(data) ? data.map(mapInvestmentFromDb) : [];
}

export async function createInvestment(payload: Partial<Investment> & { propertyId?: string }): Promise<Investment> {
  const data = await apiRequest<any>('/investments', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      type: payload.type,
      amount: payload.amount,
      maturityDate: payload.maturity_date,
      interestRate: payload.interest_rate,
      status: payload.status || 'active',
      propertyId: payload.propertyId,
    }),
  });
  return mapInvestmentFromDb(data);
}

export async function deleteInvestment(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/investments/${id}`, { method: 'DELETE' });
}

export async function fetchLoans(propertyId?: string): Promise<Loan[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/loans${qs}`);
  return Array.isArray(data) ? data.map(mapLoanFromDb) : [];
}

export async function createLoan(payload: Partial<Loan> & { propertyId?: string }): Promise<Loan> {
  const data = await apiRequest<any>('/loans', {
    method: 'POST',
    body: JSON.stringify({
      lender: payload.lender,
      principal: payload.principal,
      interestRate: payload.interest_rate,
      outstandingBalance: payload.outstanding_balance,
      nextPaymentDate: payload.next_payment_date,
      monthlyPayment: payload.monthly_payment,
      status: payload.status || 'active',
      propertyId: payload.propertyId,
    }),
  });
  return mapLoanFromDb(data);
}

export async function deleteLoan(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/loans/${id}`, { method: 'DELETE' });
}

export async function fetchFxRates(propertyId?: string): Promise<FxRate[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/fx-rates${qs}`);
  return Array.isArray(data) ? data.map(mapFxRateFromDb) : [];
}

export async function createFxRate(payload: Partial<FxRate> & { propertyId?: string }): Promise<FxRate> {
  const data = await apiRequest<any>('/fx-rates', {
    method: 'POST',
    body: JSON.stringify({
      currency: payload.currency,
      rate: payload.rate,
      changePct: payload.change_pct,
      propertyId: payload.propertyId,
    }),
  });
  return mapFxRateFromDb(data);
}

export async function deleteFxRate(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/fx-rates/${id}`, { method: 'DELETE' });
}

export async function fetchFxTransactions(propertyId?: string): Promise<FxTransaction[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/fx-transactions${qs}`);
  return Array.isArray(data) ? data.map(mapFxTransactionFromDb) : [];
}

export async function fetchLiquidityForecasts(propertyId?: string): Promise<LiquidityForecast[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/liquidity-forecasts${qs}`);
  return Array.isArray(data) ? data.map(mapLiquidityForecastFromDb) : [];
}

export async function createLiquidityForecast(payload: Partial<LiquidityForecast> & { propertyId?: string }): Promise<LiquidityForecast> {
  const data = await apiRequest<any>('/liquidity-forecasts', {
    method: 'POST',
    body: JSON.stringify({
      weekLabel: payload.week_label,
      opening: payload.opening,
      inflows: payload.inflows,
      outflows: payload.outflows,
      closing: payload.closing,
      status: payload.status || 'Surplus',
      propertyId: payload.propertyId,
    }),
  });
  return mapLiquidityForecastFromDb(data);
}

export async function deleteLiquidityForecast(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/liquidity-forecasts/${id}`, { method: 'DELETE' });
}

export async function fetchCashPoolParticipants(propertyId?: string): Promise<CashPoolParticipant[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/cash-pool${qs}`);
  return Array.isArray(data) ? data.map(mapCashPoolParticipantFromDb) : [];
}

export async function createCashPoolParticipant(payload: Partial<CashPoolParticipant> & { propertyId?: string }): Promise<CashPoolParticipant> {
  const data = await apiRequest<any>('/cash-pool', {
    method: 'POST',
    body: JSON.stringify({
      accountName: payload.account_name,
      entity: payload.entity,
      balance: payload.balance,
      sweepAmount: payload.sweep_amount,
      role: payload.role || 'Participant',
      propertyId: payload.propertyId,
    }),
  });
  return mapCashPoolParticipantFromDb(data);
}

export async function deleteCashPoolParticipant(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/cash-pool/${id}`, { method: 'DELETE' });
}
