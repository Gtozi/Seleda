const API_BASE = '/api/fixed-assets';

async function apiRequest<T = any>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────
export interface FixedAsset {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_category: string;
  description?: string | null;
  location?: string | null;
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_years: number;
  depreciation_method: string;
  accumulated_depreciation: number;
  net_book_value: number;
  status: string;
  property_id?: string | null;
  disposal_date?: string | null;
  disposal_value?: number | null;
  created_at: string;
  updated_at: string;
}

export interface DepreciationSchedule {
  id: string;
  asset_id: string;
  fiscal_year: number;
  depreciation_amount: number;
  accumulated_depreciation: number;
  net_book_value: number;
  created_at: string;
}

export interface AssetTransfer {
  id: string;
  property_id?: string | null;
  asset_id: string;
  transfer_number?: string | null;
  from_department?: string | null;
  to_department?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  transfer_date: string;
  reason?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  fixed_assets?: { asset_code: string; asset_name: string; asset_category: string } | null;
}

export interface AssetRevaluation {
  id: string;
  property_id?: string | null;
  asset_id: string;
  revaluation_number?: string | null;
  revaluation_date: string;
  original_value: number;
  revalued_value: number;
  change_percent?: number | null;
  reason?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  fixed_assets?: { asset_code: string; asset_name: string; asset_category: string } | null;
}

export interface AssetVerification {
  id: string;
  property_id?: string | null;
  asset_id: string;
  verification_number?: string | null;
  verification_date: string;
  location?: string | null;
  verified_by?: string | null;
  condition?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  fixed_assets?: { asset_code: string; asset_name: string; asset_category: string } | null;
}

export interface AssetWarranty {
  id: string;
  property_id?: string | null;
  asset_id: string;
  warranty_number?: string | null;
  provider: string;
  start_date: string;
  end_date?: string | null;
  coverage?: string | null;
  contact?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  fixed_assets?: { asset_code: string; asset_name: string; asset_category: string } | null;
}

// ── Mappers ──────────────────────────────────────────────────────
export function mapFixedAssetFromDb(row: any): FixedAsset {
  return {
    id: row.id,
    asset_code: row.asset_code,
    asset_name: row.asset_name,
    asset_category: row.asset_category,
    description: row.description,
    location: row.location,
    purchase_date: row.purchase_date,
    purchase_cost: Number(row.purchase_cost) || 0,
    salvage_value: Number(row.salvage_value) || 0,
    useful_life_years: Number(row.useful_life_years) || 0,
    depreciation_method: row.depreciation_method,
    accumulated_depreciation: Number(row.accumulated_depreciation) || 0,
    net_book_value: Number(row.net_book_value) || 0,
    status: row.status,
    property_id: row.property_id,
    disposal_date: row.disposal_date,
    disposal_value: row.disposal_value != null ? Number(row.disposal_value) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapDepreciationScheduleFromDb(row: any): DepreciationSchedule {
  return {
    id: row.id,
    asset_id: row.asset_id,
    fiscal_year: Number(row.fiscal_year) || 0,
    depreciation_amount: Number(row.depreciation_amount) || 0,
    accumulated_depreciation: Number(row.accumulated_depreciation) || 0,
    net_book_value: Number(row.net_book_value) || 0,
    created_at: row.created_at,
  };
}

function mapTransferFromDb(row: any): AssetTransfer {
  return {
    id: row.id,
    property_id: row.property_id,
    asset_id: row.asset_id,
    transfer_number: row.transfer_number,
    from_department: row.from_department,
    to_department: row.to_department,
    from_location: row.from_location,
    to_location: row.to_location,
    transfer_date: row.transfer_date,
    reason: row.reason,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    fixed_assets: row.fixed_assets,
  };
}

function mapRevaluationFromDb(row: any): AssetRevaluation {
  return {
    id: row.id,
    property_id: row.property_id,
    asset_id: row.asset_id,
    revaluation_number: row.revaluation_number,
    revaluation_date: row.revaluation_date,
    original_value: Number(row.original_value) || 0,
    revalued_value: Number(row.revalued_value) || 0,
    change_percent: row.change_percent != null ? Number(row.change_percent) : null,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    fixed_assets: row.fixed_assets,
  };
}

function mapVerificationFromDb(row: any): AssetVerification {
  return {
    id: row.id,
    property_id: row.property_id,
    asset_id: row.asset_id,
    verification_number: row.verification_number,
    verification_date: row.verification_date,
    location: row.location,
    verified_by: row.verified_by,
    condition: row.condition,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    fixed_assets: row.fixed_assets,
  };
}

function mapWarrantyFromDb(row: any): AssetWarranty {
  return {
    id: row.id,
    property_id: row.property_id,
    asset_id: row.asset_id,
    warranty_number: row.warranty_number,
    provider: row.provider,
    start_date: row.start_date,
    end_date: row.end_date,
    coverage: row.coverage,
    contact: row.contact,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    fixed_assets: row.fixed_assets,
  };
}

// ── Fixed Assets CRUD ────────────────────────────────────────────
export async function fetchFixedAssets(category?: string, status?: string, propertyId?: string): Promise<FixedAsset[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (status) params.set('status', status);
  if (propertyId) params.set('propertyId', propertyId);
  const data = await apiRequest<any[]>(`?${params.toString()}`);
  return data.map(mapFixedAssetFromDb);
}

export async function createFixedAsset(asset: {
  asset_code: string;
  asset_name: string;
  asset_category: string;
  description?: string;
  location?: string;
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_years: number;
  depreciation_method: string;
  property_id?: string | null;
}): Promise<FixedAsset> {
  const data = await apiRequest<any>('/', {
    method: 'POST',
    body: JSON.stringify({
      assetCode: asset.asset_code,
      assetName: asset.asset_name,
      assetCategory: asset.asset_category,
      description: asset.description,
      location: asset.location,
      purchaseDate: asset.purchase_date,
      purchaseCost: asset.purchase_cost,
      salvageValue: asset.salvage_value,
      usefulLifeYears: asset.useful_life_years,
      depreciationMethod: asset.depreciation_method,
      propertyId: asset.property_id,
    }),
  });
  return mapFixedAssetFromDb(data);
}

export async function updateFixedAsset(id: string, updates: Record<string, any>): Promise<FixedAsset> {
  const data = await apiRequest<any>(`/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapFixedAssetFromDb(data);
}

export async function deleteFixedAsset(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/${id}`, { method: 'DELETE' });
}

export async function calculateDepreciation(assetId: string, fiscalYear: number): Promise<{ depreciation_amount: number; accumulated_depreciation: number; net_book_value: number }> {
  return apiRequest(`/${assetId}/calculate-depreciation`, {
    method: 'POST',
    body: JSON.stringify({ fiscalYear }),
  });
}

export async function generateDepreciationSchedule(assetId: string): Promise<{ success: boolean; schedule: DepreciationSchedule[]; message: string }> {
  return apiRequest(`/${assetId}/generate-schedule`, { method: 'POST' });
}

export async function disposeAsset(assetId: string, disposalDate: string, disposalValue: number, disposalCosts?: number, reason?: string): Promise<{ success: boolean }> {
  return apiRequest(`/${assetId}/dispose`, {
    method: 'POST',
    body: JSON.stringify({ disposalDate, disposalValue, disposalCosts, reason }),
  });
}

export async function fetchDepreciationSchedule(assetId: string): Promise<DepreciationSchedule[]> {
  const data = await apiRequest<any[]>(`/${assetId}/depreciation-schedule`);
  return data.map(mapDepreciationScheduleFromDb);
}

// ── Transfers ────────────────────────────────────────────────────
export async function fetchAssetTransfers(propertyId?: string, status?: string): Promise<AssetTransfer[]> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (status) params.set('status', status);
  const data = await apiRequest<any[]>(`/transfers/all?${params.toString()}`);
  return data.map(mapTransferFromDb);
}

export async function createAssetTransfer(transfer: {
  assetId: string;
  fromDepartment?: string;
  toDepartment: string;
  fromLocation?: string;
  toLocation?: string;
  transferDate?: string;
  reason?: string;
  propertyId?: string | null;
}): Promise<AssetTransfer> {
  const data = await apiRequest<any>('/transfers', {
    method: 'POST',
    body: JSON.stringify(transfer),
  });
  return mapTransferFromDb(data);
}

export async function updateAssetTransfer(id: string, updates: Record<string, any>): Promise<AssetTransfer> {
  const data = await apiRequest<any>(`/transfers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapTransferFromDb(data);
}

export async function deleteAssetTransfer(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/transfers/${id}`, { method: 'DELETE' });
}

// ── Revaluations ─────────────────────────────────────────────────
export async function fetchAssetRevaluations(propertyId?: string, status?: string): Promise<AssetRevaluation[]> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (status) params.set('status', status);
  const data = await apiRequest<any[]>(`/revaluations/all?${params.toString()}`);
  return data.map(mapRevaluationFromDb);
}

export async function createAssetRevaluation(reval: {
  assetId: string;
  revaluationDate?: string;
  originalValue: number;
  revaluedValue: number;
  reason?: string;
  propertyId?: string | null;
}): Promise<AssetRevaluation> {
  const data = await apiRequest<any>('/revaluations', {
    method: 'POST',
    body: JSON.stringify(reval),
  });
  return mapRevaluationFromDb(data);
}

export async function updateAssetRevaluation(id: string, updates: Record<string, any>): Promise<AssetRevaluation> {
  const data = await apiRequest<any>(`/revaluations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapRevaluationFromDb(data);
}

export async function deleteAssetRevaluation(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/revaluations/${id}`, { method: 'DELETE' });
}

// ── Verifications ────────────────────────────────────────────────
export async function fetchAssetVerifications(propertyId?: string, status?: string): Promise<AssetVerification[]> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  if (status) params.set('status', status);
  const data = await apiRequest<any[]>(`/verifications/all?${params.toString()}`);
  return data.map(mapVerificationFromDb);
}

export async function createAssetVerification(verification: {
  assetId: string;
  verificationDate?: string;
  location?: string;
  verifiedBy?: string;
  condition?: string;
  notes?: string;
  propertyId?: string | null;
}): Promise<AssetVerification> {
  const data = await apiRequest<any>('/verifications', {
    method: 'POST',
    body: JSON.stringify(verification),
  });
  return mapVerificationFromDb(data);
}

export async function updateAssetVerification(id: string, updates: Record<string, any>): Promise<AssetVerification> {
  const data = await apiRequest<any>(`/verifications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapVerificationFromDb(data);
}

export async function deleteAssetVerification(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/verifications/${id}`, { method: 'DELETE' });
}

// ── Warranties ───────────────────────────────────────────────────
export async function fetchAssetWarranties(propertyId?: string): Promise<AssetWarranty[]> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  const data = await apiRequest<any[]>(`/warranties/all?${params.toString()}`);
  return data.map(mapWarrantyFromDb);
}

export async function createAssetWarranty(warranty: {
  assetId: string;
  provider: string;
  startDate?: string;
  endDate?: string;
  coverage?: string;
  contact?: string;
  notes?: string;
  propertyId?: string | null;
}): Promise<AssetWarranty> {
  const data = await apiRequest<any>('/warranties', {
    method: 'POST',
    body: JSON.stringify(warranty),
  });
  return mapWarrantyFromDb(data);
}

export async function updateAssetWarranty(id: string, updates: Record<string, any>): Promise<AssetWarranty> {
  const data = await apiRequest<any>(`/warranties/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapWarrantyFromDb(data);
}

export async function deleteAssetWarranty(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/warranties/${id}`, { method: 'DELETE' });
}
