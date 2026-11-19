const API_BASE = '/api/expense-management';

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

export interface ExpenseRequest {
  id: string;
  request_date: string;
  department: string;
  category: string;
  subcategory?: string;
  description: string;
  amount: number;
  status: 'Under Review' | 'Approved' | 'Paid' | 'Rejected';
  requested_by: string;
  approver?: string;
  attachments: number;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  is_grn: boolean;
  supplier_name?: string;
  property_id?: string;
  property_name?: string;
}

export interface ExpenseClaim {
  id: string;
  employee_id?: string;
  employee_name: string;
  amount: number;
  category: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  submitted_date: string;
  approved_date?: string;
  approved_by?: string;
  receipts_count: number;
  property_id?: string;
  property_name?: string;
}

export interface ApprovalWorkflow {
  id: string;
  workflow_name: string;
  category?: string;
  min_amount: number;
  max_amount: number;
  approver_level1: string;
  approver_level2?: string;
  auto_approve_below: number;
  status: 'Active' | 'Inactive';
  property_id?: string;
  property_name?: string;
}

export interface RecurringExpense {
  id: string;
  description: string;
  category: string;
  amount: number;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Annual';
  next_date: string;
  vendor?: string;
  department?: string;
  status: 'Active' | 'Paused' | 'Cancelled';
  property_id?: string;
  property_name?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

export function mapExpenseRequestFromDb(row: any): ExpenseRequest {
  return {
    id: row.id,
    request_date: row.request_date,
    department: row.department,
    category: row.category,
    subcategory: row.subcategory,
    description: row.description,
    amount: Number(row.amount) || 0,
    status: row.status,
    requested_by: row.requested_by,
    approver: row.approver,
    attachments: Number(row.attachments) || 0,
    priority: row.priority,
    is_grn: row.is_grn,
    supplier_name: row.supplier_name,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapExpenseClaimFromDb(row: any): ExpenseClaim {
  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    amount: Number(row.amount) || 0,
    category: row.category,
    description: row.description,
    status: row.status,
    submitted_date: row.submitted_date,
    approved_date: row.approved_date,
    approved_by: row.approved_by,
    receipts_count: Number(row.receipts_count) || 0,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapApprovalWorkflowFromDb(row: any): ApprovalWorkflow {
  return {
    id: row.id,
    workflow_name: row.workflow_name,
    category: row.category,
    min_amount: Number(row.min_amount) || 0,
    max_amount: Number(row.max_amount) || 0,
    approver_level1: row.approver_level1,
    approver_level2: row.approver_level2,
    auto_approve_below: Number(row.auto_approve_below) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapRecurringExpenseFromDb(row: any): RecurringExpense {
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    amount: Number(row.amount) || 0,
    frequency: row.frequency,
    next_date: row.next_date,
    vendor: row.vendor,
    department: row.department,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function fetchExpenseRequests(propertyId?: string): Promise<ExpenseRequest[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/expenses${qs}`);
  return Array.isArray(data) ? data.map(mapExpenseRequestFromDb) : [];
}

export async function updateExpenseRequestStatus(id: string, status: string): Promise<ExpenseRequest> {
  const data = await apiRequest<any>(`/expenses/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return mapExpenseRequestFromDb(data);
}

export async function fetchExpenseClaims(propertyId?: string): Promise<ExpenseClaim[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/claims${qs}`);
  return Array.isArray(data) ? data.map(mapExpenseClaimFromDb) : [];
}

export async function updateExpenseClaimStatus(id: string, status: string): Promise<ExpenseClaim> {
  const data = await apiRequest<any>(`/claims/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return mapExpenseClaimFromDb(data);
}

export async function fetchApprovalWorkflows(propertyId?: string): Promise<ApprovalWorkflow[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/approval-workflows${qs}`);
  return Array.isArray(data) ? data.map(mapApprovalWorkflowFromDb) : [];
}

export async function fetchRecurringExpenses(propertyId?: string): Promise<RecurringExpense[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const data = await apiRequest<any[]>(`/recurring${qs}`);
  return Array.isArray(data) ? data.map(mapRecurringExpenseFromDb) : [];
}
