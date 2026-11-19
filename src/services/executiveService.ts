/**
 * Executive portal service — client for /api/executive/* endpoints.
 *
 * Backs the Enterprise KPI Center tab (/erp/executive/enterprise-kpi-center):
 * the endpoint aggregates live KPIs across every portal's real tables
 * server-side (Front Office, Housekeeping, F&B, Engineering, HR,
 * Procurement, Inventory, Sales, Security, Sustainability).
 */

const API_BASE = '/api/executive';

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

/**
 * Reporting window: a rolling day count, or a calendar preset
 * ('today' | 'wtd' | 'mtd' | 'qtd' | 'ytd') resolved server-side to the
 * elapsed time since the calendar boundary (midnight, Monday, month,
 * quarter, or year start).
 */
export type ExecWindow = number | 'today' | 'wtd' | 'mtd' | 'qtd' | 'ytd';

export const EXEC_PERIODS: { id: ExecWindow & string; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'wtd', label: 'WTD' },
  { id: 'mtd', label: 'MTD' },
  { id: 'qtd', label: 'QTD' },
  { id: 'ytd', label: 'YTD' },
];

function setWindowParam(params: URLSearchParams, window: ExecWindow): void {
  if (typeof window === 'string') params.set('period', window);
  else params.set('days', String(window));
}

// ── Enterprise KPI Center ────────────────────────────────────────────────

export type KpiStatus = 'on-track' | 'at-risk' | 'off-track';

export interface EnterpriseKpi {
  id: string;
  name: string;
  /** Portal-aligned grouping shown in the category cards. */
  category: string;
  /** Portal the data is sourced from (shown on the card). */
  source: string;
  currentValue: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  /** 'currency' | '%' | '/5' | 'count' | 'kWh' | 'L' | 't' | 'days' | 'hrs' | 'x' */
  unit: string;
  lowerIsBetter: boolean;
  /** % change vs the previous period; null when there is no baseline. */
  trend: number | null;
  owner: string;
  status: KpiStatus;
  lastUpdated: string;
  /** Daily history from the metric_history data mart (sparkline series). */
  history?: { date: string; value: number }[];
}

export interface KpiCenterResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  kpis: EnterpriseKpi[];
}

export async function fetchKpiCenter(propertyId?: string | null, days: ExecWindow = 30): Promise<KpiCenterResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<KpiCenterResponse>(`${API_BASE}/kpi-center?${params.toString()}`);
}

// ── Executive Dashboard ──────────────────────────────────────────────────

export type DashKpiCategory = 'financial' | 'rooms' | 'guests' | 'fb'
  | 'workforce' | 'engineering' | 'procurement' | 'security' | 'leisure';

export interface DashKpi {
  id: string;
  name: string;
  category: DashKpiCategory | string;
  source: string;
  value: number | null;
  previousValue: number | null;
  unit: string;
  lowerIsBetter: boolean;
  detail?: string;
}

export interface ExecDashboardView {
  name: string;
  ownerRole: string;
  tileLayout: Record<string, { row?: number; col?: number; size?: string }>;
  defaultDateRange: string | null;
}

export interface ExecDashboardResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  kpis: DashKpi[];
  view?: ExecDashboardView | null;
}

export async function fetchExecDashboard(propertyId?: string | null, days: ExecWindow = 30): Promise<ExecDashboardResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<ExecDashboardResponse>(`${API_BASE}/dashboard?${params.toString()}`);
}

// ── Executive Approvals Queue ────────────────────────────────────────────

export interface ExecApprovalItem {
  id: string;
  source: 'operations' | 'finance' | 'expenses';
  title: string;
  department: string | null;
  amount: number | null;
  urgency: 'low' | 'medium' | 'high' | 'critical' | string;
  status: string;
  requestedBy: string | null;
  createdAt: string | null;
  drillPath: string;
}

export interface ExecApprovalsResponse {
  propertyId: string | null;
  generatedAt: string;
  items: ExecApprovalItem[];
  summary: {
    total: number;
    escalated: number;
    critical: number;
    pendingAmount: number;
    bySource: { operations: number; finance: number; expenses: number };
  };
}

export async function fetchExecApprovals(propertyId?: string | null): Promise<ExecApprovalsResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  return apiRequest<ExecApprovalsResponse>(`${API_BASE}/approvals?${params.toString()}`);
}

/**
 * Record an executive decision on an approval item.
 * `itemId` is the composite id from fetchExecApprovals (ops-/fin-/exp- prefixed).
 * Requires the exec:approvals:decide permission server-side.
 */
export async function decideExecApproval(
  itemId: string,
  decision: 'approve' | 'reject' | 'escalate',
  notes?: string,
): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/approvals/${encodeURIComponent(itemId)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

// ── Operational Intelligence ─────────────────────────────────────────────

export interface OpsMetric {
  metric: string;
  value: number;
  previousValue: number | null;
  target: number;
  threshold: number;
  /** 'currency' | '%' | 'count' | 'min' | 'hrs' | '/day' */
  unit: string;
  lowerIsBetter: boolean;
  /** % change vs the previous period; null when there is no baseline. */
  trend: number | null;
  status: KpiStatus;
}

export interface OpsDepartment {
  name: string;
  /** false when the portal has no operational tables yet (e.g. Spa). */
  hasData: boolean;
  metrics: OpsMetric[];
}

export interface OpsIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  departments: OpsDepartment[];
}

export async function fetchOperationalIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<OpsIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<OpsIntelligenceResponse>(`${API_BASE}/operational-intelligence?${params.toString()}`);
}

// ── Financial Intelligence ───────────────────────────────────────────────

export type FinCategory = 'pnl' | 'balance' | 'cashflow' | 'budget' | 'costcenters' | 'ratios';

export interface FinMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  /** 'currency' | '%' | 'x' */
  unit: string;
  category: FinCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface FinDeptProfit {
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
}

export interface FinExpenseTrend {
  name: string;
  value: number;
  previousValue: number;
  change: number | null;
}

export interface FinIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: FinMetric[];
  departmentProfitability: FinDeptProfit[];
  expenseTrends: FinExpenseTrend[];
}

export async function fetchFinancialIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<FinIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<FinIntelligenceResponse>(`${API_BASE}/financial-intelligence?${params.toString()}`);
}

// ── Revenue Intelligence ─────────────────────────────────────────────────

export type RevCategory = 'occupancy' | 'adr' | 'revpar' | 'booking' | 'forecast' | 'channel';

export interface RevMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  /** 'currency' | '%' | 'count' | 'nights' | 'days' | '/day' */
  unit: string;
  category: RevCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface RevChannelMix {
  name: string;
  sharePct: number;
  revenue: number;
  bookings: number;
}

export interface RevDemandForecast {
  horizon: string;
  forecastOccupancy: number;
  confidence: number;
  forecastDemand: number;
}

export interface RevSegmentMix {
  name: string;
  guests: number;
  sharePct: number;
}

export interface RevIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: RevMetric[];
  channelMix: RevChannelMix[];
  demandForecast: RevDemandForecast[];
  segmentMix: RevSegmentMix[];
}

export async function fetchRevenueIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<RevIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<RevIntelligenceResponse>(`${API_BASE}/revenue-intelligence?${params.toString()}`);
}

// ── Guest Intelligence ───────────────────────────────────────────────────

export type GuestCategory = 'demographics' | 'loyalty' | 'lifetime' | 'patterns' | 'satisfaction' | 'segmentation';

export interface GuestMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  /** 'currency' | '%' | 'count' | 'years' | 'nights' | 'guests' | 'hrs' | '/5' */
  unit: string;
  category: GuestCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface GuestReview {
  guestName: string;
  rating: number;
  comment: string;
  date: string;
}

export interface GuestComplaint {
  complaint: string;
  category: string;
  status: string;
  priority: string;
  date: string;
}

export interface GuestIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: GuestMetric[];
  recentReviews: GuestReview[];
  complaints: GuestComplaint[];
  segmentMix: { name: string; guests: number; sharePct: number }[];
  topCountries: { country: string; guests: number; sharePct: number }[];
}

export async function fetchGuestIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<GuestIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<GuestIntelligenceResponse>(`${API_BASE}/guest-intelligence?${params.toString()}`);
}

// ── Sales & Marketing Intelligence ───────────────────────────────────────

export type SalesCategory = 'pipeline' | 'conversion' | 'corporate' | 'ota' | 'campaign' | 'segments' | 'acquisition';

export interface SalesMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: SalesCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface PipelineStage {
  stage: string;
  count: number;
  value: number;
  sharePct: number;
}

export interface CampaignRow {
  name: string;
  type: string;
  status: string;
  budget: number;
  spent: number;
  leads: number;
  conversions: number;
}

export interface SalesIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: SalesMetric[];
  pipelineFunnel: PipelineStage[];
  campaigns: CampaignRow[];
  segmentMix: { name: string; guests: number; sharePct: number }[];
}

export async function fetchSalesIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<SalesIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<SalesIntelligenceResponse>(`${API_BASE}/sales-marketing-intelligence?${params.toString()}`);
}

// ─── F&B Intelligence ───────────────────────────────────────────────────────

export type FbCategory = 'revenue' | 'outlet' | 'menu' | 'cost' | 'waste' | 'efficiency';

export interface FbMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: FbCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface FbOutletPerformance {
  name: string;
  type: string;
  revenue: number;
  orders: number;
  covers: number;
  avgCheck: number;
  turnover: number;
}

export interface FbMenuEngineering {
  classification: string;
  count: number;
  sold: number;
  margin: number;
}

export interface FbTopMenuItem {
  name: string;
  category: string;
  classification: string;
  sold: number;
  price: number;
  margin: number;
  foodCostPct: number;
}

export interface FbIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: FbMetric[];
  outletPerformance: FbOutletPerformance[];
  menuEngineering: FbMenuEngineering[];
  topMenuItems: FbTopMenuItem[];
  mealPeriodMix: { period: string; orders: number; revenue: number }[];
}

export async function fetchFbIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<FbIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<FbIntelligenceResponse>(`${API_BASE}/fb-intelligence?${params.toString()}`);
}

// ─── Housekeeping Intelligence ──────────────────────────────────────────────

export type HkCategory = 'productivity' | 'turnaround' | 'quality' | 'linen' | 'costs' | 'status';

export interface HkMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: HkCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface HkIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: HkMetric[];
  roomStatus: { status: string; count: number }[];
  staffLeaderboard: { name: string; tasksCompleted: number; roomsPerDay: number; avgMinutes: number }[];
  taskTypes: { type: string; total: number; completed: number; completionPct: number }[];
  issuesReported: number;
}

export async function fetchHkIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<HkIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<HkIntelligenceResponse>(`${API_BASE}/hk-intelligence?${params.toString()}`);
}

// ─── Engineering Intelligence ───────────────────────────────────────────────

export type EngCategory = 'assets' | 'downtime' | 'maintenance' | 'pm' | 'energy' | 'utilities';

export interface EngMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: EngCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface EngIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: EngMetric[];
  woStatusBoard: { status: string; count: number }[];
  energyBreakdown: { type: string; unit: string; usage: number; prevUsage: number }[];
  assetCategories: { category: string; count: number; nbv: number }[];
}

export async function fetchEngIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<EngIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<EngIntelligenceResponse>(`${API_BASE}/eng-intelligence?${params.toString()}`);
}

// ─── Human Capital Intelligence ─────────────────────────────────────────────

export type HcCategory = 'headcount' | 'labor' | 'payroll' | 'attendance' | 'turnover' | 'recruitment' | 'performance' | 'training';

export interface HcMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: HcCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface HcIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: HcMetric[];
  deptLabor: { department: string; headcount: number; payroll: number; budget: number; actual: number; variancePct: number | null }[];
  recruitmentFunnel: { stage: string; count: number }[];
}

export async function fetchHcIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<HcIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<HcIntelligenceResponse>(`${API_BASE}/hc-intelligence?${params.toString()}`);
}

// ─── Procurement Intelligence ───────────────────────────────────────────────

export type ProcCategory = 'spend' | 'vendor' | 'leadtime' | 'contract' | 'savings' | 'trends';

export interface ProcMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: ProcCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface ProcIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: ProcMetric[];
  spendByDept: { department: string; spend: number; orders: number; sharePct: number }[];
  topVendors: { name: string; spend: number; score: number | null; rating: string | null }[];
  expiringContracts: { number: string; supplier: string; category: string; endDate: string; value: number }[];
}

export async function fetchProcurementIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<ProcIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<ProcIntelligenceResponse>(`${API_BASE}/procurement-intelligence?${params.toString()}`);
}

// ─── Inventory Intelligence ─────────────────────────────────────────────────

export type InvCategory = 'value' | 'turnover' | 'deadstock' | 'slowmoving' | 'fastmoving' | 'variance' | 'accuracy';

export interface InvMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: InvCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface InvIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: InvMetric[];
  stockByStore: { store: string; value: number; sharePct: number }[];
  stockByCategory: { category: string; value: number; sharePct: number }[];
  topMovers: { name: string; category: string; consumed: number; dailyRate: number; stockValue: number }[];
  expiringBatches: { item: string; batch: string; expiryDate: string; quantity: number; value: number }[];
  movementSplit: { type: string; value: number; items: number }[];
}

export async function fetchInventoryIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<InvIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<InvIntelligenceResponse>(`${API_BASE}/inventory-intelligence?${params.toString()}`);
}

// ─── Security Intelligence ──────────────────────────────────────────────────

export type SecCategory = 'incidents' | 'risk' | 'fraud' | 'access' | 'emergency' | 'compliance';

export interface SecMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: SecCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface SecIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: SecMetric[];
  incidentByType: { type: string; count: number }[];
  locationHotspots: { location: string; score: number }[];
  riskRegister: { title: string; category: string; level: string; score: number; status: string }[];
  recentIncidents: { type: string; location: string; priority: string; status: string; at: string }[];
  patrolSummary: { total: number; completed: number; inProgress: number; checkpointsScanned: number };
}

export async function fetchSecurityIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<SecIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<SecIntelligenceResponse>(`${API_BASE}/security-intelligence?${params.toString()}`);
}

// ─── Sustainability Intelligence ────────────────────────────────────────────

export type SusCategory = 'energy' | 'water' | 'fuel' | 'carbon' | 'waste' | 'esg';

export interface SusMetric {
  id: string;
  name: string;
  value: number;
  previousValue: number | null;
  target: number;
  unit: string;
  category: SusCategory;
  lowerIsBetter: boolean;
  trend: number | null;
  status: KpiStatus;
}

export interface SusIntelligenceResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: SusMetric[];
  utilityBreakdown: { utility: string; cur: number; prev: number; unit: string }[];
  energyProjects: { name: string; type: string; status: string; estSavings: number; actSavings: number; investment: number; roi: number }[];
  wasteByDept: { department: string; value: number; sharePct: number }[];
  equipmentBelowTarget: { name: string; category: string; current: number; target: number; status: string }[];
  topSuppliers: { name: string; score: number; local: boolean; cert: string | null }[];
  roomNights: number;
}

export async function fetchSustainabilityIntelligence(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<SusIntelligenceResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<SusIntelligenceResponse>(`${API_BASE}/sustainability-intelligence?${params.toString()}`);
}

// ─── Benchmarking ───────────────────────────────────────────────────────────

export type BenchCategory = 'revenue' | 'occupancy' | 'adr' | 'revpar' | 'cost' | 'satisfaction' | 'productivity';
export type BenchBasis = 'prev_period' | 'prev_year' | 'forecast' | 'competitor' | 'industry' | 'budget';

export interface BenchMetric {
  id: string;
  name: string;
  category: BenchCategory;
  unit: string;
  value: number;
  lowerIsBetter: boolean;
  comparisons: Partial<Record<BenchBasis, number>>;
}

export interface BenchmarkingResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: BenchMetric[];
  compSet: {
    ourAdr: number;
    avgCompRate: number;
    position: number;
    total: number;
    members: { name: string; starRating: number | null; proximityKm: number | null; type: string; latestRate: number | null; rateDate: string | null; available: boolean | null }[];
  };
  industryBenchmarks: { metric: string; category: string; region: string | null; year: number | null; industryAvg: number; topQuartile: number; bottomQuartile: number; ourValue: number | null }[];
  outletBenchmarks: { outlet: string; metric: string; actual: number; benchmark: number; variancePct: number; percentile: number | null; trend: string | null }[];
  yoyMetrics: { metric: string; current: number; previous: number; growth: number }[];
  marketTrends: { trend: string; impact: string; confidence: number }[];
  forecastAccuracy: { period: string; accuracy: number; variance: number }[];
}

export async function fetchBenchmarking(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<BenchmarkingResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<BenchmarkingResponse>(`${API_BASE}/benchmarking?${params.toString()}`);
}

// ─── Forecasting ────────────────────────────────────────────────────────────

export type FcCategory = 'revenue' | 'occupancy' | 'cashflow' | 'payroll' | 'purchase' | 'utility' | 'labor' | 'demand';

export interface FcMetric {
  id: string;
  name: string;
  forecast: number;
  actual: number | null;
  accuracy: number | null;
  unit: string;
  category: FcCategory;
  confidence: number | null;
}

export interface ForecastingResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  metrics: FcMetric[];
  accuracyBySource: { source: string; accuracy: number; variance: number }[];
  upcomingEvents: { name: string; type: string; start: string; end: string; impact: number; roomNights: number; attendees: number }[];
  heatMapByType: Record<string, Record<number, number>>;
  cashForecast: { period: string; inflows: number; outflows: number; net: number; closing: number }[];
  deptLabor: { department: string; projected: number; budget: number; variancePct: number; confidence: number }[];
  procForecast: { department: string; qty: number; items: number }[];
  liquidityWeeks: { week: string; closing: number; status: string }[];
}

export async function fetchForecasting(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<ForecastingResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<ForecastingResponse>(`${API_BASE}/forecasting?${params.toString()}`);
}

// ─── AI Decision Support ────────────────────────────────────────────────────

export type AiCategory = 'revenue' | 'cost' | 'staffing' | 'purchasing' | 'energy'
  | 'upselling' | 'crossselling' | 'retention' | 'maintenance' | 'risk';
export type AiStatus = 'pending' | 'in_progress' | 'implemented' | 'dismissed';

export interface AiRecommendation {
  id: string;
  title: string;
  description: string;
  /** Monetary impact — null when no real calculation exists (never fabricated). */
  impact: number | null;
  /** True when impact is a calculated estimate rather than a measured amount. */
  impactEstimated?: boolean;
  confidence: number;
  category: AiCategory;
  status: AiStatus;
  source: string;
  department?: string;
  createdAt?: string;
  /** Executive disposition note (from exec_item_overrides). */
  note?: string | null;
  updatedBy?: string | null;
}

export interface AiDecisionResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  recommendations: AiRecommendation[];
  insights: { title: string; description: string | null; icon: string; color: string }[];
  summary: {
    totalImpact: number;
    /** Recommendations with no calculated monetary impact. */
    unpriced: number;
    pending: number;
    inProgress: number;
    implemented: number;
    dismissed: number;
    bySource: { source: string; count: number }[];
  };
}

export async function fetchAiDecisionSupport(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<AiDecisionResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<AiDecisionResponse>(`${API_BASE}/ai-decision-support?${params.toString()}`);
}

// ─── Strategic Planning ─────────────────────────────────────────────────────

export type StratCategory = 'business_plan' | 'objectives' | 'okrs' | 'kpi_targets'
  | 'department_goals' | 'capital_projects' | 'growth';
export type StratStatus = 'on_track' | 'at_risk' | 'behind' | 'completed';
/** What a StrategicItem's `progress` number actually measures. */
export type StratMetric = 'completion' | 'attainment' | 'confidence'
  | 'utilization' | 'adherence' | 'elapsed' | 'pipeline';

export interface StrategicItem {
  id: string;
  title: string;
  description: string;
  progress: number;
  metric: StratMetric;
  status: StratStatus;
  category: StratCategory;
  dueDate: string | null;
  source: string;
  department?: string;
  detail?: string;
  /** true for user-authored rows (exec_strategic_items) — editable in the UI. */
  custom?: boolean;
  /** Raw exec_strategic_items.id for edit/delete (custom items only). */
  rawId?: string;
  owner?: string;
  unit?: string;
  targetValue?: number | null;
  currentValue?: number | null;
  startDate?: string | null;
}

export interface StrategicPlanningResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  items: StrategicItem[];
  summary: {
    total: number;
    onTrack: number;
    atRisk: number;
    behind: number;
    completed: number;
    avgProgress: number;
    byCategory: { category: StratCategory; count: number; avgProgress: number }[];
  };
  panels: {
    capitalProjects: { name: string; status: string; progress: number; budget: number; spent: number; dueDate: string | null; source: string }[];
    campaigns: { name: string; type: string | null; status: string; budget: number; spent: number; leads: number; conversions: number; endDate: string | null }[];
    departmentBudgets: { department: string; budgeted: number; committed: number; actual: number; utilization: number }[];
    deptLabor: { department: string; budget: number; actual: number; variance: number }[];
    upcomingDeadlines: { title: string; dueDate: string; status: StratStatus; progress: number; category: StratCategory; source: string }[];
  };
}

export async function fetchStrategicPlanning(
  propertyId?: string | null,
  days: ExecWindow = 90,
): Promise<StrategicPlanningResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<StrategicPlanningResponse>(`${API_BASE}/strategic-planning?${params.toString()}`);
}

// ─── Strategic items CRUD (user-authored, exec_strategic_items) ────────

export interface StrategicItemInput {
  title: string;
  description?: string;
  category: StratCategory;
  department?: string;
  owner?: string;
  metric?: StratMetric;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string;
  progress?: number;
  status?: StratStatus;
  startDate?: string | null;
  dueDate?: string | null;
  propertyId?: string | null;
}

export async function createStrategicItem(input: StrategicItemInput): Promise<{ id: string }> {
  return apiRequest(`${API_BASE}/strategic-planning/items`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateStrategicItem(
  id: string,
  updates: Partial<StrategicItemInput>,
): Promise<{ id: string }> {
  return apiRequest(`${API_BASE}/strategic-planning/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteStrategicItem(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/strategic-planning/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Alerts & Exceptions ────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertCategory = 'revenue' | 'occupancy' | 'cost' | 'budget' | 'satisfaction'
  | 'labor' | 'inventory' | 'fraud' | 'energy' | 'compliance';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface ExecAlert {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  category: AlertCategory;
  status: AlertStatus;
  timestamp: string | null;
  value: number | null;
  threshold: number | null;
  source: string;
  department?: string;
  /** Executive disposition note (from exec_item_overrides). */
  note?: string | null;
  updatedBy?: string | null;
}

export interface AlertsExceptionsResponse {
  propertyId: string | null;
  days: number;
  generatedAt: string;
  alerts: ExecAlert[];
  summary: {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    critical: number;
    byCategory: { category: AlertCategory; count: number; active: number }[];
    bySource: { source: string; count: number }[];
  };
}

export async function fetchAlertsExceptions(
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<AlertsExceptionsResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  setWindowParam(params, days);
  return apiRequest<AlertsExceptionsResponse>(`${API_BASE}/alerts-exceptions?${params.toString()}`);
}

/** Acknowledge / resolve / reopen an aggregated alert (exec_item_overrides). */
export async function updateExecAlertStatus(
  id: string,
  status: 'acknowledged' | 'resolved' | 'active',
  opts?: { note?: string; propertyId?: string | null },
): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/alerts-exceptions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note: opts?.note, propertyId: opts?.propertyId ?? null }),
  });
}

/** Change an AI recommendation's status (exec_item_overrides). 'pending' resets. */
export async function updateExecRecommendationStatus(
  id: string,
  status: 'in_progress' | 'implemented' | 'dismissed' | 'pending',
  opts?: { note?: string; propertyId?: string | null },
): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/ai-decision-support/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note: opts?.note, propertyId: opts?.propertyId ?? null }),
  });
}

// ─── Reports Center ─────────────────────────────────────────────────────────

export type ReportCategory = 'executive' | 'financial' | 'operational' | 'forecast' | 'custom';
export type ReportStatus = 'ready' | 'generating' | 'scheduled' | 'failed';

export interface ExecReport {
  id: string;
  rawId?: string;
  sourceKey?: string;
  name: string;
  description: string;
  category: ReportCategory;
  frequency: string;
  lastRun: string | null;
  status: ReportStatus;
  format: string;
  source: string;
  queryId?: string | null;
  /** Recipient emails — populated for Report Scheduler rows. */
  recipients?: string[];
  /** day_of_week_or_month — populated for Report Scheduler rows. */
  sendDay?: string | null;
}

export interface ReportsCenterResponse {
  propertyId: string | null;
  generatedAt: string;
  reports: ExecReport[];
  summary: {
    total: number;
    ready: number;
    scheduled: number;
    generating: number;
    failed: number;
    byCategory: { category: ReportCategory; count: number }[];
    bySource: { source: string; count: number }[];
  };
  panels: {
    recentRuns: { name: string; source: string; by: string | null; status: string; format: string | null; at: string }[];
    scheduledReports: { name: string; frequency: string; format: string; recipients: number; lastSent: string | null }[];
    snapshots: { module: string; date: string; quality: string }[];
  };
}

export async function fetchReportsCenter(
  propertyId?: string | null,
): Promise<ReportsCenterResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  return apiRequest<ReportsCenterResponse>(`${API_BASE}/reports-center?${params.toString()}`);
}

export interface ExplorerComparison {
  previousRows: Record<string, any>[] | null;
  benchmarks: { metric: string; module: string; department: string; target: number | null; unit: string; direction: string }[];
}

export interface ExecReportRunResult {
  ok: boolean;
  lastRun: string | null;
  status: string | null;
  queryId: string | null;
  query: { id: string; columns: string[]; rows: Record<string, any>[]; rowCount: number; tookMs: number; comparison?: ExplorerComparison } | null;
}

export async function runExecReport(
  sourceKey: string,
  rawId: string,
  opts?: { days?: ExecWindow; propertyId?: string | null },
): Promise<ExecReportRunResult> {
  const w = opts?.days ?? 30;
  const body = typeof w === 'string' ? { period: w } : { days: w };
  return apiRequest(`${API_BASE}/reports-center/${encodeURIComponent(sourceKey)}/${encodeURIComponent(rawId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ ...body, propertyId: opts?.propertyId ?? null }),
  });
}

export async function runAllExecReports(): Promise<{ refreshed: number; errors: string[] }> {
  return apiRequest(`${API_BASE}/reports-center/run-all`, { method: 'POST' });
}

export async function updateExecReport(
  sourceKey: string,
  rawId: string,
  updates: { frequency?: string; format?: string; status?: string; recipients?: string[]; sendDay?: string | null },
): Promise<{ ok: boolean }> {
  return apiRequest(`${API_BASE}/reports-center/${encodeURIComponent(sourceKey)}/${encodeURIComponent(rawId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// ─── Enterprise Data Explorer ───────────────────────────────────────────────

export type ExplorerQueryType = 'kpi' | 'pivot' | 'drilldown' | 'cross_dept';

export interface ExplorerQueryDef {
  id: string;
  name: string;
  description: string;
  type: ExplorerQueryType;
  source: string;
  executable: boolean;
}

export interface DataExplorerResponse {
  propertyId: string | null;
  generatedAt: string;
  sources: {
    key: string;
    name: string;
    tables: number;
    records: number;
    tableCounts: { table: string; rows: number }[];
  }[];
  queries: ExplorerQueryDef[];
  summary: { totalRecords: number; totalTables: number; portals: number; queries: number };
}

export interface ExplorerQueryResult {
  id: string;
  days: number;
  propertyId: string | null;
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  tookMs: number;
  comparison?: ExplorerComparison;
}

export async function fetchDataExplorer(propertyId?: string | null): Promise<DataExplorerResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  return apiRequest<DataExplorerResponse>(`${API_BASE}/data-explorer?${params.toString()}`);
}

export async function runExplorerQuery(
  id: string,
  propertyId?: string | null,
  days: ExecWindow = 30,
): Promise<ExplorerQueryResult> {
  const body = typeof days === 'string' ? { id, propertyId, period: days } : { id, propertyId, days };
  return apiRequest<ExplorerQueryResult>(`${API_BASE}/data-explorer/query`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ConfigurationResponse {
  items: {
    id: string;
    name: string;
    description: string;
    category: 'dashboard' | 'kpi' | 'analytics';
    status: 'active' | 'inactive';
    lastModified: string | null;
    source: string;
    meta?: string;
    kind?: 'metric' | 'rule' | 'health';
    rawId?: string;
  }[];
  summary: { total: number; dashboard: number; kpi: number; analytics: number; active: number; inactive: number };
  kpiMetrics: {
    id: string; name: string; module: string; department: string;
    unit: string; direction: string; target: number | null; formula: string | null;
    isComputed: boolean; ruleCount: number; lastModified: string | null;
  }[];
  alertRules: {
    id: string; name: string; condition: string; threshold: any;
    severity: string; channel: string; isActive: boolean; source: string; lastModified: string | null;
  }[];
  snapshotFreshness: { module: string; latest: string }[];
  properties: { id: string; name: string }[];
  sources: { name: string; table: string; count: number }[];
}

export async function fetchConfiguration(propertyId?: string | null): Promise<ConfigurationResponse> {
  const params = new URLSearchParams();
  if (propertyId) params.set('propertyId', propertyId);
  return apiRequest<ConfigurationResponse>(`${API_BASE}/configuration?${params.toString()}`);
}

export async function updateExecConfig(
  kind: 'metric' | 'rule' | 'health',
  id: string,
  updates: Record<string, any>,
): Promise<{ ok: boolean; updates: Record<string, any> }> {
  return apiRequest(`${API_BASE}/configuration/${kind}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}
