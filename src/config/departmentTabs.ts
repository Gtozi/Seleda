/**
 * Per-department tab registry — single source of truth for the tabs each
 * department exposes, their display labels, and their `modId` (used by the
 * `hasModuleAccess` permission check in App.tsx).
 *
 * Phase 0 of the route-driven migration (see ROUTE_DRIVEN_MIGRATION_PLAN.md).
 * INTRODUCED in Phase 0, not yet wired into routing. Consumed in Phase 3 when
 * each tab becomes a route (`/erp/:department/:tab`).
 *
 * Source: extracted verbatim from the `subNavConfig` memo in App.tsx
 * (lines 696-1033). The `id`/`label`/`modId` values match exactly so that
 * access-control behavior is preserved when the registry replaces the memo.
 *
 * Dynamic departments:
 *   - `admin`: tabs come from `CORE_ADMIN_MODULES` (filtered by `moduleToggles`).
 *     Not listed here; resolved at runtime via `adminModules.ts`.
 *   - `executive` and `operations`: share a common tab set whose `modId` prefix
 *     differs (`exec_*` vs `ops_*`). The base tab ids/labels are listed here
 *     under `executive`/`operations`; the modId is resolved at runtime based on
 *     the active department. `operations` ALSO has a distinct sub-nav in
 *     App.tsx (lines 1009-1032) that overrides the shared one — see the note
 *     on the `operations` entry.
 */

export interface TabConfig {
  /** Tab identifier — becomes the `:tab` route segment. */
  id: string;
  /** Display label in the side nav. */
  label: string;
  /**
   * Module id used by `hasModuleAccess(modId)`. For `executive`/`operations`
   * the prefix depends on the active department and is resolved at runtime;
   * the value here is the `exec_*` form and `resolveModId` produces the `ops_*`
   * variant.
   */
  modId: string;
  /** Optional section header for grouping tabs in the side nav. */
  section?: string;
  /**
   * Optional Platform Controls submodule key (System Admin → Platform
   * Controls → department submodules). When set, the tab is hidden
   * web-app-wide whenever `moduleToggles[toggleKey] === false`.
   */
  toggleKey?: string;
}

/**
 * Static tab sets per department. Departments with dynamic tabs (`admin`) are
 * omitted and resolved separately.
 */
export const DEPARTMENT_TABS: Readonly<Record<string, readonly TabConfig[]>> = {
  frontoffice: [
    { id: 'dashboard', label: 'Dashboard', modId: 'fo_dashboard' },
    { id: 'reservations', label: 'Reservations', modId: 'fo_reservations' },
    { id: 'availability-inventory', label: 'Availability', modId: 'fo_availability' },
    { id: 'front-desk-operations', label: 'Front Desk Ops', modId: 'fo_front_desk_ops' },
    { id: 'room-assignment', label: 'Room Assignment', modId: 'fo_room_assignment' },
    { id: 'guest-profiles', label: 'Guest Profiles', modId: 'fo_guest_profiles' },
    { id: 'group-profiles-management', label: 'Group Profiles', modId: 'fo_group_profiles' },
    { id: 'check-in', label: 'Check-In', modId: 'fo_check_in' },
    { id: 'check-out', label: 'Check-Out', modId: 'fo_check_out' },
    { id: 'folio-billing', label: 'Folio & Billing', modId: 'fo_folio' },
    { id: 'night-audit', label: 'Night Audit', modId: 'fo_night_audit' },
    { id: 'keys-access', label: 'Keys & Access', modId: 'fo_keys_access' },
    { id: 'concierge-portal', label: 'Concierge Portal', modId: 'fo_concierge_portal' },
    { id: 'guest-requests', label: 'Guest Requests', modId: 'fo_guest_requests' },
    { id: 'lost-found', label: 'Lost & Found', modId: 'fo_lost_found' },
    { id: 'communication-center', label: 'Comms', modId: 'fo_communication' },
    { id: 'requisitions', label: 'Requisitions', modId: 'fo_requisitions' },
    { id: 'inventory-consumption', label: 'Inventory Consumption', modId: 'fo_inventory_consumption' },
    { id: 'reports', label: 'Reports', modId: 'fo_reports' },
    { id: 'configuration', label: 'Config', modId: 'fo_configuration' },
    { id: 'staff', label: 'Staff Management', modId: 'fo_staff' },
  ],
  // Housekeeping — 19 modules per docs/Housekeeping Portal new.md (§3).
  // Room Cleaning (§7) and Public Area Cleaning (§8) consolidated into
  // Task Management (§6) as a unified master-detail interface.
  housekeeping: [
    { id: 'dashboard', label: 'Dashboard', modId: 'hk_dashboard' },
    { id: 'rooms', label: 'Room Status', modId: 'hk_rooms' },
    { id: 'tasks', label: 'Task Management', modId: 'hk_tasks' },
    { id: 'inspections', label: 'Room Inspections', modId: 'hk_inspections' },
    { id: 'staff', label: 'Staff Management', modId: 'hk_staff' },
    { id: 'supervisor', label: 'Supervisor Console', modId: 'hk_supervisor' },
    { id: 'laundry', label: 'Laundry Interface', modId: 'hk_laundry' },
    { id: 'amenities', label: 'Amenities Management', modId: 'hk_amenities' },
    { id: 'minibar', label: 'Minibar Operations', modId: 'hk_minibar' },
    { id: 'lostfound', label: 'Lost & Found', modId: 'hk_lostfound' },
    { id: 'guest-requests', label: 'Guest Requests', modId: 'hk_guest_requests' },
    { id: 'deep-cleaning', label: 'Deep Cleaning', modId: 'hk_deep_cleaning' },
    { id: 'preventive-cleaning', label: 'Preventive Cleaning', modId: 'hk_preventive' },
    { id: 'maintenance', label: 'Maintenance Coordination', modId: 'hk_maintenance' },
    { id: 'inventory', label: 'Inventory', modId: 'hk_inventory' },
    { id: 'communication', label: 'Communication Center', modId: 'hk_communication' },
    { id: 'reports', label: 'Reports', modId: 'hk_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'hk_configuration' },
  ],
  'f&b': [
    { id: 'executive-dashboard', label: 'Executive Dashboard', modId: 'fb_executive_dashboard' },
    { id: 'outlet-management', label: 'Outlet Management', modId: 'fb_outlet_management' },
    { id: 'menu-management', label: 'Menu Management', modId: 'fb_menu_management' },
    { id: 'recipe-management', label: 'Recipe Management', modId: 'fb_recipe_management' },
    { id: 'pricing-packages', label: 'Pricing & Packages', modId: 'fb_pricing_packages' },
    { id: 'service-operations', label: 'Service Operations', modId: 'fb_service_operations' },
    { id: 'production-coordination', label: 'Production Coordination', modId: 'fb_production_coordination' },
    { id: 'banquet-fb', label: 'Banquet F&B', modId: 'fb_banquet_fb' },
    { id: 'room-service', label: 'Room Service', modId: 'fb_room_service' },
    { id: 'inventory-coordination', label: 'Inventory', modId: 'fb_inventory_coordination' },
    { id: 'guest-experience', label: 'Guest Experience', modId: 'fb_guest_experience' },
    { id: 'staff-operations', label: 'F&B Staff Operations', modId: 'fb_staff_operations' },
    { id: 'quality-compliance', label: 'Quality & Compliance', modId: 'fb_quality_compliance' },
    { id: 'financials', label: 'Financials & Analytics', modId: 'fb_financials' },
    { id: 'reports', label: 'Reports', modId: 'fb_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'fb_configuration' },
    { id: 'integrations', label: 'Integrations', modId: 'fb_integrations' },
  ],
  maintenance: [
    { id: 'dashboard', label: 'Dashboard', modId: 'eng_dashboard' },
    { id: 'work-requests', label: 'Work Requests', modId: 'eng_work_requests' },
    { id: 'workorders', label: 'Work Orders', modId: 'eng_workorders' },
    { id: 'corrective-maintenance', label: 'Corrective Maint.', modId: 'eng_corrective_maintenance' },
    { id: 'pm', label: 'Preventive Maint.', modId: 'eng_pm' },
    { id: 'equipment-registry', label: 'Equipment Registry', modId: 'eng_equipment_registry' },
    { id: 'building-maintenance', label: 'Building Maint.', modId: 'eng_building_maintenance' },
    { id: 'energy-management', label: 'Energy Management', modId: 'eng_energy_management' },
    { id: 'spare-parts', label: 'Spare Parts & Tools', modId: 'eng_spare_parts' },
    { id: 'inspections', label: 'Inspections', modId: 'eng_inspections' },
    { id: 'calibration', label: 'Calibration', modId: 'eng_calibration' },
    { id: 'projects-renovations', label: 'Projects & Renovations', modId: 'eng_projects' },
    { id: 'communication', label: 'Communication', modId: 'eng_communication' },
    { id: 'configuration', label: 'Configuration', modId: 'eng_configuration' },
    { id: 'rooms', label: 'Guest Rooms', modId: 'eng_rooms' },
    { id: 'utilities', label: 'Utilities & Plant', modId: 'eng_utilities' },
    { id: 'staff', label: 'Technicians', modId: 'eng_staff' },
    { id: 'compliance', label: 'Safety & Compliance', modId: 'eng_compliance' },
    { id: 'reports', label: 'Reports', modId: 'eng_reports' },
  ],
  inventory: [
    { id: 'dashboard', label: 'Dashboard', modId: 'inv_dashboard' },
    { id: 'items', label: 'Item & Material Master', modId: 'inv_items' },
    { id: 'inventory', label: 'Inventory Control', modId: 'inv_inventory' },
    { id: 'stores', label: 'Stores & Warehouses', modId: 'inv_stores' },
    { id: 'stock-operations', label: 'Stock Operations', modId: 'inv_stock_operations' },
    { id: 'storekeeping', label: 'Storekeeping', modId: 'inv_storekeeping' },
    { id: 'stock-control', label: 'Stock Control', modId: 'inv_stock_control' },
    { id: 'reservations', label: 'Reservations & Allocations', modId: 'inv_reservations_allocations' },
    { id: 'replenishment-procurement', label: 'Replenishment & Procurement', modId: 'inv_replenishment' },
    { id: 'assets-resources', label: 'Assets & Resources', modId: 'inv_fixed_assets' },
    { id: 'reports', label: 'Valuation & Reports', modId: 'inv_reports' },
    { id: 'audit', label: 'Audit & Compliance', modId: 'inv_audit' },
    { id: 'advanced-operations', label: 'Advanced Operations', modId: 'inv_advanced_operations' },
    { id: 'configuration', label: 'Configuration', modId: 'inv_configuration' },
    // ── Legacy alias tabs (hidden from side nav via App.tsx filter, but
    //    registered so old URLs /erp/inventory/<alias> resolve instead of
    //    redirecting to the default tab). Each maps to the same modId as
    //    its parent consolidated tab. ──
    { id: 'receiving', label: 'Receiving', modId: 'inv_stock_operations' },
    { id: 'issues-returns', label: 'Issues & Returns', modId: 'inv_stock_operations' },
    { id: 'transfers', label: 'Transfers', modId: 'inv_stock_operations' },
    { id: 'put-away', label: 'Put Away', modId: 'inv_storekeeping' },
    { id: 'picking', label: 'Picking', modId: 'inv_storekeeping' },
    { id: 'batch-lot-serial', label: 'Serials & Lots', modId: 'inv_storekeeping' },
    { id: 'expiry', label: 'Expiry', modId: 'inv_storekeeping' },
    { id: 'quarantine', label: 'Quarantine', modId: 'inv_storekeeping' },
    { id: 'adjustments', label: 'Adjustments', modId: 'inv_stock_control' },
    { id: 'stock-counts', label: 'Stock Counts', modId: 'inv_stock_control' },
    { id: 'waste', label: 'Waste', modId: 'inv_stock_control' },
    { id: 'consumption', label: 'Consumption', modId: 'inv_stock_control' },
    { id: 'reservations-allocations', label: 'Reservations & Allocations', modId: 'inv_reservations_allocations' },
    { id: 'replenishment', label: 'Replenishment', modId: 'inv_replenishment' },
    { id: 'supply-procurement', label: 'Supply Procurement', modId: 'inv_replenishment' },
    { id: 'fixed-assets', label: 'Fixed Assets', modId: 'inv_fixed_assets' },
    { id: 'physical-resources', label: 'Physical Resources', modId: 'inv_fixed_assets' },
    { id: 'equipment-tools', label: 'Equipment & Tools', modId: 'inv_fixed_assets' },
    { id: 'linen', label: 'Linen', modId: 'inv_fixed_assets' },
    { id: 'uniforms', label: 'Uniforms', modId: 'inv_fixed_assets' },
    { id: 'returnables', label: 'Returnables', modId: 'inv_fixed_assets' },
    { id: 'loanables', label: 'Loanables', modId: 'inv_fixed_assets' },
    { id: 'physical-verification', label: 'Physical Verification', modId: 'inv_fixed_assets' },
    { id: 'valuation', label: 'Valuation', modId: 'inv_reports' },
  ],
  finance: [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'fin_dashboard' },
    { id: 'gl', label: 'General Ledger', modId: 'fin_gl' },
    { id: 'coa', label: 'Chart of Accounts', modId: 'fin_coa' },
    { id: 'folio-billing', label: 'Folio Management', modId: 'fin_folio' },
    { id: 'ar', label: 'Accounts Receivable', modId: 'fin_ar' },
    { id: 'ap', label: 'Accounts Payable', modId: 'fin_ap' },
    { id: 'cash_bank', label: 'Cash & Bank', modId: 'fin_cash_bank' },
    { id: 'treasury', label: 'Treasury', modId: 'fin_treasury' },
    { id: 'revenue', label: 'Revenue', modId: 'fin_revenue' },
    { id: 'expense', label: 'Expense', modId: 'fin_expense' },
    { id: 'cost_center', label: 'Cost Center', modId: 'fin_cost_center' },
    { id: 'budgeting', label: 'Budgeting', modId: 'fin_budgeting' },
    { id: 'fixed_assets', label: 'Fixed Assets', modId: 'fin_fixed_assets' },
    { id: 'inventory', label: 'Inventory', modId: 'fin_inventory' },
    { id: 'intercompany', label: 'Intercompany', modId: 'fin_intercompany' },
    { id: 'tax', label: 'Tax', modId: 'fin_tax' },
    { id: 'financial_close', label: 'Financial Close', modId: 'fin_financial_close' },
    { id: 'consolidation', label: 'Consolidation', modId: 'fin_consolidation' },
    { id: 'audit_compliance', label: 'Audit', modId: 'fin_audit_compliance' },
    { id: 'documents', label: 'Documents', modId: 'fin_documents' },
    { id: 'approval', label: 'Approvals', modId: 'fin_approval' },
    { id: 'bi', label: 'Business Intel', modId: 'fin_bi' },
    { id: 'requisitions', label: 'Requisitions', modId: 'fin_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'fin_reports' },
    { id: 'config', label: 'Configuration', modId: 'fin_config' },
  ],
  hr: [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'hr_dashboard' },
    { id: 'organization', label: 'Organization Management', modId: 'hr_organization' },
    { id: 'employees', label: 'Employee Management', modId: 'hr_employees' },
    { id: 'recruitment', label: 'Recruitment', modId: 'hr_recruitment' },
    { id: 'ats', label: 'Applicant Tracking (ATS)', modId: 'hr_ats' },
    { id: 'onboarding', label: 'Onboarding', modId: 'hr_onboarding' },
    { id: 'ess', label: 'Employee Self-Service', modId: 'hr_ess' },
    { id: 'mss', label: 'Manager Self-Service', modId: 'hr_mss' },
    { id: 'attendance', label: 'Attendance Management', modId: 'hr_attendance' },
    { id: 'shifts', label: 'Shift & Rostering', modId: 'hr_shifts' },
    { id: 'leave', label: 'Leave Management', modId: 'hr_leave' },
    { id: 'overtime', label: 'Time & Overtime', modId: 'hr_overtime' },
    { id: 'payroll', label: 'Payroll Management', modId: 'hr_payroll' },
    { id: 'compensation', label: 'Compensation & Benefits', modId: 'hr_compensation' },
    { id: 'performance', label: 'Performance Management', modId: 'hr_performance' },
    { id: 'learning', label: 'Learning & Development', modId: 'hr_learning' },
    { id: 'training', label: 'Training Management', modId: 'hr_training' },
    { id: 'career', label: 'Career & Succession', modId: 'hr_career' },
    { id: 'health', label: 'Health & Safety', modId: 'hr_health' },
    { id: 'relations', label: 'Employee Relations', modId: 'hr_relations' },
    { id: 'documents', label: 'Document Management', modId: 'hr_documents' },
    { id: 'workflow', label: 'Workflow & Approvals', modId: 'hr_workflow' },
    { id: 'requisitions', label: 'Requisitions', modId: 'hr_requisitions' },
    { id: 'analytics', label: 'Reports & Analytics', modId: 'hr_analytics' },
    { id: 'configuration', label: 'Configuration', modId: 'hr_configuration' },
    { id: 'offboarding', label: 'Offboarding', modId: 'hr_offboarding' },
    { id: 'accrual', label: 'Leave Accrual', modId: 'hr_accrual' },
    { id: 'contract-expiry', label: 'Contract Expiry', modId: 'hr_contract_expiry' },
    { id: 'loans', label: 'Loan Management', modId: 'hr_loans' },
  ],
  security: [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'sec_dashboard', toggleKey: 'security_dashboard' },
    { id: 'soc', label: 'Security Operations Center', modId: 'sec_soc', toggleKey: 'security_soc' },
    { id: 'incidents', label: 'Incident Management', modId: 'sec_incidents', toggleKey: 'security_incidents' },
    { id: 'investigations', label: 'Investigations', modId: 'sec_investigations', toggleKey: 'security_incidents' },
    { id: 'visitors', label: 'Visitor Management', modId: 'sec_visitors', toggleKey: 'security_visitors' },
    { id: 'access-control', label: 'Access Control', modId: 'sec_access', toggleKey: 'security_access' },
    { id: 'keys', label: 'Key & Keycard Management', modId: 'sec_keys', toggleKey: 'security_access' },
    { id: 'cctv', label: 'CCTV Management', modId: 'sec_cctv', toggleKey: 'security_surveillance' },
    { id: 'patrols', label: 'Patrol Management', modId: 'sec_patrols', toggleKey: 'security_surveillance' },
    { id: 'lost-found', label: 'Lost & Found Oversight', modId: 'sec_lostfound', toggleKey: 'security_lostfound' },
    { id: 'emergency', label: 'Emergency Management', modId: 'sec_emergency', toggleKey: 'security_emergency' },
    { id: 'fire-safety', label: 'Fire & Life Safety', modId: 'sec_firesafety', toggleKey: 'security_emergency' },
    { id: 'risk', label: 'Risk Management', modId: 'sec_risk', toggleKey: 'security_risk' },
    { id: 'business-continuity', label: 'Business Continuity', modId: 'sec_businesscontinuity', toggleKey: 'security_risk' },
    { id: 'crisis', label: 'Crisis Management', modId: 'sec_crisis', toggleKey: 'security_emergency' },
    { id: 'health-safety', label: 'Health & Safety Coordination', modId: 'sec_healthsafety', toggleKey: 'security_emergency' },
    { id: 'compliance', label: 'Compliance Management', modId: 'sec_compliance', toggleKey: 'security_compliance' },
    { id: 'asset-protection', label: 'Asset Protection', modId: 'sec_assetprotection', toggleKey: 'security_compliance' },
    { id: 'fraud-prevention', label: 'Fraud Prevention', modId: 'sec_fraudprevention', toggleKey: 'security_compliance' },
    { id: 'evidence', label: 'Evidence Management', modId: 'sec_evidence', toggleKey: 'security_compliance' },
    { id: 'communication', label: 'Communication Center', modId: 'sec_communication', toggleKey: 'security_communication' },
    { id: 'staff', label: 'Staff Management', modId: 'sec_staff', toggleKey: 'security_staff' },
    { id: 'requisitions', label: 'Requisitions', modId: 'sec_requisitions', toggleKey: 'security_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'sec_reports', toggleKey: 'security_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'sec_configuration', toggleKey: 'security_configuration' },
  ],
  transportation: [
    { id: 'dashboard', label: 'Dashboard', modId: 'trans_dashboard' },
    { id: 'my-trips', label: 'My Trips', modId: 'trans_my_trips' },
    { id: 'requests', label: 'Requests', modId: 'trans_requests' },
    { id: 'dispatch', label: 'Dispatch Center', modId: 'trans_dispatch' },
    { id: 'trips', label: 'Trip Management', modId: 'trans_trips' },
    { id: 'airport', label: 'Airport Transfers', modId: 'trans_airport' },
    { id: 'shuttle', label: 'Shuttle Management', modId: 'trans_shuttle' },
    { id: 'guest', label: 'Guest Transportation', modId: 'trans_guest' },
    { id: 'corporate', label: 'Corporate Transportation', modId: 'trans_corporate' },
    { id: 'staff', label: 'Staff Transportation', modId: 'trans_staff' },
    { id: 'fleet', label: 'Fleet Management', modId: 'trans_fleet' },
    { id: 'vehicles', label: 'Vehicle Registry', modId: 'trans_vehicles' },
    { id: 'drivers', label: 'Driver Management', modId: 'trans_drivers' },
    { id: 'routes', label: 'Route Management', modId: 'trans_routes' },
    { id: 'scheduling', label: 'Scheduling & Dispatch', modId: 'trans_scheduling' },
    { id: 'gps', label: 'GPS Tracking', modId: 'trans_gps' },
    { id: 'fuel', label: 'Fuel Management', modId: 'trans_fuel' },
    { id: 'maintenance', label: 'Vehicle Maintenance', modId: 'trans_maintenance' },
    { id: 'contractors', label: 'Contractors', modId: 'trans_contractors' },
    { id: 'billing', label: 'Billing & Charges', modId: 'trans_billing' },
    { id: 'communication', label: 'Communication Center', modId: 'trans_communication' },
    { id: 'requisitions', label: 'Requisitions', modId: 'trans_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'trans_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'trans_configuration' },
  ],
  procurement: [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'proc_dashboard' },
    { id: 'demand-planning', label: 'Demand Planning', modId: 'proc_demand_planning' },
    { id: 'procurement-planning', label: 'Procurement Planning', modId: 'proc_planning' },
    { id: 'requisitions', label: 'Purchase Requisitions', modId: 'proc_requisitions' },
    { id: 'rfq', label: 'RFQ Management', modId: 'proc_rfq' },
    { id: 'tenders', label: 'Tender Management', modId: 'proc_tenders' },
    { id: 'negotiations', label: 'Negotiations', modId: 'proc_negotiations' },
    { id: 'orders', label: 'Purchase Orders', modId: 'proc_orders' },
    { id: 'po-tracking', label: 'PO Tracking', modId: 'proc_po_tracking' },
    { id: 'approvals', label: 'Approval Center', modId: 'proc_approvals' },
    { id: 'suppliers', label: 'Supplier Directory', modId: 'proc_suppliers' },
    { id: 'onboarding', label: 'Supplier Onboarding', modId: 'proc_onboarding' },
    { id: 'qualification', label: 'Supplier Qualification', modId: 'proc_qualification' },
    { id: 'evaluation', label: 'Supplier Evaluation', modId: 'proc_evaluation' },
    { id: 'documents', label: 'Supplier Documents', modId: 'proc_documents' },
    { id: 'contracts', label: 'Contract Management', modId: 'proc_contracts' },
    { id: 'budget', label: 'Procurement Budget', modId: 'proc_budget' },
    { id: 'receiving', label: 'Receiving Coordination', modId: 'proc_receiving' },
    { id: 'risk', label: 'Risk Management', modId: 'proc_risk' },
    { id: 'analytics', label: 'Procurement Analytics', modId: 'proc_analytics' },
    { id: 'reports', label: 'Reports', modId: 'proc_reports' },
    { id: 'config', label: 'Configuration', modId: 'proc_config' },
  ],
  sales: [
    { id: 'dashboard', label: 'Dashboard', modId: 'sales_dashboard' },
    { id: 'crm', label: 'CRM', modId: 'sales_crm' },
    { id: 'guest-profiles', label: 'Guest Profiles', modId: 'sales_guest_profiles' },
    { id: 'corporate-accounts', label: 'Corporate Accounts', modId: 'sales_corporate_accounts' },
    { id: 'travel-agents', label: 'Travel Agents', modId: 'sales_travel_agents' },
    { id: 'leads', label: 'Leads', modId: 'sales_leads' },
    { id: 'opportunities', label: 'Opportunities', modId: 'sales_opportunities' },
    { id: 'proposals', label: 'Proposals', modId: 'sales_proposals' },
    { id: 'contracts', label: 'Contracts', modId: 'sales_contracts' },
    { id: 'sales-activities', label: 'Activities', modId: 'sales_activities' },
    { id: 'account-management', label: 'Account Mgmt', modId: 'sales_account_management' },
    { id: 'staff', label: 'Staff', modId: 'sales_staff' },
    { id: 'campaigns', label: 'Campaigns', modId: 'sales_campaigns' },
    { id: 'email-marketing', label: 'Email', modId: 'sales_email_marketing' },
    { id: 'sms-messaging', label: 'SMS', modId: 'sales_sms_messaging' },
    { id: 'loyalty', label: 'Loyalty', modId: 'sales_loyalty' },
    { id: 'promotions', label: 'Promotions', modId: 'sales_promotions' },
    { id: 'gift-cards', label: 'Gift Cards', modId: 'sales_gift_cards' },
    { id: 'reputation', label: 'Reputation', modId: 'sales_reputation' },
    { id: 'public-profile', label: 'Public Profile', modId: 'sales_reputation' },
    { id: 'guest-feedback', label: 'Feedback', modId: 'sales_guest_feedback' },
    { id: 'segmentation', label: 'Segmentation', modId: 'sales_segmentation' },
    { id: 'communication', label: 'Communication', modId: 'sales_communication' },
    { id: 'requisitions', label: 'Requisitions', modId: 'sales_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'sales_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'sales_configuration' },
  ],
  concierge: [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'concierge_dashboard' },
    { id: 'service-center', label: 'Guest Service Center', modId: 'concierge_service_center' },
    { id: 'guest-profiles', label: 'Guest Profiles', modId: 'concierge_guest_profiles' },
    { id: 'guest-requests', label: 'Guest Requests', modId: 'concierge_guest_requests' },
    { id: 'concierge-desk', label: 'Concierge Desk', modId: 'concierge_desk' },
    { id: 'experience-booking', label: 'Experience Booking', modId: 'concierge_experience_booking' },
    { id: 'restaurant-reservations', label: 'Restaurant Reservations', modId: 'concierge_restaurant_reservations' },
    { id: 'transportation', label: 'Transportation', modId: 'concierge_transportation' },
    { id: 'tour-management', label: 'Tour Management', modId: 'concierge_tour_management' },
    { id: 'ticketing', label: 'Ticketing Services', modId: 'concierge_ticketing' },
    { id: 'luggage-services', label: 'Luggage Services', modId: 'concierge_luggage_services' },
    { id: 'parcel-management', label: 'Parcel Management', modId: 'concierge_parcel_management' },
    { id: 'vip-services', label: 'VIP & Butler Services', modId: 'concierge_vip_services' },
    { id: 'personal-shopping', label: 'Personal Shopping', modId: 'concierge_personal_shopping' },
    { id: 'local-recommendations', label: 'Local Recommendations', modId: 'concierge_local_recommendations' },
    { id: 'itinerary-planner', label: 'Itinerary Planner', modId: 'concierge_itinerary_planner' },
    { id: 'wake-up-reminder', label: 'Wake-up & Reminder', modId: 'concierge_wake_up_reminder' },
    { id: 'guest-communication', label: 'Guest Communication', modId: 'concierge_guest_communication' },
    { id: 'vendor-management', label: 'Vendor Management', modId: 'concierge_vendor_management' },
    { id: 'billing-charges', label: 'Billing & Charges', modId: 'concierge_billing_charges' },
    { id: 'requisitions', label: 'Requisitions', modId: 'concierge_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'concierge_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'concierge_configuration' },
  ],
  /**
   * Spa & Wellness tabs.
   *
   * Mirrors `subNavConfig['spa-wellness']` in App.tsx. (A copy-paste anomaly
   * that appended `concierge_*` items to the spa array has been fixed; those
   * items now live under `subNavConfig['concierge']`.)
   */
  'spa-wellness': [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'spa_dashboard' },
    { id: 'appointments', label: 'Appointment Management', modId: 'spa_appointments' },
    { id: 'treatment-catalog', label: 'Treatment Catalog', modId: 'spa_treatment_catalog' },
    { id: 'therapists', label: 'Therapist Management', modId: 'spa_therapists' },
    { id: 'treatment-rooms', label: 'Rooms & Facilities', modId: 'spa_treatment_rooms' },
    { id: 'guest-wellness-profiles', label: 'Guest Wellness Profiles', modId: 'spa_guest_wellness_profiles' },
    { id: 'wellness-programs', label: 'Wellness Programs', modId: 'spa_wellness_programs' },
    { id: 'memberships', label: 'Membership Management', modId: 'spa_memberships' },
    { id: 'fitness-center', label: 'Fitness Center', modId: 'spa_fitness_center' },

    { id: 'wellness-packages', label: 'Wellness Packages', modId: 'spa_wellness_packages' },
    { id: 'retail-shop', label: 'Retail Shop', modId: 'spa_retail_shop' },
    { id: 'inventory', label: 'Inventory', modId: 'spa_inventory' },
    { id: 'gift-cards', label: 'Gift Cards & Vouchers', modId: 'spa_gift_cards' },
    { id: 'billing-payments', label: 'Billing & Payments', modId: 'spa_billing_payments' },
    { id: 'communication', label: 'Communication Center', modId: 'spa_communication' },
    { id: 'requisitions', label: 'Requisitions', modId: 'spa_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'spa_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'spa_configuration' },
  ],
  /**
   * Executive tabs — shared shape with `operations`. The `modId` prefix is
   * `exec_*` here; for `operations` the same tab ids use `ops_*` and are
   * produced by `resolveExecOpsModId`.
   */
  executive: [
    { id: 'executive-dashboard', label: 'Executive Dashboard', modId: 'exec_executive_dashboard', toggleKey: 'executive_executive_dashboard' },
    { id: 'enterprise-kpi-center', label: 'Enterprise KPI Center', modId: 'exec_enterprise_kpi_center', toggleKey: 'executive_enterprise_kpi_center' },
    { id: 'operational-intelligence', label: 'Operational Intelligence', modId: 'exec_operational_intelligence', toggleKey: 'executive_operational_intelligence' },
    { id: 'financial-intelligence', label: 'Financial Intelligence', modId: 'exec_financial_intelligence', toggleKey: 'executive_financial_intelligence' },
    { id: 'revenue-intelligence', label: 'Revenue Intelligence', modId: 'exec_revenue_intelligence', toggleKey: 'executive_revenue_intelligence' },
    { id: 'guest-intelligence', label: 'Guest Intelligence', modId: 'exec_guest_intelligence', toggleKey: 'executive_guest_intelligence' },
    { id: 'sales-marketing-intelligence', label: 'Sales & Marketing', modId: 'exec_sales_marketing_intelligence', toggleKey: 'executive_sales_marketing_intelligence' },
    { id: 'food-beverage-intelligence', label: 'F&B Intelligence', modId: 'exec_food_beverage_intelligence', toggleKey: 'executive_food_beverage_intelligence' },
    { id: 'housekeeping-intelligence', label: 'Housekeeping', modId: 'exec_housekeeping_intelligence', toggleKey: 'executive_housekeeping_intelligence' },
    { id: 'engineering-intelligence', label: 'Engineering', modId: 'exec_engineering_intelligence', toggleKey: 'executive_engineering_intelligence' },
    { id: 'human-capital-intelligence', label: 'Human Capital', modId: 'exec_human_capital_intelligence', toggleKey: 'executive_human_capital_intelligence' },
    { id: 'procurement-intelligence', label: 'Procurement', modId: 'exec_procurement_intelligence', toggleKey: 'executive_procurement_intelligence' },
    { id: 'inventory-intelligence', label: 'Inventory', modId: 'exec_inventory_intelligence', toggleKey: 'executive_inventory_intelligence' },
    { id: 'security-intelligence', label: 'Security', modId: 'exec_security_intelligence', toggleKey: 'executive_security_intelligence' },
    { id: 'sustainability-intelligence', label: 'Sustainability', modId: 'exec_sustainability_intelligence', toggleKey: 'executive_sustainability_intelligence' },
    { id: 'benchmarking', label: 'Benchmarking', modId: 'exec_benchmarking', toggleKey: 'executive_benchmarking' },
    { id: 'forecasting', label: 'Forecasting', modId: 'exec_forecasting', toggleKey: 'executive_forecasting' },
    { id: 'ai-decision-support', label: 'AI Decision Support', modId: 'exec_ai_decision_support', toggleKey: 'executive_ai_decision_support' },
    { id: 'strategic-planning', label: 'Strategic Planning', modId: 'exec_strategic_planning', toggleKey: 'executive_strategic_planning' },
    { id: 'alerts-exceptions', label: 'Alerts & Exceptions', modId: 'exec_alerts_exceptions', toggleKey: 'executive_alerts_exceptions' },
    { id: 'approvals', label: 'Approvals & Decisions', modId: 'exec_approvals', toggleKey: 'executive_approvals' },
    { id: 'reports-center', label: 'Reports Center', modId: 'exec_reports_center', toggleKey: 'executive_reports_center' },
    { id: 'configuration', label: 'Configuration', modId: 'exec_configuration', toggleKey: 'executive_configuration' },
  ],
  /**
   * Operations tabs — distinct from the shared exec/ops sub-nav. App.tsx
   * (lines ~789-812) overrides the shared sub-nav for `operations` with this
   * set. Tab ids match HotelOperationsPortal's `OperationsView` union, which
   * is driven by the `activeTab` prop from DepartmentRoute.
   */
  operations: [
    { id: 'executive-dashboard', label: 'Executive Dashboard', modId: 'ops_executive_dashboard', toggleKey: 'operations_executive_dashboard' },
    { id: 'command-center', label: 'Operations Command Center', modId: 'ops_command_center', toggleKey: 'operations_command_center' },
    { id: 'daily-briefing', label: 'Daily Briefing', modId: 'ops_daily_briefing', toggleKey: 'operations_daily_briefing' },
    { id: 'morning-meeting', label: 'Morning Meeting', modId: 'ops_morning_meeting', toggleKey: 'operations_morning_meeting' },
    { id: 'approvals', label: 'Manager Approvals', modId: 'ops_approvals', toggleKey: 'operations_approvals' },
    { id: 'cross-department-tasks', label: 'Cross-Department Tasks', modId: 'ops_cross_department_tasks', toggleKey: 'operations_cross_department_tasks' },
    { id: 'duty-manager', label: 'Duty Manager Workspace', modId: 'ops_duty_manager', toggleKey: 'operations_duty_manager' },
    { id: 'calendar', label: 'Operational Calendar', modId: 'ops_calendar', toggleKey: 'operations_calendar' },
    { id: 'vip-management', label: 'VIP Guest Management', modId: 'ops_vip_management', toggleKey: 'operations_vip_management' },
    { id: 'guest-recovery', label: 'Guest Recovery', modId: 'ops_guest_recovery', toggleKey: 'operations_guest_recovery' },
    { id: 'service-quality', label: 'Service Quality', modId: 'ops_service_quality', toggleKey: 'operations_service_quality' },
    { id: 'room-operations', label: 'Room Operations', modId: 'ops_room_operations', toggleKey: 'operations_room_operations' },
    { id: 'occupancy-forecast', label: 'Occupancy & Forecast', modId: 'ops_occupancy_forecast', toggleKey: 'operations_occupancy_forecast' },
    { id: 'event-coordination', label: 'Event & Group Coordination', modId: 'ops_event_coordination', toggleKey: 'operations_event_coordination' },
    { id: 'emergency', label: 'Emergency Coordination', modId: 'ops_emergency', toggleKey: 'operations_emergency' },
    { id: 'communication', label: 'Communication Center', modId: 'ops_communication', toggleKey: 'operations_communication' },
    { id: 'escalations', label: 'Escalation Center', modId: 'ops_escalations', toggleKey: 'operations_escalations' },
    { id: 'sop-compliance', label: 'SOP & Compliance', modId: 'ops_sop_compliance', toggleKey: 'operations_sop_compliance' },
    { id: 'executive-checklists', label: 'Executive Checklists', modId: 'ops_executive_checklists', toggleKey: 'operations_executive_checklists' },
    { id: 'flash-reports', label: 'Daily Flash Reports', modId: 'ops_flash_reports', toggleKey: 'operations_flash_reports' },
    { id: 'requisitions', label: 'Requisitions', modId: 'ops_requisitions', toggleKey: 'operations_requisitions' },
    { id: 'reports', label: 'Reports', modId: 'ops_reports', toggleKey: 'operations_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'ops_configuration', toggleKey: 'operations_configuration' },
  ],
  'banquet-events': [
    { id: 'dashboard', label: 'Executive Dashboard', modId: 'be_dashboard' },
    { id: 'calendar', label: 'Event Calendar', modId: 'be_calendar' },
    { id: 'event-setup', label: 'Event Booking', modId: 'be_event_setup', section: 'Pipeline' },
    { id: 'room-blocks', label: 'Room Blocks', modId: 'be_room_blocks', section: 'Pipeline' },
    { id: 'planning', label: 'Event Planning', modId: 'be_planning', section: 'Planning' },
    { id: 'catering', label: 'Catering Planning', modId: 'be_catering', section: 'Planning' },
    { id: 'logistics', label: 'Event Logistics', modId: 'be_logistics', section: 'Planning' },
    { id: 'inventory-requisition', label: 'Inventory & Requisition', modId: 'be_inventory_requisition', section: 'Planning' },
    { id: 'beo', label: 'BEO', modId: 'be_beo', section: 'Planning' },
    { id: 'execution', label: 'Event Execution', modId: 'be_execution', section: 'Operations' },
    { id: 'coordination', label: 'Coordination & Comms', modId: 'be_coordination', section: 'Operations' },
    { id: 'guest-experience', label: 'Guest Experience', modId: 'be_guest_experience', section: 'Operations' },
    { id: 'staff', label: 'Staff Management', modId: 'be_staff', section: 'Operations' },
    { id: 'billing', label: 'Billing & Deposits', modId: 'be_billing', section: 'Billing' },
    { id: 'reports', label: 'Reports', modId: 'be_reports', section: 'Support' },
    { id: 'configuration', label: 'Configuration', modId: 'be_configuration', section: 'Support' },
  ],
  /**
   * Revenue Management (RMS) tabs — ids match the module ids inside
   * `RevenueManagementPortal` (it consumes `activeModule`).
   */
  revenue: [
    { id: 'dashboard', label: 'Dashboard', modId: 'rms_dashboard', toggleKey: 'revenue_dashboard' },
    { id: 'recommendations', label: 'Recommendations', modId: 'rms_recommendations', toggleKey: 'revenue_pricing' },
    { id: 'competitors', label: 'Competitors', modId: 'rms_competitors', toggleKey: 'revenue_intelligence' },
    { id: 'forecasts', label: 'Demand Forecasts', modId: 'rms_forecasts', toggleKey: 'revenue_forecasts' },
    { id: 'los', label: 'LOS Rules', modId: 'rms_los', toggleKey: 'revenue_pricing' },
    { id: 'corporate', label: 'Corporate Rates', modId: 'rms_corporate', toggleKey: 'revenue_pricing' },
    { id: 'channels', label: 'Channel Manager', modId: 'rms_channels', toggleKey: 'revenue_channels' },
    { id: 'dynamic_pricing', label: 'Dynamic Pricing', modId: 'rms_dynamic_pricing', toggleKey: 'revenue_pricing' },
    { id: 'rate_management', label: 'Rate Management', modId: 'rms_rate_management', toggleKey: 'revenue_pricing' },
    { id: 'inventory_controls', label: 'Inventory Controls', modId: 'rms_inventory_controls', toggleKey: 'revenue_restrictions' },
    { id: 'yield_management', label: 'Yield Management', modId: 'rms_yield_management', toggleKey: 'revenue_intelligence' },
    { id: 'market_segmentation', label: 'Segmentation', modId: 'rms_market_segmentation', toggleKey: 'revenue_intelligence' },
    { id: 'channel_performance', label: 'Channel Performance', modId: 'rms_channel_performance', toggleKey: 'revenue_channels' },
    { id: 'distribution_management', label: 'Distribution', modId: 'rms_distribution_management', toggleKey: 'revenue_channels' },
    { id: 'group_evaluation', label: 'Group Evaluation', modId: 'rms_group_evaluation', toggleKey: 'revenue_groups' },
    { id: 'displacement_analysis', label: 'Displacement', modId: 'rms_displacement_analysis', toggleKey: 'revenue_groups' },
    { id: 'overbooking_management', label: 'Overbooking', modId: 'rms_overbooking_management', toggleKey: 'revenue_restrictions' },
    { id: 'restrictions_management', label: 'Restrictions', modId: 'rms_restrictions_management', toggleKey: 'revenue_restrictions' },
    { id: 'package_pricing', label: 'Packages', modId: 'rms_package_pricing', toggleKey: 'revenue_pricing' },
    { id: 'promotions_analysis', label: 'Promotions', modId: 'rms_promotions_analysis', toggleKey: 'revenue_intelligence' },
    { id: 'business_intelligence', label: 'Business Intel', modId: 'rms_business_intelligence', toggleKey: 'revenue_intelligence' },
    { id: 'ai_recommendations', label: 'AI Recs', modId: 'rms_ai_recommendations', toggleKey: 'revenue_intelligence' },
    { id: 'scenario_planning', label: 'Scenarios', modId: 'rms_scenario_planning', toggleKey: 'revenue_intelligence' },
    { id: 'requisitions', label: 'Requisitions', modId: 'rms_requisitions', toggleKey: 'revenue_inventory' },
    { id: 'reports', label: 'Reports', modId: 'rms_reports', toggleKey: 'revenue_reports' },
    { id: 'configuration', label: 'Configuration', modId: 'rms_configuration' },
  ],
  /**
   * `admin` and `settings` are dynamic / leaf:
   *  - `admin`: tabs resolved from `CORE_ADMIN_MODULES` at runtime.
   *  - `settings`: single-screen (AccountSettingsModule), no tab set.
   */
} as const;

/** Resolve the tab list for a department key. Returns an empty array for dynamic/leaf departments. */
export function getTabsForDepartment(deptKey: string): readonly TabConfig[] {
  return (DEPARTMENT_TABS as Record<string, readonly TabConfig[]>)[deptKey] ?? [];
}

/** Find a tab config by department key + tab id. */
export function findTab(deptKey: string, tabId: string): TabConfig | undefined {
  return getTabsForDepartment(deptKey).find((t) => t.id === tabId);
}

/**
 * Platform Controls submodule gating: returns false when the tab has a
 * `toggleKey` and `moduleToggles[toggleKey] === false`. Tabs without a
 * toggleKey (or departments without submodule toggles) are always enabled.
 */
export function isTabEnabledByToggles(
  deptKey: string,
  tabId: string,
  moduleToggles: Record<string, boolean>,
): boolean {
  const toggleKey = findTab(deptKey, tabId)?.toggleKey;
  return !toggleKey || moduleToggles[toggleKey] !== false;
}

/**
 * For `executive`/`operations` shared sub-nav usage: given a tab id from the
 * shared set, return the modId with the correct prefix for the active dept.
 * `executive` -> `exec_*`, `operations` -> `ops_*`.
 */
export function resolveExecOpsModId(deptKey: string, tabId: string): string | undefined {
  const base = (DEPARTMENT_TABS.executive as readonly TabConfig[]).find((t) => t.id === tabId);
  if (!base) return undefined;
  const prefix = deptKey === 'operations' ? 'ops' : 'exec';
  return base.modId.replace(/^exec_/, `${prefix}_`);
}
