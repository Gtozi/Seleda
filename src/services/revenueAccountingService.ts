const API_BASE = '/api/revenue-accounting';

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

export interface RevenueEntry {
  id: string;
  date: string;
  source: 'room' | 'f_b' | 'spa' | 'laundry' | 'transport' | 'retail' | 'events' | 'misc';
  amount: number;
  tax_amount: number;
  service_charge: number;
  net_amount: number;
  account_code: string;
  department: string;
  status: 'recognized' | 'deferred' | 'accrued';
  description?: string;
  property_id?: string;
  property_name?: string;
}

export interface DeferredRevenue {
  id: string;
  description?: string;
  original_amount: number;
  recognized_amount: number;
  remaining_amount: number;
  recognition_start: string;
  recognition_end: string;
  recognition_schedule: any;
  status: 'Active' | 'Fully Recognized' | 'Cancelled';
  property_id?: string;
  property_name?: string;
}

export interface DailyPostingSummary {
  id: string;
  posting_date: string;
  total_revenue: number;
  total_tax: number;
  total_service_charge: number;
  total_net: number;
  entry_count: number;
  status: 'Draft' | 'Posted' | 'Reversed';
  posted_by?: string;
  posted_at?: string;
  property_id?: string;
  property_name?: string;
}

export interface PackageAllocation {
  id: string;
  package_name: string;
  total_amount: number;
  room_portion: number;
  fb_portion: number;
  spa_portion: number;
  other_portion: number;
  allocation_method: string;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function mapRevenueEntryFromDb(row: any): RevenueEntry {
  return {
    id: row.id,
    date: row.date,
    source: row.source,
    amount: Number(row.amount) || 0,
    tax_amount: Number(row.tax_amount) || 0,
    service_charge: Number(row.service_charge) || 0,
    net_amount: Number(row.net_amount) || 0,
    account_code: row.account_code,
    department: row.department,
    status: row.status,
    description: row.description,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapDeferredRevenueFromDb(row: any): DeferredRevenue {
  return {
    id: row.id,
    description: row.description,
    original_amount: Number(row.original_amount) || 0,
    recognized_amount: Number(row.recognized_amount) || 0,
    remaining_amount: Number(row.remaining_amount) || 0,
    recognition_start: row.recognition_start,
    recognition_end: row.recognition_end,
    recognition_schedule: row.recognition_schedule,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapDailyPostingFromDb(row: any): DailyPostingSummary {
  return {
    id: row.id,
    posting_date: row.posting_date,
    total_revenue: Number(row.total_revenue) || 0,
    total_tax: Number(row.total_tax) || 0,
    total_service_charge: Number(row.total_service_charge) || 0,
    total_net: Number(row.total_net) || 0,
    entry_count: Number(row.entry_count) || 0,
    status: row.status,
    posted_by: row.posted_by,
    posted_at: row.posted_at,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapPackageAllocationFromDb(row: any): PackageAllocation {
  return {
    id: row.id,
    package_name: row.package_name,
    total_amount: Number(row.total_amount) || 0,
    room_portion: Number(row.room_portion) || 0,
    fb_portion: Number(row.fb_portion) || 0,
    spa_portion: Number(row.spa_portion) || 0,
    other_portion: Number(row.other_portion) || 0,
    allocation_method: row.allocation_method,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function fetchRevenueEntries(propertyId?: string): Promise<RevenueEntry[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/entries${qs}`);
  return Array.isArray(data) ? data.map(mapRevenueEntryFromDb) : [];
}

export async function createRevenueEntry(payload: Partial<RevenueEntry> & { propertyId?: string }): Promise<RevenueEntry> {
  const data = await apiRequest<any>('/entries', {
    method: 'POST',
    body: JSON.stringify({
      date: payload.date,
      source: payload.source,
      amount: payload.amount,
      taxAmount: payload.tax_amount,
      serviceCharge: payload.service_charge,
      netAmount: payload.net_amount,
      accountCode: payload.account_code,
      department: payload.department,
      status: payload.status || 'recognized',
      description: payload.description,
      propertyId: payload.propertyId,
    }),
  });
  return mapRevenueEntryFromDb(data);
}

export async function updateRevenueEntryStatus(id: string, status: string): Promise<RevenueEntry> {
  const data = await apiRequest<any>(`/entries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return mapRevenueEntryFromDb(data);
}

export async function fetchDeferredRevenue(propertyId?: string): Promise<DeferredRevenue[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/deferred${qs}`);
  return Array.isArray(data) ? data.map(mapDeferredRevenueFromDb) : [];
}

export async function createDeferredRevenue(payload: Partial<DeferredRevenue> & { propertyId?: string }): Promise<DeferredRevenue> {
  const data = await apiRequest<any>('/deferred', {
    method: 'POST',
    body: JSON.stringify({
      description: payload.description,
      originalAmount: payload.original_amount,
      recognitionStart: payload.recognition_start,
      recognitionEnd: payload.recognition_end,
      recognitionSchedule: payload.recognition_schedule,
      propertyId: payload.propertyId,
    }),
  });
  return mapDeferredRevenueFromDb(data);
}

export async function recognizeDeferredRevenue(id: string, amount: number): Promise<DeferredRevenue> {
  const data = await apiRequest<any>(`/deferred/${id}/recognize`, {
    method: 'PATCH',
    body: JSON.stringify({ amount }),
  });
  return mapDeferredRevenueFromDb(data);
}

export async function fetchDailyPostings(propertyId?: string): Promise<DailyPostingSummary[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/daily-postings${qs}`);
  return Array.isArray(data) ? data.map(mapDailyPostingFromDb) : [];
}

export async function createDailyPosting(payload: Partial<DailyPostingSummary> & { propertyId?: string }): Promise<DailyPostingSummary> {
  const data = await apiRequest<any>('/daily-postings', {
    method: 'POST',
    body: JSON.stringify({
      postingDate: payload.posting_date,
      totalRevenue: payload.total_revenue,
      totalTax: payload.total_tax,
      totalServiceCharge: payload.total_service_charge,
      totalNet: payload.total_net,
      entryCount: payload.entry_count,
      propertyId: payload.propertyId,
    }),
  });
  return mapDailyPostingFromDb(data);
}

export async function postDailyPosting(id: string): Promise<DailyPostingSummary> {
  const data = await apiRequest<any>(`/daily-postings/${id}/post`, {
    method: 'PATCH',
  });
  return mapDailyPostingFromDb(data);
}

export async function fetchPackageAllocations(propertyId?: string): Promise<PackageAllocation[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/package-allocations${qs}`);
  return Array.isArray(data) ? data.map(mapPackageAllocationFromDb) : [];
}

export async function createPackageAllocation(payload: Partial<PackageAllocation> & { propertyId?: string }): Promise<PackageAllocation> {
  const data = await apiRequest<any>('/package-allocations', {
    method: 'POST',
    body: JSON.stringify({
      packageName: payload.package_name,
      totalAmount: payload.total_amount,
      roomPortion: payload.room_portion,
      fbPortion: payload.fb_portion,
      spaPortion: payload.spa_portion,
      otherPortion: payload.other_portion,
      allocationMethod: payload.allocation_method,
      propertyId: payload.propertyId,
    }),
  });
  return mapPackageAllocationFromDb(data);
}

export async function updatePackageAllocation(id: string, payload: Partial<PackageAllocation>): Promise<PackageAllocation> {
  const data = await apiRequest<any>(`/package-allocations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      packageName: payload.package_name,
      totalAmount: payload.total_amount,
      roomPortion: payload.room_portion,
      fbPortion: payload.fb_portion,
      spaPortion: payload.spa_portion,
      otherPortion: payload.other_portion,
      allocationMethod: payload.allocation_method,
      status: payload.status,
    }),
  });
  return mapPackageAllocationFromDb(data);
}
