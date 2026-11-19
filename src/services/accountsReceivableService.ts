const API_BASE = '/api/finance/ar';

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export interface ArCustomer {
  id: string;
  customer_code?: string;
  customer_type?: string;
  name: string;
  tin?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  credit_limit?: number;
  current_balance?: number;
  payment_terms?: string;
  commission_rate?: number;
  is_active?: boolean;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FolioWithAging {
  id: string;
  reservation_id: string;
  guest_name: string;
  room_number: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  status: string;
  balance: number;
  total_charges: number;
  total_payments: number;
  opened_at: string;
  closed_at: string | null;
  payment_status: string | null;
  days_outstanding: number;
  aging_bucket: string;
  property_id?: string | null;
  property_name?: string | null;
}

export interface ArCreditNote {
  id: string;
  note_number: string;
  note_type: 'Credit' | 'Debit';
  customer_id: string | null;
  customer_name?: string | null;
  invoice_id: string | null;
  reason: string | null;
  amount: number;
  status: 'Pending' | 'Applied' | 'Void';
  applied_at: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ArCollection {
  id: string;
  customer_id: string | null;
  customer_name?: string | null;
  folio_id: string | null;
  amount: number;
  days_overdue: number;
  last_contact: string | null;
  next_action: string | null;
  next_action_date: string | null;
  status: 'In Progress' | 'Promised' | 'Escalated' | 'Resolved';
  notes: string | null;
  assigned_to: string | null;
  property_id?: string | null;
  property_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AgingSummary {
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total_outstanding: number;
}

export async function fetchCustomers(): Promise<ArCustomer[]> {
  return apiRequest<ArCustomer[]>('/customers');
}

export async function createCustomer(customer: Partial<ArCustomer>): Promise<{ success: boolean; customer: ArCustomer }> {
  return apiRequest<{ success: boolean; customer: ArCustomer }>('/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  });
}

export async function fetchFoliosWithAging(): Promise<FolioWithAging[]> {
  return apiRequest<FolioWithAging[]>('/folios');
}

// ── Credit/Debit Notes ──────────────────────────────────────────────────
export async function fetchCreditNotes(params: { noteType?: string; status?: string; propertyId?: string } = {}): Promise<ArCreditNote[]> {
  const qs = new URLSearchParams();
  if (params.noteType) qs.set('noteType', params.noteType);
  if (params.status) qs.set('status', params.status);
  if (params.propertyId) qs.set('propertyId', params.propertyId);
  const q = qs.toString();
  return apiRequest<ArCreditNote[]>(`/credit-notes${q ? `?${q}` : ''}`);
}

export async function createCreditNote(payload: {
  noteType: 'Credit' | 'Debit';
  customerId?: string;
  invoiceId?: string;
  reason?: string;
  amount: number;
  status?: string;
  propertyId?: string;
}): Promise<ArCreditNote> {
  return apiRequest<ArCreditNote>('/credit-notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCreditNote(id: string, patch: Partial<{ status: string; reason: string; amount: number }>): Promise<ArCreditNote> {
  return apiRequest<ArCreditNote>(`/credit-notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCreditNote(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/credit-notes/${id}`, { method: 'DELETE' });
}

// ── Collections ──────────────────────────────────────────────────────────
export async function fetchCollections(params: { status?: string; propertyId?: string } = {}): Promise<ArCollection[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.propertyId) qs.set('propertyId', params.propertyId);
  const q = qs.toString();
  return apiRequest<ArCollection[]>(`/collections${q ? `?${q}` : ''}`);
}

export async function createCollection(payload: {
  customerId?: string;
  folioId?: string;
  amount: number;
  daysOverdue?: number;
  lastContact?: string;
  nextAction?: string;
  nextActionDate?: string;
  status?: string;
  notes?: string;
  propertyId?: string;
}): Promise<ArCollection> {
  return apiRequest<ArCollection>('/collections', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateCollection(id: string, patch: Partial<{
  status: string; nextAction: string; nextActionDate: string; lastContact: string; notes: string; amount: number; daysOverdue: number;
}>): Promise<ArCollection> {
  return apiRequest<ArCollection>(`/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCollection(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/collections/${id}`, { method: 'DELETE' });
}

export function computeAgingSummary(folios: FolioWithAging[]): AgingSummary {
  const summary: AgingSummary = {
    bucket_0_30: 0,
    bucket_31_60: 0,
    bucket_61_90: 0,
    bucket_90_plus: 0,
    total_outstanding: 0,
  };
  for (const f of folios) {
    if (f.balance <= 0) continue;
    summary.total_outstanding += f.balance;
    switch (f.aging_bucket) {
      case '0-30': summary.bucket_0_30 += f.balance; break;
      case '31-60': summary.bucket_31_60 += f.balance; break;
      case '61-90': summary.bucket_61_90 += f.balance; break;
      case '90+': summary.bucket_90_plus += f.balance; break;
    }
  }
  return summary;
}
