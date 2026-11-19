const API_BASE = '/api/proc-portal';

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

// ── Types ──────────────────────────────────────────────────────────────────

// Dashboard
export interface DashboardKPIs {
  openRequisitions: number;
  pendingApprovals: number;
  openRFQs: number;
  openPOs: number;
  overduePOs: number;
  pendingDeliveries: number;
  totalSpend: number;
  monthlySpend: number;
  annualSpend: number;
  procurementSavings: number;
  activeSuppliers: number;
  activeAlerts: number;
  budgetUtilization: number;
  supplierPerformance: number;
  contractExpiry: number;
  supplierRisk: number;
  // Department integration KPIs
  departmentRequisitions: number;
  departmentForecasts: number;
  totalForecasts: number;
  engineeringRequisitions: number;
  housekeepingRequisitions: number;
  foodBeverageRequisitions: number;
}

export interface ProcurementAlert {
  id: string;
  property_id: string | null;
  alert_type: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  title: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  action_required: boolean;
  is_resolved: boolean;
  created_at: string;
}

// Requisitions
export type RequisitionStatus =
  | 'Draft' | 'Submitted' | 'Under Review' | 'Approved'
  | 'Sourcing' | 'Converted to PO' | 'Partially Fulfilled'
  | 'Fully Fulfilled' | 'Closed' | 'Rejected' | 'Returned'
  | 'Cancelled' | 'On Hold';

export type RequisitionPriority = 'Low' | 'Normal' | 'High' | 'Urgent' | 'Critical' | 'Emergency';

export interface RequisitionLine {
  id: string;
  line_number: number;
  item_code: string | null;
  item_name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unit_of_measure: string;
  estimated_unit_price: number;
  estimated_total: number;
  required_date: string | null;
  preferred_supplier_id: string | null;
  specification: string | null;
  cost_center: string | null;
}

export interface Requisition {
  id: string;
  pr_number: string;
  property_id: string | null;
  department: string;
  requester: string;
  request_date: string;
  required_date: string;
  priority: RequisitionPriority;
  cost_center: string | null;
  budget_code: string | null;
  purpose: string | null;
  notes: string | null;
  status: RequisitionStatus;
  estimated_total: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  converted_po_id: string | null;
  converted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_system: string | null;
  source_ref: string | null;
  proc_requisition_lines?: RequisitionLine[];
}

// Suppliers
export type SupplierStatus =
  | 'Application' | 'Under Review' | 'Pending Approval'
  | 'Active' | 'Preferred' | 'Restricted' | 'Suspended'
  | 'Disqualified' | 'Inactive';

export type SupplierType = 'Local' | 'National' | 'International' | 'Strategic' | 'Preferred' | 'Emergency' | 'One-time';

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  role: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  is_billing: boolean;
  created_at: string;
}

export interface Supplier {
  id: string;
  supplier_code: string;
  legal_name: string;
  trading_name: string | null;
  supplier_type: SupplierType;
  supplier_category: string;
  status: SupplierStatus;
  address: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_id: string | null;
  business_license: string | null;
  tax_certificate: string | null;
  currency: string;
  payment_terms: number;
  delivery_terms: string | null;
  lead_time: number;
  min_order_quantity: number;
  quality_score: number;
  on_time_delivery_rate: number;
  price_competitiveness_score: number;
  overall_score: number;
  risk_level: RiskLevel;
  is_local: boolean;
  is_sustainable: boolean;
  eco_certification: string | null;
  property_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  proc_supplier_contacts?: SupplierContact[];
}

export interface SupplierPerformance {
  id: string;
  supplier_id: string;
  period_start: string;
  period_end: string;
  total_orders: number;
  on_time_deliveries: number;
  late_deliveries: number;
  on_time_delivery_rate: number;
  quality_score: number;
  order_accuracy_score: number;
  responsiveness_score: number;
  price_competitiveness_score: number;
  total_spend: number;
  returns_count: number;
  complaints_count: number;
  rejection_rate: number;
  overall_score: number;
  trend: string;
  created_at: string;
}

export interface SupplierRisk {
  id: string;
  supplier_id: string;
  risk_type: string;
  risk_level: RiskLevel;
  risk_description: string;
  mitigation_plan: string | null;
  owner: string | null;
  status: 'Open' | 'Mitigating' | 'Closed';
  identified_at: string;
  closed_at: string | null;
  created_at: string;
}

// RFQs
export type RFQStatus = 'Draft' | 'Issued' | 'Closed' | 'Cancelled';

export interface RFQLine {
  id: string;
  line_number: number;
  item_code: string | null;
  item_name: string;
  specification: string;
  quantity: number;
  unit_of_measure: string;
  required_delivery_date: string;
  quality_requirement: string | null;
}

export interface RFQ {
  id: string;
  rfq_number: string;
  property_id: string | null;
  department: string;
  procurement_officer: string;
  issue_date: string;
  response_deadline: string;
  currency: string;
  delivery_requirement: string | null;
  terms: string | null;
  conditions: string | null;
  status: RFQStatus;
  requisition_id: string | null;
  awarded_supplier_id: string | null;
  awarded_at: string | null;
  award_amount: number | null;
  award_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_system: string | null;
  source_ref: string | null;
  proc_rfq_lines?: RFQLine[];
  proc_quotations?: Quotation[];
}

// Quotations
export type QuotationStatus = 'Received' | 'Under Review' | 'Selected' | 'Rejected' | 'Expired';

export interface QuotationLine {
  id: string;
  quotation_id: string;
  rfq_line_id: string | null;
  line_number: number;
  item_code: string | null;
  item_name: string;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
  line_total: number;
  lead_time: number | null;
}

export interface Quotation {
  id: string;
  quotation_number: string;
  rfq_id: string;
  supplier_id: string;
  submitted_at: string;
  currency: string;
  subtotal: number;
  tax: number;
  discount: number;
  freight: number;
  delivery_cost: number;
  total: number;
  lead_time: number;
  payment_terms: string | null;
  warranty: string | null;
  quote_validity: string | null;
  min_order_quantity: number | null;
  supplier_notes: string | null;
  status: QuotationStatus;
  evaluation_score: number | null;
  created_at: string;
  proc_suppliers?: Pick<Supplier, 'supplier_code' | 'legal_name'>;
  proc_quotation_lines?: QuotationLine[];
}

export interface QuotationComparison {
  quotationId: string;
  quotationNumber: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  supplierScore: number;
  total: number;
  leadTime: number;
  paymentTerms: string | null;
  lines: QuotationLine[];
}

// Purchase Orders
export type POStatus =
  | 'Draft' | 'Pending Approval' | 'Approved' | 'Sent to Supplier'
  | 'Supplier Acknowledged' | 'Partially Received' | 'Fully Received'
  | 'Closed' | 'Rejected' | 'Cancelled' | 'On Hold' | 'Expired';

export interface POLine {
  id: string;
  line_number: number;
  item_code: string | null;
  item_name: string;
  description: string | null;
  category: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_of_measure: string;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
  required_date: string | null;
  specification: string | null;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  property_id: string | null;
  supplier_id: string;
  buyer: string;
  department: string;
  cost_center: string | null;
  currency: string;
  order_date: string;
  required_delivery_date: string;
  delivery_location: string | null;
  payment_terms: string | null;
  contract_id: string | null;
  notes: string | null;
  internal_notes: string | null;
  status: POStatus;
  subtotal: number;
  tax: number;
  discount: number;
  shipping_cost: number;
  total_amount: number;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  partially_received_at: string | null;
  fully_received_at: string | null;
  requisition_id: string | null;
  rfq_id: string | null;
  quotation_id: string | null;
  tender_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_system: string | null;
  source_ref: string | null;
  proc_suppliers?: Pick<Supplier, 'supplier_code' | 'legal_name'>;
  proc_po_lines?: POLine[];
}

export interface POAmendment {
  id: string;
  po_id: string;
  amendment_number: number;
  amended_by: string;
  amended_at: string;
  field_name: string;
  previous_value: string | null;
  new_value: string;
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

// Contracts
export type ContractStatus =
  | 'Draft' | 'Review' | 'Approval' | 'Active' | 'Renewal Review'
  | 'Renewed' | 'Expired' | 'Closed';

export type ContractType =
  | 'Supplier Contract' | 'Framework Agreement' | 'Rate Agreement'
  | 'Service Agreement' | 'Volume Agreement' | 'Long-Term Agreement'
  | 'Exclusive Agreement';

export interface Contract {
  id: string;
  contract_number: string;
  supplier_id: string;
  property_id: string | null;
  category: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string;
  renewal_date: string | null;
  contract_value: number | null;
  currency: string;
  payment_terms: string | null;
  sla: string | null;
  penalties: string | null;
  min_commitment: number | null;
  max_commitment: number | null;
  pricing_rules: any;
  status: ContractStatus;
  auto_renew: boolean;
  approved_by: string | null;
  approved_at: string | null;
  renewed_from_id: string | null;
  renewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  daysUntilExpiry?: number;
  expiryAlert?: boolean;
  proc_suppliers?: Pick<Supplier, 'supplier_code' | 'legal_name'>;
}

// Budgets
export type BudgetType = 'Annual' | 'Monthly' | 'Quarterly' | 'Project';
export type ControlType = 'Hard' | 'Soft' | 'None';

export interface Budget {
  id: string;
  budget_code: string;
  property_id: string | null;
  department: string;
  category: string;
  budget_type: BudgetType;
  fiscal_year: number;
  period_start: string;
  period_end: string;
  budgeted_amount: number;
  currency: string;
  committed_amount: number;
  actual_spend: number;
  remaining_budget: number;
  status: 'Draft' | 'Active' | 'Closed' | 'Frozen';
  control_type: ControlType;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Deliveries
export type DeliveryStatus = 'Expected' | 'In Transit' | 'Delayed' | 'Partial Received' | 'Fully Received' | 'Cancelled';

export interface Delivery {
  id: string;
  po_id: string;
  supplier_id: string;
  property_id: string | null;
  expected_date: string;
  actual_date: string | null;
  status: DeliveryStatus;
  total_items: number;
  total_quantity: number;
  received_quantity: number;
  delivery_note: string | null;
  received_by: string | null;
  notes: string | null;
  delay_reason: string | null;
  created_at: string;
  updated_at: string;
  proc_suppliers?: Pick<Supplier, 'supplier_code' | 'legal_name'>;
  proc_purchase_orders?: Pick<PurchaseOrder, 'po_number'>;
}

// Savings
export type SavingsType =
  | 'Competitive Bidding' | 'Negotiation' | 'Supplier Consolidation'
  | 'Contract Savings' | 'Volume Discounts' | 'Cost Avoidance';

export interface Saving {
  id: string;
  property_id: string | null;
  savings_type: SavingsType;
  amount: number;
  currency: string;
  description: string | null;
  related_po_id: string | null;
  related_rfq_id: string | null;
  related_supplier_id: string | null;
  savings_date: string;
  recorded_by: string | null;
  created_at: string;
  proc_suppliers?: Pick<Supplier, 'supplier_code' | 'legal_name'>;
}

// Categories
export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  category_type: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Configuration
export interface Config {
  [key: string]: any;
}

// ── Dashboard API ─────────────────────────────────────────────────────────────

export async function fetchDashboardKPIs(propertyId?: string): Promise<{ kpis: DashboardKPIs; generatedAt: string }> {
  const params = new URLSearchParams();
  if (propertyId) params.append('propertyId', propertyId);
  return apiRequest(`${API_BASE}/dashboard/kpis?${params}`);
}

export async function fetchDashboardAlerts(propertyId?: string): Promise<{ alerts: ProcurementAlert[] }> {
  const params = new URLSearchParams();
  if (propertyId) params.append('propertyId', propertyId);
  return apiRequest(`${API_BASE}/dashboard/alerts?${params}`);
}

export interface DashboardSections {
  spendTrend: { month: string; spend: number }[];
  openRequisitions: { id: string; pr_number: string; department: string; requester: string; priority: string; status: string; estimated_total: number }[];
  supplierPerformance: { id: string; legal_name: string; overall_score: number; on_time_delivery_rate: number; quality_score: number; risk_level: string }[];
  deliveryAlerts: { id: string; po_id: string; expected_date: string; status: string; total_items: number }[];
  contractExpiry: { id: string; contract_number: string; end_date: string; contract_value: number; status: string }[];
  budgetUtilization: { id: string; budget_code: string; department: string; category: string; budgeted_amount: number; committed_amount: number; actual_spend: number; remaining_budget: number; status: string }[];
  supplierRisk: { id: string; legal_name: string; risk_level: string; supplier_type: string; overall_score: number }[];
  savingsByType: Record<string, number>;
}

export async function fetchDashboardSections(propertyId?: string): Promise<DashboardSections> {
  const params = new URLSearchParams();
  if (propertyId) params.append('propertyId', propertyId);
  return apiRequest(`${API_BASE}/dashboard/sections?${params}`);
}

// ── Requisitions API ──────────────────────────────────────────────────────────

export async function fetchRequisitions(filters?: {
  status?: RequisitionStatus;
  department?: string;
  priority?: RequisitionPriority;
  propertyId?: string;
}): Promise<{ requisitions: Requisition[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.department) params.append('department', filters.department);
  if (filters?.priority) params.append('priority', filters.priority);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/requisitions?${params}`);
}

export async function createRequisition(data: {
  propertyId?: string;
  department: string;
  requester: string;
  requiredDate: string;
  priority?: RequisitionPriority;
  costCenter?: string;
  budgetCode?: string;
  purpose?: string;
  notes?: string;
  lines: Array<{
    itemCode?: string;
    itemName: string;
    description?: string;
    category?: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    requiredDate?: string;
    preferredSupplierId?: string;
    specification?: string;
    costCenter?: string;
  }>;
}): Promise<{ requisition: Requisition; lines: any[] }> {
  return apiRequest(`${API_BASE}/requisitions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateRequisition(id: string, data: {
  status?: RequisitionStatus;
  notes?: string;
  priority?: RequisitionPriority;
  requiredDate?: string;
  costCenter?: string;
  budgetCode?: string;
  purpose?: string;
}): Promise<{ requisition: Requisition }> {
  return apiRequest(`${API_BASE}/requisitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteRequisition(id: string): Promise<{ success: boolean }> {
  return apiRequest(`${API_BASE}/requisitions/${id}`, { method: 'DELETE' });
}

export async function convertRequisitionToPO(id: string, data: {
  supplierId: string;
  notes?: string;
}): Promise<{ po: any; requisitionId: string }> {
  return apiRequest(`${API_BASE}/requisitions/${id}/convert-to-po`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Suppliers API ────────────────────────────────────────────────────────────

export async function fetchSuppliers(filters?: {
  status?: SupplierStatus;
  category?: string;
  type?: SupplierType;
  propertyId?: string;
}): Promise<{ suppliers: Supplier[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.category) params.append('category', filters.category);
  if (filters?.type) params.append('type', filters.type);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/suppliers?${params}`);
}

export async function createSupplier(data: {
  supplierCode: string;
  legalName: string;
  tradingName?: string;
  supplierType: SupplierType;
  supplierCategory: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxId?: string;
  taxRegistration?: string;
  businessLicense?: string;
  insurance?: string;
  currency?: string;
  paymentTerms?: number;
  deliveryTerms?: string;
  leadTime?: number;
  minimumOrderQuantity?: number;
  propertyId?: string;
  contacts?: Array<{
    name: string;
    role?: string;
    department?: string;
    email?: string;
    phone?: string;
    isBilling?: boolean;
  }>;
}): Promise<{ supplier: Supplier }> {
  return apiRequest(`${API_BASE}/suppliers`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSupplier(id: string, data: {
  status?: SupplierStatus;
  notes?: string;
  paymentTerms?: number;
  leadTime?: number;
  riskLevel?: RiskLevel;
}): Promise<{ supplier: Supplier }> {
  return apiRequest(`${API_BASE}/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchSupplierPerformance(supplierId: string): Promise<{ supplier: Supplier; performance: SupplierPerformance[] }> {
  return apiRequest(`${API_BASE}/suppliers/${supplierId}/performance`);
}

export async function fetchSupplierRisk(supplierId: string): Promise<{ risks: SupplierRisk[] }> {
  return apiRequest(`${API_BASE}/suppliers/${supplierId}/risk`);
}

export async function createSupplierRisk(data: {
  supplierId: string;
  riskType: string;
  riskLevel: RiskLevel;
  riskDescription: string;
  mitigationPlan?: string;
  owner?: string;
}): Promise<{ risk: SupplierRisk }> {
  return apiRequest(`${API_BASE}/suppliers/${data.supplierId}/risk`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── RFQs API ────────────────────────────────────────────────────────────────

export async function fetchRFQs(filters?: {
  status?: RFQStatus;
  department?: string;
  propertyId?: string;
}): Promise<{ rfqs: RFQ[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.department) params.append('department', filters.department);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/rfqs?${params}`);
}

export async function createRFQ(data: {
  propertyId?: string;
  department: string;
  procurementOfficer: string;
  responseDeadline: string;
  currency?: string;
  deliveryRequirement?: string;
  terms?: string;
  conditions?: string;
  requisitionId?: string;
  supplierIds?: string[];
  sourceSystem?: string;
  sourceRef?: string;
  lines: Array<{
    itemCode?: string;
    itemName: string;
    specification: string;
    quantity: number;
    unitOfMeasure: string;
    requiredDeliveryDate: string;
    qualityRequirement?: string;
  }>;
}): Promise<{ rfq: RFQ; lines: any[] }> {
  return apiRequest(`${API_BASE}/rfqs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Creates an RFQ from an approved requisition. Pre-fills the RFQ lines from
 * the requisition's lines and carries the source_system/source_ref for
 * department integration tracking.
 */
export async function createRFQFromRequisition(requisition: Requisition, procurementOfficer: string, supplierIds: string[] = []): Promise<{ rfq: RFQ; lines: any[] }> {
  const lines = (requisition.proc_requisition_lines || []).map((l) => ({
    itemName: l.item_name,
    specification: l.specification || '',
    quantity: Number(l.quantity),
    unitOfMeasure: l.unit_of_measure,
    requiredDeliveryDate: requisition.required_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    qualityRequirement: '',
  }));
  return createRFQ({
    propertyId: requisition.property_id || undefined,
    department: requisition.department,
    procurementOfficer,
    responseDeadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
    currency: 'ETB',
    requisitionId: requisition.id,
    sourceSystem: requisition.source_system || 'procurement',
    sourceRef: requisition.id,
    supplierIds,
    lines,
  });
}

export async function updateRFQ(id: string, data: {
  status?: RFQStatus;
  awardedSupplierId?: string;
  awardAmount?: number;
  awardNotes?: string;
}): Promise<{ rfq: RFQ }> {
  return apiRequest(`${API_BASE}/rfqs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function compareRFQQuotations(rfqId: string): Promise<{ comparison: QuotationComparison[]; recommendation: QuotationComparison | null }> {
  return apiRequest(`${API_BASE}/rfqs/${rfqId}/compare`);
}

// ── Quotations API ───────────────────────────────────────────────────────────

export async function fetchQuotations(filters?: {
  rfqId?: string;
  supplierId?: string;
  status?: QuotationStatus;
}): Promise<{ quotations: Quotation[] }> {
  const params = new URLSearchParams();
  if (filters?.rfqId) params.append('rfqId', filters.rfqId);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.status) params.append('status', filters.status);
  return apiRequest(`${API_BASE}/quotations?${params}`);
}

export async function createQuotation(data: {
  rfqId: string;
  supplierId: string;
  currency?: string;
  subtotal: number;
  tax?: number;
  discount?: number;
  freight?: number;
  deliveryCost?: number;
  leadTime?: number;
  paymentTerms?: string;
  warranty?: string;
  quoteValidity?: string;
  minOrderQuantity?: number;
  supplierNotes?: string;
  lines: Array<{
    rfqLineId?: string;
    itemCode?: string;
    itemName: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    leadTime?: number;
  }>;
}): Promise<{ quotation: Quotation; lines: any[] }> {
  return apiRequest(`${API_BASE}/quotations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Purchase Orders API ──────────────────────────────────────────────────────

export async function fetchPurchaseOrders(filters?: {
  status?: POStatus;
  supplierId?: string;
  department?: string;
  propertyId?: string;
}): Promise<{ purchaseOrders: PurchaseOrder[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.department) params.append('department', filters.department);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/purchase-orders?${params}`);
}

export async function createPurchaseOrder(data: {
  propertyId?: string;
  supplierId: string;
  buyer: string;
  department: string;
  costCenter?: string;
  currency?: string;
  requiredDeliveryDate: string;
  deliveryLocation?: string;
  paymentTerms?: string;
  contractId?: string;
  notes?: string;
  internalNotes?: string;
  requisitionId?: string;
  rfqId?: string;
  quotationId?: string;
  tenderId?: string;
  sourceSystem?: string;
  sourceRef?: string;
  lines: Array<{
    itemCode?: string;
    itemName: string;
    description?: string;
    category?: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    discount?: number;
    tax?: number;
    requiredDate?: string;
    specification?: string;
  }>;
}): Promise<{ purchaseOrder: PurchaseOrder; lines: any[] }> {
  return apiRequest(`${API_BASE}/purchase-orders`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePurchaseOrder(id: string, data: {
  status?: POStatus;
  notes?: string;
  requiredDeliveryDate?: string;
  paymentTerms?: string;
}): Promise<{ purchaseOrder: PurchaseOrder }> {
  return apiRequest(`${API_BASE}/purchase-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function amendPurchaseOrder(id: string, data: {
  fieldName: string;
  previousValue?: string;
  newValue: any;
  reason: string;
}): Promise<{ amendment: POAmendment }> {
  return apiRequest(`${API_BASE}/purchase-orders/${id}/amend`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Creates a Purchase Order from an awarded RFQ. Pre-fills the PO lines from
 * the winning quotation's lines and carries source_system/source_ref for
 * sourcing integration tracking.
 */
export async function createPOFromRFQAward(
  rfq: RFQ,
  quotation: Quotation,
  buyer: string,
): Promise<{ purchaseOrder: PurchaseOrder; lines: any[] }>;
export async function createPOFromRFQAward(
  rfq: RFQ,
  comparison: QuotationComparison,
  buyer: string,
): Promise<{ purchaseOrder: PurchaseOrder; lines: any[] }>;
export async function createPOFromRFQAward(
  rfq: RFQ,
  source: Quotation | QuotationComparison,
  buyer: string,
): Promise<{ purchaseOrder: PurchaseOrder; lines: any[] }> {
  const isComparison = 'quotationId' in source;
  const supplierId = isComparison ? source.supplierId : source.supplier_id;
  const paymentTerms = isComparison ? (source.paymentTerms || 'Net 30') : (source.payment_terms || 'Net 30');
  const quotationNumber = isComparison ? source.quotationNumber : source.quotation_number;
  const lines = (isComparison ? source.lines : (source.proc_quotation_lines || [])).map((l) => ({
    itemName: l.item_name,
    description: l.item_name,
    quantity: Number(l.quantity),
    unitOfMeasure: l.unit_of_measure,
    unitPrice: Number(l.unit_price),
    requiredDate: rfq.response_deadline?.slice(0, 10),
    specification: '',
  }));
  return createPurchaseOrder({
    propertyId: rfq.property_id || undefined,
    supplierId,
    buyer,
    department: rfq.department,
    currency: rfq.currency || 'ETB',
    requiredDeliveryDate: rfq.response_deadline?.slice(0, 10) || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    deliveryLocation: 'Main Store',
    paymentTerms,
    notes: `PO created from RFQ ${rfq.rfq_number} award to ${quotationNumber}`,
    rfqId: rfq.id,
    requisitionId: rfq.requisition_id || undefined,
    sourceSystem: 'rfq',
    sourceRef: rfq.id,
    lines,
  });
}

// ── Contracts API ───────────────────────────────────────────────────────────

export async function fetchContracts(filters?: {
  status?: ContractStatus;
  supplierId?: string;
  category?: string;
  propertyId?: string;
}): Promise<{ contracts: Contract[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.category) params.append('category', filters.category);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/contracts?${params}`);
}

export async function createContract(data: {
  supplierId: string;
  propertyId?: string;
  category: string;
  contractType: ContractType;
  startDate: string;
  endDate: string;
  renewalDate?: string;
  contractValue?: number;
  currency?: string;
  paymentTerms?: string;
  sla?: string;
  penalties?: string;
  minCommitment?: number;
  maxCommitment?: number;
  pricingRules?: any;
  autoRenew?: boolean;
}): Promise<{ contract: Contract }> {
  return apiRequest(`${API_BASE}/contracts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateContract(id: string, data: {
  status?: ContractStatus;
  approvedBy?: string;
  notes?: string;
}): Promise<{ contract: Contract }> {
  return apiRequest(`${API_BASE}/contracts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Budgets API ─────────────────────────────────────────────────────────────

export async function fetchBudgets(filters?: {
  propertyId?: string;
  department?: string;
  category?: string;
  fiscalYear?: number;
}): Promise<{ budgets: Budget[] }> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.department) params.append('department', filters.department);
  if (filters?.category) params.append('category', filters.category);
  if (filters?.fiscalYear) params.append('fiscalYear', filters.fiscalYear.toString());
  return apiRequest(`${API_BASE}/budgets?${params}`);
}

export async function createBudget(data: {
  budgetCode: string;
  propertyId?: string;
  department: string;
  category: string;
  budgetType: BudgetType;
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  budgetedAmount: number;
  currency?: string;
  controlType?: ControlType;
  notes?: string;
}): Promise<{ budget: Budget }> {
  return apiRequest(`${API_BASE}/budgets`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Deliveries API ───────────────────────────────────────────────────────────

export async function fetchDeliveries(filters?: {
  status?: DeliveryStatus;
  propertyId?: string;
  supplierId?: string;
}): Promise<{ deliveries: Delivery[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  return apiRequest(`${API_BASE}/deliveries?${params}`);
}

export async function updateDelivery(id: string, data: {
  status?: DeliveryStatus;
  actualDate?: string;
  receivedBy?: string;
  notes?: string;
  delayReason?: string;
}): Promise<{ delivery: Delivery }> {
  return apiRequest(`${API_BASE}/deliveries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Savings API ─────────────────────────────────────────────────────────────

export async function fetchSavings(filters?: {
  propertyId?: string;
  savingsType?: SavingsType;
  startDate?: string;
  endDate?: string;
}): Promise<{ savings: Saving[]; totalSavings: number }> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.savingsType) params.append('savingsType', filters.savingsType);
  if (filters?.startDate) params.append('startDate', filters.startDate);
  if (filters?.endDate) params.append('endDate', filters.endDate);
  return apiRequest(`${API_BASE}/savings?${params}`);
}

export async function createSaving(data: {
  propertyId?: string;
  savingsType: SavingsType;
  amount: number;
  description?: string;
  relatedPoId?: string;
  relatedRfqId?: string;
  relatedSupplierId?: string;
  savingsDate: string;
}): Promise<{ saving: Saving }> {
  return apiRequest(`${API_BASE}/savings`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Categories API ───────────────────────────────────────────────────────────

export async function fetchCategories(categoryType?: string): Promise<{ categories: Category[] }> {
  const params = new URLSearchParams();
  if (categoryType) params.append('categoryType', categoryType);
  return apiRequest(`${API_BASE}/categories?${params}`);
}

export async function createCategory(data: {
  name: string;
  categoryType: string;
  parentId?: string;
  description?: string;
}): Promise<{ category: Category }> {
  return apiRequest(`${API_BASE}/categories`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCategory(id: string, data: {
  name?: string;
  categoryType?: string;
  description?: string;
  isActive?: boolean;
}): Promise<{ category: Category }> {
  return apiRequest(`${API_BASE}/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCategory(id: string): Promise<{ success: boolean }> {
  return apiRequest(`${API_BASE}/categories/${id}`, { method: 'DELETE' });
}

// ── Configuration API ───────────────────────────────────────────────────────

export async function fetchConfig(): Promise<{ config: Config }> {
  return apiRequest(`${API_BASE}/config`);
}

export async function updateConfig(key: string, data: {
  value: any;
  description?: string;
}): Promise<{ config: any }> {
  return apiRequest(`${API_BASE}/config/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Demand Forecasts ───────────────────────────────────────────────────────

export interface DemandForecast {
  id: string;
  property_id: string | null;
  department: string;
  category: string;
  forecast_date: string;
  forecast_quantity: number;
  unit_of_measure: string;
  confidence_level: 'Low' | 'Medium' | 'High';
  forecast_source: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_system: string | null;
  source_ref: string | null;
}

export async function fetchDemandForecasts(filters?: {
  propertyId?: string;
  department?: string;
}): Promise<{ forecasts: DemandForecast[] }> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.department) params.append('department', filters.department);
  return apiRequest(`${API_BASE}/demand-forecasts?${params}`);
}

export async function createDemandForecast(data: {
  propertyId?: string;
  department: string;
  category: string;
  forecastDate: string;
  forecastQuantity: number;
  unitOfMeasure: string;
  confidenceLevel?: 'Low' | 'Medium' | 'High';
  forecastSource?: string;
  notes?: string;
}): Promise<{ forecast: DemandForecast }> {
  return apiRequest(`${API_BASE}/demand-forecasts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDemandForecast(id: string, data: Partial<{
  department: string;
  category: string;
  forecastDate: string;
  forecastQuantity: number;
  unitOfMeasure: string;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  forecastSource: string;
  notes: string;
}>): Promise<{ forecast: DemandForecast }> {
  return apiRequest(`${API_BASE}/demand-forecasts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteDemandForecast(id: string): Promise<{ success: boolean }> {
  return apiRequest(`${API_BASE}/demand-forecasts/${id}`, { method: 'DELETE' });
}

export async function convertForecastToRequisition(id: string, data?: {
  requester?: string;
  priority?: RequisitionPriority;
  costCenter?: string;
  budgetCode?: string;
  purpose?: string;
  notes?: string;
  unitPrice?: number;
}): Promise<{ requisition: Requisition; lines: any[]; forecastId: string }> {
  return apiRequest(`${API_BASE}/demand-forecasts/${id}/convert-to-requisition`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export interface DemandAnalysis {
  byDepartment: Record<string, { count: number; totalQuantity: number }>;
  byCategory: Record<string, { count: number; totalQuantity: number }>;
  bySource: Record<string, number>;
  byConfidence: Record<string, number>;
  demandSources: {
    openPurchaseOrders: number;
    expectedDeliveries: number;
    openRequisitions: number;
    totalForecasts: number;
  };
  totalForecasts: number;
}

export async function fetchDemandAnalysis(propertyId?: string): Promise<DemandAnalysis> {
  const params = new URLSearchParams();
  if (propertyId) params.append('propertyId', propertyId);
  return apiRequest(`${API_BASE}/demand-analysis?${params}`);
}

// ── Procurement Plan ────────────────────────────────────────────────────────

export type PlanningHorizon = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Annual';

export interface PlanItem {
  id: string;
  type: 'Forecast' | 'Requisition';
  department: string;
  category: string;
  item: string;
  quantity: number;
  unit: string;
  date: string;
  confidence: string;
  source: string;
  status: string;
  linkedRequisitionId: string | null;
  estimatedValue: number;
}

export interface ProcurementPlan {
  horizon: PlanningHorizon;
  rangeStart: string;
  rangeEnd: string;
  planItems: PlanItem[];
  budgetByDept: Record<string, { budgeted: number; committed: number; actual: number; remaining: number }>;
  openPOsInHorizon: number;
  expectedDeliveries: number;
  activeContracts: number;
  planningFactors: {
    occupancy: number | null;
    forecastRoomsSold: number | null;
    restaurantCovers: number | null;
    banquetEvents: number | null;
    spaAppointments: number | null;
    maintenancePlans: number | null;
    seasonalDemand: number | null;
    supplierLeadTime: number;
    contractCommitments: number;
    inventoryLevels: number | null;
    budgetAvailability: number;
  };
  kpis: {
    totalPlanItems: number;
    pendingCount: number;
    convertedCount: number;
    totalPlannedValue: number;
    openPOs: number;
    expectedDeliveries: number;
  };
}

export async function fetchProcurementPlan(filters?: {
  propertyId?: string;
  horizon?: PlanningHorizon;
  department?: string;
}): Promise<ProcurementPlan> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.horizon) params.append('horizon', filters.horizon);
  if (filters?.department) params.append('department', filters.department);
  return apiRequest(`${API_BASE}/procurement-plan?${params}`);
}

// ── Legacy GRN Functions (for Inventory module backward compatibility) ───────
// These are legacy functions for the Inventory & Stores domain, not part of the
// new unified procurement schema. Kept for backward compatibility with ReceivingModule.tsx.

export interface GRN {
  id: string;
  grnNumber: string;
  supplierName: string;
  purchaseOrderId: string;
  deliveryNote: string;
  invoiceNumber: string;
  receiver: string;
  receivedDate: string;
  totalValue: number;
  status: 'Pending' | 'Completed' | 'Discrepancy';
  items: Array<{
    name: string;
    receivedQty: number;
    unitCost: number;
    batchNumber: string;
    expiryDate: string;
  }>;
}

export async function createGRN(data: {
  supplierName: string;
  purchaseOrderId: string;
  deliveryNote: string;
  invoiceNumber: string;
  receiver: string;
  items: Array<{
    name: string;
    receivedQty: number;
    unitCost: number;
    batchNumber: string;
    expiryDate: string;
  }>;
}): Promise<{ grn: GRN }> {
  // This is a placeholder - the actual GRN functionality belongs in Inventory
  // For now, return a mock response to allow the build to succeed
  const grn: GRN = {
    id: `grn-${Date.now()}`,
    grnNumber: `GRN-${Date.now().toString().slice(-6)}`,
    supplierName: data.supplierName,
    purchaseOrderId: data.purchaseOrderId,
    deliveryNote: data.deliveryNote,
    invoiceNumber: data.invoiceNumber,
    receiver: data.receiver,
    receivedDate: new Date().toISOString(),
    totalValue: data.items.reduce((sum, item) => sum + (item.receivedQty * item.unitCost), 0),
    status: 'Pending',
    items: data.items,
  };
  return Promise.resolve({ grn });
}

export async function fetchGRNs(): Promise<{ grns: GRN[] }> {
  // This is a placeholder - the actual GRN functionality belongs in Inventory
  return Promise.resolve({ grns: [] });
}

export async function updateGRNDiscrepancy(
  grnId: string,
  status: string,
  notes: string
): Promise<{ grn: GRN }> {
  // This is a placeholder - the actual GRN functionality belongs in Inventory
  return Promise.resolve({ grn: {
    id: grnId,
    grnNumber: 'GRN-000000',
    supplierName: '',
    purchaseOrderId: '',
    deliveryNote: '',
    invoiceNumber: '',
    receiver: '',
    receivedDate: new Date().toISOString(),
    totalValue: 0,
    status: 'Discrepancy' as any,
    items: [],
  }});
}

// ── Legacy StockCount Functions (for Inventory module backward compatibility) ─

export interface StockCount {
  id: string;
  countNumber: string;
  countDate: string;
  location: string;
  status: 'Draft' | 'In Progress' | 'Completed';
  items: Array<{
    itemCode: string;
    itemName: string;
    systemQty: number;
    countedQty: number;
    variance: number;
  }>;
}

export async function fetchStockCounts(): Promise<{ stockCounts: StockCount[] }> {
  return Promise.resolve({ stockCounts: [] });
}

export async function createStockCount(data: {
  location: string;
  items: Array<{
    itemCode: string;
    itemName: string;
    systemQty: number;
    countedQty: number;
  }>;
}): Promise<{ stockCount: StockCount }> {
  const stockCount: StockCount = {
    id: `sc-${Date.now()}`,
    countNumber: `SC-${Date.now().toString().slice(-6)}`,
    countDate: new Date().toISOString(),
    location: data.location,
    status: 'Draft',
    items: data.items.map(item => ({
      ...item,
      variance: item.countedQty - item.systemQty,
    })),
  };
  return Promise.resolve({ stockCount });
}

export async function updateStockCount(
  id: string,
  data: {
    status?: string;
    items?: Array<{
      itemCode: string;
      itemName: string;
      systemQty: number;
      countedQty: number;
    }>;
  }
): Promise<{ stockCount: StockCount }> {
  return Promise.resolve({ stockCount: {
    id,
    countNumber: 'SC-000000',
    countDate: new Date().toISOString(),
    location: '',
    status: data.status as any || 'Draft',
    items: (data.items || []).map(item => ({
      ...item,
      variance: item.countedQty - item.systemQty,
    })),
  }});
}

// ── Tenders ────────────────────────────────────────────────────────────────

export type TenderType = 'Open' | 'Restricted' | 'Single' | 'Emergency';
export type TenderStatus = 'Draft' | 'Published' | 'Submission Closed' | 'Under Evaluation' | 'Awarded' | 'Cancelled';

export interface Tender {
  id: string;
  tender_number: string;
  property_id: string | null;
  department: string;
  procurement_officer: string;
  title: string;
  description: string | null;
  issue_date: string;
  submission_deadline: string;
  opening_date: string | null;
  currency: string;
  estimated_value: number | null;
  tender_type: TenderType;
  status: TenderStatus;
  terms: string | null;
  conditions: string | null;
  awarded_supplier_id: string | null;
  awarded_amount: number | null;
  awarded_at: string | null;
  source_system: string | null;
  source_ref: string | null;
  proc_tender_lines?: TenderLine[];
  proc_tender_submissions?: TenderSubmission[];
}

export interface TenderLine {
  id: string;
  tender_id: string;
  line_number: number;
  item_name: string;
  specification: string;
  quantity: number;
  unit_of_measure: string;
  required_delivery_date: string;
}

export interface TenderSubmission {
  id: string;
  tender_id: string;
  supplier_id: string;
  submitted_at: string;
  total_amount: number;
  currency: string;
  lead_time: number | null;
  payment_terms: string | null;
  evaluation_score: number | null;
  status: string;
  proc_suppliers?: { legal_name: string; supplier_code: string } | null;
}

export async function fetchTenders(filters?: {
  status?: TenderStatus;
  propertyId?: string;
}): Promise<{ tenders: Tender[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/tenders?${params}`);
}

export async function createTender(data: {
  propertyId?: string;
  department: string;
  procurementOfficer: string;
  title: string;
  description?: string;
  submissionDeadline: string;
  currency?: string;
  estimatedValue?: number;
  tenderType?: TenderType;
  terms?: string;
  conditions?: string;
  sourceSystem?: string;
  sourceRef?: string;
  lines?: Array<{ itemName: string; specification: string; quantity: number; unitOfMeasure: string; requiredDeliveryDate: string }>;
}): Promise<{ tender: Tender }> {
  return apiRequest(`${API_BASE}/tenders`, { method: 'POST', body: JSON.stringify(data) });
}

/**
 * Creates a tender from an approved requisition. Pre-fills the tender lines
 * from the requisition's lines and carries source_system/source_ref for
 * department integration tracking.
 */
export async function createTenderFromRequisition(requisition: Requisition, procurementOfficer: string): Promise<{ tender: Tender }> {
  const lines = (requisition.proc_requisition_lines || []).map((l) => ({
    itemName: l.item_name,
    specification: l.specification || l.description || '',
    quantity: Number(l.quantity),
    unitOfMeasure: l.unit_of_measure,
    requiredDeliveryDate: requisition.required_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  }));
  const estimatedValue = (requisition.proc_requisition_lines || []).reduce((sum, l) => sum + Number(l.estimated_total || 0), 0);
  return createTender({
    propertyId: requisition.property_id || undefined,
    department: requisition.department,
    procurementOfficer,
    title: `Tender from ${requisition.pr_number}`,
    description: `Tender created from requisition ${requisition.pr_number} (${requisition.department})`,
    submissionDeadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 16),
    currency: 'ETB',
    estimatedValue,
    tenderType: 'Open',
    sourceSystem: requisition.source_system || 'procurement',
    sourceRef: requisition.id,
    lines,
  });
}

export async function updateTender(id: string, data: {
  status?: TenderStatus;
  awardedSupplierId?: string;
  awardedAmount?: number;
}): Promise<{ tender: Tender }> {
  return apiRequest(`${API_BASE}/tenders/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Negotiations ───────────────────────────────────────────────────────────

export type NegotiationType = 'Price' | 'Terms' | 'Volume' | 'Contract' | 'Combined';
export type NegotiationStatus = 'Open' | 'In Progress' | 'Agreed' | 'Rejected' | 'Closed';

export interface Negotiation {
  id: string;
  negotiation_number: string;
  property_id: string | null;
  rfq_id: string | null;
  tender_id: string | null;
  supplier_id: string;
  department: string;
  negotiation_type: NegotiationType;
  status: NegotiationStatus;
  initial_price: number | null;
  target_price: number | null;
  final_price: number | null;
  currency: string;
  savings_amount: number | null;
  started_at: string;
  closed_at: string | null;
  notes: string | null;
  outcome: string | null;
  source_system: string | null;
  source_ref: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
  proc_negotiation_rounds?: NegotiationRound[];
}

export interface NegotiationRound {
  id: string;
  negotiation_id: string;
  round_number: number;
  initiated_by: 'Procurement' | 'Supplier';
  proposed_price: number | null;
  proposed_terms: string | null;
  response: string | null;
  response_at: string | null;
  status: string;
  counter_price: number | null;
}

export async function fetchNegotiations(filters?: {
  status?: NegotiationStatus;
  supplierId?: string;
  propertyId?: string;
}): Promise<{ negotiations: Negotiation[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/negotiations?${params}`);
}

export async function createNegotiation(data: {
  propertyId?: string;
  rfqId?: string;
  tenderId?: string;
  supplierId: string;
  department: string;
  negotiationType: NegotiationType;
  initialPrice?: number;
  targetPrice?: number;
  currency?: string;
  notes?: string;
  sourceSystem?: string;
  sourceRef?: string;
}): Promise<{ negotiation: Negotiation }> {
  return apiRequest(`${API_BASE}/negotiations`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateNegotiation(id: string, data: {
  status?: NegotiationStatus;
  finalPrice?: number;
  savingsAmount?: number;
  outcome?: string;
  notes?: string;
}): Promise<{ negotiation: Negotiation }> {
  return apiRequest(`${API_BASE}/negotiations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

/**
 * Creates a negotiation from an RFQ quotation. Pre-fills the initial price
 * from the quotation total and targets a configurable discount percentage.
 */
export async function createNegotiationFromRFQ(
  rfq: RFQ,
  supplierId: string,
  initialPrice: number,
  targetDiscountPercent: number = 5,
): Promise<{ negotiation: Negotiation }> {
  const targetPrice = Math.round(initialPrice * (1 - targetDiscountPercent / 100));
  return createNegotiation({
    propertyId: rfq.property_id || undefined,
    rfqId: rfq.id,
    supplierId,
    department: rfq.department,
    negotiationType: 'Price',
    initialPrice,
    targetPrice,
    currency: rfq.currency || 'ETB',
    notes: `Negotiation from RFQ ${rfq.rfq_number}`,
    sourceSystem: 'rfq',
    sourceRef: rfq.id,
  });
}

/**
 * Creates a negotiation from a tender submission. Pre-fills the initial price
 * from the submission total and targets a configurable discount percentage.
 */
export async function createNegotiationFromTender(
  tender: Tender,
  supplierId: string,
  initialPrice: number,
  targetDiscountPercent: number = 5,
): Promise<{ negotiation: Negotiation }> {
  const targetPrice = Math.round(initialPrice * (1 - targetDiscountPercent / 100));
  return createNegotiation({
    propertyId: tender.property_id || undefined,
    tenderId: tender.id,
    supplierId,
    department: tender.department,
    negotiationType: 'Combined',
    initialPrice,
    targetPrice,
    currency: tender.currency || 'ETB',
    notes: `Negotiation from Tender ${tender.tender_number}`,
    sourceSystem: 'tender',
    sourceRef: tender.id,
  });
}

// ── Supplier Onboarding ────────────────────────────────────────────────────

export type OnboardingStage = 'Application' | 'Document Submission' | 'Procurement Review' | 'Compliance Review' | 'Finance Verification' | 'Approval' | 'Activated' | 'Rejected';

export interface SupplierOnboarding {
  id: string;
  supplier_id: string;
  application_date: string;
  current_stage: OnboardingStage;
  documents_submitted: boolean;
  procurement_reviewed_at: string | null;
  compliance_reviewed_at: string | null;
  finance_verified_at: string | null;
  approved_at: string | null;
  activated_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string; supplier_category: string };
}

export async function fetchSupplierOnboarding(filters?: {
  stage?: OnboardingStage;
  supplierId?: string;
  propertyId?: string;
}): Promise<{ onboarding: SupplierOnboarding[] }> {
  const params = new URLSearchParams();
  if (filters?.stage) params.append('stage', filters.stage);
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/supplier-onboarding?${params}`);
}

export async function updateSupplierOnboarding(id: string, data: {
  currentStage?: OnboardingStage;
  notes?: string;
  rejectionReason?: string;
}): Promise<{ onboarding: SupplierOnboarding }> {
  return apiRequest(`${API_BASE}/supplier-onboarding/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Supplier Qualifications ────────────────────────────────────────────────

export type QualificationCriteria = 'Legal Compliance' | 'Product Quality' | 'Financial Capability' | 'Delivery Capacity' | 'Production Capacity' | 'Certifications' | 'Food Safety' | 'Insurance' | 'References' | 'Sustainability' | 'Regulatory Compliance';
export type QualificationStatus = 'Pending' | 'Qualified' | 'Conditionally Qualified' | 'Disqualified';

export interface SupplierQualification {
  id: string;
  supplier_id: string;
  criteria_type: QualificationCriteria;
  status: QualificationStatus;
  score: number | null;
  evaluated_by: string | null;
  evaluated_at: string | null;
  expiry_date: string | null;
  notes: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchSupplierQualifications(filters?: {
  supplierId?: string;
  status?: QualificationStatus;
}): Promise<{ qualifications: SupplierQualification[] }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.status) params.append('status', filters.status);
  return apiRequest(`${API_BASE}/supplier-qualifications?${params}`);
}

export async function createSupplierQualification(data: {
  supplierId: string;
  criteriaType: QualificationCriteria;
  status?: QualificationStatus;
  score?: number;
  expiryDate?: string;
  notes?: string;
}): Promise<{ qualification: SupplierQualification }> {
  return apiRequest(`${API_BASE}/supplier-qualifications`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSupplierQualification(id: string, data: {
  status?: QualificationStatus;
  score?: number;
  notes?: string;
  expiryDate?: string;
}): Promise<{ qualification: SupplierQualification }> {
  return apiRequest(`${API_BASE}/supplier-qualifications/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Supplier Evaluations ───────────────────────────────────────────────────

export type SupplierRating = 'Excellent' | 'Good' | 'Acceptable' | 'Poor' | 'Critical';

export interface SupplierEvaluation {
  id: string;
  supplier_id: string;
  evaluation_period: string;
  evaluation_date: string;
  evaluator: string;
  quality_score: number;
  delivery_score: number;
  price_score: number;
  service_score: number;
  compliance_score: number;
  overall_score: number;
  rating: SupplierRating | null;
  strengths: string | null;
  weaknesses: string | null;
  recommendations: string | null;
  action_required: string | null;
  next_review_date: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchSupplierEvaluations(filters?: {
  supplierId?: string;
}): Promise<{ evaluations: SupplierEvaluation[] }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  return apiRequest(`${API_BASE}/supplier-evaluations?${params}`);
}

export async function createSupplierEvaluation(data: {
  supplierId: string;
  evaluationPeriod: string;
  evaluator: string;
  qualityScore?: number;
  deliveryScore?: number;
  priceScore?: number;
  serviceScore?: number;
  complianceScore?: number;
  overallScore?: number;
  rating?: SupplierRating;
  strengths?: string;
  weaknesses?: string;
  recommendations?: string;
  actionRequired?: string;
  nextReviewDate?: string;
}): Promise<{ evaluation: SupplierEvaluation }> {
  return apiRequest(`${API_BASE}/supplier-evaluations`, { method: 'POST', body: JSON.stringify(data) });
}

// ── Supplier Documents ─────────────────────────────────────────────────────

export interface SupplierDocument {
  id: string;
  supplier_id: string;
  document_type: string;
  document_name: string;
  document_url: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
  notes: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchSupplierDocuments(filters?: {
  supplierId?: string;
  documentType?: string;
}): Promise<{ documents: SupplierDocument[] }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.documentType) params.append('documentType', filters.documentType);
  return apiRequest(`${API_BASE}/supplier-documents?${params}`);
}

export async function createSupplierDocument(data: {
  supplierId: string;
  documentType: string;
  documentName: string;
  documentUrl?: string;
  issueDate?: string;
  expiryDate?: string;
  notes?: string;
}): Promise<{ document: SupplierDocument }> {
  return apiRequest(`${API_BASE}/supplier-documents`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateSupplierDocument(id: string, data: {
  status?: string;
  verificationStatus?: string;
  verifiedBy?: string;
}): Promise<{ document: SupplierDocument }> {
  return apiRequest(`${API_BASE}/supplier-documents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteSupplierDocument(id: string): Promise<{ success: boolean }> {
  return apiRequest(`${API_BASE}/supplier-documents/${id}`, { method: 'DELETE' });
}

// ── PO Tracking ────────────────────────────────────────────────────────────

export type TrackingStatus = 'Pending' | 'Shipped' | 'In Transit' | 'At Customs' | 'Out for Delivery' | 'Delivered' | 'Delayed' | 'Lost';

export interface POTracking {
  id: string;
  po_id: string;
  tracking_number: string | null;
  carrier: string | null;
  shipment_date: string | null;
  estimated_arrival: string | null;
  actual_arrival: string | null;
  tracking_status: TrackingStatus;
  current_location: string | null;
  notes: string | null;
  proc_purchase_orders?: { po_number: string };
}

export async function fetchPOTracking(filters?: {
  poId?: string;
  trackingStatus?: TrackingStatus;
}): Promise<{ tracking: POTracking[] }> {
  const params = new URLSearchParams();
  if (filters?.poId) params.append('poId', filters.poId);
  if (filters?.trackingStatus) params.append('trackingStatus', filters.trackingStatus);
  return apiRequest(`${API_BASE}/po-tracking?${params}`);
}

export async function createPOTracking(data: {
  poId: string;
  trackingNumber?: string;
  carrier?: string;
  shipmentDate?: string;
  estimatedArrival?: string;
  trackingStatus?: TrackingStatus;
  currentLocation?: string;
  notes?: string;
}): Promise<{ tracking: POTracking }> {
  return apiRequest(`${API_BASE}/po-tracking`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePOTracking(id: string, data: {
  trackingStatus?: TrackingStatus;
  actualArrival?: string;
  currentLocation?: string;
  notes?: string;
}): Promise<{ tracking: POTracking }> {
  return apiRequest(`${API_BASE}/po-tracking/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Audit Trail ────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_number: string | null;
  previous_value: any;
  new_value: any;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

export async function fetchAuditTrail(filters?: {
  entityType?: string;
  entityId?: string;
  userId?: string;
  limit?: number;
}): Promise<{ auditTrail: AuditEntry[] }> {
  const params = new URLSearchParams();
  if (filters?.entityType) params.append('entityType', filters.entityType);
  if (filters?.entityId) params.append('entityId', filters.entityId);
  if (filters?.userId) params.append('userId', filters.userId);
  if (filters?.limit) params.append('limit', String(filters.limit));
  return apiRequest(`${API_BASE}/audit-trail?${params}`);
}

// ── Notifications ──────────────────────────────────────────────────────────

export interface ProcNotification {
  id: string;
  property_id: string | null;
  user_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  is_internal: boolean;
  recipient_type: string;
  supplier_id: string | null;
  created_at: string;
  read_at: string | null;
}

export async function fetchProcNotifications(filters?: {
  userId?: string;
  isRead?: boolean;
  propertyId?: string;
}): Promise<{ notifications: ProcNotification[] }> {
  const params = new URLSearchParams();
  if (filters?.userId) params.append('userId', filters.userId);
  if (filters?.isRead !== undefined) params.append('isRead', String(filters.isRead));
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/notifications?${params}`);
}

export async function markNotificationRead(id: string): Promise<{ notification: ProcNotification }> {
  return apiRequest(`${API_BASE}/notifications/${id}/read`, { method: 'PATCH' });
}

// ── Sustainability ─────────────────────────────────────────────────────────

export interface Sustainability {
  id: string;
  supplier_id: string;
  is_local: boolean;
  is_sustainable: boolean;
  eco_certification: string | null;
  sustainable_packaging: boolean;
  ethical_sourcing: boolean;
  environmental_score: number;
  carbon_footprint: number | null;
  carbon_unit: string | null;
  sustainability_report: string | null;
  last_assessed_at: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchSustainability(filters?: {
  supplierId?: string;
}): Promise<{ sustainability: Sustainability[] }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  return apiRequest(`${API_BASE}/sustainability?${params}`);
}

export async function updateSustainability(id: string, data: {
  isLocal?: boolean;
  isSustainable?: boolean;
  ecoCertification?: string;
  sustainablePackaging?: boolean;
  ethicalSourcing?: boolean;
  environmentalScore?: number;
  carbonFootprint?: number;
  carbonUnit?: string;
  sustainabilityReport?: string;
}): Promise<{ sustainability: Sustainability }> {
  return apiRequest(`${API_BASE}/sustainability/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Price Variance ─────────────────────────────────────────────────────────

export interface PriceVariance {
  id: string;
  po_id: string | null;
  supplier_id: string | null;
  item_name: string;
  standard_price: number;
  actual_price: number;
  variance_amount: number;
  variance_percent: number;
  variance_type: 'Favorable' | 'Unfavorable';
  category: string | null;
  department: string | null;
  property_id: string | null;
  recorded_date: string;
  reason: string | null;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchPriceVariance(filters?: {
  supplierId?: string;
  poId?: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ priceVariances: PriceVariance[]; totalVariance: number }> {
  const params = new URLSearchParams();
  if (filters?.supplierId) params.append('supplierId', filters.supplierId);
  if (filters?.poId) params.append('poId', filters.poId);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.startDate) params.append('startDate', filters.startDate);
  if (filters?.endDate) params.append('endDate', filters.endDate);
  return apiRequest(`${API_BASE}/price-variance?${params}`);
}

// ── Budget Commitments ─────────────────────────────────────────────────────

export interface BudgetCommitment {
  id: string;
  budget_id: string;
  po_id: string | null;
  requisition_id: string | null;
  commitment_amount: number;
  commitment_type: 'Requisition' | 'PO' | 'Contract';
  commitment_date: string;
  status: 'Active' | 'Consumed' | 'Cancelled';
  notes: string | null;
  proc_budgets?: { budget_code: string; department: string; category: string };
  proc_purchase_orders?: { po_number: string };
}

export async function fetchBudgetCommitments(filters?: {
  budgetId?: string;
  poId?: string;
}): Promise<{ commitments: BudgetCommitment[]; totalCommitted: number }> {
  const params = new URLSearchParams();
  if (filters?.budgetId) params.append('budgetId', filters.budgetId);
  if (filters?.poId) params.append('poId', filters.poId);
  return apiRequest(`${API_BASE}/budget-commitments?${params}`);
}

// ── Emergency Purchases ────────────────────────────────────────────────────

export type EmergencyReason = 'Critical Equipment Failure' | 'Food Shortage' | 'Guest Safety' | 'Utility Failure' | 'Security Emergency' | 'Critical Maintenance' | 'Regulatory Requirements';
export type EmergencyStatus = 'Pending' | 'Approved' | 'Rejected' | 'Reviewed';

export interface EmergencyPurchase {
  id: string;
  emergency_number: string;
  property_id: string | null;
  department: string;
  requester: string;
  emergency_reason: EmergencyReason;
  description: string;
  supplier_id: string | null;
  amount: number;
  currency: string;
  po_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  post_purchase_review: boolean;
  review_notes: string | null;
  review_date: string | null;
  status: EmergencyStatus;
  proc_suppliers?: { supplier_code: string; legal_name: string };
}

export async function fetchEmergencyPurchases(filters?: {
  status?: EmergencyStatus;
  propertyId?: string;
}): Promise<{ emergencyPurchases: EmergencyPurchase[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/emergency-purchases?${params}`);
}

export async function createEmergencyPurchase(data: {
  propertyId?: string;
  department: string;
  requester: string;
  emergencyReason: EmergencyReason;
  description: string;
  supplierId?: string;
  amount: number;
  currency?: string;
}): Promise<{ emergencyPurchase: EmergencyPurchase }> {
  return apiRequest(`${API_BASE}/emergency-purchases`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateEmergencyPurchase(id: string, data: {
  status?: EmergencyStatus;
  approvedBy?: string;
  postPurchaseReview?: boolean;
  reviewNotes?: string;
}): Promise<{ emergencyPurchase: EmergencyPurchase }> {
  return apiRequest(`${API_BASE}/emergency-purchases/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Approvals Queue (spec sections 42-44) ────────────────────────────────────

export interface ApprovalItem {
  id: string;
  type: string;
  refNumber: string;
  refId: string;
  amount: number;
  currency: string;
  department: string;
  status: string;
  priority: string;
  requester: string;
  createdAt: string;
}

export async function fetchApprovals(filters?: {
  propertyId?: string;
  type?: string;
}): Promise<{ approvals: ApprovalItem[]; count: number }> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  if (filters?.type) params.append('type', filters.type);
  return apiRequest(`${API_BASE}/approvals?${params}`);
}

export async function approveApprovalItem(id: string, comments?: string): Promise<{ approval: any }> {
  return apiRequest(`${API_BASE}/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ comments }) });
}

export async function rejectApprovalItem(id: string, reason?: string): Promise<{ approval: any }> {
  return apiRequest(`${API_BASE}/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ── Approval Delegations ───────────────────────────────────────────────────

export type ApprovalType = 'Purchase Requisition' | 'Purchase Order' | 'Contract' | 'Supplier Activation' | 'Supplier Suspension' | 'Price Override' | 'Emergency Purchase' | 'Budget Exception';

export interface ApprovalDelegation {
  id: string;
  delegator_id: string;
  delegator_name: string;
  delegate_id: string;
  delegate_name: string;
  approval_type: ApprovalType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'Active' | 'Expired' | 'Cancelled';
  created_at: string;
}

export async function fetchApprovalDelegations(filters?: {
  status?: string;
  delegatorId?: string;
  delegateId?: string;
}): Promise<{ delegations: ApprovalDelegation[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.delegatorId) params.append('delegatorId', filters.delegatorId);
  if (filters?.delegateId) params.append('delegateId', filters.delegateId);
  return apiRequest(`${API_BASE}/approval-delegations?${params}`);
}

export async function createApprovalDelegation(data: {
  delegatorId: string;
  delegatorName: string;
  delegateId: string;
  delegateName: string;
  approvalType: ApprovalType;
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<{ delegation: ApprovalDelegation }> {
  return apiRequest(`${API_BASE}/approval-delegations`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateApprovalDelegation(id: string, data: {
  status?: string;
}): Promise<{ delegation: ApprovalDelegation }> {
  return apiRequest(`${API_BASE}/approval-delegations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// ── Supplier Concentration ─────────────────────────────────────────────────

export interface SupplierConcentration {
  supplierId: string;
  supplierName: string;
  totalSpend: number;
  percentage: number;
  riskLevel: 'Low' | 'Medium' | 'High';
}

export async function fetchSupplierConcentration(filters?: {
  propertyId?: string;
}): Promise<{ concentration: SupplierConcentration[]; grandTotal: number }> {
  const params = new URLSearchParams();
  if (filters?.propertyId) params.append('propertyId', filters.propertyId);
  return apiRequest(`${API_BASE}/supplier-concentration?${params}`);
}

// ── Three-Way Matching ─────────────────────────────────────────────────────

export interface ThreeWayMatch {
  po: { poNumber: string; totalAmount: number; supplier: string };
  delivery: { received: number; status: string } | null;
  invoice: any;
  matchStatus: string;
  variances: any[];
}

export async function fetchThreeWayMatch(poId: string): Promise<{ threeWayMatch: ThreeWayMatch }> {
  const params = new URLSearchParams();
  params.append('poId', poId);
  return apiRequest(`${API_BASE}/three-way-match?${params}`);
}