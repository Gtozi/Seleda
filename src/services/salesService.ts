const API_BASE = '/api/sales';

function getPropertyParam(): string {
  const pid = localStorage.getItem('erp_property_id');
  return pid ? `propertyId=${encodeURIComponent(pid)}` : '';
}

function withProperty(path: string): string {
  const pp = getPropertyParam();
  if (!pp) return path;
  return path.includes('?') ? `${path}&${pp}` : `${path}?${pp}`;
}

async function apiRequest<T = any>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('erp_token');
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

export interface SalesLead {
  id: string;
  lead_number: string | null;
  lead_name: string;
  company: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: string;
  stage: string;
  opportunity_value: number;
  expected_close_date: string | null;
  assigned_to: string | null;
  corporate_account_id: string | null;
  priority: string;
  notes: string | null;
  conversion_date: string | null;
  lost_reason: string | null;
  corporate_accounts?: { company_name: string; industry: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface Proposal {
  id: string;
  proposal_number: string | null;
  lead_id: string | null;
  corporate_account_id: string | null;
  title: string;
  event_type: string | null;
  event_dates: string | null;
  guest_count: number;
  room_nights: number;
  proposed_revenue: number;
  discount_percent: number;
  terms_conditions: string | null;
  status: string;
  valid_until: string | null;
  sent_date: string | null;
  accepted_date: string | null;
  rejected_date: string | null;
  contract_id: string | null;
  notes: string | null;
  sales_leads?: { lead_name: string; company: string } | null;
  corporate_accounts?: { company_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface Contract {
  id: string;
  contract_number: string | null;
  proposal_id: string | null;
  lead_id: string | null;
  corporate_account_id: string | null;
  title: string;
  event_type: string | null;
  start_date: string | null;
  end_date: string | null;
  guest_count: number;
  room_nights: number;
  total_value: number;
  deposit_amount: number;
  deposit_paid: boolean;
  status: string;
  group_block_id: string | null;
  beo_id: string | null;
  terms: string | null;
  signed_by_client: string | null;
  signed_date: string | null;
  sales_proposals?: { proposal_number: string; title: string } | null;
  corporate_accounts?: { company_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface CorporateAccount {
  id: string;
  company_name: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  discount_percent: number;
  active_bookings: number;
  unpaid_balance: number;
  credit_limit: number;
  credit_terms: string;
  billing_address: string | null;
  tax_id: string | null;
  industry: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesAnalytics {
  totalLeads: number;
  wonLeads: number;
  conversionRate: number;
  totalPipelineValue: number;
  totalContractValue: number;
  totalProposedValue: number;
  stageCounts: Record<string, number>;
}

export interface SalesKPISummary {
  property_id: string;
  property_name: string;
  total_leads: number;
  open_opportunities: number;
  won_leads: number;
  pipeline_value: number;
  active_contracts: number;
  active_contract_value: number;
  corporate_accounts: number;
  active_campaigns: number;
}

// API Functions
export const fetchLeads = () => apiRequest<SalesLead[]>(withProperty(`${API_BASE}/leads`));
export const createLead = (data: any) => apiRequest(`${API_BASE}/leads`, { method: 'POST', body: JSON.stringify(data) });
export const updateLead = (id: string, data: any) => apiRequest(`${API_BASE}/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLead = (id: string) => apiRequest(`${API_BASE}/leads/${id}`, { method: 'DELETE' });

export const fetchProposals = () => apiRequest<Proposal[]>(withProperty(`${API_BASE}/proposals`));
export const createProposal = (data: any) => apiRequest(`${API_BASE}/proposals`, { method: 'POST', body: JSON.stringify(data) });
export const updateProposal = (id: string, data: any) => apiRequest(`${API_BASE}/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteProposal = (id: string) => apiRequest(`${API_BASE}/proposals/${id}`, { method: 'DELETE' });

export const fetchContracts = () => apiRequest<Contract[]>(withProperty(`${API_BASE}/contracts`));
export const createContract = (data: any) => apiRequest(`${API_BASE}/contracts`, { method: 'POST', body: JSON.stringify(data) });
export const updateContract = (id: string, data: any) => apiRequest(`${API_BASE}/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteContract = (id: string) => apiRequest(`${API_BASE}/contracts/${id}`, { method: 'DELETE' });
export const createGroupBlock = (contractId: string) => apiRequest(`${API_BASE}/contracts/${contractId}/create-group-block`, { method: 'POST' });
export const createBEO = (contractId: string) => apiRequest(`${API_BASE}/contracts/${contractId}/create-beo`, { method: 'POST' });

export const fetchCorporateAccounts = () => apiRequest<CorporateAccount[]>(withProperty(`${API_BASE}/corporate-accounts`));
export const createCorporateAccount = (data: any) => apiRequest(`${API_BASE}/corporate-accounts`, { method: 'POST', body: JSON.stringify(data) });
export const updateCorporateAccount = (id: string, data: any) => apiRequest(`${API_BASE}/corporate-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCorporateAccount = (id: string) => apiRequest(`${API_BASE}/corporate-accounts/${id}`, { method: 'DELETE' });

export const fetchSalesAnalytics = () => apiRequest<SalesAnalytics>(`${API_BASE}/analytics`);
export const fetchSalesKPISummary = (propertyId?: string) => apiRequest<SalesKPISummary[]>(withProperty(`${API_BASE}/kpi-summary${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ''}`));

export interface SalesActivity {
  id: string;
  activity_type: string;
  title: string;
  related_to: string | null;
  assigned_to: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchSalesActivities = () => apiRequest<SalesActivity[]>(withProperty(`${API_BASE}/activities`));
export const createSalesActivity = (data: any) => apiRequest(`${API_BASE}/activities`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesActivity = (id: string, data: any) => apiRequest(`${API_BASE}/activities/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesActivity = (id: string) => apiRequest(`${API_BASE}/activities/${id}`, { method: 'DELETE' });

export interface Campaign {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string;
  audience: string | null;
  budget: number;
  spent: number;
  leads: number;
  conversions: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchCampaigns = () => apiRequest<Campaign[]>(withProperty(`${API_BASE}/campaigns`));
export const createCampaign = (data: any) => apiRequest(`${API_BASE}/campaigns`, { method: 'POST', body: JSON.stringify(data) });
export const updateCampaign = (id: string, data: any) => apiRequest(`${API_BASE}/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCampaign = (id: string) => apiRequest(`${API_BASE}/campaigns/${id}`, { method: 'DELETE' });

export interface EmailCampaign {
  id: string;
  subject: string;
  template: string | null;
  recipients: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  unsubscribe_rate: number;
  status: string;
  sent_date: string | null;
  body: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchEmailCampaigns = () => apiRequest<EmailCampaign[]>(withProperty(`${API_BASE}/email-campaigns`));
export const createEmailCampaign = (data: any) => apiRequest(`${API_BASE}/email-campaigns`, { method: 'POST', body: JSON.stringify(data) });
export const updateEmailCampaign = (id: string, data: any) => apiRequest(`${API_BASE}/email-campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const sendEmailCampaign = (id: string, recipientList: string[]) => apiRequest(`${API_BASE}/email-campaigns/${id}/send`, { method: 'POST', body: JSON.stringify({ recipientList }) });
export const deleteEmailCampaign = (id: string) => apiRequest(`${API_BASE}/email-campaigns/${id}`, { method: 'DELETE' });

export interface SMSMessage {
  id: string;
  message_type: string;
  content: string;
  recipients: number;
  delivered: number;
  failed: number;
  status: string;
  sent_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchSMSMessaging = () => apiRequest<SMSMessage[]>(withProperty(`${API_BASE}/sms-messages`));
export const createSMSMessage = (data: any) => apiRequest(`${API_BASE}/sms-messages`, { method: 'POST', body: JSON.stringify(data) });
export const updateSMSMessage = (id: string, data: any) => apiRequest(`${API_BASE}/sms-messages/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const sendSMSMessage = (id: string, recipientList: string[]) => apiRequest(`${API_BASE}/sms-messages/${id}/send`, { method: 'POST', body: JSON.stringify({ recipientList }) });
export const deleteSMSMessage = (id: string) => apiRequest(`${API_BASE}/sms-messages/${id}`, { method: 'DELETE' });

export interface LoyaltyMember {
  id: string;
  member_name: string;
  tier: string;
  points: number;
  total_stays: number;
  total_spend: number;
  rewards_redeemed: number;
  enrollment_date: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchLoyaltyMembers = () => apiRequest<LoyaltyMember[]>(withProperty(`${API_BASE}/loyalty-members`));
export const createLoyaltyMember = (data: any) => apiRequest(`${API_BASE}/loyalty-members`, { method: 'POST', body: JSON.stringify(data) });
export const updateLoyaltyMember = (id: string, data: any) => apiRequest(`${API_BASE}/loyalty-members/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteLoyaltyMember = (id: string) => apiRequest(`${API_BASE}/loyalty-members/${id}`, { method: 'DELETE' });

export interface Promotion {
  id: string;
  name: string;
  type: string | null;
  code: string | null;
  discount_percent: number;
  start_date: string | null;
  end_date: string | null;
  uses: number;
  max_uses: number;
  revenue: number;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchPromotions = () => apiRequest<Promotion[]>(withProperty(`${API_BASE}/promotions`));
export const createPromotion = (data: any) => apiRequest(`${API_BASE}/promotions`, { method: 'POST', body: JSON.stringify(data) });
export const updatePromotion = (id: string, data: any) => apiRequest(`${API_BASE}/promotions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deletePromotion = (id: string) => apiRequest(`${API_BASE}/promotions/${id}`, { method: 'DELETE' });

export interface GiftVoucher {
  id: string;
  code: string;
  type: string | null;
  value: number;
  balance: number;
  recipient: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchGiftVouchers = () => apiRequest<GiftVoucher[]>(withProperty(`${API_BASE}/gift-vouchers`));
export const createGiftVoucher = (data: any) => apiRequest(`${API_BASE}/gift-vouchers`, { method: 'POST', body: JSON.stringify(data) });
export const updateGiftVoucher = (id: string, data: any) => apiRequest(`${API_BASE}/gift-vouchers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteGiftVoucher = (id: string) => apiRequest(`${API_BASE}/gift-vouchers/${id}`, { method: 'DELETE' });

export interface Review {
  id: string;
  source: string | null;
  guest_name: string;
  rating: number;
  title: string;
  sentiment: string;
  status: string;
  review_date: string | null;
  response: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchReviews = (sentiment?: string) => apiRequest<Review[]>(withProperty(`${API_BASE}/reviews${sentiment && sentiment !== 'all' ? `?sentiment=${encodeURIComponent(sentiment)}` : ''}`));
export const createReview = (data: any) => apiRequest(`${API_BASE}/reviews`, { method: 'POST', body: JSON.stringify(data) });
export const updateReview = (id: string, data: any) => apiRequest(`${API_BASE}/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteReview = (id: string) => apiRequest(`${API_BASE}/reviews/${id}`, { method: 'DELETE' });

export interface GuestFeedback {
  id: string;
  feedback_type: string | null;
  guest_name: string;
  rating: number;
  comments: string | null;
  status: string;
  resolution: string | null;
  feedback_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchGuestFeedback = () => apiRequest<GuestFeedback[]>(withProperty(`${API_BASE}/guest-feedback`));
export const createGuestFeedback = (data: any) => apiRequest(`${API_BASE}/guest-feedback`, { method: 'POST', body: JSON.stringify(data) });
export const updateGuestFeedback = (id: string, data: any) => apiRequest(`${API_BASE}/guest-feedback/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteGuestFeedback = (id: string) => apiRequest(`${API_BASE}/guest-feedback/${id}`, { method: 'DELETE' });

export interface SegmentMember {
  id: string;
  name: string;
  segment: string;
  total_spend: number;
  last_stay: string | null;
  frequency: string | null;
  value_tier: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchSegmentMembers = (segment?: string) => apiRequest<SegmentMember[]>(withProperty(`${API_BASE}/segment-members${segment && segment !== 'all' ? `?segment=${encodeURIComponent(segment)}` : ''}`));
export const createSegmentMember = (data: any) => apiRequest(`${API_BASE}/segment-members`, { method: 'POST', body: JSON.stringify(data) });
export const updateSegmentMember = (id: string, data: any) => apiRequest(`${API_BASE}/segment-members/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSegmentMember = (id: string) => apiRequest(`${API_BASE}/segment-members/${id}`, { method: 'DELETE' });

export interface Communication {
  id: string;
  channel: string | null;
  subject: string | null;
  recipient: string | null;
  body: string | null;
  status: string;
  communication_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchCommunications = () => apiRequest<Communication[]>(withProperty(`${API_BASE}/communications`));
export const createCommunication = (data: any) => apiRequest(`${API_BASE}/communications`, { method: 'POST', body: JSON.stringify(data) });
export const updateCommunication = (id: string, data: any) => apiRequest(`${API_BASE}/communications/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCommunication = (id: string) => apiRequest(`${API_BASE}/communications/${id}`, { method: 'DELETE' });

export interface SalesReport {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  status: string;
  last_run: string | null;
  format: string;
  frequency: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesReportStats {
  total: number;
  ready: number;
  scheduled: number;
  failed: number;
  byCategory: Record<string, number>;
}

export const fetchSalesReports = (category?: string) => apiRequest<SalesReport[]>(withProperty(`${API_BASE}/reports${category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : ''}`));
export const fetchSalesReportStats = () => apiRequest<SalesReportStats>(`${API_BASE}/reports/stats`);
export const createSalesReport = (data: any) => apiRequest(`${API_BASE}/reports`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesReport = (id: string, data: any) => apiRequest(`${API_BASE}/reports/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesReport = (id: string) => apiRequest(`${API_BASE}/reports/${id}`, { method: 'DELETE' });
export const runSalesReport = (id: string) => apiRequest(`${API_BASE}/reports/${id}/run`, { method: 'POST' });
export const runAllSalesReports = () => apiRequest<{ refreshed: number }>(`${API_BASE}/reports/run-all`, { method: 'POST' });
export const previewSalesReport = (id: string) => apiRequest<any[]>(`${API_BASE}/reports/${id}/preview`);

export interface SalesDashboardWidget {
  id: string;
  widget_type: string;
  category: string | null;
  title: string;
  value: string | null;
  change_value: string | null;
  sequence: number;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export const fetchSalesDashboard = () => apiRequest<SalesDashboardWidget[]>(`${API_BASE}/dashboard`);
export const refreshSalesDashboard = () => apiRequest<SalesDashboardWidget[]>(`${API_BASE}/dashboard/refresh`, { method: 'POST' });

export interface SalesStaff {
  id: string;
  employee_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  shift: string;
  territory: string;
  status: string;
  workload: number;
  sales_target: number;
  ytd_revenue: number;
  property_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesStaffAttendance {
  id: string;
  staff_id: string;
  attendance_date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  hours_worked: number;
  overtime_hours: number;
  notes: string | null;
  sales_staff?: { name: string; role: string };
  created_at: string;
  updated_at: string;
}

export interface SalesStaffTraining {
  id: string;
  staff_id: string;
  course: string;
  due_date: string | null;
  status: string;
  sales_staff?: { name: string; role: string };
  created_at: string;
  updated_at: string;
}

export interface SalesStaffProductivity {
  id: string;
  staff_id: string;
  period: string;
  calls_made: number;
  meetings: number;
  deals_closed: number;
  revenue: number;
  sales_staff?: { name: string; role: string };
  created_at: string;
  updated_at: string;
}

export interface SalesStaffShiftReq {
  id: string;
  role: string;
  shift: string;
  required_count: number;
  assigned_count: number;
  property_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesStaffStaffingReq {
  id: string;
  territory: string;
  role: string;
  required_count: number;
  assigned_count: number;
  property_id: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchSalesStaff = () => apiRequest<SalesStaff[]>(withProperty(`${API_BASE}/staff`));
export const fetchSalesStaffEmployees = (propertyId: string) => apiRequest<{ id: string; name: string; email: string | null; phone: string | null; position: string | null; department: string | null; status: string }[]>(`${API_BASE}/staff/employees/${propertyId}`);
export const createSalesStaff = (data: any) => apiRequest(`${API_BASE}/staff`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesStaff = (id: string, data: any) => apiRequest(`${API_BASE}/staff/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesStaff = (id: string) => apiRequest(`${API_BASE}/staff/${id}`, { method: 'DELETE' });

export const fetchSalesStaffAttendance = () => apiRequest<SalesStaffAttendance[]>(withProperty(`${API_BASE}/staff/attendance`));
export const createSalesStaffAttendance = (data: any) => apiRequest(`${API_BASE}/staff/attendance`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesStaffAttendance = (id: string, data: any) => apiRequest(`${API_BASE}/staff/attendance/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesStaffAttendance = (id: string) => apiRequest(`${API_BASE}/staff/attendance/${id}`, { method: 'DELETE' });

export const fetchSalesStaffTraining = () => apiRequest<SalesStaffTraining[]>(withProperty(`${API_BASE}/staff/training`));
export const createSalesStaffTraining = (data: any) => apiRequest(`${API_BASE}/staff/training`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesStaffTraining = (id: string, data: any) => apiRequest(`${API_BASE}/staff/training/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesStaffTraining = (id: string) => apiRequest(`${API_BASE}/staff/training/${id}`, { method: 'DELETE' });

export const fetchSalesStaffProductivity = () => apiRequest<SalesStaffProductivity[]>(withProperty(`${API_BASE}/staff/productivity`));
export const createSalesStaffProductivity = (data: any) => apiRequest(`${API_BASE}/staff/productivity`, { method: 'POST', body: JSON.stringify(data) });
export const updateSalesStaffProductivity = (id: string, data: any) => apiRequest(`${API_BASE}/staff/productivity/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteSalesStaffProductivity = (id: string) => apiRequest(`${API_BASE}/staff/productivity/${id}`, { method: 'DELETE' });

export const fetchSalesStaffShiftReqs = () => apiRequest<SalesStaffShiftReq[]>(withProperty(`${API_BASE}/staff/shift-reqs`));
export const updateSalesStaffShiftReq = (id: string, data: any) => apiRequest(`${API_BASE}/staff/shift-reqs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const fetchSalesStaffStaffingReqs = () => apiRequest<SalesStaffStaffingReq[]>(withProperty(`${API_BASE}/staff/staffing-reqs`));
export const updateSalesStaffStaffingReq = (id: string, data: any) => apiRequest(`${API_BASE}/staff/staffing-reqs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export interface SalesSetting {
  id: string;
  setting_key: string;
  setting_value: string | null;
  setting_type: string | null;
  label: string | null;
  category: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchSalesSettings = () => apiRequest<SalesSetting[]>(withProperty(`${API_BASE}/settings`));
export const saveSalesSetting = (data: any) => apiRequest(`${API_BASE}/settings`, { method: 'POST', body: JSON.stringify(data) });
export const saveSalesSettingsBulk = (settings: any[]) => apiRequest(`${API_BASE}/settings/bulk`, { method: 'POST', body: JSON.stringify({ settings }) });

export interface GuestProfileRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  history: {
    totalStays: number;
    totalRevenue: number;
    totalNights: number;
    lastStay: string | null;
    stayFrequency: string;
    loyaltyTier: string;
    loyaltyPoints: number;
  };
  preferences: {
    language: string;
    roomType: string;
    pillowType: string;
    bedType: string;
    dietary: string;
    newspaper: string;
    amenities: string[];
  };
  notes: string;
  specialRequests: string;
}

export interface CreateGuestProfilePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  status?: string;
  loyaltyPoints?: number;
  preferences?: {
    language?: string;
    roomType?: string;
    pillowType?: string;
    bedType?: string;
    dietary?: string;
    newspaper?: string;
    amenities?: string[];
  };
  notes?: string;
  specialRequests?: string;
}

export const fetchGuestProfiles = () =>
  apiRequest<{ guests: GuestProfileRecord[]; total: number }>('/api/front-office/guests?limit=200').then(r => r.guests || []);

export const createGuestProfile = (data: CreateGuestProfilePayload) =>
  apiRequest('/api/front-office/guests', { method: 'POST', body: JSON.stringify(data) });

export interface TravelAgentRecord {
  id: string;
  code: string;
  name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  payment_terms: string;
  commission_model: 'net' | 'commissionable';
  credit_limit: number;
  is_active: boolean;
  notes: string | null;
  billing_address?: string | null;
  tax_id?: string | null;
  vat_number?: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchTravelAgents = () => apiRequest<TravelAgentRecord[]>('/api/b2b/operators');
export const createTravelAgent = (data: any) => apiRequest('/api/b2b/operators', { method: 'POST', body: JSON.stringify(data) });
export const updateTravelAgent = (id: string, data: any) => apiRequest(`/api/b2b/operators/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export interface Testimonial {
  id: string;
  property_id: string;
  guest_name: string;
  location: string | null;
  rating: number;
  comment: string;
  stay_date: string | null;
  room_type: string | null;
  status: 'pending' | 'approved' | 'hidden';
  source: string;
  created_at: string;
  updated_at: string;
}

export const fetchTestimonials = () => apiRequest<Testimonial[]>(`${API_BASE}/testimonials`);
export const createTestimonial = (data: Partial<Testimonial> & { source?: string }) => apiRequest<Testimonial>(`${API_BASE}/testimonials`, { method: 'POST', body: JSON.stringify(data) });
export const updateTestimonial = (id: string, data: Partial<Testimonial>) => apiRequest<Testimonial>(`${API_BASE}/testimonials/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTestimonial = (id: string) => apiRequest(`${API_BASE}/testimonials/${id}`, { method: 'DELETE' });
