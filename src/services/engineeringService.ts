const API_BASE = '/api/eng-portal';

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

// Types
export interface Asset {
  id: string;
  asset_code: string | null;
  asset_name: string | null;
  asset_category: string | null;
  description: string | null;
  location: string | null;
  purchase_date: string | null;
  purchase_cost: number;
  salvage_value: number;
  useful_life_years: number | null;
  depreciation_method: string;
  accumulated_depreciation: number;
  net_book_value: number;
  status: string;
  serial_number: string | null;
  manufacturer: string | null;
  model_number: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  warranty_provider: string | null;
  criticality: string;
  parent_asset_id: string | null;
  property_id: string | null;
  disposal_date: string | null;
  disposal_value: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  description: string;
  completed?: boolean;
}

export interface PMSchedule {
  id: string;
  schedule_name: string;
  asset_id: string | null;
  frequency: string;
  interval_days: number;
  next_due_date: string;
  last_completed_date: string | null;
  checklist_template: ChecklistItem[] | any[];
  assigned_technician: string | null;
  priority: string;
  status: string;
  fixed_assets?: { asset_name: string; asset_code: string; location: string } | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  wo_number: string | null;
  pm_schedule_id: string | null;
  asset_id: string | null;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  room_number: string | null;
  checklist: any[];
  completed_checklist: any[];
  spare_parts_used: any[];
  labor_hours: number;
  cost_estimate: number;
  actual_cost: number;
  created_date: string;
  scheduled_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_by: string | null;
  fixed_assets?: { asset_name: string; asset_code: string; location: string } | null;
}

export interface SparePart {
  id: string;
  property_id: string | null;
  part_number: string | null;
  part_name: string;
  category: string | null;
  manufacturer: string | null;
  supplier: string | null;
  compatible_assets: any[];
  unit: string;
  min_stock: number;
  max_stock: number;
  current_stock: number;
  unit_cost: number;
  location: string | null;
  reorder_qty: number;
  reorder_point: number;
  last_reorder_date: string | null;
  created_at: string;
  updated_at: string;
}

export type SparePartTransactionType =
  | 'Reserve' | 'Issue' | 'Return' | 'Consumption'
  | 'Restock' | 'Waste' | 'Adjustment' | 'Stock Count';

export type SparePartWasteType = 'damaged' | 'expired' | 'lost' | 'obsolete' | 'other';

export interface SparePartTransaction {
  id: string;
  property_id: string | null;
  part_id: string;
  transaction_type: SparePartTransactionType;
  quantity: number;
  transaction_date: string;
  work_order: string | null;
  technician: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  // Enhanced fields (migration 330)
  unit_cost: number;
  total_cost: number;
  performed_by: string;
  reason: string | null;
  reference_number: string | null;
  waste_type: SparePartWasteType | null;
  theoretical_qty: number | null;
  actual_qty: number | null;
}

export interface ReorderRecommendation {
  id: string;
  partName: string;
  partNumber: string | null;
  category: string | null;
  currentStock: number;
  reorderPoint: number;
  minStock: number;
  suggestedOrderQuantity: number;
  estimatedCost: number;
  unitCost: number;
  supplier: string | null;
  location: string | null;
}

// API Functions
export const fetchAssets = (filters?: { propertyId?: string; category?: string; status?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<Asset[]>(`${API_BASE}/assets${qs ? `?${qs}` : ''}`);
};
export const createAsset = (data: any) => apiRequest(`${API_BASE}/assets`, { method: 'POST', body: JSON.stringify(data) });
export const updateAsset = (id: string, data: any) => apiRequest(`${API_BASE}/assets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteAsset = (id: string) => apiRequest(`${API_BASE}/assets/${id}`, { method: 'DELETE' });

export const fetchPMSchedules = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<PMSchedule[]>(`${API_BASE}/pm-schedules${qs ? `?${qs}` : ''}`);
};
export const createPMSchedule = (data: any) => apiRequest(`${API_BASE}/pm-schedules`, { method: 'POST', body: JSON.stringify(data) });
export const updatePMSchedule = (id: string, data: any) => apiRequest(`${API_BASE}/pm-schedules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deletePMSchedule = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/pm-schedules/${id}`, { method: 'DELETE' });
export const generatePMWorkOrders = () => apiRequest(`${API_BASE}/generate-pm-work-orders`, { method: 'POST' });

export const fetchWorkOrders = (filters?: { propertyId?: string; status?: string; assignedTo?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assignedTo) params.set('assignedTo', filters.assignedTo);
  const qs = params.toString();
  return apiRequest<WorkOrder[]>(`${API_BASE}/work-orders${qs ? `?${qs}` : ''}`);
};
export const createWorkOrder = (data: any) => apiRequest<{ success: boolean; workOrder: WorkOrder }>(`${API_BASE}/work-orders`, { method: 'POST', body: JSON.stringify(data) });
export const updateWorkOrder = (id: string, data: any) => apiRequest<{ success: boolean; workOrder: WorkOrder }>(`${API_BASE}/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteWorkOrder = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/work-orders/${id}`, { method: 'DELETE' });

export const fetchSpareParts = (filters?: { propertyId?: string; category?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString();
  return apiRequest<SparePart[]>(`${API_BASE}/spare-parts${qs ? `?${qs}` : ''}`);
};
export const createSparePart = (data: any) => apiRequest<SparePart>(`${API_BASE}/spare-parts`, { method: 'POST', body: JSON.stringify(data) });
export const updateSparePart = (id: string, data: any) => apiRequest<{ success: boolean; sparePart: SparePart }>(`${API_BASE}/spare-parts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSparePart = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/spare-parts/${id}`, { method: 'DELETE' });

// Spare Parts Transactions
export const fetchSparePartTransactions = (filters?: { propertyId?: string; partId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.partId) params.set('partId', filters.partId);
  const qs = params.toString();
  return apiRequest<SparePartTransaction[]>(`${API_BASE}/spare-parts-transactions${qs ? `?${qs}` : ''}`);
};
export const createSparePartTransaction = (data: any) => apiRequest<SparePartTransaction>(`${API_BASE}/spare-parts-transactions`, { method: 'POST', body: JSON.stringify(data) });
export const deleteSparePartTransaction = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/spare-parts-transactions/${id}`, { method: 'DELETE' });

// Dedicated waste endpoint (maintenance-optimized: parts get damaged/expired)
export const wasteSparePart = (id: string, data: { wasteType: SparePartWasteType; quantity: number; reason?: string; referenceNumber?: string }) =>
  apiRequest<SparePartTransaction>(`${API_BASE}/spare-parts/${id}/waste`, { method: 'POST', body: JSON.stringify(data) });

// Dedicated restock endpoint with supplier PO reference
export const restockSparePart = (id: string, data: { quantity: number; referenceNumber?: string; supplier?: string; notes?: string }) =>
  apiRequest<SparePartTransaction>(`${API_BASE}/spare-parts/${id}/restock`, { method: 'POST', body: JSON.stringify(data) });

// Stock count reconciliation — sets actual stock and logs variance
export const stockCountSparePart = (id: string, data: { actualQty: number; notes?: string }) =>
  apiRequest<SparePartTransaction>(`${API_BASE}/spare-parts/${id}/stock-count`, { method: 'POST', body: JSON.stringify(data) });

// Reorder recommendations — parts at or below reorder_point
export const fetchReorderRecommendations = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<ReorderRecommendation[]>(`${API_BASE}/spare-parts/reorder-recommendations${qs ? `?${qs}` : ''}`);
};

// ── Spare Parts Requisitions (HK-inspired) ───────────────────────────────
// Reuses inventory_requisitions with department='Engineering'.
// Workflow: pending → approved → completed (issued) | rejected

export interface SparePartRequisitionLine {
  id: string;
  itemId: string;
  itemName: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
  unit: string;
  unitCost: number;
  reason: string;
}

export interface SparePartRequisition {
  id: string;
  number: string;
  department: string;
  requestedBy: string;
  requestDate: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  totalCost: number;
  notes: string;
  items: SparePartRequisitionLine[];
}

export interface MainStoreItem {
  id: string;
  name: string;
  currentQuantity: number;
  unitOfMeasure: string;
  unitCost: number;
}

export const fetchMainStoreItems = () =>
  apiRequest<{ items: MainStoreItem[] }>(`${API_BASE}/spare-parts/main-store-items`);

export const fetchSparePartRequisitions = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<{ requisitions: SparePartRequisition[] }>(`${API_BASE}/spare-parts/requisitions${qs ? `?${qs}` : ''}`);
};

export const createSparePartRequisition = (data: { propertyId: string; requestedBy: string; notes?: string; items: Array<{ itemId: string; itemName: string; requestedQuantity: number; unit: string; unitCost: number }> }) =>
  apiRequest<{ id: string; number: string; status: string; totalCost: number }>(`${API_BASE}/spare-parts/requisitions`, { method: 'POST', body: JSON.stringify(data) });

export const approveSparePartRequisition = (id: string, approvedQuantities?: Array<{ id: string; approvedQuantity: number }>) =>
  apiRequest<{ success: boolean; id: string; status: string }>(`${API_BASE}/spare-parts/requisitions/${id}/approve`, { method: 'PUT', body: JSON.stringify({ approvedQuantities }) });

export const issueSparePartRequisition = (id: string) =>
  apiRequest<{ success: boolean; id: string; status: string }>(`${API_BASE}/spare-parts/requisitions/${id}/issue`, { method: 'PUT' });

export const rejectSparePartRequisition = (id: string) =>
  apiRequest<{ success: boolean; id: string; status: string }>(`${API_BASE}/spare-parts/requisitions/${id}/reject`, { method: 'PUT' });

// ── Tools Registry & Checkout ───────────────────────────────────────────
// Backs the "Tools" sub-tab of the /erp/maintenance/spare-parts tab
// (renamed "Spare Parts & Tools"). Tools are durable, trackable assets
// with a checkout/return lifecycle to technicians.
// Uses eng_tools + eng_tool_checkouts (migration 344).

export type ToolStatus = 'Available' | 'Checked Out' | 'In Repair' | 'Lost' | 'Retired';
export type ToolCondition = 'New' | 'Good' | 'Fair' | 'Poor';
export type ToolCheckoutStatus = 'Active' | 'Returned' | 'Overdue';

export interface Tool {
  id: string;
  property_id: string | null;
  tool_number: string;
  tool_name: string;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  status: ToolStatus;
  condition: ToolCondition;
  assigned_to: string | null;
  purchase_date: string | null;
  purchase_cost: number;
  calibration_due_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCheckout {
  id: string;
  property_id: string | null;
  tool_id: string;
  technician: string;
  work_order: string | null;
  checked_out_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  status: ToolCheckoutStatus;
  checkout_notes: string | null;
  return_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchTools = (filters?: { propertyId?: string; status?: ToolStatus | string; category?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.category) params.set('category', filters.category);
  const qs = params.toString();
  return apiRequest<Tool[]>(`${API_BASE}/tools${qs ? `?${qs}` : ''}`);
};

export const createTool = (data: any) => apiRequest<Tool>(`${API_BASE}/tools`, { method: 'POST', body: JSON.stringify(data) });
export const updateTool = (id: string, data: any) => apiRequest<{ success: boolean; tool: Tool }>(`${API_BASE}/tools/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTool = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/tools/${id}`, { method: 'DELETE' });

export const checkoutTool = (id: string, data: { technician: string; workOrder?: string; expectedReturnAt?: string; notes?: string; propertyId?: string }) =>
  apiRequest<{ success: boolean; checkout: ToolCheckout }>(`${API_BASE}/tools/${id}/checkout`, { method: 'POST', body: JSON.stringify(data) });

export const returnTool = (id: string, data: { notes?: string; condition?: ToolCondition }) =>
  apiRequest<{ success: boolean; checkout: ToolCheckout }>(`${API_BASE}/tools/${id}/return`, { method: 'POST', body: JSON.stringify(data) });

export const fetchToolCheckouts = (filters?: { propertyId?: string; toolId?: string; status?: ToolCheckoutStatus | string; technician?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.toolId) params.set('toolId', filters.toolId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.technician) params.set('technician', filters.technician);
  const qs = params.toString();
  return apiRequest<ToolCheckout[]>(`${API_BASE}/tool-checkouts${qs ? `?${qs}` : ''}`);
};

export const deleteToolCheckout = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/tool-checkouts/${id}`, { method: 'DELETE' });

// ── Supply & Procurement ────────────────────────────────────────────────
// Backs the /erp/maintenance/vendor-contractor tab (SupplyProcurementModule).
// Mirrors the HK Supply & Procurement pattern using eng_purchase_orders.

export interface EngForecastDemand {
  id: string;
  part_name: string;
  part_number: string;
  category: string;
  unit: string;
  current_stock: number;
  reorder_point: number;
  shortage: number;
  reorder_qty: number;
  unit_cost: number;
  supplier: string;
  requisition_id: string | null;
  requisition_status: string | null;
}

export interface EngRequisitionItem {
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

export interface EngPurchaseRequisition {
  id: string;
  requisition_number: string;
  requested_by: string;
  request_date: string;
  department: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processing';
  po_status?: string;
  items: EngRequisitionItem[];
  total_cost: number;
  notes: string;
  supplier_name: string | null;
}

export interface EngSupplierRequirement {
  id: string;
  supplier_id: string;
  supplier_name: string;
  category: string;
  item_name: string;
  minimum_order_qty: number;
  unit: string;
  lead_time_days: number;
  payment_terms: string;
  status: 'active' | 'inactive' | 'on-hold';
  last_order_date: string | null;
}

export interface EngProcurementStats {
  openRequisitions: number;
  pendingApproval: number;
  activeSuppliers: number;
  avgLeadTimeDays: number;
}

export const fetchEngForecast = (filters?: { propertyId?: string }) => {
  const qs = new URLSearchParams();
  if (filters?.propertyId) qs.set('propertyId', filters.propertyId);
  const q = qs.toString();
  return apiRequest<EngForecastDemand[]>(`${API_BASE}/supply-procurement/forecast${q ? `?${q}` : ''}`);
};

export const fetchEngRequisitions = (filters?: { propertyId?: string; status?: string }) => {
  const qs = new URLSearchParams();
  if (filters?.propertyId) qs.set('propertyId', filters.propertyId);
  if (filters?.status) qs.set('status', filters.status);
  const q = qs.toString();
  return apiRequest<EngPurchaseRequisition[]>(`${API_BASE}/supply-procurement/requisitions${q ? `?${q}` : ''}`);
};

export const createEngRequisition = (data: {
  propertyId: string;
  supplierId?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  notes?: string;
  items: Array<{ itemName: string; category: string; quantity: number; unit: string; estimatedCost: number; requiredBy: string; reason: string; itemId?: string }>;
}) =>
  apiRequest<{ id: string; po_number: string; status: string }>(`${API_BASE}/supply-procurement/requisitions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const advanceEngPoStatus = (id: string, status: string) =>
  apiRequest<{ id: string; po_number: string; status: string }>(`${API_BASE}/supply-procurement/requisitions/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });

export const receiveEngPo = (id: string, lines?: Array<{ lineId: string; receivedQty: number }>) =>
  apiRequest<{ id: string; po_number: string; status: string; fullyReceived: boolean; transactionsLogged: number }>(
    `${API_BASE}/supply-procurement/requisitions/${id}/receive`,
    { method: 'POST', body: JSON.stringify({ lines: lines || undefined }) }
  );

export const fetchEngSuppliers = () =>
  apiRequest<EngSupplierRequirement[]>(`${API_BASE}/supply-procurement/suppliers`);

export const fetchEngProcurementStats = (filters?: { propertyId?: string }) => {
  const qs = new URLSearchParams();
  if (filters?.propertyId) qs.set('propertyId', filters.propertyId);
  const q = qs.toString();
  return apiRequest<EngProcurementStats>(`${API_BASE}/supply-procurement/stats${q ? `?${q}` : ''}`);
};

// ── Building Maintenance ────────────────────────────────────────────────
// Backs the /erp/maintenance/building-maintenance tab.

export type BuildingArea =
  | 'Guest Rooms' | 'Public Areas' | 'Roof' | 'Exterior' | 'Parking'
  | 'Landscaping' | 'Water Systems' | 'Electrical Systems' | 'Mechanical Systems';

export type BuildingTaskStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'On Hold' | 'Cancelled';
export type BuildingTaskPriority = 'Emergency' | 'High' | 'Normal' | 'Low';

export interface BuildingTask {
  id: string;
  property_id: string | null;
  bm_number: string;
  area: BuildingArea;
  location: string | null;
  task_type: string;
  description: string;
  priority: BuildingTaskPriority;
  status: BuildingTaskStatus;
  assigned_to: string | null;
  scheduled_date: string;
  estimated_cost: number | null;
  actual_cost: number | null;
  completion_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchBuildingTasks = (filters?: { propertyId?: string; status?: string; area?: string; priority?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.area) params.set('area', filters.area);
  if (filters?.priority) params.set('priority', filters.priority);
  const qs = params.toString();
  return apiRequest<BuildingTask[]>(`${API_BASE}/building-maintenance${qs ? `?${qs}` : ''}`);
};
export const createBuildingTask = (data: any) => apiRequest<BuildingTask>(`${API_BASE}/building-maintenance`, { method: 'POST', body: JSON.stringify(data) });
export const updateBuildingTask = (id: string, data: any) => apiRequest<{ success: boolean; task: BuildingTask }>(`${API_BASE}/building-maintenance/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteBuildingTask = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/building-maintenance/${id}`, { method: 'DELETE' });

// ── Energy Management ───────────────────────────────────────────────────
// Backs the /erp/maintenance/energy tab.

export type EfficiencyStatus = 'Optimal' | 'Warning' | 'Critical';
export type EnergyProjectType = 'LED Upgrade' | 'HVAC Optimization' | 'Solar Installation' | 'Insulation' | 'Variable Speed Drives';
export type EnergyProjectStatus = 'Planned' | 'In Progress' | 'Completed';

export interface EnergyMetric {
  id: string;
  property_id: string | null;
  metric_date: string;
  electricity_kwh: number;
  water_liters: number;
  gas_m3: number;
  diesel_liters: number;
  solar_kwh: number;
  total_cost: number;
  carbon_footprint_tons: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EquipmentEfficiency {
  id: string;
  property_id: string | null;
  equipment_name: string;
  category: string;
  current_efficiency: number;
  target_efficiency: number;
  status: EfficiencyStatus;
  last_measured: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnergyProject {
  id: string;
  property_id: string | null;
  ep_number: string;
  name: string;
  type: EnergyProjectType;
  status: EnergyProjectStatus;
  estimated_savings: number;
  actual_savings: number | null;
  investment: number;
  roi: number;
  completion_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Energy Metrics
export const fetchEnergyMetrics = (filters?: { propertyId?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiRequest<EnergyMetric[]>(`${API_BASE}/energy-metrics${qs ? `?${qs}` : ''}`);
};
export const createEnergyMetric = (data: any) => apiRequest<EnergyMetric>(`${API_BASE}/energy-metrics`, { method: 'POST', body: JSON.stringify(data) });
export const updateEnergyMetric = (id: string, data: any) => apiRequest<{ success: boolean; metric: EnergyMetric }>(`${API_BASE}/energy-metrics/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteEnergyMetric = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/energy-metrics/${id}`, { method: 'DELETE' });

// Equipment Efficiency
export const fetchEnergyEfficiency = (filters?: { propertyId?: string; status?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<EquipmentEfficiency[]>(`${API_BASE}/energy-efficiency${qs ? `?${qs}` : ''}`);
};
export const createEnergyEfficiency = (data: any) => apiRequest<EquipmentEfficiency>(`${API_BASE}/energy-efficiency`, { method: 'POST', body: JSON.stringify(data) });
export const updateEnergyEfficiency = (id: string, data: any) => apiRequest<{ success: boolean; efficiency: EquipmentEfficiency }>(`${API_BASE}/energy-efficiency/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteEnergyEfficiency = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/energy-efficiency/${id}`, { method: 'DELETE' });

// Energy Projects
export const fetchEnergyProjects = (filters?: { propertyId?: string; status?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<EnergyProject[]>(`${API_BASE}/energy-projects${qs ? `?${qs}` : ''}`);
};
export const createEnergyProject = (data: any) => apiRequest<EnergyProject>(`${API_BASE}/energy-projects`, { method: 'POST', body: JSON.stringify(data) });
export const updateEnergyProject = (id: string, data: any) => apiRequest<{ success: boolean; project: EnergyProject }>(`${API_BASE}/energy-projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteEnergyProject = (id: string) => apiRequest<{ success: boolean }>(`${API_BASE}/energy-projects/${id}`, { method: 'DELETE' });

// ── Work Requests ───────────────────────────────────────────────────────
// Backs the /erp/maintenance/work-requests tab.

export type WorkRequestStatus = 'Pending' | 'Reviewed' | 'Approved' | 'Rejected' | 'Converted to WO';
export type WorkRequestPriority = 'Emergency' | 'High' | 'Normal' | 'Low';

export interface WorkRequest {
  id: string;
  property_id: string | null;
  wr_number: string;
  request_date: string;
  source: string;
  source_type: string;
  location: string;
  room_number: string | null;
  priority: WorkRequestPriority;
  type: string;
  description: string;
  status: WorkRequestStatus;
  requested_by: string;
  attachments: number;
  converted_work_order_id: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  converted_at: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkRequestFilters {
  status?: string;
  source?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchWorkRequests = (filters?: WorkRequestFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.source && filters.source !== 'All') params.set('source', filters.source);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<WorkRequest[]>(`${API_BASE}/work-requests${qs ? `?${qs}` : ''}`);
};

export const createWorkRequest = (data: {
  propertyId?: string;
  source: string;
  sourceType?: string;
  location: string;
  roomNumber?: string;
  priority: WorkRequestPriority;
  type: string;
  description: string;
  requestedBy?: string;
  attachments?: number;
}) => apiRequest<WorkRequest>(`${API_BASE}/work-requests`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateWorkRequest = (id: string, data: {
  status?: WorkRequestStatus;
  reviewNotes?: string;
  rejectionReason?: string;
}) => apiRequest<{ success: boolean; workRequest: WorkRequest }>(`${API_BASE}/work-requests/${id}`, {
  method: 'PATCH',
  body: JSON.stringify(data),
});

export const convertWorkRequestToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; workRequest: WorkRequest; workOrder: any }>(
  `${API_BASE}/work-requests/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const deleteWorkRequest = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/work-requests/${id}`, { method: 'DELETE' });

// ── Corrective Maintenance ──────────────────────────────────────────────
// Backs the /erp/maintenance/corrective-maintenance tab.
// Flow: Reported → Diagnosed → In Progress → Parts Ordered → Completed → Verified.
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management console.

export type CorrectiveTaskStatus =
  | 'Reported' | 'Diagnosed' | 'In Progress' | 'Parts Ordered'
  | 'Completed' | 'Verified';
export type CorrectiveTaskPriority = 'Emergency' | 'High' | 'Normal' | 'Low';
export type CorrectiveCategory =
  | 'Reactive Repairs' | 'Emergency Repairs' | 'Guest Complaint Resolution'
  | 'Equipment Breakdown' | 'Infrastructure Repair' | 'Utility Failure Response';

export interface CorrectiveTask {
  id: string;
  property_id: string | null;
  cm_number: string;
  reported_date: string;
  type: string;
  category: CorrectiveCategory;
  location: string;
  room_number: string | null;
  priority: CorrectiveTaskPriority;
  description: string;
  status: CorrectiveTaskStatus;
  assigned_technician: string | null;
  estimated_cost: number;
  actual_cost: number;
  downtime: string | null;
  resolution: string | null;
  converted_work_order_id: string | null;
  diagnosed_at: string | null;
  in_progress_at: string | null;
  parts_ordered_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectiveTaskFilters {
  status?: string;
  category?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchCorrectiveTasks = (filters?: CorrectiveTaskFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<CorrectiveTask[]>(`${API_BASE}/corrective-maintenance${qs ? `?${qs}` : ''}`);
};

export const createCorrectiveTask = (data: {
  propertyId?: string;
  type: string;
  category: CorrectiveCategory;
  location: string;
  roomNumber?: string;
  priority: CorrectiveTaskPriority;
  description: string;
  assignedTechnician?: string;
  estimatedCost?: number;
  downtime?: string;
}) => apiRequest<CorrectiveTask>(`${API_BASE}/corrective-maintenance`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateCorrectiveTask = (id: string, data: {
  status?: CorrectiveTaskStatus;
  assignedTechnician?: string | null;
  estimatedCost?: number;
  actualCost?: number;
  downtime?: string | null;
  resolution?: string | null;
}) => apiRequest<{ success: boolean; task: CorrectiveTask }>(
  `${API_BASE}/corrective-maintenance/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const convertCorrectiveToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; task: CorrectiveTask; workOrder: any }>(
  `${API_BASE}/corrective-maintenance/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const deleteCorrectiveTask = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/corrective-maintenance/${id}`, { method: 'DELETE' });

// ── Inspections ─────────────────────────────────────────────────────────
// Backs the /erp/maintenance/inspections tab (Inspections.tsx).
// Flow: Scheduled → In Progress → (Completed | Failed).
// Overdue is auto-derived server-side (Scheduled + scheduled_date passed).
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console. Typically used when an inspection Fails.

export type InspectionType =
  | 'Fire Safety' | 'Elevator' | 'Boiler' | 'Electrical'
  | 'Water System' | 'HVAC' | 'Structural' | 'Environmental';
export type InspectionCategory =
  | 'Compliance' | 'Safety' | 'Preventive' | 'Regulatory' | 'Insurance';
export type InspectionStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Failed' | 'Overdue';
export type InspectionPriority = 'Critical' | 'High' | 'Normal' | 'Low';

export interface Inspection {
  id: string;
  property_id: string | null;
  ins_number: string;
  type: InspectionType;
  category: InspectionCategory;
  location: string;
  room_number: string | null;
  description: string;
  status: InspectionStatus;
  priority: InspectionPriority;
  scheduled_date: string;
  completed_date: string | null;
  inspector: string | null;
  findings: string | null;
  next_due_date: string | null;
  converted_work_order_id: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionFilters {
  status?: string;
  type?: string;
  category?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchInspections = (filters?: InspectionFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.type && filters.type !== 'All') params.set('type', filters.type);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<Inspection[]>(`${API_BASE}/inspections${qs ? `?${qs}` : ''}`);
};

export const createInspection = (data: {
  propertyId?: string;
  type: InspectionType;
  category: InspectionCategory;
  location: string;
  roomNumber?: string;
  description: string;
  priority?: InspectionPriority;
  scheduledDate: string;
  inspector?: string;
  nextDueDate?: string;
}) => apiRequest<Inspection>(`${API_BASE}/inspections`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateInspection = (id: string, data: {
  status?: InspectionStatus;
  inspector?: string | null;
  findings?: string | null;
  nextDueDate?: string | null;
  completedDate?: string | null;
}) => apiRequest<{ success: boolean; inspection: Inspection }>(
  `${API_BASE}/inspections/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const convertInspectionToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; inspection: Inspection; workOrder: any }>(
  `${API_BASE}/inspections/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const deleteInspection = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/inspections/${id}`, { method: 'DELETE' });

// ── Calibrations ─────────────────────────────────────────────────────────
// Backs the /erp/maintenance/calibration tab (CalibrationManagement.tsx).
// Flow: Scheduled → In Progress → (Completed | Failed).
// Overdue is auto-derived server-side (Scheduled + scheduled_date passed).
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console. Typically used when a calibration Fails.

export type CalibrationInstrumentType =
  | 'Temperature Sensor' | 'Pressure Gauge' | 'Flow Meter'
  | 'Electrical Meter' | 'Scale' | 'Thermostat' | 'Controller';
export type CalibrationStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Failed' | 'Overdue';
export type CalibrationPriority = 'Critical' | 'High' | 'Normal' | 'Low';

export interface Calibration {
  id: string;
  property_id: string | null;
  cal_number: string;
  equipment_id: string | null;
  equipment_name: string;
  instrument_type: CalibrationInstrumentType;
  location: string;
  room_number: string | null;
  description: string;
  status: CalibrationStatus;
  priority: CalibrationPriority;
  scheduled_date: string;
  completed_date: string | null;
  calibrated_by: string | null;
  previous_reading: string | null;
  current_reading: string | null;
  tolerance: string | null;
  deviation: string | null;
  next_due_date: string | null;
  converted_work_order_id: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalibrationFilters {
  status?: string;
  instrumentType?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchCalibrations = (filters?: CalibrationFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.instrumentType && filters.instrumentType !== 'All') params.set('instrumentType', filters.instrumentType);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<Calibration[]>(`${API_BASE}/calibrations${qs ? `?${qs}` : ''}`);
};

export const createCalibration = (data: {
  propertyId?: string;
  equipmentId?: string;
  equipmentName: string;
  instrumentType: CalibrationInstrumentType;
  location: string;
  roomNumber?: string;
  description: string;
  priority?: CalibrationPriority;
  scheduledDate: string;
  calibratedBy?: string;
  nextDueDate?: string;
}) => apiRequest<Calibration>(`${API_BASE}/calibrations`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateCalibration = (id: string, data: {
  status?: CalibrationStatus;
  calibratedBy?: string | null;
  previousReading?: string | null;
  currentReading?: string | null;
  tolerance?: string | null;
  deviation?: string | null;
  nextDueDate?: string | null;
  completedDate?: string | null;
}) => apiRequest<{ success: boolean; calibration: Calibration }>(
  `${API_BASE}/calibrations/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const convertCalibrationToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; calibration: Calibration; workOrder: any }>(
  `${API_BASE}/calibrations/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const deleteCalibration = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/calibrations/${id}`, { method: 'DELETE' });

// ── Projects & Renovations ───────────────────────────────────────────────
// Backs the /erp/maintenance/projects-renovations tab (ProjectsRenovations.tsx).
// Flow: Planning → Approved → In Progress → (Completed | On Hold | Cancelled).
// Each project has an optional set of phases (eng_project_phases) for
// granular stage tracking. Phases are nested in the GET response.

export type ProjectType = 'Renovation' | 'Upgrade' | 'New Construction' | 'Refurbishment' | 'Expansion';
export type ProjectCategory =
  | 'Guest Rooms' | 'Public Areas' | 'Kitchen'
  | 'Exterior' | 'Infrastructure' | 'Energy Efficiency';
export type ProjectStatus = 'Planning' | 'Approved' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';
export type ProjectPriority = 'Critical' | 'High' | 'Normal' | 'Low';
export type ProjectPhaseStatus = 'Pending' | 'In Progress' | 'Completed' | 'On Hold';

export interface ProjectPhase {
  id: string;
  project_id: string;
  name: string;
  status: ProjectPhaseStatus;
  completed_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  property_id: string | null;
  prj_number: string;
  name: string;
  type: ProjectType;
  category: ProjectCategory;
  location: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  start_date: string | null;
  target_completion_date: string | null;
  actual_completion_date: string | null;
  project_manager: string | null;
  budget: number;
  spent: number;
  progress: number;
  approved_at: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  on_hold_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  phases?: ProjectPhase[];
}

export interface ProjectFilters {
  status?: string;
  type?: string;
  category?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchProjects = (filters?: ProjectFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.type && filters.type !== 'All') params.set('type', filters.type);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<Project[]>(`${API_BASE}/projects${qs ? `?${qs}` : ''}`);
};

export const fetchProject = (id: string) =>
  apiRequest<Project>(`${API_BASE}/projects/${id}`);

export const createProject = (data: {
  propertyId?: string;
  name: string;
  type: ProjectType;
  category: ProjectCategory;
  location: string;
  description: string;
  priority?: ProjectPriority;
  startDate?: string;
  targetCompletionDate?: string;
  projectManager?: string;
  budget?: number;
  spent?: number;
  progress?: number;
  phases?: Array<{ name: string; status?: ProjectPhaseStatus; completedDate?: string }>;
}) => apiRequest<Project>(`${API_BASE}/projects`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateProject = (id: string, data: {
  status?: ProjectStatus;
  name?: string;
  type?: ProjectType;
  category?: ProjectCategory;
  location?: string;
  description?: string;
  priority?: ProjectPriority;
  startDate?: string | null;
  targetCompletionDate?: string | null;
  actualCompletionDate?: string | null;
  projectManager?: string | null;
  budget?: number;
  spent?: number;
  progress?: number;
}) => apiRequest<{ success: boolean; project: Project }>(
  `${API_BASE}/projects/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteProject = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/projects/${id}`, { method: 'DELETE' });

// ── Project Phases (child CRUD) ──────────────────────────────────────────

export const addProjectPhase = (projectId: string, data: {
  name: string;
  status?: ProjectPhaseStatus;
  completedDate?: string;
  sortOrder?: number;
}) => apiRequest<ProjectPhase>(`${API_BASE}/projects/${projectId}/phases`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateProjectPhase = (projectId: string, phaseId: string, data: {
  name?: string;
  status?: ProjectPhaseStatus;
  completedDate?: string | null;
  sortOrder?: number;
}) => apiRequest<{ success: boolean; phase: ProjectPhase }>(
  `${API_BASE}/projects/${projectId}/phases/${phaseId}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteProjectPhase = (projectId: string, phaseId: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/projects/${projectId}/phases/${phaseId}`, { method: 'DELETE' });

// ── Communication Center ─────────────────────────────────────────────────
// Backs the /erp/maintenance/communication tab (CommunicationCenter.tsx).
// Two resources:
//   1. Messages — announcements/alerts/requests/updates/reminders.
//      Flow: Sent → Read → Archived.
//   2. Notifications — sidebar notifications with a read flag.

export type CommunicationMessageType =
  | 'Announcement' | 'Alert' | 'Request' | 'Update' | 'Reminder';
export type CommunicationCategory =
  | 'General' | 'Safety' | 'Maintenance' | 'Emergency' | 'Compliance';
export type CommunicationMessageStatus = 'Sent' | 'Read' | 'Archived';
export type CommunicationPriority = 'Critical' | 'High' | 'Normal' | 'Low';
export type CommunicationNotificationType =
  | 'System' | 'Work Order' | 'Alert' | 'Request';

export interface CommunicationMessage {
  id: string;
  property_id: string | null;
  msg_number: string;
  type: CommunicationMessageType;
  category: CommunicationCategory;
  title: string;
  content: string;
  sender: string;
  sender_role: string | null;
  recipients: string[];
  status: CommunicationMessageStatus;
  priority: CommunicationPriority;
  attachments: number;
  read_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationMessageFilters {
  type?: string;
  status?: string;
  priority?: string;
  category?: string;
  propertyId?: string;
}

export interface CommunicationNotification {
  id: string;
  property_id: string | null;
  type: CommunicationNotificationType;
  title: string;
  message: string;
  read: boolean;
  action_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationNotificationFilters {
  propertyId?: string;
  read?: boolean;
}

export const fetchCommunicationMessages = (filters?: CommunicationMessageFilters) => {
  const params = new URLSearchParams();
  if (filters?.type && filters.type !== 'All') params.set('type', filters.type);
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<CommunicationMessage[]>(`${API_BASE}/communication/messages${qs ? `?${qs}` : ''}`);
};

export const fetchCommunicationMessage = (id: string) =>
  apiRequest<CommunicationMessage>(`${API_BASE}/communication/messages/${id}`);

export const createCommunicationMessage = (data: {
  propertyId?: string;
  type: CommunicationMessageType;
  category: CommunicationCategory;
  title: string;
  content: string;
  sender: string;
  senderRole?: string;
  recipients?: string[];
  priority?: CommunicationPriority;
  attachments?: number;
}) => apiRequest<CommunicationMessage>(`${API_BASE}/communication/messages`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateCommunicationMessage = (id: string, data: {
  status?: CommunicationMessageStatus;
  title?: string;
  content?: string;
  priority?: CommunicationPriority;
  category?: CommunicationCategory;
  type?: CommunicationMessageType;
  sender?: string;
  senderRole?: string;
  recipients?: string[];
  attachments?: number;
}) => apiRequest<{ success: boolean; message: CommunicationMessage }>(
  `${API_BASE}/communication/messages/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteCommunicationMessage = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/communication/messages/${id}`, { method: 'DELETE' });

export const fetchCommunicationNotifications = (filters?: CommunicationNotificationFilters) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (typeof filters?.read === 'boolean') params.set('read', String(filters.read));
  const qs = params.toString();
  return apiRequest<CommunicationNotification[]>(`${API_BASE}/communication/notifications${qs ? `?${qs}` : ''}`);
};

export const createCommunicationNotification = (data: {
  propertyId?: string;
  type: CommunicationNotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}) => apiRequest<CommunicationNotification>(`${API_BASE}/communication/notifications`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateCommunicationNotification = (id: string, data: {
  read?: boolean;
  title?: string;
  message?: string;
  actionUrl?: string;
}) => apiRequest<{ success: boolean; notification: CommunicationNotification }>(
  `${API_BASE}/communication/notifications/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteCommunicationNotification = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/communication/notifications/${id}`, { method: 'DELETE' });

// ── Configuration ────────────────────────────────────────────────────────
// Backs the /erp/maintenance/configuration tab (Configuration.tsx).
// JSON-blob config per property per section, mirroring the HK
// hk_config pattern. Sections: general, departments, staff, work_orders,
// preventive_maintenance, alerts, safety, locations, utilities.

export type EngConfigSection =
  | 'work_orders' | 'preventive_maintenance' | 'alerts' | 'safety';

export const ENG_CONFIG_SECTIONS: EngConfigSection[] = [
  'work_orders', 'preventive_maintenance', 'alerts', 'safety',
];

export const fetchEngConfig = (propertyId: string, section: EngConfigSection) =>
  apiRequest<Record<string, any>>(`${API_BASE}/config/${propertyId}/${section}`);

export const saveEngConfig = (propertyId: string, section: EngConfigSection, data: Record<string, any>) =>
  apiRequest<Record<string, any>>(`${API_BASE}/config/${propertyId}/${section}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

// ── Room Maintenance ─────────────────────────────────────────────────────
// Backs the /erp/maintenance/rooms tab (RoomMaintenanceModule.tsx).
// Two resources:
//   1. /room-issues — eng_room_issues table (room-specific fault tracking).
//      Flow: Open → In Progress → Resolved. `blocksRoom` takes the room
//      out of inventory (rooms.status → 'Out of Order'); resolving restores
//      the room to 'Vacant Clean', syncing with Front Office & Housekeeping.
//   2. /rooms — read-only room list (with active issue counts) + status update.

export type RoomIssueCategory =
  | 'Plumbing' | 'HVAC' | 'Electrical' | 'Security' | 'Furniture'
  | 'Lock' | 'TV' | 'Internet' | 'Lighting' | 'Other';
export type RoomIssueStatus = 'Open' | 'In Progress' | 'Resolved';
export type RoomIssuePriority = 'Emergency' | 'High' | 'Normal' | 'Low';

export interface RoomIssue {
  id: string;
  property_id: string | null;
  ri_number: string;
  room_number: string;
  category: RoomIssueCategory;
  description: string;
  status: RoomIssueStatus;
  priority: RoomIssuePriority;
  blocks_room: boolean;
  reported_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  notes: string | null;
  converted_work_order_id: string | null;
  converted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomIssueFilters {
  status?: string;
  category?: string;
  priority?: string;
  roomNumber?: string;
  propertyId?: string;
}

export interface EngRoom {
  id: string;
  number: string;
  type: string | null;
  floor: number | null;
  status: string;
  rate: number | null;
  room_type_id: string | null;
  property_id: string | null;
  activeIssueCount: number;
  hasBlockingIssue: boolean;
}

export const fetchRoomIssues = (filters?: RoomIssueFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.roomNumber) params.set('roomNumber', filters.roomNumber);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<RoomIssue[]>(`${API_BASE}/room-issues${qs ? `?${qs}` : ''}`);
};

export const createRoomIssue = (data: {
  propertyId?: string;
  roomNumber: string;
  category: RoomIssueCategory;
  description: string;
  priority?: RoomIssuePriority;
  blocksRoom?: boolean;
  reportedBy?: string;
  assignedTo?: string;
  notes?: string;
}) => apiRequest<RoomIssue>(`${API_BASE}/room-issues`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateRoomIssue = (id: string, data: {
  status?: RoomIssueStatus;
  category?: RoomIssueCategory;
  description?: string;
  priority?: RoomIssuePriority;
  blocksRoom?: boolean;
  reportedBy?: string;
  assignedTo?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; issue: RoomIssue }>(
  `${API_BASE}/room-issues/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteRoomIssue = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/room-issues/${id}`, { method: 'DELETE' });

export const convertRoomIssueToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; issue: RoomIssue; workOrder: any }>(
  `${API_BASE}/room-issues/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const fetchEngRooms = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<EngRoom[]>(`${API_BASE}/rooms${qs ? `?${qs}` : ''}`);
};

export const updateEngRoomStatus = (roomNumberOrId: string, status: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/rooms/${roomNumberOrId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ── Utilities & Plant ────────────────────────────────────────────────────
// Backs the /erp/maintenance/utilities tab (UtilitiesManagement.tsx).
// Four resources:
//   1. /utility-readings — eng_utility_readings (periodic meter readings)
//   2. /generators       — eng_generators (backup power assets + live stats)
//   3. /generator-events — eng_generator_events (event log per generator)
//   4. /utility-alerts   — eng_utility_alerts (abnormal usage / leak alerts)

export type UtilityType = 'electricity' | 'water' | 'fuel';
export type GeneratorStatus = 'Running' | 'Standby' | 'Maintenance' | 'Offline';
export type GeneratorEventType =
  | 'Cold Start' | 'Load Test' | 'Refuel' | 'Service'
  | 'Manual Start' | 'Emergency Stop' | 'Alert' | 'Other';
export type UtilityAlertType = 'Flow' | 'Voltage' | 'Draw' | 'Leak' | 'Temperature' | 'Other';
export type UtilityAlertSeverity = 'Info' | 'Warning' | 'Critical';
export type UtilityAlertStatus = 'Active' | 'Resolved';

export interface UtilityReading {
  id: string;
  property_id: string | null;
  reading_date: string;
  utility_type: UtilityType;
  value: number;
  unit: string;
  reading_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Generator {
  id: string;
  property_id: string | null;
  name: string;
  code: string | null;
  status: GeneratorStatus;
  running_hours: number;
  fuel_level_pct: number;
  battery_health_pct: number;
  last_service_date: string | null;
  next_service_date: string | null;
  output_kva: number | null;
  engine_type: string | null;
  control_unit: string | null;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratorEvent {
  id: string;
  property_id: string | null;
  generator_id: string | null;
  event_type: GeneratorEventType;
  event_time: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UtilityAlert {
  id: string;
  property_id: string | null;
  alert_type: UtilityAlertType;
  severity: UtilityAlertSeverity;
  sector: string | null;
  description: string;
  status: UtilityAlertStatus;
  detected_at: string;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Utility Readings ─────────────────────────────────────────────────────
export const fetchUtilityReadings = (filters?: { utilityType?: string; propertyId?: string; days?: number }) => {
  const params = new URLSearchParams();
  if (filters?.utilityType) params.set('utilityType', filters.utilityType);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.days) params.set('days', String(filters.days));
  const qs = params.toString();
  return apiRequest<UtilityReading[]>(`${API_BASE}/utility-readings${qs ? `?${qs}` : ''}`);
};

export const createUtilityReading = (data: {
  propertyId?: string; readingDate: string; utilityType: UtilityType;
  value: number; unit?: string; readingBy?: string; notes?: string;
}) => apiRequest<UtilityReading>(`${API_BASE}/utility-readings`, {
  method: 'POST', body: JSON.stringify(data),
});

export const deleteUtilityReading = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/utility-readings/${id}`, { method: 'DELETE' });

// ── Generators ───────────────────────────────────────────────────────────
export const fetchGenerators = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<Generator[]>(`${API_BASE}/generators${qs ? `?${qs}` : ''}`);
};

export const createGenerator = (data: {
  propertyId?: string; name: string; code?: string; status?: GeneratorStatus;
  runningHours?: number; fuelLevelPct?: number; batteryHealthPct?: number;
  lastServiceDate?: string; nextServiceDate?: string; outputKva?: number;
  engineType?: string; controlUnit?: string; location?: string; notes?: string;
}) => apiRequest<Generator>(`${API_BASE}/generators`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateGenerator = (id: string, data: {
  status?: GeneratorStatus; runningHours?: number; fuelLevelPct?: number;
  batteryHealthPct?: number; lastServiceDate?: string | null;
  nextServiceDate?: string | null; name?: string; code?: string | null;
  outputKva?: number | null; engineType?: string | null; controlUnit?: string | null;
  location?: string | null; notes?: string | null;
}) => apiRequest<{ success: boolean; generator: Generator }>(
  `${API_BASE}/generators/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteGenerator = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/generators/${id}`, { method: 'DELETE' });

// ── Generator Events ─────────────────────────────────────────────────────
export const fetchGeneratorEvents = (filters?: { generatorId?: string; propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.generatorId) params.set('generatorId', filters.generatorId);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<GeneratorEvent[]>(`${API_BASE}/generator-events${qs ? `?${qs}` : ''}`);
};

export const createGeneratorEvent = (data: {
  propertyId?: string; generatorId?: string; eventType: GeneratorEventType;
  eventTime?: string; description?: string;
}) => apiRequest<GeneratorEvent>(`${API_BASE}/generator-events`, {
  method: 'POST', body: JSON.stringify(data),
});

export const deleteGeneratorEvent = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/generator-events/${id}`, { method: 'DELETE' });

// ── Utility Alerts ───────────────────────────────────────────────────────
export const fetchUtilityAlerts = (filters?: { status?: string; propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<UtilityAlert[]>(`${API_BASE}/utility-alerts${qs ? `?${qs}` : ''}`);
};

export const createUtilityAlert = (data: {
  propertyId?: string; alertType: UtilityAlertType; severity?: UtilityAlertSeverity;
  sector?: string; description: string;
}) => apiRequest<UtilityAlert>(`${API_BASE}/utility-alerts`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateUtilityAlert = (id: string, data: {
  status?: UtilityAlertStatus; severity?: UtilityAlertSeverity; description?: string;
}) => apiRequest<{ success: boolean; alert: UtilityAlert }>(
  `${API_BASE}/utility-alerts/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteUtilityAlert = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/utility-alerts/${id}`, { method: 'DELETE' });

// ── Technicians & Staff Management ───────────────────────────────────────
// Backs the /erp/maintenance/staff tab (StaffManagement.tsx).
// Mimics the HK Staff Management pattern, adapted for engineering roles.
// Five resources: technicians, shifts, staffing, training, productivity.

export type TechRole =
  | 'Electrician' | 'Plumber' | 'HVAC Technician' | 'General Technician'
  | 'Supervisor' | 'Locksmith' | 'AV / IT Technician' | 'External Contractor';
export type TechShift = 'Morning' | 'Evening' | 'Night';
export type TechStatus = 'Available' | 'On Task' | 'Off Duty' | 'Emergency';
export type TrainingStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Overdue';

export interface Technician {
  id: string;
  property_id: string | null;
  name: string;
  avatar: string | null;
  role: TechRole;
  shift: TechShift;
  status: TechStatus;
  is_active: boolean;
  zone: string | null;
  jobs_completed: number;
  avg_response_min: number;
  workload: number;
  skills: string[] | null;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  hire_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // HR integration — populated when employee_id is linked
  hrEmail?: string | null;
  hrPhone?: string | null;
  hrHireDate?: string | null;
  hrSalary?: number | null;
  hrDepartment?: string | null;
  hrPosition?: string | null;
}

export interface AvailableEmployee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  hire_date: string | null;
  salary: number | null;
  department: string | null;
}

export interface TechShiftReq {
  id: string;
  property_id: string | null;
  name: string;
  shift: TechShift;
  start_time: string;
  end_time: string;
  assigned_staff: number;
  required_staff: number;
}

export interface TechStaffingReq {
  id: string;
  property_id: string | null;
  role: string;
  zone: string | null;
  shift: TechShift;
  required_count: number;
  assigned_count: number;
}

export interface TechTraining {
  id: string;
  property_id: string | null;
  technician_id: string | null;
  course: string;
  due_date: string | null;
  status: TrainingStatus;
  created_at: string;
}

export interface TechProductivity {
  id: string;
  property_id: string | null;
  technician_id: string | null;
  jobs_completed: number;
  hours: number;
  avg_response_min: number;
  productivity_score: number;
  period_date: string | null;
  created_at: string;
}

// ── Technicians ──────────────────────────────────────────────────────────
export const fetchTechnicians = (filters?: { propertyId?: string; role?: string; shift?: string; status?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.role) params.set('role', filters.role);
  if (filters?.shift) params.set('shift', filters.shift);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return apiRequest<Technician[]>(`${API_BASE}/technicians${qs ? `?${qs}` : ''}`);
};

// HR integration — list unlinked Engineering employees for the Link dropdown.
export const fetchAvailableEmployees = (propertyId?: string) => {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  const qs = params.toString();
  return apiRequest<{ employees: AvailableEmployee[] }>(
    `${API_BASE}/technicians/available-employees${qs ? `?${qs}` : ''}`,
  );
};

export const createTechnician = (data: {
  propertyId?: string; name: string; role?: TechRole; shift?: TechShift;
  status?: TechStatus; zone?: string; jobsCompleted?: number; avgResponseMin?: number;
  workload?: number; skills?: string[]; phone?: string; email?: string; hireDate?: string;
  // HR integration
  employeeId?: string; salary?: number;
}) => apiRequest<Technician>(`${API_BASE}/technicians`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechnician = (id: string, data: {
  name?: string; role?: TechRole; shift?: TechShift; status?: TechStatus;
  zone?: string | null; jobsCompleted?: number; avgResponseMin?: number;
  workload?: number; skills?: string[] | null; phone?: string | null;
  email?: string | null; isActive?: boolean;
  // HR integration
  employeeId?: string | null;
}) => apiRequest<{ success: boolean; technician: Technician }>(
  `${API_BASE}/technicians/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechnician = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/${id}`, { method: 'DELETE' });

// ── Shifts ───────────────────────────────────────────────────────────────
export const fetchTechShifts = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<TechShiftReq[]>(`${API_BASE}/technicians/shifts${qs ? `?${qs}` : ''}`);
};

export const createTechShift = (data: {
  propertyId?: string; name: string; shift: TechShift; startTime: string;
  endTime: string; assignedStaff?: number; requiredStaff?: number;
}) => apiRequest<TechShiftReq>(`${API_BASE}/technicians/shifts`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechShift = (id: string, data: {
  name?: string; shift?: TechShift; startTime?: string; endTime?: string;
  assignedStaff?: number; requiredStaff?: number;
}) => apiRequest<{ success: boolean; shift: TechShiftReq }>(
  `${API_BASE}/technicians/shifts/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechShift = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/shifts/${id}`, { method: 'DELETE' });

// ── Staffing ─────────────────────────────────────────────────────────────
export const fetchTechStaffing = (filters?: { propertyId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<TechStaffingReq[]>(`${API_BASE}/technicians/staffing${qs ? `?${qs}` : ''}`);
};

export const createTechStaffing = (data: {
  propertyId?: string; role: string; zone?: string; shift: TechShift;
  requiredCount?: number; assignedCount?: number;
}) => apiRequest<TechStaffingReq>(`${API_BASE}/technicians/staffing`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechStaffing = (id: string, data: {
  role?: string; zone?: string | null; shift?: TechShift;
  requiredCount?: number; assignedCount?: number;
}) => apiRequest<{ success: boolean; staffing: TechStaffingReq }>(
  `${API_BASE}/technicians/staffing/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechStaffing = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/staffing/${id}`, { method: 'DELETE' });

// ── Training ─────────────────────────────────────────────────────────────
export const fetchTechTraining = (filters?: { propertyId?: string; technicianId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.technicianId) params.set('technicianId', filters.technicianId);
  const qs = params.toString();
  return apiRequest<TechTraining[]>(`${API_BASE}/technicians/training${qs ? `?${qs}` : ''}`);
};

export const createTechTraining = (data: {
  propertyId?: string; technicianId?: string; course: string;
  dueDate?: string; status?: TrainingStatus;
}) => apiRequest<TechTraining>(`${API_BASE}/technicians/training`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechTraining = (id: string, data: {
  course?: string; dueDate?: string | null; status?: TrainingStatus; technicianId?: string | null;
}) => apiRequest<{ success: boolean; training: TechTraining }>(
  `${API_BASE}/technicians/training/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechTraining = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/training/${id}`, { method: 'DELETE' });

// ── Productivity ─────────────────────────────────────────────────────────
export const fetchTechProductivity = (filters?: { propertyId?: string; technicianId?: string }) => {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  if (filters?.technicianId) params.set('technicianId', filters.technicianId);
  const qs = params.toString();
  return apiRequest<TechProductivity[]>(`${API_BASE}/technicians/productivity${qs ? `?${qs}` : ''}`);
};

export const createTechProductivity = (data: {
  propertyId?: string; technicianId?: string; jobsCompleted?: number;
  hours?: number; avgResponseMin?: number; productivityScore?: number; periodDate?: string;
}) => apiRequest<TechProductivity>(`${API_BASE}/technicians/productivity`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechProductivity = (id: string, data: {
  jobsCompleted?: number; hours?: number; avgResponseMin?: number;
  productivityScore?: number; periodDate?: string | null;
}) => apiRequest<{ success: boolean; productivity: TechProductivity }>(
  `${API_BASE}/technicians/productivity/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechProductivity = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/productivity/${id}`, { method: 'DELETE' });

// ── Technician Attendance ────────────────────────────────────────────────
// Uses the shared staff_attendance table with department_scope='ENG'.
// Mimics the HK attendance pattern (StaffManagementModule.tsx).

export type AttendanceStatus =
  | 'Present' | 'Late' | 'Absent' | 'On Leave' | 'Sick' | 'Half Day'
  | 'Day Off' | 'Public Holiday' | 'Work From Home' | 'Mission' | 'Training Day';

export interface TechAttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  departmentScope: string;
  employeeId: string | null;
  attendanceDate: string;
  shift: TechShift;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
  hoursWorked: number;
  overtimeHours: number;
  notes: string | null;
}

export interface TechAttendanceSummary {
  staffId: string;
  staffName: string;
  employeeId: string | null;
  records: TechAttendanceRecord[];
  present: number; late: number; absent: number; onLeave: number; sick: number;
  halfDay: number; dayOff: number; publicHoliday: number; workFromHome: number;
  mission: number; trainingDay: number;
  totalHours: number; totalOvertime: number; totalDays: number;
  attendanceRate: number;
}

export interface TechAttendanceSummaryResponse {
  propertyId: string;
  summary: TechAttendanceSummary[];
  totals: {
    staffCount: number;
    totalHours: number;
    totalOvertime: number;
    avgAttendanceRate: number;
  };
}

export interface TechAttendanceListResponse {
  propertyId: string;
  attendance: TechAttendanceRecord[];
  summary: {
    total: number;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    totalHours: number;
    totalOvertime: number;
  };
}

export const fetchTechAttendanceSummary = (propertyId: string) =>
  apiRequest<TechAttendanceSummaryResponse>(
    `${API_BASE}/technicians/attendance/summary?propertyId=${encodeURIComponent(propertyId)}`,
  );

export const fetchTechAttendance = (propertyId: string, date?: string) => {
  const params = new URLSearchParams({ propertyId });
  if (date) params.set('date', date);
  return apiRequest<TechAttendanceListResponse>(
    `${API_BASE}/technicians/attendance?${params.toString()}`,
  );
};

export const checkInTechAttendance = (data: {
  propertyId: string; staffId: string; staffName: string;
  shift?: TechShift; status?: AttendanceStatus; checkIn?: string;
  notes?: string; attendanceDate?: string;
}) => apiRequest<TechAttendanceRecord>(`${API_BASE}/technicians/attendance`, {
  method: 'POST', body: JSON.stringify(data),
});

export const updateTechAttendance = (id: string, data: {
  status?: AttendanceStatus; checkIn?: string; checkOut?: string;
  hoursWorked?: number; overtimeHours?: number; shift?: TechShift; notes?: string;
}) => apiRequest<{ success: boolean; attendance: TechAttendanceRecord }>(
  `${API_BASE}/technicians/attendance/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const deleteTechAttendance = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/technicians/attendance/${id}`, { method: 'DELETE' });

// ── Safety & Regulatory Compliance ───────────────────────────────────────
// Backs the /erp/maintenance/compliance tab (ComplianceModule.tsx).
// Flow: Scheduled → In Progress → Valid → (Overdue | Expired | Failed).
// Overdue is auto-derived server-side (Valid/Scheduled + expiry_date passed).
// "Convert to Work Order" creates a real work_orders row linked via
// converted_work_order_id, integrating with the Work Order Management
// console. Typically used when an item Fails or goes Overdue.

export type ComplianceCategory =
  | 'Fire Safety' | 'Electrical' | 'Elevator' | 'Water' | 'Gas'
  | 'Structural' | 'Mechanical' | 'Environmental' | 'General' | 'Other';
export type ComplianceType =
  | 'Certification' | 'Inspection' | 'Testing' | 'Audit' | 'License' | 'Permit';
export type ComplianceStatus =
  | 'Valid' | 'Scheduled' | 'In Progress' | 'Overdue' | 'Expired' | 'Failed';
export type CompliancePriority = 'Critical' | 'High' | 'Normal' | 'Low';

export interface ComplianceItem {
  id: string;
  property_id: string | null;
  comp_number: string;
  title: string;
  category: ComplianceCategory;
  type: ComplianceType;
  authority: string;
  status: ComplianceStatus;
  priority: CompliancePriority;
  certificate_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  last_inspected_date: string | null;
  next_inspection_date: string | null;
  responsible_person: string | null;
  result: string | null;
  notes: string | null;
  attachments: any[];
  converted_work_order_id: string | null;
  in_progress_at: string | null;
  verified_at: string | null;
  failed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceFilters {
  status?: string;
  category?: string;
  type?: string;
  priority?: string;
  propertyId?: string;
}

export const fetchComplianceItems = (filters?: ComplianceFilters) => {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  if (filters?.category && filters.category !== 'All') params.set('category', filters.category);
  if (filters?.type && filters.type !== 'All') params.set('type', filters.type);
  if (filters?.priority && filters.priority !== 'All') params.set('priority', filters.priority);
  if (filters?.propertyId) params.set('propertyId', filters.propertyId);
  const qs = params.toString();
  return apiRequest<ComplianceItem[]>(`${API_BASE}/compliance${qs ? `?${qs}` : ''}`);
};

export const createComplianceItem = (data: {
  propertyId?: string;
  title: string;
  category: ComplianceCategory;
  type: ComplianceType;
  authority: string;
  priority?: CompliancePriority;
  certificateNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  nextInspectionDate?: string;
  responsiblePerson?: string;
  notes?: string;
}) => apiRequest<ComplianceItem>(`${API_BASE}/compliance`, {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateComplianceItem = (id: string, data: {
  status?: ComplianceStatus;
  priority?: CompliancePriority;
  certificateNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  lastInspectedDate?: string | null;
  nextInspectionDate?: string | null;
  responsiblePerson?: string | null;
  result?: string | null;
  notes?: string | null;
}) => apiRequest<{ success: boolean; item: ComplianceItem }>(
  `${API_BASE}/compliance/${id}`,
  { method: 'PATCH', body: JSON.stringify(data) },
);

export const convertComplianceToWO = (id: string, data: {
  assignedTo?: string;
  scheduledDate?: string;
  notes?: string;
}) => apiRequest<{ success: boolean; item: ComplianceItem; workOrder: any }>(
  `${API_BASE}/compliance/${id}/convert-to-wo`,
  { method: 'POST', body: JSON.stringify(data) },
);

export const deleteComplianceItem = (id: string) =>
  apiRequest<{ success: boolean }>(`${API_BASE}/compliance/${id}`, { method: 'DELETE' });
