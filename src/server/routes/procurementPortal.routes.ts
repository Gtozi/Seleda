/**
 * Unified Supply Chain & Procurement Portal Routes
 * Backs the /erp/procurement/* tabs following the Engineering portal DB-integrated pattern.
 * 
 * This route file provides full CRUD for all procurement modules:
 * - Dashboard (KPIs + alerts)
 * - Requisitions (full lifecycle)
 * - RFQs + Quotations + Comparison + Award
 * - Purchase Orders (full lifecycle + amendments)
 * - Suppliers (directory + onboarding + performance + risk)
 * - Contracts (lifecycle + alerts)
 * - Budgets (commitments + utilization)
 * - Receiving Coordination (expected deliveries)
 * - Cost Savings
 * - Demand Forecasts
 * - Configuration
 * 
 * All routes use the proc_* tables from migration 345.
 * Routes use `authenticate` only (no `requirePermission`) to match HK/Engineering patterns.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import { checkApprover, getTaxRates, evaluateBusinessRules } from '../services/adminConfigService';
import { startWorkflows, workflowBlocker } from '../services/workflowEngine';
import { syncDepartmentDemand } from '../services/procurementIntegration';

const router = Router();

/**
 * Central approval gate for purchase orders: pending/rejected admin workflow, the admin approval
 * matrix, and business rules using require_approval(...). Returns the refusal, or null when allowed.
 */
async function poApprovalGate(user: { role?: string } | undefined, po: any, poId: string): Promise<{ status: number; error: string } | null> {
  const blocker = await workflowBlocker('purchase_order', poId);
  if (blocker) return { status: 409, error: blocker };
  const amount = Number(po?.total_amount) || 0;
  const denied = await checkApprover(user, 'purchase_order', amount, { currency: po?.currency, department: po?.department });
  if (denied) return { status: 403, error: denied };
  const rules = await evaluateBusinessRules('procurement', { po: { total: amount, currency: po?.currency, department: po?.department, supplierId: po?.supplier_id }, amount, user: { role: user?.role } }, po?.property_id);
  const role = String(user?.role || '').toLowerCase();
  if (rules.approvalRoles.length && role !== 'executive' && role !== 'system_admin' && !rules.approvalRoles.includes(role)) {
    return { status: 403, error: `Business rule requires approval by: ${[...new Set(rules.approvalRoles)].join(', ')}` };
  }
  return null;
}

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────

// GET /api/proc-portal/dashboard/kpis
// Returns KPI data for the dashboard (14 KPIs per spec section 6)
router.get('/dashboard/kpis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const cacheKey = `proc-dashboard-kpis:${propertyId || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  // Sync department demand signals before computing KPIs.
  await syncDepartmentDemand();

  const propFilter = (table: string) => propertyId
    ? supabaseAdmin.from(table).select('*').eq('property_id', propertyId)
    : supabaseAdmin.from(table).select('*');

  const [requisitions, pos, suppliers, savings, alerts, rfqs, budgets, contracts, forecasts] = await Promise.all([
    propFilter('proc_requisitions'),
    propFilter('proc_purchase_orders'),
    propFilter('proc_suppliers'),
    propFilter('proc_savings'),
    propertyId ? supabaseAdmin.from('proc_alerts').select('*').eq('property_id', propertyId).eq('is_resolved', false) : supabaseAdmin.from('proc_alerts').select('*').eq('is_resolved', false),
    propFilter('proc_rfqs'),
    propFilter('proc_budgets'),
    propFilter('proc_contracts'),
    propFilter('proc_demand_forecasts'),
  ]);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const poData = pos.data || [];
  const supplierData = suppliers.data || [];
  const budgetData = budgets.data || [];
  const contractData = contracts.data || [];

  const totalSpend = poData.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  const monthlySpend = poData
    .filter((p: any) => { const d = new Date(p.order_date); return d.getMonth() === currentMonth && d.getFullYear() === currentYear; })
    .reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  const annualSpend = poData
    .filter((p: any) => new Date(p.order_date).getFullYear() === currentYear)
    .reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);

  const budgetedTotal = budgetData.reduce((sum: number, b: any) => sum + (b.budgeted_amount || 0), 0);
  const spentTotal = budgetData.reduce((sum: number, b: any) => sum + (b.actual_spend || 0) + (b.committed_amount || 0), 0);
  const budgetUtilization = budgetedTotal > 0 ? Math.round((spentTotal / budgetedTotal) * 100) : 0;

  const avgSupplierPerformance = supplierData.length > 0
    ? Math.round(supplierData.reduce((sum: number, s: any) => sum + (s.overall_score || 0), 0) / supplierData.length * 10) / 10
    : 0;

  const contractExpiry = contractData.filter((c: any) => {
    const end = new Date(c.end_date);
    const daysToExpiry = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysToExpiry <= 90 && daysToExpiry >= 0 && c.status === 'Active';
  }).length;

  const supplierRisk = supplierData.filter((s: any) => s.risk_level === 'High' || s.risk_level === 'Critical').length;

  const kpis = {
    openRequisitions: (requisitions.data || []).filter((r: any) => r.status === 'Submitted' || r.status === 'Under Review').length,
    pendingApprovals: (requisitions.data || []).filter((r: any) => r.status === 'Under Review').length + poData.filter((p: any) => p.status === 'Pending Approval').length,
    openRFQs: (rfqs.data || []).filter((r: any) => r.status === 'Issued' || r.status === 'Draft').length,
    openPOs: poData.filter((p: any) => p.status === 'Approved' || p.status === 'Sent to Supplier' || p.status === 'Supplier Acknowledged').length,
    overduePOs: poData.filter((p: any) => ['Approved', 'Sent to Supplier', 'Supplier Acknowledged'].includes(p.status) && new Date(p.required_delivery_date) < now).length,
    pendingDeliveries: poData.filter((p: any) => p.status === 'Sent to Supplier' || p.status === 'Supplier Acknowledged').length,
    totalSpend,
    monthlySpend,
    annualSpend,
    procurementSavings: (savings.data || []).reduce((sum: number, s: any) => sum + (s.amount || 0), 0),
    activeSuppliers: supplierData.filter((s: any) => s.status === 'Active' || s.status === 'Preferred').length,
    activeAlerts: (alerts.data || []).length,
    budgetUtilization,
    supplierPerformance: avgSupplierPerformance,
    contractExpiry,
    supplierRisk,
    // Department integration KPIs
    departmentRequisitions: (requisitions.data || []).filter((r: any) => r.source_system && r.source_system !== 'procurement').length,
    departmentForecasts: (forecasts.data || []).filter((f: any) => f.source_system && f.source_system !== 'procurement').length,
    totalForecasts: (forecasts.data || []).length,
    engineeringRequisitions: (requisitions.data || []).filter((r: any) => r.source_system === 'engineering').length,
    housekeepingRequisitions: (requisitions.data || []).filter((r: any) => r.source_system === 'housekeeping').length,
    foodBeverageRequisitions: (requisitions.data || []).filter((r: any) => r.source_system === 'food_beverage').length,
  };

  const result = { kpis, generatedAt: new Date().toISOString() };
  cacheService.set(cacheKey, result, 5 * 60 * 1000);
  return res.json(result);
});

// GET /api/proc-portal/dashboard/alerts
// Returns dashboard alerts
router.get('/dashboard/alerts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_alerts')
    .select('*')
    .eq('is_resolved', false)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false });

  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ alerts: data || [] });
});

// GET /api/proc-portal/dashboard/sections
// Returns data for the 6 dashboard sections per spec section 6
router.get('/dashboard/sections', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId } = req.query as Record<string, string>;
  const propFilter = (table: string) => propertyId
    ? supabaseAdmin.from(table).select('*').eq('property_id', propertyId)
    : supabaseAdmin.from(table).select('*');

  const [pos, requisitions, suppliers, contracts, budgets, deliveries, savings] = await Promise.all([
    propFilter('proc_purchase_orders'),
    propFilter('proc_requisitions'),
    propFilter('proc_suppliers'),
    propFilter('proc_contracts'),
    propFilter('proc_budgets'),
    propFilter('proc_deliveries'),
    propFilter('proc_savings'),
  ]);

  const now = new Date();
  const poData = pos.data || [];
  const supplierData = suppliers.data || [];
  const contractData = contracts.data || [];
  const budgetData = budgets.data || [];
  const reqData = requisitions.data || [];
  const delData = deliveries.data || [];
  const savData = savings.data || [];

  // 1. Spend trend (last 6 months)
  const spendTrend: { month: string; spend: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = d.toLocaleString('default', { month: 'short' });
    const spend = poData
      .filter((p: any) => { const pd = new Date(p.order_date); return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear(); })
      .reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
    spendTrend.push({ month: monthName, spend });
  }

  // 2. Open requisitions (top 5)
  const openRequisitions = reqData
    .filter((r: any) => ['Submitted', 'Under Review', 'Draft'].includes(r.status))
    .slice(0, 5)
    .map((r: any) => ({ id: r.id, pr_number: r.pr_number, department: r.department, requester: r.requester, priority: r.priority, status: r.status, estimated_total: r.estimated_total }));

  // 3. Supplier performance (top 5)
  const supplierPerformance = supplierData
    .slice(0, 5)
    .map((s: any) => ({ id: s.id, legal_name: s.legal_name, overall_score: s.overall_score, on_time_delivery_rate: s.on_time_delivery_rate, quality_score: s.quality_score, risk_level: s.risk_level }));

  // 4. Delivery alerts (delayed/expected)
  const deliveryAlerts = delData
    .filter((d: any) => ['Expected', 'In Transit', 'Delayed'].includes(d.status))
    .slice(0, 5)
    .map((d: any) => ({ id: d.id, po_id: d.po_id, expected_date: d.expected_date, status: d.status, total_items: d.total_items }));

  // 5. Contract expiry (next 5 expiring)
  const contractExpiry = contractData
    .filter((c: any) => c.status === 'Active')
    .sort((a: any, b: any) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())
    .slice(0, 5)
    .map((c: any) => ({ id: c.id, contract_number: c.contract_number, end_date: c.end_date, contract_value: c.contract_value, status: c.status }));

  // 6. Budget utilization
  const budgetUtilization = budgetData.slice(0, 6).map((b: any) => ({
    id: b.id, budget_code: b.budget_code, department: b.department, category: b.category,
    budgeted_amount: b.budgeted_amount, committed_amount: b.committed_amount, actual_spend: b.actual_spend,
    remaining_budget: b.remaining_budget, status: b.status,
  }));

  // 7. Supplier risk
  const supplierRisk = supplierData
    .filter((s: any) => s.risk_level === 'High' || s.risk_level === 'Critical')
    .slice(0, 5)
    .map((s: any) => ({ id: s.id, legal_name: s.legal_name, risk_level: s.risk_level, supplier_type: s.supplier_type, overall_score: s.overall_score }));

  // 8. Savings by type
  const savingsByType = savData.reduce((acc: Record<string, number>, s: any) => {
    acc[s.savings_type] = (acc[s.savings_type] || 0) + (s.amount || 0);
    return acc;
  }, {});

  return res.json({
    spendTrend,
    openRequisitions,
    supplierPerformance,
    deliveryAlerts,
    contractExpiry,
    budgetUtilization,
    supplierRisk,
    savingsByType,
  });
});

// ── REQUISITIONS ───────────────────────────────────────────────────────────

// GET /api/proc-portal/requisitions
// List requisitions with optional filters
router.get('/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, department, priority, propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_requisitions')
    .select('*, proc_requisition_lines(*)')
    .order('request_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (department) q = q.eq('department', department);
  if (priority) q = q.eq('priority', priority);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ requisitions: data || [] });
});

// POST /api/proc-portal/requisitions
// Create a new requisition
router.post('/requisitions', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, department, requester, requiredDate, priority,
    costCenter, budgetCode, purpose, notes, lines,
  } = req.body || {};

  if (!department || !requester || !requiredDate || !lines || lines.length === 0) {
    return res.status(400).json({ error: 'department, requester, requiredDate, and lines are required' });
  }

  // Generate PR number
  const seq = Date.now().toString().slice(-6);
  const prNumber = `PR-2026-${seq}`;
  const estimatedTotal = lines.reduce((sum: number, l: any) => sum + (l.quantity * l.unitPrice), 0);

  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('proc_requisitions')
    .insert({
      pr_number: prNumber,
      property_id: propertyId || null,
      department,
      requester,
      required_date: requiredDate,
      priority: priority || 'Normal',
      cost_center: costCenter,
      budget_code: budgetCode,
      purpose,
      notes,
      estimated_total: estimatedTotal,
      status: 'Draft',
      source_system: 'procurement',
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (reqError) return res.status(500).json({ error: reqError.message });

  // Insert lines
  const requisitionLines = lines.map((l: any, idx: number) => ({
    requisition_id: requisition.id,
    line_number: idx + 1,
    item_code: l.itemCode,
    item_name: l.itemName,
    description: l.description,
    category: l.category,
    quantity: l.quantity,
    unit_of_measure: l.unitOfMeasure,
    estimated_unit_price: l.unitPrice,
    estimated_total: l.quantity * l.unitPrice,
    required_date: l.requiredDate || requiredDate,
    preferred_supplier_id: l.preferredSupplierId || null,
    specification: l.specification,
    cost_center: l.costCenter,
  }));

  const { error: linesError } = await supabaseAdmin
    .from('proc_requisition_lines')
    .insert(requisitionLines);

  if (linesError) {
    // Rollback requisition
    await supabaseAdmin.from('proc_requisitions').delete().eq('id', requisition.id);
    return res.status(500).json({ error: linesError.message });
  }

  cacheService.invalidate('proc-*');
  return res.status(201).json({ requisition, lines: requisitionLines });
});

// PATCH /api/proc-portal/requisitions/:id
// Update requisition status and fields
router.patch('/requisitions/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, notes, priority, requiredDate } = req.body || {};
  const updateData: any = {};
  
  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'Submitted') updateData.submitted_at = now;
    if (status === 'Under Review') updateData.reviewed_at = now;
    if (status === 'Approved') {
      updateData.approved_at = now;
      updateData.approved_by = req.user?.id;
    }
  }
  if (notes !== undefined) updateData.notes = notes;
  if (priority) updateData.priority = priority;
  if (requiredDate) updateData.required_date = requiredDate;

  const { data, error } = await supabaseAdmin
    .from('proc_requisitions')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Requisition not found' });

  cacheService.invalidate('proc-*');
  return res.json({ requisition: data });
});

// DELETE /api/proc-portal/requisitions/:id
// Delete a requisition (only allowed for Draft status)
router.delete('/requisitions/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Check status first
  const { data: requisition } = await supabaseAdmin
    .from('proc_requisitions')
    .select('status')
    .eq('id', req.params.id)
    .single();

  if (!requisition) return res.status(404).json({ error: 'Requisition not found' });
  if (requisition.status !== 'Draft') {
    return res.status(400).json({ error: 'Only Draft requisitions can be deleted' });
  }

  const { error } = await supabaseAdmin.from('proc_requisitions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.json({ success: true });
});

// POST /api/proc-portal/requisitions/:id/convert-to-po
// Convert an approved requisition to a Purchase Order
router.post('/requisitions/:id/convert-to-po', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { supplierId, notes } = req.body || {};

  // Fetch requisition with lines
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('proc_requisitions')
    .select('*, proc_requisition_lines(*)')
    .eq('id', id)
    .single();

  if (reqError || !requisition) return res.status(404).json({ error: 'Requisition not found' });
  if (!['Approved', 'Sourcing'].includes(requisition.status)) {
    return res.status(400).json({ error: 'Only Approved or Sourcing requisitions can be converted to PO' });
  }
  if (!supplierId) return res.status(400).json({ error: 'supplierId is required' });

  // Generate PO number
  const seq = Date.now().toString().slice(-6);
  const poNumber = `PO-2026-${seq}`;
  const totalAmount = (requisition.proc_requisition_lines || []).reduce(
    (sum: number, l: any) => sum + (l.estimated_total || 0), 0
  );

  // Create PO
  const { data: po, error: poError } = await supabaseAdmin
    .from('proc_purchase_orders')
    .insert({
      po_number: poNumber,
      property_id: requisition.property_id,
      supplier_id: supplierId,
      department: requisition.department,
      order_date: new Date().toISOString().split('T')[0],
      required_delivery_date: requisition.required_date,
      total_amount: totalAmount,
      status: 'Draft',
      notes: notes || `Converted from ${requisition.pr_number}`,
      created_from_requisition_id: requisition.id,
      created_by: req.user?.id,
    })
    .select('*')
    .single();

  if (poError) return res.status(500).json({ error: poError.message });

  // Create PO lines from requisition lines
  const poLines = (requisition.proc_requisition_lines || []).map((l: any, idx: number) => ({
    po_id: po.id,
    line_number: idx + 1,
    item_code: l.item_code,
    item_name: l.item_name,
    description: l.description,
    category: l.category,
    quantity: l.quantity,
    unit_of_measure: l.unit_of_measure,
    unit_price: l.estimated_unit_price,
    total_price: l.estimated_total,
    required_date: l.required_date,
  }));

  if (poLines.length > 0) {
    const { error: linesError } = await supabaseAdmin.from('proc_po_lines').insert(poLines);
    if (linesError) return res.status(500).json({ error: linesError.message });
  }

  // Update requisition status to "Converted to PO"
  const { error: updateError } = await supabaseAdmin
    .from('proc_requisitions')
    .update({
      status: 'Converted to PO',
      converted_po_id: po.id,
      converted_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  cacheService.invalidate('proc-*');
  return res.status(201).json({ po, requisitionId: id });
});

// ── SUPPLIERS ───────────────────────────────────────────────────────────────

// GET /api/proc-portal/suppliers
// List suppliers with optional filters
router.get('/suppliers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, category, type, propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_suppliers')
    .select('*, proc_supplier_contacts(*)')
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (category) q = q.eq('supplier_category', category);
  if (type) q = q.eq('supplier_type', type);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ suppliers: data || [] });
});

// POST /api/proc-portal/suppliers
// Create a new supplier
router.post('/suppliers', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    supplierCode, legalName, tradingName, supplierType, supplierCategory,
    address, city, phone, email, website, taxId, paymentTerms, leadTime,
    propertyId, contacts,
    taxRegistration, businessLicense, insurance,
    currency, deliveryTerms, minimumOrderQuantity,
  } = req.body || {};

  if (!supplierCode || !legalName || !supplierType || !supplierCategory) {
    return res.status(400).json({ error: 'supplierCode, legalName, supplierType, and supplierCategory are required' });
  }

  const { data: supplier, error: supError } = await supabaseAdmin
    .from('proc_suppliers')
    .insert({
      supplier_code: supplierCode,
      legal_name: legalName,
      trading_name: tradingName,
      supplier_type: supplierType,
      supplier_category: supplierCategory,
      address,
      city,
      phone,
      email,
      website,
      tax_id: taxId || taxRegistration,
      tax_registration: taxRegistration,
      business_license: businessLicense,
      insurance,
      currency: currency || 'ETB',
      payment_terms: paymentTerms || 30,
      delivery_terms: deliveryTerms,
      lead_time: leadTime || 7,
      minimum_order_quantity: minimumOrderQuantity || 0,
      property_id: propertyId || null,
      status: 'Application',
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (supError) return res.status(500).json({ error: supError.message });

  // Insert contacts if provided
  if (contacts && contacts.length > 0) {
    const supplierContacts = contacts.map((c: any, idx: number) => ({
      supplier_id: supplier.id,
      name: c.name,
      role: c.role,
      department: c.department,
      email: c.email,
      phone: c.phone,
      is_primary: idx === 0,
      is_billing: c.isBilling || false,
    }));

    await supabaseAdmin.from('proc_supplier_contacts').insert(supplierContacts);
  }

  cacheService.invalidate('proc-*');
  return res.status(201).json({ supplier });
});

// PATCH /api/proc-portal/suppliers/:id
// Update supplier
router.patch('/suppliers/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, notes, paymentTerms, leadTime, riskLevel } = req.body || {};
  const updateData: any = {};

  if (status) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (paymentTerms) updateData.payment_terms = paymentTerms;
  if (leadTime) updateData.lead_time = leadTime;
  if (riskLevel) updateData.risk_level = riskLevel;

  const { data, error } = await supabaseAdmin
    .from('proc_suppliers')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Supplier not found' });

  cacheService.invalidate('proc-*');
  return res.json({ supplier: data });
});

// GET /api/proc-portal/suppliers/:id/performance
// Get supplier performance data
router.get('/suppliers/:id/performance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: performance } = await supabaseAdmin
    .from('proc_supplier_performance')
    .select('*')
    .eq('supplier_id', req.params.id)
    .order('period_start', { ascending: false })
    .limit(12);

  const { data: supplier } = await supabaseAdmin
    .from('proc_suppliers')
    .select('*')
    .eq('id', req.params.id)
    .single();

  return res.json({ supplier, performance: performance || [] });
});

// GET /api/proc-portal/suppliers/:id/risk
// Get supplier risk register
router.get('/suppliers/:id/risk', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: risks } = await supabaseAdmin
    .from('proc_supplier_risks')
    .select('*')
    .eq('supplier_id', req.params.id)
    .order('identified_at', { ascending: false });

  return res.json({ risks: risks || [] });
});

// POST /api/proc-portal/suppliers/:id/risk
// Create a supplier risk entry
router.post('/suppliers/:id/risk', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { riskType, riskLevel, riskDescription, mitigationPlan, owner } = req.body || {};
  if (!riskType || !riskLevel || !riskDescription) {
    return res.status(400).json({ error: 'riskType, riskLevel, and riskDescription are required' });
  }

  const riskId = `risk-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from('proc_supplier_risks')
    .insert({
      id: riskId,
      supplier_id: req.params.id,
      risk_type: riskType,
      risk_level: riskLevel,
      risk_description: riskDescription,
      mitigation_plan: mitigationPlan || null,
      owner: owner || null,
      status: 'Open',
      identified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ risk: data });
});

// ── RFQS ────────────────────────────────────────────────────────────────────

// GET /api/proc-portal/rfqs
// List RFQs with optional filters
router.get('/rfqs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, department, propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_rfqs')
    .select('*, proc_rfq_lines(*), proc_quotations(*)')
    .order('issue_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (department) q = q.eq('department', department);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ rfqs: data || [] });
});

// POST /api/proc-portal/rfqs
// Create a new RFQ
router.post('/rfqs', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, department, procurementOfficer, responseDeadline,
    currency, deliveryRequirement, terms, conditions, requisitionId, supplierIds, lines,
    sourceSystem, sourceRef,
  } = req.body || {};

  if (!department || !procurementOfficer || !responseDeadline || !lines || lines.length === 0) {
    return res.status(400).json({ error: 'department, procurementOfficer, responseDeadline, and lines are required' });
  }

  // Generate RFQ number
  const seq = Date.now().toString().slice(-6);
  const rfqNumber = `RFQ-2026-${seq}`;

  const { data: rfq, error: rfqError } = await supabaseAdmin
    .from('proc_rfqs')
    .insert({
      rfq_number: rfqNumber,
      property_id: propertyId || null,
      department,
      procurement_officer: procurementOfficer,
      response_deadline: responseDeadline,
      currency: currency || 'ETB',
      delivery_requirement: deliveryRequirement,
      terms,
      conditions,
      requisition_id: requisitionId || null,
      status: 'Draft',
      source_system: sourceSystem || 'procurement',
      source_ref: sourceRef || (requisitionId || null),
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (rfqError) return res.status(500).json({ error: rfqError.message });

  // Insert lines
  const rfqLines = lines.map((l: any, idx: number) => ({
    rfq_id: rfq.id,
    line_number: idx + 1,
    item_code: l.itemCode,
    item_name: l.itemName,
    specification: l.specification,
    quantity: l.quantity,
    unit_of_measure: l.unitOfMeasure,
    required_delivery_date: l.requiredDeliveryDate,
    quality_requirement: l.qualityRequirement,
  }));

  await supabaseAdmin.from('proc_rfq_lines').insert(rfqLines);

  // Insert invitations
  if (supplierIds && supplierIds.length > 0) {
    const invitations = supplierIds.map((supplierId: string) => ({
      rfq_id: rfq.id,
      supplier_id: supplierId,
    }));
    await supabaseAdmin.from('proc_rfq_invitations').insert(invitations);
  }

  cacheService.invalidate('proc-*');
  return res.status(201).json({ rfq, lines: rfqLines });
});

// PATCH /api/proc-portal/rfqs/:id
// Update RFQ status or issue RFQ
router.patch('/rfqs/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, awardedSupplierId, awardAmount, awardNotes } = req.body || {};
  const updateData: any = {};

  if (status) {
    updateData.status = status;
    if (status === 'Issued') {
      updateData.issue_date = new Date().toISOString();
    }
  }
  if (awardedSupplierId) {
    updateData.awarded_supplier_id = awardedSupplierId;
    updateData.awarded_at = new Date().toISOString();
  }
  if (awardAmount) updateData.award_amount = awardAmount;
  if (awardNotes) updateData.award_notes = awardNotes;

  const { data, error } = await supabaseAdmin
    .from('proc_rfqs')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'RFQ not found' });

  cacheService.invalidate('proc-*');
  return res.json({ rfq: data });
});

// ── QUOTATIONS ─────────────────────────────────────────────────────────────

// GET /api/proc-portal/quotations
// List quotations with optional filters
router.get('/quotations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { rfqId, supplierId, status } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_quotations')
    .select('*, proc_suppliers(supplier_code, legal_name), proc_quotation_lines(*)')
    .order('submitted_at', { ascending: false });

  if (rfqId) q = q.eq('rfq_id', rfqId);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ quotations: data || [] });
});

// POST /api/proc-portal/quotations
// Create a new quotation (typically called via supplier portal)
router.post('/quotations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    rfqId, supplierId, currency, subtotal, tax, discount, freight, deliveryCost,
    leadTime, paymentTerms, warranty, quoteValidity, minOrderQuantity, supplierNotes, lines,
  } = req.body || {};

  if (!rfqId || !supplierId || !lines || lines.length === 0) {
    return res.status(400).json({ error: 'rfqId, supplierId, and lines are required' });
  }

  const total = (subtotal || 0) + (tax || 0) - (discount || 0) + (freight || 0) + (deliveryCost || 0);

  const seq = Date.now().toString().slice(-6);
  const quotationNumber = `QT-2026-${seq}`;

  const { data: quotation, error: quotError } = await supabaseAdmin
    .from('proc_quotations')
    .insert({
      quotation_number: quotationNumber,
      rfq_id: rfqId,
      supplier_id: supplierId,
      currency: currency || 'ETB',
      subtotal: subtotal || 0,
      tax: tax || 0,
      discount: discount || 0,
      freight: freight || 0,
      delivery_cost: deliveryCost || 0,
      total,
      lead_time: leadTime || 7,
      payment_terms: paymentTerms,
      warranty,
      quote_validity: quoteValidity,
      min_order_quantity: minOrderQuantity,
      supplier_notes: supplierNotes,
      status: 'Received',
    })
    .select()
    .single();

  if (quotError) return res.status(500).json({ error: quotError.message });

  // Insert lines
  const quotationLines = lines.map((l: any, idx: number) => ({
    quotation_id: quotation.id,
    rfq_line_id: l.rfqLineId,
    line_number: idx + 1,
    item_code: l.itemCode,
    item_name: l.itemName,
    quantity: l.quantity,
    unit_of_measure: l.unitOfMeasure,
    unit_price: l.unitPrice,
    line_total: l.quantity * l.unitPrice,
    lead_time: l.leadTime,
  }));

  await supabaseAdmin.from('proc_quotation_lines').insert(quotationLines);

  cacheService.invalidate('proc-*');
  return res.status(201).json({ quotation, lines: quotationLines });
});

// GET /api/proc-portal/rfqs/:id/compare
// Compare quotations for an RFQ
router.get('/rfqs/:id/compare', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: quotations } = await supabaseAdmin
    .from('proc_quotations')
    .select('*, proc_suppliers(supplier_code, legal_name, overall_score), proc_quotation_lines(*)')
    .eq('rfq_id', req.params.id)
    .eq('status', 'Received');

  const comparison = (quotations || []).map((q: any) => ({
    quotationId: q.id,
    quotationNumber: q.quotation_number,
    supplierId: q.supplier_id,
    supplierName: q.proc_suppliers?.legal_name,
    supplierCode: q.proc_suppliers?.supplier_code,
    supplierScore: q.proc_suppliers?.overall_score || 0,
    total: q.total,
    leadTime: q.lead_time,
    paymentTerms: q.payment_terms,
    lines: q.proc_quotation_lines,
  }));

  // Sort by total price (ascending)
  comparison.sort((a, b) => a.total - b.total);

  return res.json({ comparison, recommendation: comparison[0] || null });
});

// ── PURCHASE ORDERS ────────────────────────────────────────────────────────

// GET /api/proc-portal/purchase-orders
// List purchase orders with optional filters
router.get('/purchase-orders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, supplierId, department, propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_purchase_orders')
    .select('*, proc_suppliers(supplier_code, legal_name), proc_po_lines(*)')
    .order('order_date', { ascending: false });

  if (status) q = q.eq('status', status);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (department) q = q.eq('department', department);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ purchaseOrders: data || [] });
});

// POST /api/proc-portal/purchase-orders
// Create a new purchase order
router.post('/purchase-orders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, supplierId, buyer, department, costCenter, currency,
    requiredDeliveryDate, deliveryLocation, paymentTerms, contractId, notes, internalNotes,
    requisitionId, rfqId, quotationId, tenderId, sourceSystem, sourceRef, lines,
  } = req.body || {};

  if (!supplierId || !buyer || !department || !requiredDeliveryDate || !lines || lines.length === 0) {
    return res.status(400).json({ error: 'supplierId, buyer, department, requiredDeliveryDate, and lines are required' });
  }

  // Generate PO number
  const seq = Date.now().toString().slice(-6);
  const poNumber = `PO-2026-${seq}`;

  // Calculate totals (spec section 19: per-line discount + tax)
  const subtotal = lines.reduce((sum: number, l: any) => sum + (l.quantity * l.unitPrice - (l.discount || 0)), 0);
  const vatFraction = ((await getTaxRates({ appliesTo: 'procurement', propertyId })).vat ?? 15) / 100;
  const tax = lines.reduce((sum: number, l: any) => sum + (l.tax != null ? l.tax : (l.quantity * l.unitPrice - (l.discount || 0)) * vatFraction), 0);
  const total = subtotal + tax;

  const { data: po, error: poError } = await supabaseAdmin
    .from('proc_purchase_orders')
    .insert({
      po_number: poNumber,
      property_id: propertyId || null,
      supplier_id: supplierId,
      buyer,
      department,
      cost_center: costCenter,
      currency: currency || 'ETB',
      order_date: new Date().toISOString(),
      required_delivery_date: requiredDeliveryDate,
      delivery_location: deliveryLocation,
      payment_terms: paymentTerms,
      contract_id: contractId,
      notes,
      internal_notes,
      subtotal,
      tax,
      total_amount: total,
      status: 'Draft',
      requisition_id: requisitionId || null,
      rfq_id: rfqId || null,
      quotation_id: quotationId || null,
      tender_id: tenderId || null,
      source_system: sourceSystem || (rfqId ? 'rfq' : tenderId ? 'tender' : 'procurement'),
      source_ref: sourceRef || (rfqId || tenderId || null),
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (poError) return res.status(500).json({ error: poError.message });

  // Insert lines (spec section 19: discount, tax, line_total)
  const poLines = lines.map((l: any, idx: number) => {
    const lineSubtotal = l.quantity * l.unitPrice - (l.discount || 0);
    const lineTax = l.tax != null ? l.tax : lineSubtotal * vatFraction;
    return {
      po_id: po.id,
      line_number: idx + 1,
      item_code: l.itemCode,
      item_name: l.itemName,
      description: l.description,
      category: l.category,
      quantity_ordered: l.quantity,
      unit_of_measure: l.unitOfMeasure,
      unit_price: l.unitPrice,
      discount: l.discount || 0,
      tax: lineTax,
      line_total: lineSubtotal + lineTax,
      required_date: l.requiredDate || requiredDeliveryDate,
      specification: l.specification,
    };
  });

  await supabaseAdmin.from('proc_po_lines').insert(poLines);

  // Update requisition if linked
  if (requisitionId) {
    await supabaseAdmin
      .from('proc_requisitions')
      .update({ status: 'Converted to PO', converted_po_id: po.id, converted_at: new Date().toISOString() })
      .eq('id', requisitionId);
  }

  cacheService.invalidate('proc-*');
  return res.status(201).json({ purchaseOrder: po, lines: poLines });
});

// PATCH /api/proc-portal/purchase-orders/:id
// Update purchase order status or fields.
// When status → 'Approved', auto-creates a gl_invoices (AP) record and posts
// a journal_entries row so the Finance Portal sees the vendor liability.
router.patch('/purchase-orders/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, notes, requiredDeliveryDate, paymentTerms } = req.body || {};
  const updateData: any = {};

  // Fetch the current PO *before* updating so we can detect the transition
  const { data: existingPo } = await supabaseAdmin
    .from('proc_purchase_orders')
    .select('*, proc_suppliers(legal_name), proc_po_lines(*)')
    .eq('id', req.params.id)
    .single();

  if (status === 'Pending Approval' && existingPo && existingPo.status !== 'Pending Approval') {
    const rules = await evaluateBusinessRules('procurement', { po: { total: Number(existingPo.total_amount) || 0, currency: existingPo.currency, department: existingPo.department, supplierId: existingPo.supplier_id }, amount: Number(existingPo.total_amount) || 0, user: { role: req.user?.role } }, existingPo.property_id);
    if (rules.blocked.length) return res.status(422).json({ error: rules.blocked.join('; '), rules: rules.matched.map(m => m.name) });
  }

  if (status === 'Approved' && existingPo && existingPo.status !== 'Approved') {
    const refused = await poApprovalGate(req.user, existingPo, req.params.id);
    if (refused) return res.status(refused.status).json({ error: refused.error });
  }

  if (status) {
    updateData.status = status;
    const now = new Date().toISOString();
    if (status === 'Pending Approval') {
      updateData.submitted_at = now;
      updateData.submitted_by = req.user?.id;
    }
    if (status === 'Approved') {
      updateData.approved_at = now;
      updateData.approved_by = req.user?.id;
    }
    if (status === 'Sent to Supplier') updateData.sent_at = now;
    if (status === 'Supplier Acknowledged') updateData.acknowledged_at = now;
  }
  if (notes !== undefined) updateData.notes = notes;
  if (requiredDeliveryDate) updateData.required_delivery_date = requiredDeliveryDate;
  if (paymentTerms) updateData.payment_terms = paymentTerms;

  const { data, error } = await supabaseAdmin
    .from('proc_purchase_orders')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Purchase order not found' });

  if (status === 'Pending Approval' && existingPo && existingPo.status !== 'Pending Approval') {
    await startWorkflows('purchase_order.submitted', {
      entityType: 'purchase_order', entityId: req.params.id, propertyId: data.property_id, userId: req.user?.id,
      context: { amount: Number(data.total_amount) || 0, currency: data.currency, department: data.department, poNumber: data.po_number },
    });
  }

  // ── Finance Integration: when PO transitions TO 'Approved', create AP invoice + GL journal ──
  if (status === 'Approved' && existingPo && existingPo.status !== 'Approved') {
    try {
      const po = data;
      const supplierName = po.proc_suppliers?.legal_name || `Supplier ${po.supplier_id || ''}`;
      const netAmount = Number(po.subtotal) || 0;
      const taxAmount = Number(po.tax) || 0;
      const totalAmount = Number(po.total_amount) || (netAmount + taxAmount);
      const today = new Date().toISOString().split('T')[0];
      const period = today.slice(0, 7);

      // 1. Create gl_invoices (AP) record
      const invoiceNumber = `AP-PO-${po.po_number || po.id}`;
      const { data: invoice, error: invError } = await supabaseAdmin
        .from('gl_invoices')
        .insert({
          invoice_number: invoiceNumber,
          type: 'AP',
          entity: supplierName,
          issue_date: today,
          net_amount: netAmount,
          tax_amount: taxAmount,
          gl_status: 'Posted',
          gl_ref: po.po_number || po.id,
          items: JSON.stringify((po.proc_po_lines || []).map((l: any) => ({
            desc: l.description || l.item_name || 'PO Line',
            qty: Number(l.quantity) || 0,
            rate: Number(l.unit_price) || 0,
            total: Number(l.total_price) || 0,
          }))),
          property_id: po.property_id || null,
        })
        .select()
        .single();

      // 2. Post journal_entries row (Debit: Inventory/Expense, Credit: Accounts Payable)
      if (!invError && invoice) {
        const jeId = `je_po_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const lines = [
          { accountId: '1400', accountName: 'Inventory', description: `PO ${po.po_number} - Goods Received`, debit: totalAmount, credit: 0 },
          { accountId: '2100', accountName: 'Accounts Payable', description: `PO ${po.po_number} - Vendor Liability`, debit: 0, credit: totalAmount },
        ];
        await supabaseAdmin.from('journal_entries').insert({
          id: jeId,
          entry_date: today,
          period,
          source: 'AP',
          reference: invoiceNumber,
          description: `PO ${po.po_number} approved — AP invoice ${invoiceNumber}`,
          status: 'Posted',
          total_debit: totalAmount,
          total_credit: totalAmount,
          amount: totalAmount,
          department: po.department || 'Procurement',
          lines: JSON.stringify(lines),
          attachments: [],
          posted_at: new Date().toISOString(),
          created_by: req.user?.id || null,
          property_id: po.property_id || null,
        });
      }
    } catch (finErr: any) {
      // Don't fail the PO update if finance posting fails — log and continue
      console.error(`[Procurement→Finance] Failed to create AP invoice for PO ${data.po_number}:`, finErr?.message);
    }
  }

  cacheService.invalidate('proc-*');
  return res.json({ purchaseOrder: data });
});

// POST /api/proc-portal/purchase-orders/:id/amend
// Create an amendment for a purchase order
router.post('/purchase-orders/:id/amend', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { fieldName, previousValue, newValue, reason } = req.body || {};

  if (!fieldName || !newValue || !reason) {
    return res.status(400).json({ error: 'fieldName, newValue, and reason are required' });
  }

  // Get current amendment number
  const { data: existing } = await supabaseAdmin
    .from('proc_po_amendments')
    .select('amendment_number')
    .eq('po_id', req.params.id)
    .order('amendment_number', { ascending: false })
    .limit(1);

  const nextAmendment = (existing?.[0]?.amendment_number || 0) + 1;

  const { data: amendment } = await supabaseAdmin
    .from('proc_po_amendments')
    .insert({
      po_id: req.params.id,
      amendment_number: nextAmendment,
      amended_by: req.user?.id || 'Unknown',
      field_name: fieldName,
      previous_value: previousValue,
      new_value: newValue,
      reason,
    })
    .select()
    .single();

  // Update the PO
  const updateData: any = {};
  updateData[fieldName] = newValue;

  await supabaseAdmin
    .from('proc_purchase_orders')
    .update(updateData)
    .eq('id', req.params.id);

  cacheService.invalidate('proc-*');
  return res.status(201).json({ amendment });
});

// ── CONTRACTS ──────────────────────────────────────────────────────────────

// GET /api/proc-portal/contracts
// List contracts with optional filters
router.get('/contracts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, supplierId, category, propertyId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_contracts')
    .select('*, proc_suppliers(supplier_code, legal_name)')
    .order('end_date', { ascending: true });

  if (status) q = q.eq('status', status);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (category) q = q.eq('category', category);
  if (propertyId) q = q.eq('property_id', propertyId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Add expiry alerts
  const contractsWithAlerts = (data || []).map((c: any) => {
    const daysUntilExpiry = Math.ceil((new Date(c.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return {
      ...c,
      daysUntilExpiry,
      expiryAlert: daysUntilExpiry > 0 && daysUntilExpiry <= 90,
    };
  });

  return res.json({ contracts: contractsWithAlerts });
});

// POST /api/proc-portal/contracts
// Create a new contract
router.post('/contracts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    supplierId, propertyId, category, contractType, startDate, endDate, renewalDate,
    contractValue, currency, paymentTerms, sla, penalties, minCommitment, maxCommitment,
    pricingRules, autoRenew,
  } = req.body || {};

  if (!supplierId || !category || !contractType || !startDate || !endDate) {
    return res.status(400).json({ error: 'supplierId, category, contractType, startDate, and endDate are required' });
  }

  const seq = Date.now().toString().slice(-6);
  const contractNumber = `CTR-2026-${seq}`;

  const { data, error } = await supabaseAdmin
    .from('proc_contracts')
    .insert({
      contract_number: contractNumber,
      supplier_id: supplierId,
      property_id: propertyId || null,
      category,
      contract_type: contractType,
      start_date: startDate,
      end_date: endDate,
      renewal_date: renewalDate,
      contract_value: contractValue,
      currency: currency || 'ETB',
      payment_terms: paymentTerms,
      sla,
      penalties,
      min_commitment: minCommitment,
      max_commitment: maxCommitment,
      pricing_rules: pricingRules || {},
      auto_renew: autoRenew || false,
      status: 'Draft',
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.status(201).json({ contract: data });
});

// PATCH /api/proc-portal/contracts/:id
// Update contract
router.patch('/contracts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, approvedBy, notes } = req.body || {};
  const updateData: any = {};

  if (status) {
    updateData.status = status;
    if (status === 'Active' || status === 'Approved') {
      updateData.approved_at = new Date().toISOString();
      updateData.approved_by = approvedBy || req.user?.id;
    }
  }
  if (notes !== undefined) updateData.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('proc_contracts')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Contract not found' });

  cacheService.invalidate('proc-*');
  return res.json({ contract: data });
});

// ── BUDGETS ─────────────────────────────────────────────────────────────────

// GET /api/proc-portal/budgets
// List budgets with optional filters
router.get('/budgets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, department, category, fiscalYear } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_budgets')
    .select('*')
    .order('fiscal_year', { ascending: false })
    .order('period_start', { ascending: false });

  if (propertyId) q = q.eq('property_id', propertyId);
  if (department) q = q.eq('department', department);
  if (category) q = q.eq('category', category);
  if (fiscalYear) q = q.eq('fiscal_year', parseInt(fiscalYear));

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ budgets: data || [] });
});

// POST /api/proc-portal/budgets
// Create a new budget
router.post('/budgets', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    budgetCode, propertyId, department, category, budgetType, fiscalYear,
    periodStart, periodEnd, budgetedAmount, currency, controlType, notes,
  } = req.body || {};

  if (!budgetCode || !department || !category || !budgetType || !fiscalYear || !periodStart || !periodEnd || !budgetedAmount) {
    return res.status(400).json({ error: 'budgetCode, department, category, budgetType, fiscalYear, periodStart, periodEnd, and budgetedAmount are required' });
  }

  const { data, error } = await supabaseAdmin
    .from('proc_budgets')
    .insert({
      budget_code: budgetCode,
      property_id: propertyId || null,
      department,
      category,
      budget_type: budgetType,
      fiscal_year,
      period_start: periodStart,
      period_end: periodEnd,
      budgeted_amount: budgetedAmount,
      currency: currency || 'ETB',
      control_type: controlType || 'Soft',
      status: 'Active',
      notes,
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.status(201).json({ budget: data });
});

// ── DELIVERIES (Receiving Coordination) ─────────────────────────────────────

// GET /api/proc-portal/deliveries
// List expected deliveries
router.get('/deliveries', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, propertyId, supplierId } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_deliveries')
    .select('*, proc_suppliers(supplier_code, legal_name), proc_purchase_orders(po_number)')
    .order('expected_date', { ascending: true });

  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (supplierId) q = q.eq('supplier_id', supplierId);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ deliveries: data || [] });
});

// PATCH /api/proc-portal/deliveries/:id
// Update delivery status
router.patch('/deliveries/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { status, actualDate, receivedBy, notes, delayReason } = req.body || {};
  const updateData: any = {};

  if (status) updateData.status = status;
  if (actualDate) updateData.actual_date = actualDate;
  if (receivedBy) updateData.received_by = receivedBy;
  if (notes !== undefined) updateData.notes = notes;
  if (delayReason) updateData.delay_reason = delayReason;

  const { data, error } = await supabaseAdmin
    .from('proc_deliveries')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Delivery not found' });

  cacheService.invalidate('proc-*');
  return res.json({ delivery: data });
});

// ── SAVINGS ─────────────────────────────────────────────────────────────────

// GET /api/proc-portal/savings
// List cost savings
router.get('/savings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, savingsType, startDate, endDate } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_savings')
    .select('*, proc_suppliers(supplier_code, legal_name)')
    .order('savings_date', { ascending: false });

  if (propertyId) q = q.eq('property_id', propertyId);
  if (savingsType) q = q.eq('savings_type', savingsType);
  if (startDate) q = q.gte('savings_date', startDate);
  if (endDate) q = q.lte('savings_date', endDate);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const totalSavings = (data || []).reduce((sum: number, s: any) => sum + (s.amount || 0), 0);

  return res.json({ savings: data || [], totalSavings });
});

// POST /api/proc-portal/savings
// Record a cost saving
router.post('/savings', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId, savingsType, amount, description, relatedPoId, relatedRfqId, relatedSupplierId, savingsDate,
  } = req.body || {};

  if (!savingsType || !amount || !savingsDate) {
    return res.status(400).json({ error: 'savingsType, amount, and savingsDate are required' });
  }

  const { data, error } = await supabaseAdmin
    .from('proc_savings')
    .insert({
      property_id: propertyId || null,
      savings_type: savingsType,
      amount,
      description,
      related_po_id: relatedPoId,
      related_rfq_id: relatedRfqId,
      related_supplier_id: relatedSupplierId,
      savings_date,
      recorded_by: req.user?.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.status(201).json({ saving: data });
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────

// GET /api/proc-portal/categories
// List procurement categories
router.get('/categories', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { categoryType } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_categories')
    .select('*')
    .order('name', { ascending: true });

  if (categoryType) q = q.eq('category_type', categoryType);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ categories: data || [] });
});

// POST /api/proc-portal/categories
// Create a new procurement category (spec section 68 master data)
router.post('/categories', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { name, categoryType, parentId, description } = req.body || {};

  if (!name || !categoryType) {
    return res.status(400).json({ error: 'name and categoryType are required' });
  }

  const id = `cat-${Date.now()}`;

  const { data, error } = await supabaseAdmin
    .from('proc_categories')
    .insert({
      id,
      name,
      category_type: categoryType,
      parent_id: parentId || null,
      description: description || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.status(201).json({ category: data });
});

// PATCH /api/proc-portal/categories/:id
// Update a procurement category (name/type/description/active)
router.patch('/categories/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { name, categoryType, description, isActive } = req.body || {};
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (categoryType !== undefined) updateData.category_type = categoryType;
  if (description !== undefined) updateData.description = description;
  if (isActive !== undefined) updateData.is_active = isActive;

  const { data, error } = await supabaseAdmin
    .from('proc_categories')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Category not found' });

  cacheService.invalidate('proc-*');
  return res.json({ category: data });
});

// DELETE /api/proc-portal/categories/:id
// Delete a procurement category
router.delete('/categories/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { error } = await supabaseAdmin
    .from('proc_categories')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('proc-*');
  return res.json({ success: true });
});

// ── CONFIGURATION ───────────────────────────────────────────────────────────

// GET /api/proc-portal/config
// Get procurement configuration
router.get('/config', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('proc_config')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });

  const configMap: Record<string, any> = {};
  (data || []).forEach((c: any) => {
    configMap[c.config_key] = c.config_value;
  });

  return res.json({ config: configMap });
});

// PATCH /api/proc-portal/config/:key
// Update configuration
router.patch('/config/:key', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { value, description } = req.body || {};

  const { data, error } = await supabaseAdmin
    .from('proc_config')
    .update({
      config_value: value,
      description,
      updated_by: req.user?.id,
    })
    .eq('config_key', req.params.key)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Configuration key not found' });

  cacheService.invalidate('proc-*');
  return res.json({ config: data });
});

// GET /api/proc-portal/demand-forecasts
// Get demand forecasts
router.get('/demand-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, department } = req.query as Record<string, string>;

  let q = supabaseAdmin
    .from('proc_demand_forecasts')
    .select('*')
    .order('forecast_date', { ascending: true });

  if (propertyId) q = q.eq('property_id', propertyId);
  if (department) q = q.eq('department', department);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ forecasts: data || [] });
});

// POST /api/proc-portal/demand-forecasts
// Create a demand forecast
router.post('/demand-forecasts', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { propertyId, department, category, forecastDate, forecastQuantity, unitOfMeasure, confidenceLevel, forecastSource, notes } = req.body || {};

  if (!department || !category || !forecastDate || !forecastQuantity || !unitOfMeasure) {
    return res.status(400).json({ error: 'department, category, forecastDate, forecastQuantity, and unitOfMeasure are required' });
  }

  const id = `df-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from('proc_demand_forecasts')
    .insert({
      id,
      property_id: propertyId || null,
      department,
      category,
      forecast_date: forecastDate,
      forecast_quantity: forecastQuantity,
      unit_of_measure: unitOfMeasure,
      confidence_level: confidenceLevel || 'Medium',
      forecast_source: forecastSource || 'Manual',
      notes,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.json({ forecast: data });
});

// PATCH /api/proc-portal/demand-forecasts/:id
// Update a demand forecast
router.patch('/demand-forecasts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { department, category, forecastDate, forecastQuantity, unitOfMeasure, confidenceLevel, forecastSource, notes } = req.body || {};

  const update: Record<string, any> = {};
  if (department !== undefined) update.department = department;
  if (category !== undefined) update.category = category;
  if (forecastDate !== undefined) update.forecast_date = forecastDate;
  if (forecastQuantity !== undefined) update.forecast_quantity = forecastQuantity;
  if (unitOfMeasure !== undefined) update.unit_of_measure = unitOfMeasure;
  if (confidenceLevel !== undefined) update.confidence_level = confidenceLevel;
  if (forecastSource !== undefined) update.forecast_source = forecastSource;
  if (notes !== undefined) update.notes = notes;

  const { data, error } = await supabaseAdmin
    .from('proc_demand_forecasts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.json({ forecast: data });
});

// DELETE /api/proc-portal/demand-forecasts/:id
// Delete a demand forecast
router.delete('/demand-forecasts/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('proc_demand_forecasts')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.json({ success: true });
});

// POST /api/proc-portal/demand-forecasts/:id/convert-to-requisition
// Convert a demand forecast into a Purchase Requisition (spec section 8 demand flow).
// Creates a requisition with a single line derived from the forecast's category/quantity/UoM.
router.post('/demand-forecasts/:id/convert-to-requisition', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { id } = req.params;
  const { requester, priority, costCenter, budgetCode, purpose, notes, unitPrice } = req.body || {};

  // Fetch the forecast
  const { data: forecast, error: fcError } = await supabaseAdmin
    .from('proc_demand_forecasts')
    .select('*')
    .eq('id', id)
    .single();

  if (fcError || !forecast) return res.status(404).json({ error: 'Demand forecast not found' });

  // Generate PR number
  const seq = Date.now().toString().slice(-6);
  const prNumber = `PR-2026-${seq}`;
  const estimatedUnitPrice = typeof unitPrice === 'number' ? unitPrice : 0;
  const estimatedTotal = (forecast.forecast_quantity || 0) * estimatedUnitPrice;

  // Create the requisition
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('proc_requisitions')
    .insert({
      pr_number: prNumber,
      property_id: forecast.property_id,
      department: forecast.department,
      requester: requester || req.user?.name || req.user?.id || 'System',
      required_date: forecast.forecast_date,
      priority: priority || 'Normal',
      cost_center: costCenter || null,
      budget_code: budgetCode || null,
      purpose: purpose || `Converted from demand forecast (${forecast.category})`,
      notes: notes || forecast.notes || undefined,
      estimated_total: estimatedTotal,
      status: 'Draft',
      created_by: req.user?.id,
    })
    .select()
    .single();

  if (reqError) return res.status(500).json({ error: reqError.message });

  // Create a single requisition line from the forecast
  const requisitionLines = [{
    requisition_id: requisition.id,
    line_number: 1,
    item_name: forecast.category,
    description: `Demand forecast: ${forecast.category} for ${forecast.department}`,
    category: forecast.category,
    quantity: forecast.forecast_quantity,
    unit_of_measure: forecast.unit_of_measure,
    estimated_unit_price: estimatedUnitPrice,
    estimated_total: estimatedTotal,
    required_date: forecast.forecast_date,
    specification: forecast.notes || null,
  }];

  const { error: linesError } = await supabaseAdmin
    .from('proc_requisition_lines')
    .insert(requisitionLines);

  if (linesError) {
    // Rollback requisition
    await supabaseAdmin.from('proc_requisitions').delete().eq('id', requisition.id);
    return res.status(500).json({ error: linesError.message });
  }

  cacheService.invalidate('proc-*');
  return res.status(201).json({ requisition, lines: requisitionLines, forecastId: id });
});

// GET /api/proc-portal/demand-analysis
// Aggregated demand analysis: forecasts by department/category, demand sources summary
router.get('/demand-analysis', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Sync department demand signals before computing analysis.
  await syncDepartmentDemand();

  const { propertyId } = req.query as Record<string, string>;
  const propFilter = (table: string) => propertyId
    ? supabaseAdmin.from(table).select('*').eq('property_id', propertyId)
    : supabaseAdmin.from(table).select('*');

  const [forecasts, pos, deliveries, requisitions] = await Promise.all([
    propFilter('proc_demand_forecasts'),
    propFilter('proc_purchase_orders'),
    propFilter('proc_deliveries'),
    propFilter('proc_requisitions'),
  ]);

  const fcData = forecasts.data || [];
  const poData = pos.data || [];
  const delData = deliveries.data || [];
  const reqData = requisitions.data || [];

  // By department
  const byDepartment: Record<string, { count: number; totalQuantity: number }> = {};
  fcData.forEach((f: any) => {
    if (!byDepartment[f.department]) byDepartment[f.department] = { count: 0, totalQuantity: 0 };
    byDepartment[f.department].count++;
    byDepartment[f.department].totalQuantity += f.forecast_quantity || 0;
  });

  // By category
  const byCategory: Record<string, { count: number; totalQuantity: number }> = {};
  fcData.forEach((f: any) => {
    if (!byCategory[f.category]) byCategory[f.category] = { count: 0, totalQuantity: 0 };
    byCategory[f.category].count++;
    byCategory[f.category].totalQuantity += f.forecast_quantity || 0;
  });

  // By source
  const bySource: Record<string, number> = {};
  fcData.forEach((f: any) => {
    const src = f.forecast_source || 'Manual';
    bySource[src] = (bySource[src] || 0) + 1;
  });

  // By confidence
  const byConfidence: Record<string, number> = { Low: 0, Medium: 0, High: 0 };
  fcData.forEach((f: any) => {
    const c = f.confidence_level || 'Medium';
    byConfidence[c] = (byConfidence[c] || 0) + 1;
  });

  // Demand sources summary (per spec section 8)
  const demandSources = {
    openPurchaseOrders: poData.filter((p: any) => ['Approved', 'Sent to Supplier', 'Supplier Acknowledged'].includes(p.status)).length,
    expectedDeliveries: delData.filter((d: any) => ['Expected', 'In Transit'].includes(d.status)).length,
    openRequisitions: reqData.filter((r: any) => ['Submitted', 'Under Review', 'Approved', 'Sourcing'].includes(r.status)).length,
    totalForecasts: fcData.length,
  };

  return res.json({
    byDepartment,
    byCategory,
    bySource,
    byConfidence,
    demandSources,
    totalForecasts: fcData.length,
  });
});

// GET /api/proc-portal/procurement-plan
// Aggregated procurement plan: combines demand forecasts, pending requisitions,
// budgets, open POs, and deliveries into a unified planning view per spec section 9.
// Supports ?horizon=Daily|Weekly|Monthly|Quarterly|Annual&department=...&propertyId=...
router.get('/procurement-plan', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  // Sync department demand signals before building the plan.
  await syncDepartmentDemand();

  const { propertyId, horizon: queryHorizon, department: queryDept } = req.query as Record<string, string>;
  const horizon = queryHorizon || 'Monthly';
  const propFilter = (table: string) => propertyId
    ? supabaseAdmin.from(table).select('*').eq('property_id', propertyId)
    : supabaseAdmin.from(table).select('*');

  const [forecasts, requisitions, budgets, pos, deliveries, contracts, suppliers] = await Promise.all([
    propFilter('proc_demand_forecasts'),
    propFilter('proc_requisitions'),
    propFilter('proc_budgets'),
    propFilter('proc_purchase_orders'),
    propFilter('proc_deliveries'),
    propFilter('proc_contracts'),
    propFilter('proc_suppliers'),
  ]);

  const fcData = forecasts.data || [];
  const reqData = requisitions.data || [];
  const budgData = budgets.data || [];
  const poData = pos.data || [];
  const delData = deliveries.data || [];
  const contractData = contracts.data || [];
  const supData = suppliers.data || [];

  // Filter by department if specified
  const deptFilter = (item: any) => !queryDept || item.department === queryDept;

  // Horizon date range
  const now = new Date();
  let rangeStart = new Date(now);
  let rangeEnd = new Date(now);
  switch (horizon) {
    case 'Daily': rangeEnd.setDate(now.getDate() + 1); break;
    case 'Weekly': rangeEnd.setDate(now.getDate() + 7); break;
    case 'Monthly': rangeEnd.setMonth(now.getMonth() + 1); break;
    case 'Quarterly': rangeEnd.setMonth(now.getMonth() + 3); break;
    case 'Annual': rangeEnd.setFullYear(now.getFullYear() + 1); break;
    default: rangeEnd.setMonth(now.getMonth() + 1);
  }

  const inHorizon = (dateStr: string) => {
    const d = new Date(dateStr);
    return d >= rangeStart && d <= rangeEnd;
  };

  // Plan items: merge forecasts + pending requisitions into plan lines
  const planItems: any[] = [];

  // From forecasts
  fcData.filter(deptFilter).forEach((f: any) => {
    if (!inHorizon(f.forecast_date)) return;
    const matchingReq = reqData.find((r: any) => r.department === f.department && r.status === 'Approved' || r.status === 'Sourcing');
    planItems.push({
      id: f.id,
      type: 'Forecast',
      department: f.department,
      category: f.category,
      item: `${f.category} demand`,
      quantity: f.forecast_quantity,
      unit: f.unit_of_measure,
      date: f.forecast_date,
      confidence: f.confidence_level,
      source: f.forecast_source,
      status: matchingReq ? 'Converted to Requisition' : 'Pending',
      linkedRequisitionId: matchingReq?.id || null,
      estimatedValue: 0,
    });
  });

  // From pending requisitions (Draft, Submitted, Under Review, Approved, Sourcing)
  reqData.filter(deptFilter).forEach((r: any) => {
    if (!['Draft', 'Submitted', 'Under Review', 'Approved', 'Sourcing'].includes(r.status)) return;
    if (!inHorizon(r.required_date)) return;
    planItems.push({
      id: r.id,
      type: 'Requisition',
      department: r.department,
      category: 'N/A',
      item: r.purpose || r.pr_number,
      quantity: 0,
      unit: 'N/A',
      date: r.required_date,
      confidence: 'High',
      source: 'Requisition',
      status: r.status,
      linkedRequisitionId: r.id,
      estimatedValue: r.estimated_total || 0,
    });
  });

  // Budget availability by department
  const budgetByDept: Record<string, { budgeted: number; committed: number; actual: number; remaining: number }> = {};
  budgData.forEach((b: any) => {
    if (!budgetByDept[b.department]) budgetByDept[b.department] = { budgeted: 0, committed: 0, actual: 0, remaining: 0 };
    budgetByDept[b.department].budgeted += b.budgeted_amount || 0;
    budgetByDept[b.department].committed += b.committed_amount || 0;
    budgetByDept[b.department].actual += b.actual_spend || 0;
    budgetByDept[b.department].remaining += (b.remaining_budget || 0);
  });

  // Open POs in horizon
  const openPOsInHorizon = poData.filter(deptFilter).filter((p: any) =>
    ['Approved', 'Sent to Supplier', 'Supplier Acknowledged', 'Partially Received'].includes(p.status) &&
    inHorizon(p.required_delivery_date)
  );

  // Expected deliveries in horizon
  const expectedDeliveries = delData.filter(deptFilter).filter((d: any) =>
    ['Expected', 'In Transit'].includes(d.status) && inHorizon(d.expected_date)
  );

  // Active contracts (for contract commitments factor)
  const activeContracts = contractData.filter((c: any) => c.status === 'Active');

  // Planning factors summary (spec section 9)
  const planningFactors = {
    occupancy: null, // would come from Front Office forecast
    forecastRoomsSold: null,
    restaurantCovers: null,
    banquetEvents: null,
    spaAppointments: null,
    maintenancePlans: null,
    seasonalDemand: null,
    supplierLeadTime: supData.length > 0 ? Math.round(supData.reduce((s: number, x: any) => s + (x.lead_time || 0), 0) / supData.length) : 7,
    contractCommitments: activeContracts.length,
    inventoryLevels: null, // would come from Inventory module
    budgetAvailability: Object.values(budgetByDept).reduce((s: number, x: any) => s + x.remaining, 0),
  };

  // KPIs
  const totalPlannedValue = planItems.reduce((s, p) => s + (p.estimatedValue || 0), 0);
  const pendingCount = planItems.filter((p) => p.status === 'Pending').length;
  const convertedCount = planItems.filter((p) => p.status !== 'Pending').length;

  return res.json({
    horizon,
    rangeStart: rangeStart.toISOString().split('T')[0],
    rangeEnd: rangeEnd.toISOString().split('T')[0],
    planItems,
    budgetByDept,
    openPOsInHorizon: openPOsInHorizon.length,
    expectedDeliveries: expectedDeliveries.length,
    activeContracts: activeContracts.length,
    planningFactors,
    kpis: {
      totalPlanItems: planItems.length,
      pendingCount,
      convertedCount,
      totalPlannedValue,
      openPOs: openPOsInHorizon.length,
      expectedDeliveries: expectedDeliveries.length,
    },
  });
});

// ── TENDERS ────────────────────────────────────────────────────────────────

router.get('/tenders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_tenders').select('*, proc_tender_lines(*), proc_tender_submissions(*, proc_suppliers(supplier_code, legal_name))').order('issue_date', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ tenders: data || [] });
});

router.post('/tenders', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, department, procurementOfficer, title, description, submissionDeadline, currency, estimatedValue, tenderType, terms, conditions, lines, sourceSystem, sourceRef } = req.body || {};
  if (!department || !procurementOfficer || !title || !submissionDeadline) return res.status(400).json({ error: 'department, procurementOfficer, title, and submissionDeadline are required' });
  const seq = Date.now().toString().slice(-6);
  const tenderNumber = `TND-2026-${seq}`;
  const { data: tender, error } = await supabaseAdmin.from('proc_tenders').insert({
    tender_number: tenderNumber, property_id: propertyId || null, department, procurement_officer: procurementOfficer,
    title, description, submission_deadline: submissionDeadline, currency: currency || 'ETB',
    estimated_value: estimatedValue, tender_type: tenderType || 'Open', terms, conditions, status: 'Draft',
    source_system: sourceSystem || 'procurement', source_ref: sourceRef || null, created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (lines && lines.length > 0) {
    const tenderLines = lines.map((l: any, idx: number) => ({ tender_id: tender.id, line_number: idx + 1, item_name: l.itemName, specification: l.specification, quantity: l.quantity, unit_of_measure: l.unitOfMeasure, required_delivery_date: l.requiredDeliveryDate }));
    await supabaseAdmin.from('proc_tender_lines').insert(tenderLines);
  }
  cacheService.invalidate('proc-*');
  return res.status(201).json({ tender });
});

router.patch('/tenders/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, awardedSupplierId, awardedAmount } = req.body || {};
  const updateData: any = {};
  if (status) updateData.status = status;
  if (awardedSupplierId) { updateData.awarded_supplier_id = awardedSupplierId; updateData.awarded_at = new Date().toISOString(); }
  if (awardedAmount) updateData.awarded_amount = awardedAmount;
  const { data, error } = await supabaseAdmin.from('proc_tenders').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Tender not found' });
  cacheService.invalidate('proc-*');
  return res.json({ tender: data });
});

// ── NEGOTIATIONS ───────────────────────────────────────────────────────────

router.get('/negotiations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, supplierId, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_negotiations').select('*, proc_suppliers(supplier_code, legal_name), proc_negotiation_rounds(*)').order('started_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ negotiations: data || [] });
});

router.post('/negotiations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, rfqId, tenderId, supplierId, department, negotiationType, initialPrice, targetPrice, currency, notes, sourceSystem, sourceRef } = req.body || {};
  if (!supplierId || !department || !negotiationType) return res.status(400).json({ error: 'supplierId, department, and negotiationType are required' });
  const seq = Date.now().toString().slice(-6);
  const negotiationNumber = `NEG-2026-${seq}`;
  const { data, error } = await supabaseAdmin.from('proc_negotiations').insert({
    negotiation_number: negotiationNumber, property_id: propertyId || null, rfq_id: rfqId || null, tender_id: tenderId || null,
    supplier_id: supplierId, department, negotiation_type: negotiationType, status: 'Open',
    initial_price: initialPrice, target_price: targetPrice, currency: currency || 'ETB', notes,
    source_system: sourceSystem || (rfqId ? 'rfq' : tenderId ? 'tender' : 'procurement'),
    source_ref: sourceRef || (rfqId || tenderId || null),
    created_by: req.user?.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ negotiation: data });
});

router.patch('/negotiations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, finalPrice, savingsAmount, outcome, notes } = req.body || {};
  const updateData: any = {};
  if (status) { updateData.status = status; if (status === 'Agreed' || status === 'Closed') updateData.closed_at = new Date().toISOString(); }
  if (finalPrice !== undefined) updateData.final_price = finalPrice;
  if (savingsAmount !== undefined) updateData.savings_amount = savingsAmount;
  if (outcome !== undefined) updateData.outcome = outcome;
  if (notes !== undefined) updateData.notes = notes;
  const { data, error } = await supabaseAdmin.from('proc_negotiations').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Negotiation not found' });
  cacheService.invalidate('proc-*');
  return res.json({ negotiation: data });
});

// ── SUPPLIER ONBOARDING ────────────────────────────────────────────────────

router.get('/supplier-onboarding', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { stage, supplierId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_supplier_onboarding').select('*, proc_suppliers(supplier_code, legal_name, supplier_category)').order('application_date', { ascending: false });
  if (stage) q = q.eq('current_stage', stage);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ onboarding: data || [] });
});

router.patch('/supplier-onboarding/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { currentStage, notes, rejectionReason } = req.body || {};
  const updateData: any = {};
  if (currentStage) {
    updateData.current_stage = currentStage;
    const now = new Date().toISOString();
    if (currentStage === 'Procurement Review') updateData.procurement_reviewed_at = now;
    if (currentStage === 'Compliance Review') updateData.compliance_reviewed_at = now;
    if (currentStage === 'Finance Verification') updateData.finance_verified_at = now;
    if (currentStage === 'Approval') updateData.approved_at = now;
    if (currentStage === 'Activated') updateData.activated_at = now;
    if (currentStage === 'Rejected') { updateData.rejected_at = now; updateData.rejection_reason = rejectionReason; }
  }
  if (notes !== undefined) updateData.notes = notes;
  const { data, error } = await supabaseAdmin.from('proc_supplier_onboarding').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Onboarding record not found' });
  // Update supplier status when activated
  if (currentStage === 'Activated') {
    await supabaseAdmin.from('proc_suppliers').update({ status: 'Active' }).eq('id', data.supplier_id);
  }
  cacheService.invalidate('proc-*');
  return res.json({ onboarding: data });
});

// ── SUPPLIER QUALIFICATIONS ────────────────────────────────────────────────

router.get('/supplier-qualifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, status } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_supplier_qualifications').select('*, proc_suppliers(supplier_code, legal_name)').order('created_at', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ qualifications: data || [] });
});

router.post('/supplier-qualifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, criteriaType, status, score, expiryDate, notes } = req.body || {};
  if (!supplierId || !criteriaType) return res.status(400).json({ error: 'supplierId and criteriaType are required' });
  const { data, error } = await supabaseAdmin.from('proc_supplier_qualifications').insert({
    supplier_id: supplierId, criteria_type: criteriaType, status: status || 'Pending', score, expiry_date: expiryDate, notes, evaluated_by: req.user?.id, evaluated_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ qualification: data });
});

router.patch('/supplier-qualifications/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, score, notes, expiryDate } = req.body || {};
  const updateData: any = {};
  if (status) updateData.status = status;
  if (score !== undefined) updateData.score = score;
  if (notes !== undefined) updateData.notes = notes;
  if (expiryDate) updateData.expiry_date = expiryDate;
  updateData.evaluated_by = req.user?.id;
  updateData.evaluated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('proc_supplier_qualifications').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Qualification not found' });
  cacheService.invalidate('proc-*');
  return res.json({ qualification: data });
});

// ── SUPPLIER EVALUATIONS ───────────────────────────────────────────────────

router.get('/supplier-evaluations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_supplier_evaluations').select('*, proc_suppliers(supplier_code, legal_name)').order('evaluation_date', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ evaluations: data || [] });
});

router.post('/supplier-evaluations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, evaluationPeriod, evaluator, qualityScore, deliveryScore, priceScore, serviceScore, complianceScore, overallScore, rating, strengths, weaknesses, recommendations, actionRequired, nextReviewDate } = req.body || {};
  if (!supplierId || !evaluationPeriod || !evaluator) return res.status(400).json({ error: 'supplierId, evaluationPeriod, and evaluator are required' });
  const { data, error } = await supabaseAdmin.from('proc_supplier_evaluations').insert({
    supplier_id: supplierId, evaluation_period: evaluationPeriod, evaluator,
    quality_score: qualityScore || 0, delivery_score: deliveryScore || 0, price_score: priceScore || 0,
    service_score: serviceScore || 0, compliance_score: complianceScore || 0, overall_score: overallScore || 0,
    rating, strengths, weaknesses, recommendations, action_required: actionRequired, next_review_date: nextReviewDate,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ evaluation: data });
});

// ── SUPPLIER DOCUMENTS ─────────────────────────────────────────────────────

router.get('/supplier-documents', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, documentType } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_supplier_documents').select('*, proc_suppliers(supplier_code, legal_name)').order('created_at', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (documentType) q = q.eq('document_type', documentType);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ documents: data || [] });
});

router.post('/supplier-documents', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, documentType, documentName, documentUrl, issueDate, expiryDate, notes } = req.body || {};
  if (!supplierId || !documentType || !documentName) return res.status(400).json({ error: 'supplierId, documentType, and documentName are required' });
  const { data, error } = await supabaseAdmin.from('proc_supplier_documents').insert({
    supplier_id: supplierId, document_type: documentType, document_name: documentName, document_url: documentUrl,
    issue_date: issueDate, expiry_date: expiryDate, notes,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ document: data });
});

router.patch('/supplier-documents/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, verificationStatus, verifiedBy } = req.body || {};
  const updateData: any = {};
  if (status) updateData.status = status;
  if (verificationStatus) { updateData.verification_status = verificationStatus; updateData.verified_by = verifiedBy || req.user?.id; updateData.verified_at = new Date().toISOString(); }
  const { data, error } = await supabaseAdmin.from('proc_supplier_documents').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Document not found' });
  cacheService.invalidate('proc-*');
  return res.json({ document: data });
});

router.delete('/supplier-documents/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('proc_supplier_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.json({ success: true });
});

// ── PO TRACKING ────────────────────────────────────────────────────────────

router.get('/po-tracking', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { poId, trackingStatus } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_po_tracking').select('*, proc_purchase_orders(po_number)').order('created_at', { ascending: false });
  if (poId) q = q.eq('po_id', poId);
  if (trackingStatus) q = q.eq('tracking_status', trackingStatus);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ tracking: data || [] });
});

router.post('/po-tracking', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { poId, trackingNumber, carrier, shipmentDate, estimatedArrival, trackingStatus, currentLocation, notes } = req.body || {};
  if (!poId) return res.status(400).json({ error: 'poId is required' });
  const { data, error } = await supabaseAdmin.from('proc_po_tracking').insert({
    po_id: poId, tracking_number: trackingNumber, carrier, shipment_date: shipmentDate,
    estimated_arrival: estimatedArrival, tracking_status: trackingStatus || 'Pending', current_location: currentLocation, notes,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ tracking: data });
});

router.patch('/po-tracking/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { trackingStatus, actualArrival, currentLocation, notes } = req.body || {};
  const updateData: any = {};
  if (trackingStatus) updateData.tracking_status = trackingStatus;
  if (actualArrival) updateData.actual_arrival = actualArrival;
  if (currentLocation !== undefined) updateData.current_location = currentLocation;
  if (notes !== undefined) updateData.notes = notes;
  const { data, error } = await supabaseAdmin.from('proc_po_tracking').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Tracking record not found' });
  cacheService.invalidate('proc-*');
  return res.json({ tracking: data });
});

// ── AUDIT TRAIL ────────────────────────────────────────────────────────────

router.get('/audit-trail', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { entityType, entityId, userId, limit } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_audit_trail').select('*').order('created_at', { ascending: false });
  if (entityType) q = q.eq('entity_type', entityType);
  if (entityId) q = q.eq('entity_id', entityId);
  if (userId) q = q.eq('user_id', userId);
  q = q.limit(parseInt(limit || '100'));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ auditTrail: data || [] });
});

router.post('/audit-trail', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { action, entityType, entityId, entityNumber, previousValue, newValue, reason } = req.body || {};
  if (!action || !entityType) return res.status(400).json({ error: 'action and entityType are required' });
  const { data, error } = await supabaseAdmin.from('proc_audit_trail').insert({
    user_id: req.user?.id, user_name: req.user?.name || 'System', action, entity_type: entityType,
    entity_id: entityId, entity_number: entityNumber, previous_value: previousValue, new_value: newValue, reason,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ audit: data });
});

// ── NOTIFICATIONS ──────────────────────────────────────────────────────────

router.get('/notifications', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { userId, isRead, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_notifications').select('*').order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  if (isRead !== undefined) q = q.eq('is_read', isRead === 'true');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notifications: data || [] });
});

router.patch('/notifications/:id/read', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('proc_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Notification not found' });
  return res.json({ notification: data });
});

// ── SUSTAINABILITY ─────────────────────────────────────────────────────────

router.get('/sustainability', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_sustainability').select('*, proc_suppliers(supplier_code, legal_name)').order('created_at', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ sustainability: data || [] });
});

router.patch('/sustainability/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { isLocal, isSustainable, ecoCertification, sustainablePackaging, ethicalSourcing, environmentalScore, carbonFootprint, carbonUnit, sustainabilityReport } = req.body || {};
  const updateData: any = {};
  if (isLocal !== undefined) updateData.is_local = isLocal;
  if (isSustainable !== undefined) updateData.is_sustainable = isSustainable;
  if (ecoCertification !== undefined) updateData.eco_certification = ecoCertification;
  if (sustainablePackaging !== undefined) updateData.sustainable_packaging = sustainablePackaging;
  if (ethicalSourcing !== undefined) updateData.ethical_sourcing = ethicalSourcing;
  if (environmentalScore !== undefined) updateData.environmental_score = environmentalScore;
  if (carbonFootprint !== undefined) updateData.carbon_footprint = carbonFootprint;
  if (carbonUnit !== undefined) updateData.carbon_unit = carbonUnit;
  if (sustainabilityReport !== undefined) updateData.sustainability_report = sustainabilityReport;
  updateData.last_assessed_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('proc_sustainability').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Sustainability record not found' });
  cacheService.invalidate('proc-*');
  return res.json({ sustainability: data });
});

// ── PRICE VARIANCE ─────────────────────────────────────────────────────────

router.get('/price-variance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { supplierId, poId, propertyId, startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_price_variance').select('*, proc_suppliers(supplier_code, legal_name)').order('recorded_date', { ascending: false });
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (poId) q = q.eq('po_id', poId);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (startDate) q = q.gte('recorded_date', startDate);
  if (endDate) q = q.lte('recorded_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const totalVariance = (data || []).reduce((sum: number, p: any) => sum + (p.variance_amount || 0), 0);
  return res.json({ priceVariances: data || [], totalVariance });
});

// ── BUDGET COMMITMENTS ─────────────────────────────────────────────────────

router.get('/budget-commitments', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { budgetId, poId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_budget_commitments').select('*, proc_budgets(budget_code, department, category), proc_purchase_orders(po_number)').order('commitment_date', { ascending: false });
  if (budgetId) q = q.eq('budget_id', budgetId);
  if (poId) q = q.eq('po_id', poId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const totalCommitted = (data || []).filter((c: any) => c.status === 'Active').reduce((sum: number, c: any) => sum + (c.commitment_amount || 0), 0);
  return res.json({ commitments: data || [], totalCommitted });
});

// ── EMERGENCY PURCHASES ────────────────────────────────────────────────────

router.get('/emergency-purchases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_emergency_purchases').select('*, proc_suppliers(supplier_code, legal_name)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ emergencyPurchases: data || [] });
});

router.post('/emergency-purchases', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, department, requester, emergencyReason, description, supplierId, amount, currency } = req.body || {};
  if (!department || !requester || !emergencyReason || !description || !amount) return res.status(400).json({ error: 'department, requester, emergencyReason, description, and amount are required' });
  const seq = Date.now().toString().slice(-6);
  const emergencyNumber = `EMG-2026-${seq}`;
  const { data, error } = await supabaseAdmin.from('proc_emergency_purchases').insert({
    emergency_number: emergencyNumber, property_id: propertyId || null, department, requester,
    emergency_reason: emergencyReason, description, supplier_id: supplierId, amount, currency: currency || 'ETB', status: 'Pending',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ emergencyPurchase: data });
});

router.patch('/emergency-purchases/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, approvedBy, postPurchaseReview, reviewNotes } = req.body || {};
  const updateData: any = {};
  if (status) { updateData.status = status; if (status === 'Approved') { updateData.approved_by = approvedBy || req.user?.id; updateData.approved_at = new Date().toISOString(); } }
  if (postPurchaseReview !== undefined) { updateData.post_purchase_review = postPurchaseReview; updateData.review_date = new Date().toISOString(); }
  if (reviewNotes !== undefined) updateData.review_notes = reviewNotes;
  const { data, error } = await supabaseAdmin.from('proc_emergency_purchases').update(updateData).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Emergency purchase not found' });
  cacheService.invalidate('proc-*');
  return res.json({ emergencyPurchase: data });
});

// ── APPROVALS QUEUE (spec sections 42-44) ──────────────────────────────────
// Aggregates pending approvals from across procurement modules.

router.get('/approvals', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, type } = req.query as Record<string, string>;

  const approvals: any[] = [];

  // Purchase Requisitions pending approval (spec section 42)
  if (!type || type === 'Purchase Requisition') {
    const { data: reqs } = await supabaseAdmin
      .from('proc_requisitions')
      .select('id, requisition_number, department, total_amount, currency, status, priority, requested_by, created_at, property_id')
      .eq('status', 'Under Review');
    (reqs || []).forEach((r: any) => {
      if (propertyId && r.property_id !== propertyId) return;
      approvals.push({
        id: `REQ-${r.id}`,
        type: 'Purchase Requisition',
        refNumber: r.requisition_number,
        refId: r.id,
        amount: r.total_amount,
        currency: r.currency || 'ETB',
        department: r.department,
        status: r.status,
        priority: r.priority || 'Normal',
        requester: r.requested_by,
        createdAt: r.created_at,
      });
    });
  }

  // Purchase Orders pending approval (spec section 42)
  if (!type || type === 'Purchase Order') {
    const { data: pos } = await supabaseAdmin
      .from('proc_purchase_orders')
      .select('id, po_number, department, total_amount, currency, status, buyer, created_at, property_id')
      .eq('status', 'Pending Approval');
    (pos || []).forEach((p: any) => {
      if (propertyId && p.property_id !== propertyId) return;
      approvals.push({
        id: `PO-${p.id}`,
        type: 'Purchase Order',
        refNumber: p.po_number,
        refId: p.id,
        amount: p.total_amount,
        currency: p.currency || 'ETB',
        department: p.department,
        status: p.status,
        priority: 'Normal',
        requester: p.buyer,
        createdAt: p.created_at,
      });
    });
  }

  // RFQ Awards pending (Closed RFQs with awarded supplier — for spec section 42)
  if (!type || type === 'RFQ Award') {
    const { data: rfqs } = await supabaseAdmin
      .from('proc_rfqs')
      .select('id, rfq_number, department, award_amount, currency, status, procurement_officer, created_at, property_id')
      .eq('status', 'Closed')
      .not('awarded_supplier_id', 'is', null);
    (rfqs || []).forEach((r: any) => {
      if (propertyId && r.property_id !== propertyId) return;
      approvals.push({
        id: `RFQ-${r.id}`,
        type: 'RFQ Award',
        refNumber: r.rfq_number,
        refId: r.id,
        amount: r.award_amount,
        currency: r.currency || 'ETB',
        department: r.department,
        status: 'Pending Award Approval',
        priority: 'Normal',
        requester: r.procurement_officer,
        createdAt: r.created_at,
      });
    });
  }

  // Contracts pending approval (spec section 42)
  if (!type || type === 'Contract') {
    const { data: contracts } = await supabaseAdmin
      .from('proc_contracts')
      .select('id, contract_number, department, contract_value, currency, status, procurement_officer, created_at, property_id')
      .eq('status', 'Approval');
    (contracts || []).forEach((c: any) => {
      if (propertyId && c.property_id !== propertyId) return;
      approvals.push({
        id: `CTR-${c.id}`,
        type: 'Contract',
        refNumber: c.contract_number,
        refId: c.id,
        amount: c.contract_value,
        currency: c.currency || 'ETB',
        department: c.department,
        status: c.status,
        priority: 'Normal',
        requester: c.procurement_officer,
        createdAt: c.created_at,
      });
    });
  }

  // Supplier Activation pending (spec section 42)
  if (!type || type === 'Supplier Activation') {
    const { data: suppliers } = await supabaseAdmin
      .from('proc_suppliers')
      .select('id, supplier_code, legal_name, supplier_type, status, created_at, property_id')
      .eq('status', 'Pending Approval');
    (suppliers || []).forEach((s: any) => {
      if (propertyId && s.property_id !== propertyId) return;
      approvals.push({
        id: `SUP-${s.id}`,
        type: 'Supplier Activation',
        refNumber: s.supplier_code,
        refId: s.id,
        amount: 0,
        currency: 'ETB',
        department: 'Procurement',
        status: s.status,
        priority: 'Normal',
        requester: s.legal_name,
        createdAt: s.created_at,
      });
    });
  }

  // Sort by created_at descending
  approvals.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return res.json({ approvals, count: approvals.length });
});

// POST /api/proc-portal/approvals/:id/approve — approve a pending item
router.post('/approvals/:id/approve', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { comments } = req.body || {};
  const [prefix, refId] = id.split('-');

  try {
    if (prefix === 'REQ') {
      const { data, error } = await supabaseAdmin.from('proc_requisitions')
        .update({ status: 'Approved', approved_by: req.user?.id, approved_at: new Date().toISOString(), approval_comments: comments })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'PO') {
      const { data: po } = await supabaseAdmin.from('proc_purchase_orders').select('total_amount, currency, department, supplier_id, property_id').eq('id', refId).single();
      const refused = po && await poApprovalGate(req.user, po, refId);
      if (refused) return res.status(refused.status).json({ error: refused.error });
      const { data, error } = await supabaseAdmin.from('proc_purchase_orders')
        .update({ status: 'Approved', approved_by: req.user?.id, approved_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'CTR') {
      const { data, error } = await supabaseAdmin.from('proc_contracts')
        .update({ status: 'Active', approved_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'SUP') {
      const { data, error } = await supabaseAdmin.from('proc_suppliers')
        .update({ status: 'Active', approved_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    return res.status(400).json({ error: 'Unknown approval type prefix' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to approve' });
  }
});

// POST /api/proc-portal/approvals/:id/reject — reject a pending item
router.post('/approvals/:id/reject', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { id } = req.params;
  const { reason } = req.body || {};
  const [prefix, refId] = id.split('-');

  try {
    if (prefix === 'REQ') {
      const { data, error } = await supabaseAdmin.from('proc_requisitions')
        .update({ status: 'Rejected', rejected_by: req.user?.id, rejected_at: new Date().toISOString(), rejection_reason: reason })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'PO') {
      const { data, error } = await supabaseAdmin.from('proc_purchase_orders')
        .update({ status: 'Rejected', rejected_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'CTR') {
      const { data, error } = await supabaseAdmin.from('proc_contracts')
        .update({ status: 'Rejected', rejected_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    if (prefix === 'SUP') {
      const { data, error } = await supabaseAdmin.from('proc_suppliers')
        .update({ status: 'Rejected', rejected_at: new Date().toISOString() })
        .eq('id', refId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      cacheService.invalidate('proc-*');
      return res.json({ approval: data });
    }
    return res.status(400).json({ error: 'Unknown approval type prefix' });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to reject' });
  }
});

// ── APPROVAL DELEGATIONS ───────────────────────────────────────────────────

router.get('/approval-delegations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status, delegatorId, delegateId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_approval_delegations').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (delegatorId) q = q.eq('delegator_id', delegatorId);
  if (delegateId) q = q.eq('delegate_id', delegateId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ delegations: data || [] });
});

router.post('/approval-delegations', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { delegatorId, delegatorName, delegateId, delegateName, approvalType, startDate, endDate, reason } = req.body || {};
  if (!delegatorId || !delegateId || !approvalType || !startDate || !endDate) return res.status(400).json({ error: 'delegatorId, delegateId, approvalType, startDate, and endDate are required' });
  const { data, error } = await supabaseAdmin.from('proc_approval_delegations').insert({
    delegator_id: delegatorId, delegator_name: delegatorName, delegate_id: delegateId, delegate_name: delegateName,
    approval_type: approvalType, start_date: startDate, end_date: endDate, reason, status: 'Active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('proc-*');
  return res.status(201).json({ delegation: data });
});

router.patch('/approval-delegations/:id', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.body || {};
  const { data, error } = await supabaseAdmin.from('proc_approval_delegations').update({ status }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Delegation not found' });
  cacheService.invalidate('proc-*');
  return res.json({ delegation: data });
});

// ── SUPPLIER CONCENTRATION ─────────────────────────────────────────────────

router.get('/supplier-concentration', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('proc_purchase_orders').select('supplier_id, total_amount, proc_suppliers(legal_name)');
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Calculate concentration by supplier
  const supplierTotals: Record<string, { name: string; total: number }> = {};
  let grandTotal = 0;
  (data || []).forEach((po: any) => {
    const sid = po.supplier_id;
    if (!supplierTotals[sid]) supplierTotals[sid] = { name: po.proc_suppliers?.legal_name || sid, total: 0 };
    supplierTotals[sid].total += po.total_amount || 0;
    grandTotal += po.total_amount || 0;
  });
  const concentration = Object.entries(supplierTotals).map(([sid, info]) => ({
    supplierId: sid, supplierName: info.name, totalSpend: info.total,
    percentage: grandTotal > 0 ? (info.total / grandTotal) * 100 : 0,
    riskLevel: (info.total / (grandTotal || 1)) * 100 > 70 ? 'High' : (info.total / (grandTotal || 1)) * 100 > 50 ? 'Medium' : 'Low',
  })).sort((a, b) => b.totalSpend - a.totalSpend);
  return res.json({ concentration, grandTotal });
});

// ── THREE-WAY MATCHING ─────────────────────────────────────────────────────

router.get('/three-way-match', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { poId } = req.query as Record<string, string>;
  if (!poId) return res.status(400).json({ error: 'poId is required' });
  // Get PO, deliveries, and check matching
  const { data: po } = await supabaseAdmin.from('proc_purchase_orders').select('*, proc_po_lines(*), proc_suppliers(legal_name)').eq('id', poId).single();
  if (!po) return res.status(404).json({ error: 'PO not found' });
  const { data: deliveries } = await supabaseAdmin.from('proc_deliveries').select('*').eq('po_id', poId);
  const matchResult = {
    po: { poNumber: po.po_number, totalAmount: po.total_amount, supplier: po.proc_suppliers?.legal_name },
    delivery: deliveries && deliveries.length > 0 ? { received: deliveries[0].received_quantity, status: deliveries[0].status } : null,
    invoice: null, // Invoice data would come from Finance
    matchStatus: deliveries && deliveries.length > 0 && deliveries[0].status === 'Fully Received' ? 'Matched' : 'Pending',
    variances: [],
  };
  return res.json({ threeWayMatch: matchResult });
});

export default router;