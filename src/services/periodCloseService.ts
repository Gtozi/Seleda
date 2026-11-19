const API_BASE = '/api/period-close';

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export interface AccountingPeriod {
  id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_by?: string;
  closed_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export function mapAccountingPeriodFromDb(row: any): AccountingPeriod {
  return {
    id: row.id,
    period_name: row.period_name,
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    closed_by: row.closed_by,
    closed_at: row.closed_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchAccountingPeriods(status?: string): Promise<AccountingPeriod[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const data = await apiRequest<any[]>(`?${params.toString()}`);
  return Array.isArray(data) ? data.map(mapAccountingPeriodFromDb) : [];
}

export async function createAccountingPeriod(period: Omit<AccountingPeriod, 'id' | 'status' | 'closed_by' | 'closed_at' | 'created_at' | 'updated_at'>): Promise<AccountingPeriod> {
  const data = await apiRequest<any>('/', {
    method: 'POST',
    body: JSON.stringify({
      periodName: period.period_name,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      notes: period.notes,
    }),
  });
  return mapAccountingPeriodFromDb(data);
}

export async function closeAccountingPeriod(periodId: string, notes?: string): Promise<{ success: boolean; period_id: string }> {
  return apiRequest(`/${periodId}/close`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function reopenAccountingPeriod(periodId: string): Promise<{ success: boolean; period_id: string }> {
  return apiRequest(`/${periodId}/reopen`, {
    method: 'POST',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Period Close Checklist
// ══════════════════════════════════════════════════════════════════════════

export interface PeriodCloseChecklistItem {
  id: string;
  period_id: string | null;
  category: string;
  task: string;
  assigned_to: string | null;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
  sort_order: number;
  property_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchChecklistItems(params: { propertyId?: string; periodId?: string; category?: string; completed?: boolean } = {}): Promise<PeriodCloseChecklistItem[]> {
  const search = new URLSearchParams();
  if (params.propertyId) search.set('propertyId', params.propertyId);
  if (params.periodId) search.set('periodId', params.periodId);
  if (params.category) search.set('category', params.category);
  if (params.completed !== undefined) search.set('completed', String(params.completed));
  const qs = search.toString();
  const data = await apiRequest<PeriodCloseChecklistItem[]>(`/checklist${qs ? `?${qs}` : ''}`);
  return Array.isArray(data) ? data : [];
}

export async function createChecklistItem(payload: {
  periodId?: string; category?: string; task: string;
  assignedTo?: string; notes?: string; propertyId?: string;
}): Promise<PeriodCloseChecklistItem> {
  return apiRequest<PeriodCloseChecklistItem>('/checklist', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function updateChecklistItem(id: string, patch: {
  completed?: boolean; category?: string; task?: string;
  assignedTo?: string; notes?: string;
}): Promise<PeriodCloseChecklistItem> {
  return apiRequest<PeriodCloseChecklistItem>(`/checklist/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}

export async function deleteChecklistItem(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/checklist/${id}`, { method: 'DELETE' });
}
