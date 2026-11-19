/**
 * Unified Inventory & Stores Portal — frontend service layer.
 *
 * Talks to /api/uinv-portal (see unifiedInventoryPortal.routes.ts).
 * Mirrors the engineeringService.ts pattern: typed API functions + types.
 */
const API_BASE = '/api/uinv-portal';

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

function qs(filters?: Record<string, string | number | undefined>) {
  if (!filters) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ── Types ────────────────────────────────────────────────────────────────

export type StockStatus =
  | 'Available' | 'Reserved' | 'Allocated' | 'Damaged'
  | 'Quarantined' | 'Expired' | 'Blocked' | 'Under Inspection';

export interface UinvItem {
  id: string;
  property_id: string | null;
  item_code: string;
  item_name: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  /** Additional categories for dual/triple category items. */
  secondary_categories: string[] | null;
  item_type: string;
  brand: string | null;
  manufacturer: string | null;
  sku: string | null;
  barcode: string | null;
  secondary_barcode: string | null;
  unit_of_measure: string;
  base_unit: string | null;
  purchase_unit: string | null;
  stock_unit: string | null;
  issue_unit: string | null;
  inventory_controlled: boolean;
  batch_controlled: boolean;
  expiry_controlled: boolean;
  fefo_required: boolean;
  fifo_required: boolean;
  min_stock: number;
  max_stock: number | null;
  reorder_point: number;
  safety_stock: number;
  par_level: number;
  default_store_id: string | null;
  default_location: string | null;
  costing_method: string;
  last_cost: number;
  avg_cost: number;
  standard_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Item types that are consumable (deducted permanently on issue). */
const CONSUMABLE_TYPES = ['Consumable', 'Food', 'Beverage', 'Inventory Item'];

/** Returns true if the item type is consumable (stock is permanently deducted on issue). */
export function isConsumableItem(item: { item_type: string }): boolean {
  return CONSUMABLE_TYPES.includes(item.item_type);
}

/** Returns true if the item is a non-consumable fixed asset (checked out, must be returned). */
export function isFixedAssetItem(item: { item_type: string }): boolean {
  return !CONSUMABLE_TYPES.includes(item.item_type);
}

export interface UinvStore {
  id: string;
  property_id: string | null;
  store_code: string;
  store_name: string;
  store_type: string;
  parent_store_id: string | null;
  manager: string | null;
  location: string | null;
  capacity: number | null;
  temperature_zone: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Department this store belongs to (null = inventory portal store). */
  department?: string | null;
  /** True if this store belongs to a department (read-only from inventory portal). */
  is_department_store?: boolean;
}

export interface UinvLocation {
  id: string;
  store_id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  parent_location_id: string | null;
  temperature_zone: string | null;
  capacity: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UinvStockBalance {
  id: string;
  property_id: string | null;
  item_id: string;
  store_id: string;
  location_id: string | null;
  on_hand: number;
  reserved: number;
  allocated: number;
  on_order: number;
  in_transit: number;
  damaged: number;
  quarantined: number;
  expired: number;
  status: StockStatus;
  unit_cost: number;
  last_movement_date: string | null;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
  location?: UinvLocation | null;
}

export interface UinvBatch {
  id: string;
  item_id: string;
  store_id: string | null;
  batch_number: string;
  lot_number: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_date: string | null;
  supplier: string | null;
  quantity: number;
  unit_cost: number;
  status: StockStatus;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface GRNLine {
  itemId: string;
  itemName: string;
  orderedQty: number;
  deliveredQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unit: string;
  batchNumber?: string;
  lotNumber?: string;
  manufacturingDate?: string;
  expiryDate?: string;
  unitCost: number;
  storageLocation?: string;
  locationId?: string | null;
}

export interface UinvGoodsReceipt {
  id: string;
  property_id: string | null;
  grn_number: string;
  purchase_order: string | null;
  supplier: string | null;
  store_id: string | null;
  receiving_date: string;
  receiver: string | null;
  delivery_note: string | null;
  invoice_reference: string | null;
  vehicle_reference: string | null;
  inspection_status: string;
  lines: GRNLine[];
  total_value: number;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  store?: UinvStore;
}

export interface IssueLine {
  itemId: string;
  itemName: string;
  requestedQty: number;
  approvedQty: number;
  issuedQty: number;
  unit: string;
  batchNumber?: string | null;
  location?: string | null;
  locationId?: string | null;
  substitution?: string;
  notes?: string;
  cost?: number;
}

export interface UinvIssue {
  id: string;
  property_id: string | null;
  issue_number: string;
  department: string;
  requester: string | null;
  store_id: string | null;
  required_date: string | null;
  priority: string;
  cost_center: string | null;
  purpose: string | null;
  lines: IssueLine[];
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  issued_by: string | null;
  issued_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  store?: UinvStore;
  /** 'Requisition' (from department portal) or 'Direct' (from inventory Stock Operations). */
  source?: string;
  /** ID of the requisition this issue fulfills (for direct issues linked to a requisition). */
  requisition_id?: string | null;
}

export interface TransferLine {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

export interface UinvTransfer {
  id: string;
  property_id: string | null;
  transfer_number: string;
  from_store_id: string | null;
  to_store_id: string | null;
  from_property_id: string | null;
  to_property_id: string | null;
  lines: TransferLine[];
  transfer_value: number;
  status: string;
  priority: string;
  approved_by: string | null;
  approved_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  from_store?: UinvStore;
  to_store?: UinvStore;
}

export interface UinvAdjustment {
  id: string;
  property_id: string | null;
  adjustment_number: string;
  item_id: string;
  store_id: string | null;
  location_id: string | null;
  batch_id: string | null;
  adjustment_type: string;
  reason: string;
  quantity_delta: number;
  unit_cost: number;
  value_delta: number;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface UinvReservation {
  id: string;
  property_id: string | null;
  reservation_number: string;
  item_id: string;
  store_id: string | null;
  quantity: number;
  department: string | null;
  reference: string | null;
  required_date: string | null;
  expiry_date: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface CountLine {
  itemId: string;
  itemName: string;
  systemQty: number;
  physicalQty: number;
  variance: number;
  unitCost: number;
  varianceValue: number;
  unit?: string;
}

export interface UinvCount {
  id: string;
  property_id: string | null;
  count_number: string;
  count_type: string;
  store_id: string | null;
  is_blind: boolean;
  lines: CountLine[];
  total_variance: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  store?: UinvStore;
}

export interface UinvWaste {
  id: string;
  property_id: string | null;
  waste_number: string;
  item_id: string;
  store_id: string | null;
  batch_id: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  waste_type: string;
  reason: string | null;
  department: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface UinvLedgerEntry {
  id: string;
  property_id: string | null;
  item_id: string;
  store_id: string | null;
  location_id: string | null;
  batch_id: string | null;
  transaction_type: string;
  reference: string | null;
  quantity_in: number;
  quantity_out: number;
  balance: number;
  unit_cost: number;
  value: number;
  performed_by: string | null;
  reason: string | null;
  transaction_date: string;
  created_at: string;
  theoretical_qty?: number | null;
  actual_qty?: number | null;
  item?: UinvItem;
  store?: UinvStore;
}

export interface UinvReplenishment {
  id: string;
  property_id: string | null;
  item_id: string;
  store_id: string | null;
  current_stock: number;
  reorder_point: number;
  par_level: number;
  suggested_qty: number;
  urgency: string;
  status: string;
  replenishment_number?: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface UinvConfig {
  id: string;
  property_id: string | null;
  section: string;
  config: Record<string, any>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardData {
  totalValue: number;
  totalSkus: number;
  onHand: number;
  available: number;
  reserved: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringCount: number;
  expiredCount: number;
  pendingReceipts: number;
  pendingIssues: number;
  pendingTransfers: number;
  inventoryVariance: number;
  wasteValue: number;
  lowStockItems: any[];
  expiringItems: any[];
  expiredItems: any[];
  // Expanded fields (migration 364–367)
  totalItems: number;
  totalStores: number;
  totalAssets: number;
  missingAssets: number;
  inventoryValue: number;
  assetValue: number;
}

export interface ValuationData {
  grandTotal: number;
  totalItems: number;
  valuation: Array<{
    itemId: string;
    itemName: string;
    category: string;
    unitOfMeasure: string;
    costingMethod: string;
    totalQuantity: number;
    totalValue: number;
    avgUnitCost: number;
    byStore: Array<{ storeId: string; storeName: string; quantity: number; unitCost: number; value: number }>;
  }>;
  byCategory: Record<string, number>;
}

// ── API Functions ─────────────────────────────────────────────────────────

// Dashboard
export const fetchDashboard = (propertyId?: string) =>
  apiRequest<DashboardData>(`${API_BASE}/dashboard${qs({ propertyId })}`);

// Items
export const fetchItems = (filters?: { propertyId?: string; category?: string; search?: string; active?: string; department?: string }) =>
  apiRequest<UinvItem[]>(`${API_BASE}/items${qs(filters)}`);
export const createItem = (data: Partial<UinvItem>) => apiRequest<UinvItem>(`${API_BASE}/items`, { method: 'POST', body: JSON.stringify(data) });
export const updateItem = (id: string, data: Partial<UinvItem>) => apiRequest<UinvItem>(`${API_BASE}/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteItem = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/items/${id}`, { method: 'DELETE' });

// Stores
export const fetchStores = (filters?: { propertyId?: string; active?: string }) =>
  apiRequest<UinvStore[]>(`${API_BASE}/stores${qs(filters)}`);
export const createStore = (data: Partial<UinvStore>) => apiRequest<UinvStore>(`${API_BASE}/stores`, { method: 'POST', body: JSON.stringify(data) });
export const updateStore = (id: string, data: Partial<UinvStore>) => apiRequest<UinvStore>(`${API_BASE}/stores/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteStore = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/stores/${id}`, { method: 'DELETE' });
export const transferStock = (data: { itemId: string; toStoreId: string; quantity: number; reason?: string }) =>
  apiRequest<{ success: boolean; message: string }>(`${API_BASE}/stores/transfer-stock`, { method: 'POST', body: JSON.stringify(data) });

// Locations
export const fetchLocations = (filters?: { storeId?: string; active?: string }) =>
  apiRequest<UinvLocation[]>(`${API_BASE}/locations${qs(filters)}`);
export const createLocation = (data: Partial<UinvLocation>) => apiRequest<UinvLocation>(`${API_BASE}/locations`, { method: 'POST', body: JSON.stringify(data) });
export const updateLocation = (id: string, data: Partial<UinvLocation>) => apiRequest<UinvLocation>(`${API_BASE}/locations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLocation = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/locations/${id}`, { method: 'DELETE' });

// Stock
export const fetchStock = (filters?: { propertyId?: string; storeId?: string; itemId?: string; status?: string; lowStock?: string; department?: string; category?: string }) =>
  apiRequest<UinvStockBalance[]>(`${API_BASE}/stock${qs(filters)}`);
export const updateStock = (id: string, data: Partial<UinvStockBalance>) => apiRequest<UinvStockBalance>(`${API_BASE}/stock/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

// Convenience: fetch stock for a specific department (maps to department stores server-side)
export const fetchStockByDepartment = (department: string, propertyId?: string) =>
  apiRequest<UinvStockBalance[]>(`${API_BASE}/stock${qs({ department, propertyId })}`);

// Convenience: fetch items for a specific department
export const fetchItemsByDepartment = (department: string, propertyId?: string) =>
  apiRequest<UinvItem[]>(`${API_BASE}/items${qs({ department, propertyId })}`);

// Batches
export const fetchBatches = (filters?: { itemId?: string; storeId?: string; expiring?: string }) =>
  apiRequest<UinvBatch[]>(`${API_BASE}/batches${qs(filters)}`);

// Goods Receipts
export const fetchReceipts = (filters?: { propertyId?: string; status?: string; supplier?: string }) =>
  apiRequest<UinvGoodsReceipt[]>(`${API_BASE}/receipts${qs(filters)}`);
export const createReceipt = (data: any) => apiRequest<UinvGoodsReceipt>(`${API_BASE}/receipts`, { method: 'POST', body: JSON.stringify(data) });
export const updateReceipt = (id: string, data: any) => apiRequest<UinvGoodsReceipt>(`${API_BASE}/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReceipt = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/receipts/${id}`, { method: 'DELETE' });

// Issues
export const fetchIssues = (filters?: { propertyId?: string; status?: string; department?: string }) =>
  apiRequest<UinvIssue[]>(`${API_BASE}/issues${qs(filters)}`);
export const createIssue = (data: any) => apiRequest<UinvIssue>(`${API_BASE}/issues`, { method: 'POST', body: JSON.stringify(data) });
export const updateIssue = (id: string, data: any) => apiRequest<UinvIssue>(`${API_BASE}/issues/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteIssue = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/issues/${id}`, { method: 'DELETE' });

// Transfers
export const fetchTransfers = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvTransfer[]>(`${API_BASE}/transfers${qs(filters)}`);
export const createTransfer = (data: any) => apiRequest<UinvTransfer>(`${API_BASE}/transfers`, { method: 'POST', body: JSON.stringify(data) });
export const updateTransfer = (id: string, data: any) => apiRequest<UinvTransfer>(`${API_BASE}/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTransfer = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/transfers/${id}`, { method: 'DELETE' });

// Adjustments
export const fetchAdjustments = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvAdjustment[]>(`${API_BASE}/adjustments${qs(filters)}`);
export const createAdjustment = (data: any) => apiRequest<UinvAdjustment>(`${API_BASE}/adjustments`, { method: 'POST', body: JSON.stringify(data) });
export const createAdjustmentBulk = (data: { store_id: string; reason?: string; adjustment_type?: string; notes?: string; property_id?: string | null; lines: { item_id: string; quantity_delta: number; unit_cost?: number; adjustment_type?: string; reason?: string }[] }) =>
  apiRequest<UinvAdjustment[]>(`${API_BASE}/adjustments/bulk`, { method: 'POST', body: JSON.stringify(data) });
export const updateAdjustment = (id: string, data: any) => apiRequest<UinvAdjustment>(`${API_BASE}/adjustments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAdjustment = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/adjustments/${id}`, { method: 'DELETE' });

// Reservations
export const fetchReservations = (filters?: { propertyId?: string; status?: string; itemId?: string }) =>
  apiRequest<UinvReservation[]>(`${API_BASE}/reservations${qs(filters)}`);
export const createReservation = (data: any) => apiRequest<UinvReservation>(`${API_BASE}/reservations`, { method: 'POST', body: JSON.stringify(data) });
export const updateReservation = (id: string, data: any) => apiRequest<UinvReservation>(`${API_BASE}/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReservation = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/reservations/${id}`, { method: 'DELETE' });

// Counts
export const fetchCounts = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvCount[]>(`${API_BASE}/counts${qs(filters)}`);
export const createCount = (data: any) => apiRequest<UinvCount>(`${API_BASE}/counts`, { method: 'POST', body: JSON.stringify(data) });
export const updateCount = (id: string, data: any) => apiRequest<UinvCount>(`${API_BASE}/counts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCount = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/counts/${id}`, { method: 'DELETE' });

// Waste
export const fetchWaste = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvWaste[]>(`${API_BASE}/waste${qs(filters)}`);
export const createWaste = (data: any) => apiRequest<UinvWaste>(`${API_BASE}/waste`, { method: 'POST', body: JSON.stringify(data) });
export const createWasteBulk = (data: { store_id: string; waste_type?: string; reason?: string; notes?: string; property_id?: string | null; lines: { item_id: string; quantity: number; unit_cost?: number; waste_type?: string; reason?: string }[] }) =>
  apiRequest<UinvWaste[]>(`${API_BASE}/waste/bulk`, { method: 'POST', body: JSON.stringify(data) });
export const updateWaste = (id: string, data: any) => apiRequest<UinvWaste>(`${API_BASE}/waste/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteWaste = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/waste/${id}`, { method: 'DELETE' });

// Stock Ledger
export const fetchLedger = (filters?: { propertyId?: string; itemId?: string; storeId?: string; transactionType?: string; startDate?: string; endDate?: string }) =>
  apiRequest<UinvLedgerEntry[]>(`${API_BASE}/stock-ledger${qs(filters)}`);

// Valuation
export const fetchValuation = (filters?: { propertyId?: string; storeId?: string; method?: string; startDate?: string; endDate?: string }) =>
  apiRequest<ValuationData>(`${API_BASE}/valuation${qs(filters)}`);

// Replenishment
export const fetchReplenishment = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvReplenishment[]>(`${API_BASE}/replenishment${qs(filters)}`);
export const recalculateReplenishment = (propertyId?: string) =>
  apiRequest<{ generated: number; requirements: UinvReplenishment[] }>(`${API_BASE}/replenishment/recalculate`, { method: 'POST', body: JSON.stringify({ propertyId }) });
export const updateReplenishment = (id: string, data: any) => apiRequest<UinvReplenishment>(`${API_BASE}/replenishment/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReplenishment = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/replenishment/${id}`, { method: 'DELETE' });

// Config
export const fetchConfig = (filters?: { propertyId?: string; section?: string }) =>
  apiRequest<UinvConfig[]>(`${API_BASE}/config${qs(filters)}`);
export const saveConfig = (data: { propertyId?: string; section: string; config: Record<string, any> }) =>
  apiRequest<UinvConfig>(`${API_BASE}/config`, { method: 'PUT', body: JSON.stringify(data) });

// Cross-department inventory view
export interface DepartmentStockItem {
  itemId: string;
  itemName: string;
  unit: string;
  totalIssued: number;
  unitCost: number;
  balances: any[];
  totalOnHand: number;
  totalReserved: number;
}
export interface DepartmentStockResponse {
  department: string;
  issues: UinvIssue[];
  items: DepartmentStockItem[];
  summary: {
    totalItemsTracked: number;
    totalIssuedLast30: number;
    totalOnHand: number;
    pendingIssues: number;
  };
}
export const fetchDepartmentStock = (department: string, propertyId?: string) =>
  apiRequest<DepartmentStockResponse>(`${API_BASE}/department-stock/${encodeURIComponent(department)}${qs({ propertyId })}`);

// Reports
export interface ReportData {
  reportId: string;
  rows: Record<string, any>[];
  summary?: Record<string, any>;
}
export const fetchReport = (reportId: string, filters?: { propertyId?: string; startDate?: string; endDate?: string }) =>
  apiRequest<ReportData>(`${API_BASE}/reports/${reportId}${qs(filters)}`);

// Replenishment — create
export const createReplenishment = (data: any) =>
  apiRequest<UinvReplenishment>(`${API_BASE}/replenishment`, { method: 'POST', body: JSON.stringify(data) });

// Replenishment — generate requests from low stock scan (request-driven model)
export const generateReplenishmentRequests = (propertyId?: string) =>
  apiRequest<{ generated: number; requests: UinvReplenishment[] }>(`${API_BASE}/replenishment/generate-requests`, {
    method: 'POST',
    body: JSON.stringify({ propertyId }),
  });

// Replenishment — fulfill a request from Central Warehouse
export const fulfillReplenishment = (id: string, quantity?: number) =>
  apiRequest<{ success: boolean; transferNumber: string; transferId: string; quantity: number; request: UinvReplenishment; procurementTriggered: boolean; procurementMessage: string }>(`${API_BASE}/replenishment/${id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });

// ════════════════════════════════════════════════════════════════
// STOREKEEPING — PUT-AWAY, PICKING, RETURNS, QUARANTINE, SERIALS, LOTS
// ════════════════════════════════════════════════════════════════
export interface UinvPutAwayTask {
  id: string; property_id: string | null; putaway_number: string;
  grn_id: string | null; item_id: string; store_id: string | null;
  from_location_id: string | null; to_location_id: string | null; batch_id: string | null;
  quantity: number; unit: string; recommended_location: string | null;
  status: 'Pending' | 'In Progress' | 'Put Away' | 'Cancelled';
  putaway_by: string | null; putaway_at: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  item?: UinvItem; store?: UinvStore; to_location?: UinvLocation; grn?: UinvGoodsReceipt;
}
export const fetchPutAwayTasks = (filters?: { propertyId?: string; status?: string; grnId?: string }) =>
  apiRequest<UinvPutAwayTask[]>(`${API_BASE}/putaway-tasks${qs(filters)}`);
export const createPutAwayTask = (data: Partial<UinvPutAwayTask>) =>
  apiRequest<UinvPutAwayTask>(`${API_BASE}/putaway-tasks`, { method: 'POST', body: JSON.stringify(data) });
export const updatePutAwayTask = (id: string, data: Partial<UinvPutAwayTask>) =>
  apiRequest<UinvPutAwayTask>(`${API_BASE}/putaway-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deletePutAwayTask = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/putaway-tasks/${id}`, { method: 'DELETE' });

export interface UinvPickingTask {
  id: string; property_id: string | null; picking_number: string;
  source_type: 'Issue' | 'Transfer' | 'Reservation' | 'Production'; source_id: string | null;
  item_id: string; store_id: string | null; location_id: string | null; batch_id: string | null;
  serial_id: string | null; quantity: number; unit: string;
  pick_strategy: 'FIFO' | 'FEFO' | 'LIFO' | 'Manual';
  status: 'Pending' | 'Picked' | 'Short' | 'Cancelled';
  picked_by: string | null; picked_at: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  item?: UinvItem; store?: UinvStore; location?: UinvLocation;
}
export const fetchPickingTasks = (filters?: { propertyId?: string; status?: string; sourceId?: string }) =>
  apiRequest<UinvPickingTask[]>(`${API_BASE}/picking-tasks${qs(filters)}`);
export const createPickingTask = (data: Partial<UinvPickingTask>) =>
  apiRequest<UinvPickingTask>(`${API_BASE}/picking-tasks`, { method: 'POST', body: JSON.stringify(data) });
export const updatePickingTask = (id: string, data: Partial<UinvPickingTask>) =>
  apiRequest<UinvPickingTask>(`${API_BASE}/picking-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deletePickingTask = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/picking-tasks/${id}`, { method: 'DELETE' });

export interface UinvReturnLine {
  itemId: string; itemName: string; quantity: number; unit: string;
  condition: 'Good' | 'Damaged' | 'Expired'; reason: string;
  unitCost: number; value: number;
}
export interface UinvReturn {
  id: string; property_id: string | null; return_number: string;
  issue_id: string | null; department: string | null; store_id: string | null;
  return_date: string; received_by: string | null;
  lines: UinvReturnLine[]; total_value: number;
  status: 'Pending' | 'Received' | 'Inspected' | 'Restocked' | 'Quarantined' | 'Rejected';
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
  store?: UinvStore; issue?: UinvIssue;
}
export const fetchReturns = (filters?: { propertyId?: string; status?: string; issueId?: string }) =>
  apiRequest<UinvReturn[]>(`${API_BASE}/returns${qs(filters)}`);
export const createReturn = (data: Partial<UinvReturn>) =>
  apiRequest<UinvReturn>(`${API_BASE}/returns`, { method: 'POST', body: JSON.stringify(data) });
export const updateReturn = (id: string, data: Partial<UinvReturn>) =>
  apiRequest<UinvReturn>(`${API_BASE}/returns/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReturn = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/returns/${id}`, { method: 'DELETE' });

export interface UinvQuarantine {
  id: string; property_id: string | null; quarantine_number: string;
  item_id: string; store_id: string | null; batch_id: string | null;
  quantity: number; unit: string; reason: string;
  source: 'Receiving' | 'Return' | 'Damage' | 'Inspection' | 'Expiry' | 'Other'; source_ref: string | null;
  quarantined_by: string | null; quarantined_at: string;
  status: 'Held' | 'Released' | 'Rejected' | 'Disposed' | 'Returned to Supplier';
  release_destination: string | null; released_by: string | null; released_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
  item?: UinvItem; store?: UinvStore;
}
export const fetchQuarantine = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvQuarantine[]>(`${API_BASE}/quarantine${qs(filters)}`);
export const createQuarantine = (data: Partial<UinvQuarantine>) =>
  apiRequest<UinvQuarantine>(`${API_BASE}/quarantine`, { method: 'POST', body: JSON.stringify(data) });
export const updateQuarantine = (id: string, data: Partial<UinvQuarantine>) =>
  apiRequest<UinvQuarantine>(`${API_BASE}/quarantine/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteQuarantine = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/quarantine/${id}`, { method: 'DELETE' });

export interface UinvSerial {
  id: string; property_id: string | null; item_id: string;
  store_id: string | null; location_id: string | null; serial_number: string;
  batch_id: string | null; grn_id: string | null;
  status: 'In Stock' | 'Issued' | 'In Transit' | 'Quarantined' | 'Damaged' | 'Lost' | 'Retired';
  custodian: string | null;
  condition: 'New' | 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Damaged' | 'Unusable';
  acquired_at: string | null; notes: string | null; created_at: string; updated_at: string;
  item?: UinvItem; store?: UinvStore;
}
export const fetchSerials = (filters?: { propertyId?: string; itemId?: string; status?: string }) =>
  apiRequest<UinvSerial[]>(`${API_BASE}/serials${qs(filters)}`);
export const createSerial = (data: Partial<UinvSerial>) =>
  apiRequest<UinvSerial>(`${API_BASE}/serials`, { method: 'POST', body: JSON.stringify(data) });
export const updateSerial = (id: string, data: Partial<UinvSerial>) =>
  apiRequest<UinvSerial>(`${API_BASE}/serials/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSerial = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/serials/${id}`, { method: 'DELETE' });

export interface UinvLot {
  id: string; property_id: string | null; item_id: string; store_id: string | null;
  lot_number: string; manufacturing_date: string | null; expiry_date: string | null;
  received_date: string | null; supplier: string | null;
  quantity: number; unit_cost: number; status: StockStatus;
  notes: string | null; created_at: string; updated_at: string;
  item?: UinvItem; store?: UinvStore;
}
export const fetchLots = (filters?: { propertyId?: string; itemId?: string }) =>
  apiRequest<UinvLot[]>(`${API_BASE}/lots${qs(filters)}`);
export const createLot = (data: Partial<UinvLot>) =>
  apiRequest<UinvLot>(`${API_BASE}/lots`, { method: 'POST', body: JSON.stringify(data) });
export const updateLot = (id: string, data: Partial<UinvLot>) =>
  apiRequest<UinvLot>(`${API_BASE}/lots/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLot = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/lots/${id}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════
// STOREKEEPING — TEMPERATURE LOGS, CHEMICALS, EXPIRY ALERTS
// ════════════════════════════════════════════════════════════════
export interface UinvTemperatureLog {
  id: string; property_id: string | null; store_id: string; location_id: string | null;
  required_min: number | null; required_max: number | null; actual_temp: number; unit: string;
  reading_time: string; recorded_by: string | null;
  status: 'OK' | 'Exception' | 'Critical'; corrective_action: string | null;
  notes: string | null; created_at: string; store?: UinvStore;
}
export const fetchTemperatureLogs = (filters?: { storeId?: string; status?: string }) =>
  apiRequest<UinvTemperatureLog[]>(`${API_BASE}/temperature-logs${qs(filters)}`);
export const createTemperatureLog = (data: Partial<UinvTemperatureLog>) =>
  apiRequest<UinvTemperatureLog>(`${API_BASE}/temperature-logs`, { method: 'POST', body: JSON.stringify(data) });
export const deleteTemperatureLog = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/temperature-logs/${id}`, { method: 'DELETE' });

export interface UinvChemical {
  id: string; property_id: string | null; item_id: string;
  classification: string; storage_requirement: string | null; sds_reference: string | null;
  authorized_handlers: string[] | null;
  hazard_level: 'Low' | 'Medium' | 'High' | 'Very High';
  notes: string | null; created_at: string; updated_at: string; item?: UinvItem;
}
export const fetchChemicals = (filters?: { propertyId?: string; itemId?: string }) =>
  apiRequest<UinvChemical[]>(`${API_BASE}/chemicals${qs(filters)}`);
export const createChemical = (data: Partial<UinvChemical>) =>
  apiRequest<UinvChemical>(`${API_BASE}/chemicals`, { method: 'POST', body: JSON.stringify(data) });
export const updateChemical = (id: string, data: Partial<UinvChemical>) =>
  apiRequest<UinvChemical>(`${API_BASE}/chemicals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteChemical = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/chemicals/${id}`, { method: 'DELETE' });

export interface UinvExpiryAlert {
  batch_id: string; source: 'batch' | 'lot'; item_id: string; item_name: string;
  property_id: string | null; store_id: string | null; batch_number: string;
  expiry_date: string; quantity: number; unit_cost: number; status: StockStatus;
  alert_bucket: 'Expired' | '7 Days' | '14 Days' | '30 Days' | '60 Days' | '90 Days' | 'OK';
}
export const fetchExpiryAlerts = (filters?: { propertyId?: string; bucket?: string }) =>
  apiRequest<UinvExpiryAlert[]>(`${API_BASE}/expiry-alerts${qs(filters)}`);

// ════════════════════════════════════════════════════════════════
// FIXED ASSETS — CLASSES, REGISTER, COMPONENTS, ASSIGNMENTS, TRANSFERS,
// VERIFICATIONS, WARRANTIES, INSURANCE, DISPOSALS, DOCUMENTS
// ════════════════════════════════════════════════════════════════
export interface UinvAssetClass {
  id: string; property_id: string | null; class_code: string; class_name: string;
  description: string | null; capitalization_threshold: number; default_useful_life_years: number | null;
  is_active: boolean; created_at: string; updated_at: string;
}
export const fetchAssetClasses = (filters?: { propertyId?: string }) =>
  apiRequest<UinvAssetClass[]>(`${API_BASE}/asset-classes${qs(filters)}`);
export const createAssetClass = (data: Partial<UinvAssetClass>) =>
  apiRequest<UinvAssetClass>(`${API_BASE}/asset-classes`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetClass = (id: string, data: Partial<UinvAssetClass>) =>
  apiRequest<UinvAssetClass>(`${API_BASE}/asset-classes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetClass = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-classes/${id}`, { method: 'DELETE' });

export type AssetStatus =
  | 'Ordered' | 'Received' | 'Inspection' | 'Tagged' | 'Available' | 'Assigned' | 'In Service'
  | 'In Transit' | 'Under Maintenance' | 'Damaged' | 'Lost' | 'Stolen' | 'Impaired'
  | 'Held for Disposal' | 'Disposed' | 'Retired';
export type AssetCondition = 'New' | 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Damaged' | 'Unusable';

export interface UinvAsset {
  id: string; property_id: string | null; asset_number: string;
  asset_tag: string | null; barcode: string | null; qr_code: string | null; serial_number: string | null;
  asset_name: string; description: string | null;
  class_id: string | null; class: string | null; category: string | null;
  manufacturer: string | null; model: string | null; supplier: string | null;
  purchase_order: string | null; grn: string | null;
  purchase_date: string | null; in_service_date: string | null;
  acquisition_cost: number; currency: string;
  building: string | null; department: string | null; location: string | null; location_detail: string | null;
  custodian: string | null; condition: AssetCondition; status: AssetStatus;
  warranty_id: string | null; insurance_id: string | null; finance_asset_id: string | null;
  parent_asset_id: string | null; is_active: boolean;
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
  class_ref?: UinvAssetClass; parent?: UinvAsset;
  assignments?: UinvAssetAssignment[]; transfers?: UinvAssetTransfer[];
  warranties?: UinvAssetWarranty[]; insurance?: UinvAssetInsurance[];
  disposals?: UinvAssetDisposal[]; documents?: UinvAssetDocument[];
}
export const fetchAssets = (filters?: { propertyId?: string; status?: string; classId?: string; custodian?: string; department?: string }) =>
  apiRequest<UinvAsset[]>(`${API_BASE}/assets${qs(filters)}`);
export const fetchAsset = (id: string) =>
  apiRequest<UinvAsset>(`${API_BASE}/assets/${id}`);
export const createAsset = (data: Partial<UinvAsset>) =>
  apiRequest<UinvAsset>(`${API_BASE}/assets`, { method: 'POST', body: JSON.stringify(data) });
export const updateAsset = (id: string, data: Partial<UinvAsset>) =>
  apiRequest<UinvAsset>(`${API_BASE}/assets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAsset = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/assets/${id}`, { method: 'DELETE' });

export interface UinvAssetComponent {
  id: string; parent_asset_id: string; child_asset_id: string;
  component_name: string | null; relationship: string; created_at: string;
  parent?: UinvAsset; child?: UinvAsset;
}
export const fetchAssetComponents = (filters?: { parentAssetId?: string }) =>
  apiRequest<UinvAssetComponent[]>(`${API_BASE}/asset-components${qs(filters)}`);
export const createAssetComponent = (data: Partial<UinvAssetComponent>) =>
  apiRequest<UinvAssetComponent>(`${API_BASE}/asset-components`, { method: 'POST', body: JSON.stringify(data) });
export const deleteAssetComponent = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-components/${id}`, { method: 'DELETE' });

export interface UinvAssetAssignment {
  id: string; property_id: string | null; asset_id: string;
  employee: string; department: string | null; location: string | null;
  issue_date: string; expected_return_date: string | null; return_date: string | null;
  condition_at_issue: AssetCondition; condition_at_return: AssetCondition | null;
  accessories: string | null; acknowledgement: string | null;
  status: 'Active' | 'Returned' | 'Overdue' | 'Lost';
  approved_by: string | null; notes: string | null; created_by: string | null;
  created_at: string; updated_at: string; asset?: UinvAsset;
}
export const fetchAssetAssignments = (filters?: { propertyId?: string; assetId?: string; status?: string; employee?: string }) =>
  apiRequest<UinvAssetAssignment[]>(`${API_BASE}/asset-assignments${qs(filters)}`);
export const createAssetAssignment = (data: Partial<UinvAssetAssignment>) =>
  apiRequest<UinvAssetAssignment>(`${API_BASE}/asset-assignments`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetAssignment = (id: string, data: Partial<UinvAssetAssignment>) =>
  apiRequest<UinvAssetAssignment>(`${API_BASE}/asset-assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetAssignment = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-assignments/${id}`, { method: 'DELETE' });

export interface UinvAssetTransfer {
  id: string; property_id: string | null; transfer_number: string; asset_id: string;
  transfer_type: 'Employee' | 'Department' | 'Location' | 'Property' | 'Temporary' | 'Inter-Company';
  from_property_id: string | null; to_property_id: string | null;
  from_location: string | null; to_location: string | null;
  from_custodian: string | null; to_custodian: string | null;
  from_department: string | null; to_department: string | null;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Dispatched' | 'In Transit' | 'Received' | 'Rejected' | 'Cancelled';
  approved_by: string | null; approved_at: string | null;
  dispatched_at: string | null; received_at: string | null;
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
  asset?: UinvAsset;
}
export const fetchAssetTransfers = (filters?: { propertyId?: string; assetId?: string; status?: string }) =>
  apiRequest<UinvAssetTransfer[]>(`${API_BASE}/asset-transfers${qs(filters)}`);
export const createAssetTransfer = (data: Partial<UinvAssetTransfer>) =>
  apiRequest<UinvAssetTransfer>(`${API_BASE}/asset-transfers`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetTransfer = (id: string, data: Partial<UinvAssetTransfer>) =>
  apiRequest<UinvAssetTransfer>(`${API_BASE}/asset-transfers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetTransfer = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-transfers/${id}`, { method: 'DELETE' });

export interface UinvVerificationCampaign {
  id: string; property_id: string | null; campaign_number: string; campaign_name: string;
  scope: 'Full' | 'By Class' | 'By Department' | 'By Location' | 'By Custodian' | 'Sample';
  scope_filter: Record<string, any>; start_date: string; end_date: string | null;
  status: 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
  assigned_verifiers: string[] | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
export const fetchVerificationCampaigns = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvVerificationCampaign[]>(`${API_BASE}/asset-verification-campaigns${qs(filters)}`);
export const createVerificationCampaign = (data: Partial<UinvVerificationCampaign>) =>
  apiRequest<UinvVerificationCampaign>(`${API_BASE}/asset-verification-campaigns`, { method: 'POST', body: JSON.stringify(data) });
export const updateVerificationCampaign = (id: string, data: Partial<UinvVerificationCampaign>) =>
  apiRequest<UinvVerificationCampaign>(`${API_BASE}/asset-verification-campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteVerificationCampaign = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-verification-campaigns/${id}`, { method: 'DELETE' });

export interface UinvAssetVerification {
  id: string; property_id: string | null; campaign_id: string | null; asset_id: string;
  expected_location: string | null; confirmed_location: string | null;
  expected_custodian: string | null; confirmed_custodian: string | null;
  confirmed_condition: AssetCondition | null;
  result: 'Found' | 'Wrong Location' | 'Wrong Custodian' | 'Damaged' | 'Missing' | 'Duplicate' | 'Unidentified';
  scanned_at: string | null; scanned_by: string | null;
  exception_notes: string | null; resolution: string | null;
  resolved_by: string | null; resolved_at: string | null;
  status: 'Open' | 'Investigating' | 'Resolved';
  created_at: string; updated_at: string;
  asset?: UinvAsset; campaign?: UinvVerificationCampaign;
}
export const fetchAssetVerifications = (filters?: { campaignId?: string; result?: string; status?: string }) =>
  apiRequest<UinvAssetVerification[]>(`${API_BASE}/asset-verifications${qs(filters)}`);
export const updateAssetVerification = (id: string, data: Partial<UinvAssetVerification>) =>
  apiRequest<UinvAssetVerification>(`${API_BASE}/asset-verifications/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export interface UinvAssetWarranty {
  id: string; property_id: string | null; asset_id: string;
  warranty_number: string | null; provider: string | null;
  start_date: string; end_date: string | null; coverage: string | null;
  supplier: string | null; service_contact: string | null;
  notes: string | null; created_at: string; updated_at: string; asset?: UinvAsset;
}
export const fetchAssetWarranties = (filters?: { propertyId?: string; assetId?: string }) =>
  apiRequest<UinvAssetWarranty[]>(`${API_BASE}/asset-warranties${qs(filters)}`);
export const createAssetWarranty = (data: Partial<UinvAssetWarranty>) =>
  apiRequest<UinvAssetWarranty>(`${API_BASE}/asset-warranties`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetWarranty = (id: string, data: Partial<UinvAssetWarranty>) =>
  apiRequest<UinvAssetWarranty>(`${API_BASE}/asset-warranties/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetWarranty = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-warranties/${id}`, { method: 'DELETE' });

export interface UinvAssetInsurance {
  id: string; property_id: string | null; asset_id: string;
  policy_number: string | null; insurer: string | null; coverage: string | null;
  insured_value: number; start_date: string; expiry_date: string | null;
  notes: string | null; created_at: string; updated_at: string; asset?: UinvAsset;
}
export const fetchAssetInsurance = (filters?: { propertyId?: string; assetId?: string }) =>
  apiRequest<UinvAssetInsurance[]>(`${API_BASE}/asset-insurance${qs(filters)}`);
export const createAssetInsurance = (data: Partial<UinvAssetInsurance>) =>
  apiRequest<UinvAssetInsurance>(`${API_BASE}/asset-insurance`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetInsurance = (id: string, data: Partial<UinvAssetInsurance>) =>
  apiRequest<UinvAssetInsurance>(`${API_BASE}/asset-insurance/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetInsurance = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-insurance/${id}`, { method: 'DELETE' });

export interface UinvAssetDisposal {
  id: string; property_id: string | null; disposal_number: string; asset_id: string;
  disposal_method: 'Sale' | 'Auction' | 'Scrap' | 'Donation' | 'Return to Supplier' | 'Recycling' | 'Destruction' | 'Trade-in';
  disposal_date: string | null; condition_assessment: string | null;
  disposal_value: number; finance_reference: string | null; evidence_ref: string | null;
  status: 'Requested' | 'Condition Assessed' | 'Approved' | 'Finance Reviewed' | 'Disposed' | 'Rejected';
  approved_by: string | null; approved_at: string | null;
  finance_reviewed_by: string | null; finance_reviewed_at: string | null;
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
  asset?: UinvAsset;
}
export const fetchAssetDisposals = (filters?: { propertyId?: string; assetId?: string; status?: string }) =>
  apiRequest<UinvAssetDisposal[]>(`${API_BASE}/asset-disposals${qs(filters)}`);
export const createAssetDisposal = (data: Partial<UinvAssetDisposal>) =>
  apiRequest<UinvAssetDisposal>(`${API_BASE}/asset-disposals`, { method: 'POST', body: JSON.stringify(data) });
export const updateAssetDisposal = (id: string, data: Partial<UinvAssetDisposal>) =>
  apiRequest<UinvAssetDisposal>(`${API_BASE}/asset-disposals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAssetDisposal = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-disposals/${id}`, { method: 'DELETE' });

export interface UinvAssetDocument {
  id: string; asset_id: string;
  document_type: 'Purchase Document' | 'Delivery Note' | 'Inspection Record' | 'Damage Photo' | 'Asset Photo' | 'Warranty Document' | 'Insurance Document' | 'Count Sheet' | 'Transfer Document' | 'Custody Acknowledgement' | 'Disposal Evidence' | 'Calibration Certificate' | 'Other';
  file_name: string | null; file_url: string | null;
  uploaded_by: string | null; notes: string | null; created_at: string;
}
export const fetchAssetDocuments = (filters?: { assetId?: string }) =>
  apiRequest<UinvAssetDocument[]>(`${API_BASE}/asset-documents${qs(filters)}`);
export const createAssetDocument = (data: Partial<UinvAssetDocument>) =>
  apiRequest<UinvAssetDocument>(`${API_BASE}/asset-documents`, { method: 'POST', body: JSON.stringify(data) });
export const deleteAssetDocument = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/asset-documents/${id}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════
// TOOLS & EQUIPMENT
// ════════════════════════════════════════════════════════════════
export interface UinvTool {
  id: string; property_id: string | null; tool_code: string; tool_name: string;
  type: string; serial_number: string | null; location: string | null; custodian: string | null;
  condition: AssetCondition; calibration_required: boolean;
  last_calibration_date: string | null; next_calibration_date: string | null;
  status: 'In Stock' | 'Issued' | 'In Calibration' | 'Out of Service' | 'Lost' | 'Retired';
  criticality: 'Critical' | 'High' | 'Medium' | 'Normal';
  compatible_equipment: string[] | null;
  notes: string | null; created_at: string; updated_at: string;
}
export const fetchTools = (filters?: { propertyId?: string; status?: string; custodian?: string }) =>
  apiRequest<UinvTool[]>(`${API_BASE}/tools${qs(filters)}`);
export const createTool = (data: Partial<UinvTool>) =>
  apiRequest<UinvTool>(`${API_BASE}/tools`, { method: 'POST', body: JSON.stringify(data) });
export const updateTool = (id: string, data: Partial<UinvTool>) =>
  apiRequest<UinvTool>(`${API_BASE}/tools/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTool = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tools/${id}`, { method: 'DELETE' });

export interface UinvToolAssignment {
  id: string; property_id: string | null; tool_id: string;
  employee: string; department: string | null;
  issue_date: string; expected_return_date: string | null; return_date: string | null;
  condition_at_issue: AssetCondition; condition_at_return: AssetCondition | null;
  status: 'Active' | 'Returned' | 'Overdue' | 'Lost';
  approved_by: string | null; notes: string | null; created_by: string | null;
  created_at: string; updated_at: string; tool?: UinvTool;
}
export const fetchToolAssignments = (filters?: { propertyId?: string; toolId?: string; status?: string; employee?: string }) =>
  apiRequest<UinvToolAssignment[]>(`${API_BASE}/tool-assignments${qs(filters)}`);
export const createToolAssignment = (data: Partial<UinvToolAssignment>) =>
  apiRequest<UinvToolAssignment>(`${API_BASE}/tool-assignments`, { method: 'POST', body: JSON.stringify(data) });
export const updateToolAssignment = (id: string, data: Partial<UinvToolAssignment>) =>
  apiRequest<UinvToolAssignment>(`${API_BASE}/tool-assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteToolAssignment = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tool-assignments/${id}`, { method: 'DELETE' });

export interface UinvToolCalibration {
  id: string; property_id: string | null; tool_id: string;
  calibration_date: string; next_calibration_date: string | null;
  performed_by: string | null; result: 'Pass' | 'Fail' | 'Adjusted';
  certificate_ref: string | null; notes: string | null; created_at: string; tool?: UinvTool;
}
export const fetchToolCalibrations = (filters?: { toolId?: string }) =>
  apiRequest<UinvToolCalibration[]>(`${API_BASE}/tool-calibrations${qs(filters)}`);
export const createToolCalibration = (data: Partial<UinvToolCalibration>) =>
  apiRequest<UinvToolCalibration>(`${API_BASE}/tool-calibrations`, { method: 'POST', body: JSON.stringify(data) });
export const deleteToolCalibration = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/tool-calibrations/${id}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════
// LINEN, UNIFORMS, RETURNABLES, LOANABLES
// ════════════════════════════════════════════════════════════════
export interface UinvLinenItem {
  id: string; property_id: string | null; item_code: string; item_name: string;
  category: 'Bed Sheets' | 'Pillowcases' | 'Duvets' | 'Towels' | 'Bath Mats' | 'Table Linen' | 'Pool Towels' | 'Spa Linen' | 'Kitchen Linen' | 'Other';
  size: string | null;
  store_quantity: number; department_quantity: number; laundry_quantity: number;
  clean_quantity: number; dirty_quantity: number; damaged_quantity: number;
  lost_quantity: number; retired_quantity: number;
  par_level: number; unit_cost: number; is_active: boolean;
  notes: string | null; created_at: string; updated_at: string;
}
export const fetchLinen = (filters?: { propertyId?: string; category?: string }) =>
  apiRequest<UinvLinenItem[]>(`${API_BASE}/linen${qs(filters)}`);
export const createLinen = (data: Partial<UinvLinenItem>) =>
  apiRequest<UinvLinenItem>(`${API_BASE}/linen`, { method: 'POST', body: JSON.stringify(data) });
export const updateLinen = (id: string, data: Partial<UinvLinenItem>) =>
  apiRequest<UinvLinenItem>(`${API_BASE}/linen/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLinen = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/linen/${id}`, { method: 'DELETE' });

export interface UinvLinenMovement {
  id: string; property_id: string | null; linen_id: string;
  movement_type: 'Issue' | 'Laundry Out' | 'Laundry Return' | 'Damage' | 'Loss' | 'Retirement' | 'Transfer' | 'Adjustment';
  quantity: number; department: string | null; reference: string | null;
  performed_by: string | null; notes: string | null;
  movement_date: string; created_at: string; linen?: UinvLinenItem;
}
export const fetchLinenMovements = (filters?: { linenId?: string }) =>
  apiRequest<UinvLinenMovement[]>(`${API_BASE}/linen-movements${qs(filters)}`);
export const createLinenMovement = (data: Partial<UinvLinenMovement>) =>
  apiRequest<UinvLinenMovement>(`${API_BASE}/linen-movements`, { method: 'POST', body: JSON.stringify(data) });

export interface UinvUniformItem {
  id: string; property_id: string | null; item_code: string; item_name: string;
  department: string | null; role: string | null; size: string | null;
  stock_quantity: number; issued_quantity: number; par_level: number; unit_cost: number;
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
}
export const fetchUniforms = (filters?: { propertyId?: string; department?: string }) =>
  apiRequest<UinvUniformItem[]>(`${API_BASE}/uniforms${qs(filters)}`);
export const createUniform = (data: Partial<UinvUniformItem>) =>
  apiRequest<UinvUniformItem>(`${API_BASE}/uniforms`, { method: 'POST', body: JSON.stringify(data) });
export const updateUniform = (id: string, data: Partial<UinvUniformItem>) =>
  apiRequest<UinvUniformItem>(`${API_BASE}/uniforms/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteUniform = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/uniforms/${id}`, { method: 'DELETE' });

export interface UinvUniformAssignment {
  id: string; property_id: string | null; uniform_id: string;
  employee: string; department: string | null; role: string | null; size: string | null;
  quantity: number; issue_date: string; return_date: string | null;
  condition: 'New' | 'Good' | 'Fair' | 'Poor' | 'Damaged' | 'Retired';
  status: 'Issued' | 'Returned' | 'Replaced' | 'Retired';
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
  uniform?: UinvUniformItem;
}
export const fetchUniformAssignments = (filters?: { propertyId?: string; employee?: string; status?: string }) =>
  apiRequest<UinvUniformAssignment[]>(`${API_BASE}/uniform-assignments${qs(filters)}`);
export const createUniformAssignment = (data: Partial<UinvUniformAssignment>) =>
  apiRequest<UinvUniformAssignment>(`${API_BASE}/uniform-assignments`, { method: 'POST', body: JSON.stringify(data) });
export const updateUniformAssignment = (id: string, data: Partial<UinvUniformAssignment>) =>
  apiRequest<UinvUniformAssignment>(`${API_BASE}/uniform-assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteUniformAssignment = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/uniform-assignments/${id}`, { method: 'DELETE' });

export interface UinvReturnableItem {
  id: string; property_id: string | null; item_code: string; item_name: string;
  owner: 'Supplier' | 'Hotel' | 'Guest/Third Party'; owner_ref: string | null;
  type: 'Container' | 'Crate' | 'Pallet' | 'Keg' | 'Other';
  quantity_on_hand: number; quantity_out: number; unit_cost: number;
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
}
export const fetchReturnables = (filters?: { propertyId?: string; owner?: string }) =>
  apiRequest<UinvReturnableItem[]>(`${API_BASE}/returnables${qs(filters)}`);
export const createReturnable = (data: Partial<UinvReturnableItem>) =>
  apiRequest<UinvReturnableItem>(`${API_BASE}/returnables`, { method: 'POST', body: JSON.stringify(data) });
export const updateReturnable = (id: string, data: Partial<UinvReturnableItem>) =>
  apiRequest<UinvReturnableItem>(`${API_BASE}/returnables/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReturnable = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/returnables/${id}`, { method: 'DELETE' });

export interface UinvReturnableMovement {
  id: string; property_id: string | null; returnable_id: string;
  movement_type: 'Receive' | 'Issue to Supplier' | 'Return from Supplier' | 'Receive from Dept' | 'Adjustment' | 'Scrap';
  quantity: number; reference: string | null; performed_by: string | null;
  notes: string | null; movement_date: string; created_at: string;
  returnable?: UinvReturnableItem;
}
export const fetchReturnableMovements = (filters?: { returnableId?: string }) =>
  apiRequest<UinvReturnableMovement[]>(`${API_BASE}/returnable-movements${qs(filters)}`);
export const createReturnableMovement = (data: Partial<UinvReturnableMovement>) =>
  apiRequest<UinvReturnableMovement>(`${API_BASE}/returnable-movements`, { method: 'POST', body: JSON.stringify(data) });

export interface UinvLoanableItem {
  id: string; property_id: string | null; item_code: string; item_name: string;
  type: 'Laptop' | 'Projector' | 'Radio' | 'Event Equipment' | 'Tool' | 'Portable Equipment' | 'Other';
  serial_number: string | null; total_quantity: number; available_quantity: number;
  location: string | null; custodian: string | null; condition: AssetCondition;
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
}
export const fetchLoanableItems = (filters?: { propertyId?: string; type?: string }) =>
  apiRequest<UinvLoanableItem[]>(`${API_BASE}/loanable-items${qs(filters)}`);
export const createLoanableItem = (data: Partial<UinvLoanableItem>) =>
  apiRequest<UinvLoanableItem>(`${API_BASE}/loanable-items`, { method: 'POST', body: JSON.stringify(data) });
export const updateLoanableItem = (id: string, data: Partial<UinvLoanableItem>) =>
  apiRequest<UinvLoanableItem>(`${API_BASE}/loanable-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLoanableItem = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/loanable-items/${id}`, { method: 'DELETE' });

export interface UinvLoanTransaction {
  id: string; property_id: string | null; loan_number: string; loanable_id: string;
  borrower: string; department: string | null; purpose: string | null;
  issue_date: string; due_date: string | null; return_date: string | null;
  condition_at_issue: AssetCondition; condition_at_return: AssetCondition | null;
  status: 'Active' | 'Returned' | 'Overdue' | 'Lost';
  approved_by: string | null; notes: string | null; created_by: string | null;
  created_at: string; updated_at: string; loanable?: UinvLoanableItem;
}
export const fetchLoanTransactions = (filters?: { propertyId?: string; loanableId?: string; status?: string; borrower?: string }) =>
  apiRequest<UinvLoanTransaction[]>(`${API_BASE}/loan-transactions${qs(filters)}`);
export const createLoanTransaction = (data: Partial<UinvLoanTransaction>) =>
  apiRequest<UinvLoanTransaction>(`${API_BASE}/loan-transactions`, { method: 'POST', body: JSON.stringify(data) });
export const updateLoanTransaction = (id: string, data: Partial<UinvLoanTransaction>) =>
  apiRequest<UinvLoanTransaction>(`${API_BASE}/loan-transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLoanTransaction = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/loan-transactions/${id}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════
// GOVERNANCE — PERIODS, AUDIT, APPROVALS, DASHBOARD
// ════════════════════════════════════════════════════════════════
export interface UinvInventoryPeriod {
  id: string; property_id: string | null; period_name: string;
  period_type: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  start_date: string; end_date: string;
  status: 'Open' | 'Frozen' | 'Closed';
  frozen_at: string | null; closed_at: string | null; closed_by: string | null;
  finance_handoff_at: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
export const fetchInventoryPeriods = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<UinvInventoryPeriod[]>(`${API_BASE}/inventory-periods${qs(filters)}`);
export const createInventoryPeriod = (data: Partial<UinvInventoryPeriod>) =>
  apiRequest<UinvInventoryPeriod>(`${API_BASE}/inventory-periods`, { method: 'POST', body: JSON.stringify(data) });
export const updateInventoryPeriod = (id: string, data: Partial<UinvInventoryPeriod>) =>
  apiRequest<UinvInventoryPeriod>(`${API_BASE}/inventory-periods/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteInventoryPeriod = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/inventory-periods/${id}`, { method: 'DELETE' });

export interface UinvAuditLog {
  id: string; property_id: string | null; department: string | null;
  user_id: string | null; user_name: string;
  transaction_type: string; entity_type: string; entity_id: string | null;
  item_or_asset: string | null; quantity: number | null; value: number | null;
  location: string | null; batch_serial: string | null;
  reason: string | null; approval_ref: string | null;
  previous_state: Record<string, any> | null; new_state: Record<string, any> | null;
  related_document: string | null; timestamp: string; created_at: string;
}
export const fetchAuditLogs = (filters?: { propertyId?: string; entityType?: string; entityId?: string; userId?: string; startDate?: string; endDate?: string }) =>
  apiRequest<UinvAuditLog[]>(`${API_BASE}/audit-logs${qs(filters)}`);

export interface UinvApprovalRequest {
  id: string; property_id: string | null; request_number: string;
  approval_type: 'High-Value Stock Adjustment' | 'High-Value Waste' | 'Asset Transfer' | 'Inter-Property Transfer' | 'Asset Disposal' | 'Missing Asset' | 'High-Value Issue' | 'Count Variance' | 'Quarantine Release' | 'Other';
  entity_type: string; entity_id: string | null;
  requester: string; requester_department: string | null;
  value: number | null; quantity: number | null; reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  approver: string | null; approver_role: string | null;
  approved_at: string | null; decision_notes: string | null;
  created_at: string; updated_at: string;
}
export const fetchApprovalRequests = (filters?: { propertyId?: string; status?: string; approvalType?: string }) =>
  apiRequest<UinvApprovalRequest[]>(`${API_BASE}/approval-requests${qs(filters)}`);
export const createApprovalRequest = (data: Partial<UinvApprovalRequest>) =>
  apiRequest<UinvApprovalRequest>(`${API_BASE}/approval-requests`, { method: 'POST', body: JSON.stringify(data) });
export const updateApprovalRequest = (id: string, data: Partial<UinvApprovalRequest>) =>
  apiRequest<UinvApprovalRequest>(`${API_BASE}/approval-requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteApprovalRequest = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/approval-requests/${id}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════
// GAP FILLERS — CRITICAL SPARES, EQUIPMENT COMPATIBILITY,
// GUEST CUSTODY, STORE SESSIONS, GLOBAL SEARCH
// ════════════════════════════════════════════════════════════════
export interface UinvCriticalSpare {
  id: string; property_id: string | null; item_id: string;
  criticality: 'Critical' | 'High' | 'Medium' | 'Normal';
  min_stock: number; lead_time_days: number;
  alternative_part_id: string | null;
  emergency_availability: string | null;
  compatible_equipment: string[] | null;
  notes: string | null; created_by: string | null;
  created_at: string; updated_at: string; item?: UinvItem;
}
export const fetchCriticalSpares = (filters?: { propertyId?: string; criticality?: string }) =>
  apiRequest<UinvCriticalSpare[]>(`${API_BASE}/critical-spares${qs(filters)}`);
export const createCriticalSpare = (data: Partial<UinvCriticalSpare>) =>
  apiRequest<UinvCriticalSpare>(`${API_BASE}/critical-spares`, { method: 'POST', body: JSON.stringify(data) });
export const updateCriticalSpare = (id: string, data: Partial<UinvCriticalSpare>) =>
  apiRequest<UinvCriticalSpare>(`${API_BASE}/critical-spares/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCriticalSpare = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/critical-spares/${id}`, { method: 'DELETE' });

export interface UinvEquipmentCompatibility {
  id: string; property_id: string | null; item_id: string; asset_id: string;
  compatibility_notes: string | null; is_primary: boolean;
  created_at: string; item?: UinvItem; asset?: UinvAsset;
}
export const fetchEquipmentCompatibility = (filters?: { propertyId?: string; itemId?: string; assetId?: string }) =>
  apiRequest<UinvEquipmentCompatibility[]>(`${API_BASE}/equipment-compatibility${qs(filters)}`);
export const createEquipmentCompatibility = (data: Partial<UinvEquipmentCompatibility>) =>
  apiRequest<UinvEquipmentCompatibility>(`${API_BASE}/equipment-compatibility`, { method: 'POST', body: JSON.stringify(data) });
export const deleteEquipmentCompatibility = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/equipment-compatibility/${id}`, { method: 'DELETE' });

export interface UinvGuestCustody {
  id: string; property_id: string | null; custody_number: string;
  owner_name: string; owner_type: 'Guest' | 'Third Party' | 'Supplier' | 'Vendor' | 'Other';
  item_description: string; quantity: number;
  received_date: string; location: string | null; custodian: string | null;
  condition: AssetCondition;
  release_authorization: string | null; release_date: string | null;
  released_to: string | null; released_by: string | null;
  status: 'In Custody' | 'Released' | 'Transferred' | 'Disposed';
  notes: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}
export const fetchGuestCustody = (filters?: { propertyId?: string; status?: string; ownerType?: string }) =>
  apiRequest<UinvGuestCustody[]>(`${API_BASE}/guest-custody${qs(filters)}`);
export const createGuestCustody = (data: Partial<UinvGuestCustody>) =>
  apiRequest<UinvGuestCustody>(`${API_BASE}/guest-custody`, { method: 'POST', body: JSON.stringify(data) });
export const updateGuestCustody = (id: string, data: Partial<UinvGuestCustody>) =>
  apiRequest<UinvGuestCustody>(`${API_BASE}/guest-custody/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteGuestCustody = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/guest-custody/${id}`, { method: 'DELETE' });

export interface UinvStoreSession {
  id: string; property_id: string | null; store_id: string;
  session_type: 'Opening' | 'Closing'; session_date: string;
  performed_by: string;
  temperature_checked: boolean; temperature_reading: number | null;
  security_checked: boolean; cold_room_checked: boolean;
  pending_transactions_reviewed: boolean; stock_exceptions_reviewed: boolean;
  high_value_secured: boolean; receipts_completed: boolean;
  issues_completed: boolean; transfers_reviewed: boolean;
  returns_reviewed: boolean; expiry_reviewed: boolean;
  checklist: any[]; exceptions: string | null;
  status: 'In Progress' | 'Completed' | 'Exceptions Noted';
  notes: string | null;
  created_at: string; updated_at: string; store?: UinvStore;
}
export const fetchStoreSessions = (filters?: { propertyId?: string; storeId?: string; sessionType?: string }) =>
  apiRequest<UinvStoreSession[]>(`${API_BASE}/store-sessions${qs(filters)}`);
export const createStoreSession = (data: Partial<UinvStoreSession>) =>
  apiRequest<UinvStoreSession>(`${API_BASE}/store-sessions`, { method: 'POST', body: JSON.stringify(data) });
export const updateStoreSession = (id: string, data: Partial<UinvStoreSession>) =>
  apiRequest<UinvStoreSession>(`${API_BASE}/store-sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteStoreSession = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/store-sessions/${id}`, { method: 'DELETE' });

// Global physical resource search (spec S55)
export interface UinvSearchResult {
  type: string; id: string; label: string; subtitle: string;
  location: string | null; status: string | null;
  reference: string | null;
}
export const globalResourceSearch = (query: string, propertyId?: string) =>
  apiRequest<UinvSearchResult[]>(`${API_BASE}/global-search?q=${encodeURIComponent(query)}${propertyId ? `&propertyId=${propertyId}` : ''}`);

// ════════════════════════════════════════════════════════════════
// CROSS-PORTAL INTEGRATION API
// ════════════════════════════════════════════════════════════════

// Department Consumption (spec §61–§66)
export interface ConsumptionLine {
  item_id: string;
  quantity: number;
  unit_cost?: number;
  reason?: string;
}
export interface ConsumptionResult {
  success: boolean;
  consumption_number: string;
  department: string;
  store_id: string;
  results: { item_id: string; success: boolean; new_on_hand?: number; error?: string }[];
}
export const postDepartmentConsumption = (data: {
  property_id?: string | null;
  department: string;
  consumed_by?: string;
  consumption_date?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  cost_center?: string;
  notes?: string;
  lines: ConsumptionLine[];
}) => apiRequest<ConsumptionResult>(`${API_BASE}/department-consumption`, { method: 'POST', body: JSON.stringify(data) });

export const fetchDepartmentConsumption = (department: string, filters?: { propertyId?: string; startDate?: string; endDate?: string; limit?: number }) =>
  apiRequest<any[]>(`${API_BASE}/department-consumption/${encodeURIComponent(department)}${qs(filters)}`);

/** Fetch cross-department consumption history (all department stores). */
export const fetchConsumption = (filters?: { propertyId?: string; startDate?: string; endDate?: string; department?: string; storeId?: string; limit?: number }) =>
  apiRequest<any[]>(`${API_BASE}/consumption${qs(filters)}`);

// ── Centralized Supply & Procurement ────────────────────────────────────
// Consolidates department-siloed supply/procurement (Engineering, HK, F&B)
// into a single Inventory-portal view. Talks to /api/uinv-portal/supply-procurement/*.

export interface SupplyProcurementStats {
  openRequisitions: number;
  pendingApproval: number;
  activeSuppliers: number;
  avgLeadTimeDays: number;
  departmentCount: number;
}

export interface SupplyDemandRow {
  id: string;
  department: string;
  item_name: string;
  item_code: string;
  category: string;
  unit: string;
  current_stock: number;
  reorder_point: number;
  shortage: number;
  reorder_qty: number;
  unit_cost: number;
  supplier: string;
}

export interface SupplyRequisitionItem {
  id: string;
  item_name: string;
  category: string;
  requested_quantity: number;
  unit: string;
  estimated_unit_cost: number;
  estimated_total: number;
  required_by: string;
  reason: string;
}

export interface SupplyRequisition {
  id: string;
  source_department: string;
  source_table: string;
  requisition_number: string;
  requested_by: string;
  request_date: string;
  department: string;
  priority: string;
  status: string;
  po_status: string;
  items: SupplyRequisitionItem[];
  total_cost: number;
  notes: string;
  supplier_name: string | null;
  supplier_id: string | null;
}

export interface SupplySupplier {
  id: string;
  supplier_id: string;
  supplier_name: string;
  category: string;
  item_name: string;
  minimum_order_qty: number;
  unit: string;
  lead_time_days: number;
  payment_terms: string;
  status: string;
  last_order_date: string | null;
}

export const fetchSupplyProcurementStats = (propertyId?: string) =>
  apiRequest<SupplyProcurementStats>(`${API_BASE}/supply-procurement/stats${qs({ propertyId })}`);

export const fetchSupplyDemand = (filters?: { propertyId?: string; department?: string }) =>
  apiRequest<SupplyDemandRow[]>(`${API_BASE}/supply-procurement/demand${qs(filters)}`);

export const fetchSupplyRequisitions = (filters?: { status?: string; propertyId?: string; department?: string }) =>
  apiRequest<SupplyRequisition[]>(`${API_BASE}/supply-procurement/requisitions${qs(filters)}`);

export const createSupplyRequisition = (data: {
  department: string;
  propertyId: string;
  supplierId?: string;
  priority?: string;
  notes?: string;
  items: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; itemId?: string }>;
}) => apiRequest<{ id: string; po_number: string; status: string; department: string }>(
  `${API_BASE}/supply-procurement/requisitions`, { method: 'POST', body: JSON.stringify(data) }
);

export const updateSupplyRequisitionStatus = (id: string, data: { status: string; department?: string }) =>
  apiRequest<{ id: string; po_number: string; status: string; department: string }>(
    `${API_BASE}/supply-procurement/requisitions/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }
  );

export const receiveSupplyRequisition = (id: string, data: { department: string; lines?: Array<{ lineId: string; receivedQty: number }> }) =>
  apiRequest<{ id: string; po_number: string; status: string; department: string; fullyReceived: boolean; transactionsLogged: number }>(
    `${API_BASE}/supply-procurement/requisitions/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }
  );

export const fetchSupplySuppliers = () =>
  apiRequest<SupplySupplier[]>(`${API_BASE}/supply-procurement/suppliers`);

// Finance Bridge (spec §60)
export const syncAssetsToFinance = (propertyId?: string) =>
  apiRequest<{ success: boolean; total_uinv_assets: number; synced: number; skipped: number; errors: any[] }>(
    `${API_BASE}/finance/sync-assets`, { method: 'POST', body: JSON.stringify({ property_id: propertyId }) }
  );

export const fetchFinanceAssetRegister = (filters?: { propertyId?: string; status?: string; department?: string }) =>
  apiRequest<any[]>(`${API_BASE}/finance/asset-register${qs(filters)}`);

// Security Alerts (spec §67)
export interface SecurityAlert {
  id: string;
  type: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  entity_type: string;
  entity_id: string;
  description: string;
  status: string;
  created_at: string;
  reference: string | null;
}
export const fetchSecurityAlerts = (filters?: { propertyId?: string; severity?: string; status?: string }) =>
  apiRequest<SecurityAlert[]>(`${API_BASE}/security/alerts${qs(filters)}`);

// Procurement PO Linkage (spec §8)
export const fetchProcurementPOs = (filters?: { propertyId?: string; status?: string }) =>
  apiRequest<{ purchase_orders: any[]; approved_requisitions: any[] }>(`${API_BASE}/procurement/purchase-orders${qs(filters)}`);

export const linkReceiptToPO = (receiptId: string, data: { po_id?: string; po_number?: string }) =>
  apiRequest<{ success: boolean; receipt: any; purchase_order: any }>(`${API_BASE}/receipts/${receiptId}/link-po`, { method: 'PATCH', body: JSON.stringify(data) });

// F&B Reconciliation (spec §61)
export const fetchFBOutletInventory = (filters?: { outlet?: string; propertyId?: string }) =>
  apiRequest<{ bar: any[]; kitchen: any[] }>(`${API_BASE}/fb/outlet-inventory${qs(filters)}`);

export const reconcileFBInventory = (data: { property_id?: string | null; outlet_type?: 'bar' | 'kitchen' | 'both' }) =>
  apiRequest<{ success: boolean; created: number; updated: number; skipped: number; errors: any[] }>(`${API_BASE}/fb/reconcile`, { method: 'POST', body: JSON.stringify(data) });

// Executive BI Metrics (spec §68)
export const fetchBIMetrics = (propertyId?: string) =>
  apiRequest<any>(`${API_BASE}/bi/metrics${qs({ propertyId })}`);

// ── Auto-Replenishment (Central → Department Stores) ────────────

export interface ReplenishmentRule {
  id: string;
  property_id: string | null;
  store_id: string;
  item_id: string | null;
  replenish_min: number;
  replenish_max: number;
  source_store_id: string;
  is_active: boolean;
  rule_type: string;
  created_at: string;
  updated_at: string;
  store?: UinvStore;
  item?: UinvItem;
}

export interface AutoReplenishPreview {
  totalChecked: number;
  belowMin: number;
  items: {
    balanceId: string;
    storeId: string;
    storeName: string;
    department: string | null;
    itemId: string;
    itemName: string;
    itemCode: string;
    onHand: number;
    replenishMin: number;
    replenishMax: number;
    suggestedQty: number;
    unitCost: number;
  }[];
}

export interface AutoReplenishResult {
  generated: number;
  transfers: {
    transfer_number: string;
    out_store_id: string;
    item_name: string;
    quantity: number;
    status: string;
  }[];
}

/** Preview which department store balances are below their replenish_min. */
export const previewAutoReplenish = (propertyId?: string) =>
  apiRequest<AutoReplenishPreview>(`${API_BASE}/replenishment/auto-replenish/preview${qs({ propertyId })}`);

/** Trigger auto-replenishment from Central Warehouse to department stores. */
export const triggerAutoReplenish = (propertyId?: string) =>
  apiRequest<AutoReplenishResult>(`${API_BASE}/replenishment/auto-replenish`, {
    method: 'POST',
    body: JSON.stringify({ propertyId }),
  });

/** List auto-replenishment rules. */
export const fetchReplenishmentRules = (filters?: { propertyId?: string; storeId?: string; active?: string }) =>
  apiRequest<ReplenishmentRule[]>(`${API_BASE}/replenishment/rules${qs(filters)}`);

/** Create an auto-replenishment rule. */
export const createReplenishmentRule = (data: {
  property_id?: string | null;
  store_id: string;
  item_id?: string | null;
  replenish_min: number;
  replenish_max: number;
  source_store_id?: string;
  is_active?: boolean;
  rule_type?: string;
}) =>
  apiRequest<ReplenishmentRule>(`${API_BASE}/replenishment/rules`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

/** Update an auto-replenishment rule. */
export const updateReplenishmentRule = (id: string, data: Partial<ReplenishmentRule>) =>
  apiRequest<ReplenishmentRule>(`${API_BASE}/replenishment/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

/** Delete an auto-replenishment rule. */
export const deleteReplenishmentRule = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/replenishment/rules/${id}`, { method: 'DELETE' });

// ── Dynamic Par Levels ──────────────────────────────────────────────

export interface ConsumptionStat {
  id: string;
  property_id: string | null;
  item_id: string;
  store_id: string;
  lookback_days: number;
  total_consumed: number;
  avg_daily_consumption: number;
  avg_weekly_consumption: number;
  active_days: number;
  peak_daily_consumption: number;
  consumption_stddev: number;
  dynamic_par_level: number;
  dynamic_replenish_min: number;
  dynamic_replenish_max: number;
  service_level: number;
  calculated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export interface DynamicParConfig {
  id: string;
  property_id: string | null;
  store_id: string | null;
  item_id: string | null;
  lookback_days: number;
  lead_time_days: number;
  safety_stock_days: number;
  reorder_cycle_days: number;
  service_level: number;
  is_enabled: boolean;
  min_replenish_threshold: number;
  created_at: string;
  updated_at: string;
  store?: { id: string; store_name: string } | null;
  item?: { id: string; item_name: string; item_code: string } | null;
}

export interface DynamicParResult {
  generated: number;
  lookbackDays: number;
  results: {
    itemId: string;
    storeId: string;
    avgDaily: number;
    dynamicPar: number;
    dynamicMin: number;
    dynamicMax: number;
  }[];
}

/** Trigger dynamic par level calculation from historical consumption. */
export const calculateDynamicPar = (lookbackDays?: number, propertyId?: string) =>
  apiRequest<DynamicParResult>(`${API_BASE}/replenishment/calculate-dynamic-par`, {
    method: 'POST',
    body: JSON.stringify({ lookbackDays, propertyId }),
  });

/** Fetch cached consumption statistics. */
export const fetchConsumptionStats = (filters?: { propertyId?: string; storeId?: string; itemId?: string; lookbackDays?: string }) =>
  apiRequest<ConsumptionStat[]>(`${API_BASE}/replenishment/consumption-stats${qs(filters)}`);

/** Fetch dynamic par configuration. */
export const fetchDynamicParConfig = (filters?: { storeId?: string; itemId?: string }) =>
  apiRequest<DynamicParConfig[]>(`${API_BASE}/replenishment/dynamic-par-config${qs(filters)}`);

/** Create or update dynamic par configuration. */
export const saveDynamicParConfig = (data: {
  property_id?: string | null;
  store_id?: string | null;
  item_id?: string | null;
  lookback_days?: number;
  lead_time_days?: number;
  safety_stock_days?: number;
  reorder_cycle_days?: number;
  service_level?: number;
  is_enabled?: boolean;
  min_replenish_threshold?: number;
}) =>
  apiRequest<DynamicParConfig>(`${API_BASE}/replenishment/dynamic-par-config`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

/** Update a dynamic par configuration. */
export const updateDynamicParConfig = (id: string, data: Partial<DynamicParConfig>) =>
  apiRequest<DynamicParConfig>(`${API_BASE}/replenishment/dynamic-par-config/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

/** Delete a dynamic par configuration. */
export const deleteDynamicParConfig = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/replenishment/dynamic-par-config/${id}`, { method: 'DELETE' });

// ── Department-Scoped Dynamic Par + Consumption Stats ───────────────

/** Fetch consumption stats for a department's stores. */
export const fetchDepartmentConsumptionStats = (department: string, filters?: { propertyId?: string; lookbackDays?: string }) =>
  apiRequest<ConsumptionStat[]>(`${API_BASE}/replenishment/department-consumption-stats${qs({ department, ...filters })}`);

/** Recalculate dynamic par levels and return only the department's results. */
export const calculateDepartmentDynamicPar = (department: string, lookbackDays?: number, propertyId?: string) =>
  apiRequest<DynamicParResult>(`${API_BASE}/replenishment/department-calculate-dynamic-par`, {
    method: 'POST',
    body: JSON.stringify({ department, lookbackDays, propertyId }),
  });

/** Fetch dynamic par config for a department's stores. */
export const fetchDepartmentDynamicParConfig = (department: string) =>
  apiRequest<DynamicParConfig[]>(`${API_BASE}/replenishment/department-dynamic-par-config${qs({ department })}`);

// ════════════════════════════════════════════════════════════════
// Migration 376 — Central Store Dynamic Par
// ROP_Central = (D_Total × LT_Vendor) + SS_Central
// ════════════════════════════════════════════════════════════════

export interface CentralStoreStat {
  id: string;
  property_id: string | null;
  item_id: string;
  lookback_days: number;
  d_total: number;
  demand_variance: number;
  dept_count: number;
  vendor_lead_time_days: number;
  lead_time_stddev_days: number;
  safety_stock_method: 'bulletproof' | 'statistical';
  ss_central: number;
  central_min: number;
  central_rop: number;
  central_order_qty: number;
  central_par: number;
  combined_dept_par: number;
  combined_dept_rop: number;
  service_level: number;
  z_score: number;
  dept_breakdown: Array<{
    storeId: string;
    storeName: string;
    department: string | null;
    avgDaily: number;
    dynamicPar: number;
    dynamicMin: number;
    orderQty: number;
  }>;
  calculated_at: string;
  item?: UinvItem;
  balance?: { item_id: string; store_id: string; on_hand: number };
}

export interface CentralDynamicParResult {
  generated: number;
  lookbackDays: number;
  results: {
    itemId: string;
    dTotal: number;
    centralMin: number;
    centralRop: number;
    centralPar: number;
    ssMethod: string;
    deptCount: number;
  }[];
}

export interface CentralStoreConfig extends DynamicParConfig {
  safety_stock_method: 'bulletproof' | 'statistical';
  lead_time_stddev_days: number;
}

/** Fetch cached central store dynamic par stats. */
export const fetchCentralStoreStats = (filters?: { propertyId?: string; lookbackDays?: string; itemId?: string }) =>
  apiRequest<CentralStoreStat[]>(`${API_BASE}/replenishment/central-store-stats${qs(filters)}`);

/** Recalculate central store dynamic par from aggregated department demand. */
export const calculateCentralDynamicPar = (lookbackDays?: number, propertyId?: string) =>
  apiRequest<CentralDynamicParResult>(`${API_BASE}/replenishment/central-calculate-dynamic-par`, {
    method: 'POST',
    body: JSON.stringify({ lookbackDays, propertyId }),
  });

/** Fetch central store dynamic par config (MAIN-scoped + global default). */
export const fetchCentralStoreConfig = (filters?: { itemId?: string }) =>
  apiRequest<CentralStoreConfig[]>(`${API_BASE}/replenishment/central-store-config${qs(filters)}`);

/** Create or update a central store dynamic par config row. */
export const saveCentralStoreConfig = (data: {
  property_id?: string | null;
  item_id?: string | null;
  lookback_days?: number;
  lead_time_days?: number;
  safety_stock_days?: number;
  reorder_cycle_days?: number;
  service_level?: number;
  is_enabled?: boolean;
  min_replenish_threshold?: number;
  safety_stock_method?: 'bulletproof' | 'statistical';
  lead_time_stddev_days?: number;
}) =>
  apiRequest<CentralStoreConfig>(`${API_BASE}/replenishment/central-store-config`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

// ════════════════════════════════════════════════════════════════
// Migration 373 — Inventory System Enhancements
// ════════════════════════════════════════════════════════════════

// ── Replenishment Pulls (Gap 1: Central = separate stock) ───────────

export interface ReplenishmentPull {
  id: string;
  pull_number: string;
  property_id: string | null;
  dept_store_id: string;
  source_store_id: string;
  item_id: string;
  quantity_requested: number;
  quantity_shipped: number;
  trigger_type: string;
  status: string;
  transfer_id: string | null;
  reason: string | null;
  stock_at_generation: number | null;
  par_at_generation: number | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  dept_store?: UinvStore;
  source_store?: UinvStore;
}

export const fetchReplenishmentPulls = (filters?: { propertyId?: string; deptStoreId?: string; status?: string }) =>
  apiRequest<ReplenishmentPull[]>(`${API_BASE}/replenishment-pulls${qs(filters)}`);

export const generateReplenishmentPulls = (deptStoreId: string, propertyId?: string) =>
  apiRequest<any>(`${API_BASE}/replenishment-pulls/generate`, {
    method: 'POST',
    body: JSON.stringify({ deptStoreId, propertyId }),
  });

export const approveReplenishmentPull = (id: string) =>
  apiRequest<ReplenishmentPull>(`${API_BASE}/replenishment-pulls/${id}/approve`, { method: 'PATCH' });

export const rejectReplenishmentPull = (id: string, rejectionReason?: string) =>
  apiRequest<ReplenishmentPull>(`${API_BASE}/replenishment-pulls/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectionReason }),
  });

export const convertPullToTransfer = (id: string) =>
  apiRequest<any>(`${API_BASE}/replenishment-pulls/${id}/convert-to-transfer`, { method: 'POST' });

export const deleteReplenishmentPull = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/replenishment-pulls/${id}`, { method: 'DELETE' });

// ── Manual Par Overrides (Gap 2: Three-tier par system) ──────────────

export interface ManualParOverride {
  id: string;
  store_id: string;
  item_id: string;
  manual_par_level: number;
  manual_replenish_min: number | null;
  manual_replenish_max: number | null;
  reason: string | null;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  store?: UinvStore;
}

export const fetchManualParOverrides = (filters?: { propertyId?: string; storeId?: string; itemId?: string; activeOnly?: string }) =>
  apiRequest<ManualParOverride[]>(`${API_BASE}/manual-par-overrides${qs(filters)}`);

export const createManualParOverride = (data: {
  store_id: string;
  item_id: string;
  manual_par_level: number;
  manual_replenish_min?: number;
  manual_replenish_max?: number;
  reason?: string;
  effective_from?: string;
  effective_until?: string;
  property_id?: string;
}) =>
  apiRequest<ManualParOverride>(`${API_BASE}/manual-par-overrides`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateManualParOverride = (id: string, data: Partial<ManualParOverride>) =>
  apiRequest<ManualParOverride>(`${API_BASE}/manual-par-overrides/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deactivateManualParOverride = (id: string) =>
  apiRequest<ManualParOverride>(`${API_BASE}/manual-par-overrides/${id}/deactivate`, { method: 'PATCH' });

export const deleteManualParOverride = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/manual-par-overrides/${id}`, { method: 'DELETE' });

export interface EffectiveParResult {
  par_level: number;
  replenish_min: number;
  replenish_max: number;
  source: 'manual' | 'dynamic' | 'standard';
}

export const resolveEffectivePar = (itemId: string, storeId: string) =>
  apiRequest<EffectiveParResult>(`${API_BASE}/effective-par${qs({ itemId, storeId })}`);

// ── Procurement Auto-Trigger (Gap 3: Low central stock → PR) ─────────

export interface ProcurementTriggerPreview {
  balanceId: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  category: string;
  onHand: number;
  reorderPoint: number;
  maxStock: number;
  lastCost: number;
  suggestedOrderQty: number;
  estimatedValue: number;
}

export const previewProcurementTrigger = async (propertyId?: string): Promise<ProcurementTriggerPreview[]> => {
  const resp = await apiRequest<{ lowStockItems: ProcurementTriggerPreview[]; count: number }>(`${API_BASE}/procurement-trigger/preview${qs({ propertyId })}`);
  return resp?.lowStockItems ?? [];
};

export const generateProcurementRequisitions = (propertyId: string) =>
  apiRequest<any>(`${API_BASE}/procurement-trigger/generate`, {
    method: 'POST',
    body: JSON.stringify({ propertyId }),
  });

// ── Draft procurement requisition (single PR with multiple items, editable) ──

export interface ProcDraftLine {
  id?: string;
  item_code?: string;
  item_name: string;
  category?: string;
  quantity: number;
  unit_of_measure?: string;
  estimated_unit_price: number;
  required_date?: string;
}

export interface ProcDraftRequisition {
  id: string;
  pr_number: string;
  status: string;
  estimated_total?: number;
  notes?: string;
  priority?: string;
}

export const generateDraftRequisition = (propertyId?: string) =>
  apiRequest<{ requisition: ProcDraftRequisition | null; lines: ProcDraftLine[]; count?: number; message: string }>(
    `${API_BASE}/procurement-trigger/generate-draft`,
    { method: 'POST', body: JSON.stringify({ propertyId }) },
  );

export const fetchDraftRequisition = (id: string) =>
  apiRequest<{ requisition: ProcDraftRequisition; lines: ProcDraftLine[] }>(
    `${API_BASE}/procurement-trigger/draft/${id}`,
  );

export const updateDraftRequisition = (id: string, data: { lines?: ProcDraftLine[]; notes?: string; priority?: string }) =>
  apiRequest<{ success: boolean; estimated_total: number }>(
    `${API_BASE}/procurement-trigger/draft/${id}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );

export const submitDraftRequisition = (id: string) =>
  apiRequest<{ success: boolean; pr_number: string; message: string }>(
    `${API_BASE}/procurement-trigger/draft/${id}/submit`,
    { method: 'POST' },
  );

// ── Journal Posting Log (Gap 4: Finance integration) ─────────────────

export interface JournalPostingLogEntry {
  id: string;
  source_entity: string;
  source_id: string;
  journal_id: string;
  posting_type: string;
  amount: number;
  posted_at: string;
}

export const fetchJournalPostingLog = (filters?: { sourceEntity?: string; postingType?: string }) =>
  apiRequest<JournalPostingLogEntry[]>(`${API_BASE}/journal-posting-log${qs(filters)}`);

export const postInventoryJournal = (data: {
  source_entity: string;
  source_id: string;
  posting_type: string;
  amount: number;
  description?: string;
  department?: string;
  property_id?: string;
  reference?: string;
}) =>
  apiRequest<{ journal_id: string }>(`${API_BASE}/journal-posting/post`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const batchPostWasteJournals = () =>
  apiRequest<any>(`${API_BASE}/journal-posting/batch-waste`, { method: 'POST' });

// ── Department Borrowing (Gap 5: Inter-departmental loans) ───────────

export interface DeptBorrow {
  id: string;
  borrow_number: string;
  property_id: string | null;
  borrowing_store_id: string;
  lending_store_id: string;
  item_id: string;
  quantity_borrowed: number;
  quantity_returned: number;
  expected_return_date: string | null;
  actual_return_date: string | null;
  status: string;
  purpose: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  outbound_transfer_id: string | null;
  return_transfer_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  item?: UinvItem;
  borrowing_store?: UinvStore;
  lending_store?: UinvStore;
}

export const fetchDeptBorrows = (filters?: { propertyId?: string; borrowingStoreId?: string; lendingStoreId?: string; status?: string }) =>
  apiRequest<DeptBorrow[]>(`${API_BASE}/dept-borrows${qs(filters)}`);

export const createDeptBorrow = (data: {
  borrowing_store_id: string;
  lending_store_id: string;
  item_id: string;
  quantity_borrowed: number;
  expected_return_date?: string;
  purpose?: string;
  property_id?: string;
}) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const approveDeptBorrow = (id: string) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/approve`, { method: 'PATCH' });

export const rejectDeptBorrow = (id: string, rejectionReason?: string) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectionReason }),
  });

export const dispatchDeptBorrow = (id: string) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/dispatch`, { method: 'POST' });

export const receiveDeptBorrow = (id: string) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/receive`, { method: 'PATCH' });

export const returnDeptBorrow = (id: string, quantityReturned: number) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/return`, {
    method: 'POST',
    body: JSON.stringify({ quantityReturned }),
  });

export const cancelDeptBorrow = (id: string) =>
  apiRequest<DeptBorrow>(`${API_BASE}/dept-borrows/${id}/cancel`, { method: 'PATCH' });

export const deleteDeptBorrow = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/dept-borrows/${id}`, { method: 'DELETE' });

// ── Asset Retirement, Warranty Claims, Insurance Claims (spec §40/§41/§59) ──

export interface UinvWarrantyClaim {
  id: string; property_id: string | null; claim_number: string;
  warranty_id: string | null; asset_id: string; claim_date: string;
  issue_description: string; status: string; estimated_cost: number | null;
  actual_cost: number | null; resolved_at: string | null; resolved_by: string | null;
  notes: string | null; created_by: string | null; created_at: string;
  asset?: UinvAsset; warranty?: UinvAssetWarranty;
}
export const fetchWarrantyClaims = (filters?: { propertyId?: string; status?: string; assetId?: string }) =>
  apiRequest<UinvWarrantyClaim[]>(`${API_BASE}/warranty-claims${qs(filters)}`);
export const createWarrantyClaim = (data: Partial<UinvWarrantyClaim>) =>
  apiRequest<UinvWarrantyClaim>(`${API_BASE}/warranty-claims`, { method: 'POST', body: JSON.stringify(data) });
export const updateWarrantyClaim = (id: string, data: Partial<UinvWarrantyClaim>) =>
  apiRequest<UinvWarrantyClaim>(`${API_BASE}/warranty-claims/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteWarrantyClaim = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/warranty-claims/${id}`, { method: 'DELETE' });

export interface UinvInsuranceClaim {
  id: string; property_id: string | null; claim_number: string;
  insurance_id: string | null; asset_id: string; incident_date: string;
  description: string; claim_amount: number; settled_amount: number | null;
  status: string; settled_at: string | null; notes: string | null;
  created_by: string | null; created_at: string;
  asset?: UinvAsset; insurance?: UinvAssetInsurance;
}
export const fetchInsuranceClaims = (filters?: { propertyId?: string; status?: string; assetId?: string }) =>
  apiRequest<UinvInsuranceClaim[]>(`${API_BASE}/insurance-claims${qs(filters)}`);
export const createInsuranceClaim = (data: Partial<UinvInsuranceClaim>) =>
  apiRequest<UinvInsuranceClaim>(`${API_BASE}/insurance-claims`, { method: 'POST', body: JSON.stringify(data) });
export const updateInsuranceClaim = (id: string, data: Partial<UinvInsuranceClaim>) =>
  apiRequest<UinvInsuranceClaim>(`${API_BASE}/insurance-claims/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteInsuranceClaim = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/insurance-claims/${id}`, { method: 'DELETE' });

export const retireAsset = (id: string, data: { reason?: string; reference?: string }) =>
  apiRequest<UinvAsset>(`${API_BASE}/assets/${id}/retire`, { method: 'POST', body: JSON.stringify(data) });

// ── Variance Investigations (spec §23/§50) ──

export interface UinvVarianceInvestigation {
  id: string; property_id: string | null; investigation_number: string;
  count_id: string | null; item_id: string; store_id: string | null; batch_id: string | null;
  source: string; variance_quantity: number; variance_value: number;
  status: string; assigned_to: string | null; evidence: string | null;
  notes: string | null; resolved_at: string | null; resolved_by: string | null;
  created_by: string | null; created_at: string;
  item?: UinvItem; store?: UinvStore; count?: any;
}
export const fetchVarianceInvestigations = (filters?: { propertyId?: string; status?: string; countId?: string; itemId?: string }) =>
  apiRequest<UinvVarianceInvestigation[]>(`${API_BASE}/variance-investigations${qs(filters)}`);
export const createVarianceInvestigation = (data: Partial<UinvVarianceInvestigation>) =>
  apiRequest<UinvVarianceInvestigation>(`${API_BASE}/variance-investigations`, { method: 'POST', body: JSON.stringify(data) });
export const createVarianceInvestigationsFromCount = (countId: string) =>
  apiRequest<{ created: UinvVarianceInvestigation[]; skipped: any[]; count_id: string }>(`${API_BASE}/variance-investigations/from-count/${countId}`, { method: 'POST' });
export const updateVarianceInvestigation = (id: string, data: Partial<UinvVarianceInvestigation>) =>
  apiRequest<UinvVarianceInvestigation>(`${API_BASE}/variance-investigations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteVarianceInvestigation = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/variance-investigations/${id}`, { method: 'DELETE' });

