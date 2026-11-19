async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export interface Vendor {
  id: string;
  name: string;
  contact?: string;
  contactName?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  tin?: string;
  withholdingRate?: number;
  withholding_rate?: number;
  category?: string;
  status: string;
  is_active?: boolean;
  balance: number;
  current_balance?: number;
  property_id?: string;
  property_name?: string;
}

export interface BillLine {
  description: string;
  quantity: number;
  rate: number;
  total: number;
}

export interface Bill {
  id: string;
  vendorId: string;
  vendorName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  category?: string;
  amount: number;
  taxAmount: number;
  withholdingAmount: number;
  netPayable: number;
  amountDue: number;
  status: string;
  lines: BillLine[];
  createdAt?: string;
  property_id?: string;
  property_name?: string;
}

export interface Payment {
  id: string;
  billId: string;
  vendorName?: string;
  amount: number;
  paymentDate: string;
  paymentMethod?: string;
  reference?: string;
  status: string;
  property_id?: string;
  property_name?: string;
}

export interface ThreeWayMatch {
  id: string;
  po_number: string;
  vendor_id?: string;
  vendor_name?: string;
  bill_id?: string;
  invoice_match: string;
  receipt_match: string;
  po_amount: number;
  invoice_amount: number;
  variance_pct: number;
  status: string;
  property_id?: string;
  property_name?: string;
}

export interface PaymentSchedule {
  id: string;
  vendor_id?: string;
  vendor_name?: string;
  bill_id?: string;
  bill_number?: string;
  scheduled_date: string;
  amount: number;
  payment_method: string;
  frequency: string;
  auto_pay: boolean;
  status: string;
  property_id?: string;
  property_name?: string;
}

export function mapVendorFromDb(row: any): Vendor {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact_person || row.contact_name,
    contactName: row.contact_person || row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    taxId: row.tin || row.tax_id,
    withholdingRate: row.withholding_rate !== undefined ? Number(row.withholding_rate) : undefined,
    category: row.category,
    status: row.is_active !== undefined ? (row.is_active ? 'Active' : 'Inactive') : (row.status || 'Active'),
    balance: Number(row.current_balance ?? row.balance ?? 0),
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapBillFromDb(row: any): Bill {
  const vendor = row.ap_vendors || {};
  // DB schema uses bill_number, bill_date, subtotal, total_amount, paid_amount
  const subtotal = Number(row.subtotal ?? row.amount ?? 0);
  const tax = Number(row.tax_amount ?? 0);
  const wh = Number(row.withholding_amount ?? 0);
  const total = Number(row.total_amount ?? row.amount ?? 0);
  const paid = Number(row.paid_amount ?? 0);
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: vendor.name || row.vendor_name,
    invoiceNumber: row.bill_number || row.invoice_number,
    invoiceDate: row.bill_date || row.invoice_date,
    dueDate: row.due_date,
    category: row.category,
    amount: total, // gross amount
    taxAmount: tax,
    withholdingAmount: wh,
    netPayable: total - wh,
    amountDue: total - paid,
    status: row.status,
    lines: Array.isArray(row.lines) ? row.lines : [],
    createdAt: row.created_at,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapPaymentFromDb(row: any): Payment {
  const vendor = row.ap_vendors || {};
  return {
    id: row.id,
    billId: row.bill_id,
    vendorName: vendor.name || row.vendor_name,
    amount: Number(row.amount) || 0,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    reference: row.reference,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapMatchFromDb(row: any): ThreeWayMatch {
  const vendor = row.ap_vendors || {};
  return {
    id: row.id,
    po_number: row.po_number,
    vendor_id: row.vendor_id,
    vendor_name: vendor.name || row.vendor_name,
    bill_id: row.bill_id,
    invoice_match: row.invoice_match,
    receipt_match: row.receipt_match,
    po_amount: Number(row.po_amount) || 0,
    invoice_amount: Number(row.invoice_amount) || 0,
    variance_pct: Number(row.variance_pct) || 0,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export function mapScheduleFromDb(row: any): PaymentSchedule {
  const vendor = row.ap_vendors || {};
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    vendor_name: vendor.name || row.vendor_name,
    bill_id: row.bill_id,
    bill_number: row.bill_number,
    scheduled_date: row.scheduled_date,
    amount: Number(row.amount) || 0,
    payment_method: row.payment_method,
    frequency: row.frequency,
    auto_pay: !!row.auto_pay,
    status: row.status,
    property_id: row.property_id,
    property_name: row.property_name,
  };
}

export async function fetchVendors(propertyId?: string): Promise<Vendor[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const rows = await api<any[]>(`/api/accounts-payable/vendors${qs}`);
  return rows.map(mapVendorFromDb);
}

export async function createVendor(vendor: Partial<Vendor> & { propertyId?: string }): Promise<Vendor> {
  const row = await api<any>('/api/accounts-payable/vendors', {
    method: 'POST',
    body: JSON.stringify(vendor),
  });
  return mapVendorFromDb(row);
}

export async function fetchBills(status?: string, propertyId?: string): Promise<Bill[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyId) params.set('propertyId', propertyId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const rows = await api<any[]>(`/api/accounts-payable/bills${qs}`);
  return rows.map(mapBillFromDb);
}

export async function createBill(bill: any): Promise<Bill> {
  const row = await api<any>('/api/accounts-payable/bills', {
    method: 'POST',
    body: JSON.stringify(bill),
  });
  return mapBillFromDb(row);
}

export async function payBill(billId: string, payment: Omit<Payment, 'id' | 'billId' | 'vendorName' | 'status'>): Promise<any> {
  return api<any>(`/api/accounts-payable/bills/${billId}/pay`, {
    method: 'POST',
    body: JSON.stringify(payment),
  });
}

export async function fetchPayments(propertyId?: string): Promise<Payment[]> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const rows = await api<any[]>(`/api/accounts-payable/payments${qs}`);
  return rows.map(mapPaymentFromDb);
}

export async function fetchThreeWayMatches(status?: string, propertyId?: string): Promise<ThreeWayMatch[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyId) params.set('propertyId', propertyId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const rows = await api<any[]>(`/api/accounts-payable/matching${qs}`);
  return rows.map(mapMatchFromDb);
}

export async function approveThreeWayMatch(id: string): Promise<any> {
  return api<any>(`/api/accounts-payable/matching/${id}/approve`, { method: 'POST' });
}

export async function updateThreeWayMatch(id: string, patch: Partial<ThreeWayMatch>): Promise<any> {
  return api<any>(`/api/accounts-payable/matching/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchPaymentSchedules(status?: string, propertyId?: string): Promise<PaymentSchedule[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyId) params.set('propertyId', propertyId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const rows = await api<any[]>(`/api/accounts-payable/scheduling${qs}`);
  return rows.map(mapScheduleFromDb);
}

export async function createPaymentSchedule(schedule: Partial<PaymentSchedule>): Promise<PaymentSchedule> {
  const row = await api<any>('/api/accounts-payable/scheduling', {
    method: 'POST',
    body: JSON.stringify(schedule),
  });
  return mapScheduleFromDb(row);
}

export async function updatePaymentSchedule(id: string, patch: Partial<PaymentSchedule>): Promise<PaymentSchedule> {
  const row = await api<any>(`/api/accounts-payable/scheduling/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return mapScheduleFromDb(row);
}

export async function deletePaymentSchedule(id: string): Promise<any> {
  return api<any>(`/api/accounts-payable/scheduling/${id}`, { method: 'DELETE' });
}
