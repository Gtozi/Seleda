/**
 * Executive drill-through map — resolves a KPI `source`/`category` or an
 * alert's source/department label to the owning department's portal URL
 * so exec cards can navigate straight to the operational detail.
 *
 * Matching is keyword-based (case-insensitive); first match wins.
 */

export interface DrillTarget {
  path: string;
  label: string;
}

const DRILL_RULES: [RegExp, DrillTarget][] = [
  [/front.?office|front.?desk|reservation|reception/i, { path: '/erp/frontoffice/dashboard', label: 'Front Office' }],
  [/housekeep|\bhk\b|linen|room.?status/i, { path: '/erp/housekeeping/dashboard', label: 'Housekeeping' }],
  [/f&b|food|beverage|restaurant|kitchen|outlet|menu/i, { path: '/erp/fb/executive-dashboard', label: 'Food & Beverage' }],
  [/engineer|maintenance|work.?order|asset|pm |energy|utilit|sustainab/i, { path: '/erp/maintenance/dashboard', label: 'Engineering' }],
  [/financ|account|ledger|p&l|cash|treasury|budget/i, { path: '/erp/finance/dashboard', label: 'Finance' }],
  [/human|payroll|staff|labor|recruit|employee|\bhr\b/i, { path: '/erp/hr/dashboard', label: 'Human Resources' }],
  [/procure|vendor|supplier|purchase|spend/i, { path: '/erp/procurement/dashboard', label: 'Procurement' }],
  [/inventor|stock|store|warehouse/i, { path: '/erp/inventory/dashboard', label: 'Inventory' }],
  [/secur|incident|fraud|risk|patrol|cctv|access/i, { path: '/erp/security/dashboard', label: 'Security' }],
  [/sales|marketing|campaign|lead|pipeline|crm/i, { path: '/erp/sales/dashboard', label: 'Sales' }],
  [/revenue|rms|rate|pricing|channel|parity/i, { path: '/erp/revenue/dashboard', label: 'Revenue Management' }],
  [/transport|fleet|shuttle|driver|vehicle/i, { path: '/erp/transportation/dashboard', label: 'Transportation' }],
  [/concierge|guest.?request|guest.?service/i, { path: '/erp/concierge/dashboard', label: 'Concierge' }],
  [/spa|wellness/i, { path: '/erp/spa-wellness/dashboard', label: 'Spa & Wellness' }],
  [/banquet|event|catering/i, { path: '/erp/banquet-events/dashboard', label: 'Banquet & Events' }],
  [/ops|operation|duty|command/i, { path: '/erp/operations/executive-dashboard', label: 'Operations' }],
];

/** Resolve a free-text source/category/department to a portal target. */
export function drillTargetFor(text: string | null | undefined): DrillTarget | null {
  if (!text) return null;
  for (const [re, target] of DRILL_RULES) {
    if (re.test(text)) return target;
  }
  return null;
}
