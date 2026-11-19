-- Migration 443: Sales Portal Gap Fixes
-- 1. Add property_id to existing sales tables for multi-property isolation
-- 2. Create missing tables referenced by salesEventsPortal.routes.ts
-- 3. Enable RLS on all sales tables with admin/service-role policies
-- 4. Create refresh_sales_dashboard() function to compute KPIs from real data
-- 5. Add indexes on property_id columns

-- =============================================================
-- 0. Create missing sales tables that prior migrations should have created
--    (idempotent so re-running is safe)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_loyalty_members (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  member_name text NOT NULL,
  tier text DEFAULT 'Bronze',
  points numeric DEFAULT 0,
  total_stays integer DEFAULT 0,
  total_spend numeric DEFAULT 0,
  rewards_redeemed integer DEFAULT 0,
  enrollment_date date,
  status text DEFAULT 'Active',
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_promotions (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name text NOT NULL,
  type text,
  code text,
  discount_percent numeric DEFAULT 0,
  start_date date,
  end_date date,
  uses integer DEFAULT 0,
  max_uses integer DEFAULT 0,
  revenue numeric DEFAULT 0,
  status text DEFAULT 'Draft',
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_gift_vouchers (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  code text NOT NULL,
  type text,
  value numeric DEFAULT 0,
  balance numeric DEFAULT 0,
  recipient text,
  issue_date date,
  expiry_date date,
  status text DEFAULT 'Active',
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_reviews (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  source text,
  guest_name text NOT NULL,
  rating integer DEFAULT 0,
  title text,
  sentiment text,
  status text DEFAULT 'Pending',
  review_date date,
  response text,
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_guest_feedback (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  feedback_type text,
  guest_name text NOT NULL,
  rating integer DEFAULT 0,
  comments text,
  status text DEFAULT 'Pending',
  resolution text,
  feedback_date date,
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_segment_members (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name text NOT NULL,
  segment text NOT NULL,
  total_spend numeric DEFAULT 0,
  last_stay text,
  frequency text,
  value_tier text DEFAULT 'Medium',
  created_by text,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 1. Add property_id to existing sales tables
-- =============================================================

ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_leads ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_proposals ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_contracts ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_activities ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_campaigns ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_email_campaigns ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_sms_messages ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_loyalty_members ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_promotions ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_gift_vouchers ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_reviews ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_guest_feedback ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_segment_members ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_communications ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_reports ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS property_id uuid;

-- =============================================================
-- 2. Create missing tables referenced by salesEventsPortal.routes.ts
-- =============================================================

-- 2a. Sales Opportunities (advanced pipeline entity used by events portal)
CREATE TABLE IF NOT EXISTS public.sales_opportunities (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  corporate_account_id text REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  value numeric DEFAULT 0,
  status text DEFAULT 'lead' CHECK (status IN ('lead','qualified','proposal','negotiation','closed_won','closed_lost')),
  probability integer DEFAULT 10,
  expected_close_date date,
  owner_id text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2b. Events (sales/events calendar — distinct from banquet_events)
CREATE TABLE IF NOT EXISTS public.events (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  name text NOT NULL,
  event_date date NOT NULL,
  end_date date,
  event_type text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  expected_attendees integer DEFAULT 0,
  estimated_revenue numeric DEFAULT 0,
  actual_revenue numeric DEFAULT 0,
  setup_time text,
  service_style text,
  special_requirements text,
  beo_generated boolean DEFAULT false,
  beo_generated_at timestamptz,
  corporate_account_id text REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2c. Banquet Event Orders (BEO handoff to F&B)
CREATE TABLE IF NOT EXISTS public.banquet_event_orders (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  event_id text REFERENCES public.events(id) ON DELETE CASCADE,
  beo_number text,
  event_date date,
  event_type text,
  expected_attendees integer DEFAULT 0,
  setup_time text,
  service_style text,
  special_requirements text,
  status text DEFAULT 'draft' CHECK (status IN ('draft','sent','confirmed','completed','cancelled')),
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2d. Event Resources
CREATE TABLE IF NOT EXISTS public.event_resources (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  name text NOT NULL,
  resource_type text,
  total_quantity integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2e. Event Resource Bookings
CREATE TABLE IF NOT EXISTS public.event_resource_bookings (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  event_id text REFERENCES public.events(id) ON DELETE CASCADE,
  resource_id text REFERENCES public.event_resources(id) ON DELETE CASCADE,
  quantity integer DEFAULT 0,
  booking_date date NOT NULL,
  booked_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2f. Event Actuals (post-event analysis)
CREATE TABLE IF NOT EXISTS public.event_actuals (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  event_id text REFERENCES public.events(id) ON DELETE CASCADE,
  actual_attendees integer DEFAULT 0,
  actual_revenue numeric DEFAULT 0,
  satisfaction_score numeric DEFAULT 0,
  feedback text,
  recorded_by text,
  recorded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2g. CRM Guests (linking table between sales CRM and front office guests)
CREATE TABLE IF NOT EXISTS public.crm_guests (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  guest_id text,
  first_name text,
  last_name text,
  email text,
  phone text,
  corporate_account_id text REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2h. Guest Preferences
CREATE TABLE IF NOT EXISTS public.guest_preferences (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  guest_id text NOT NULL,
  category text,
  preference text,
  value text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2i. Communication History
CREATE TABLE IF NOT EXISTS public.communication_history (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  guest_id text,
  communication_type text,
  subject text,
  message text,
  direction text DEFAULT 'outbound',
  logged_by text,
  communication_date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2j. Sales Contacts
CREATE TABLE IF NOT EXISTS public.sales_contacts (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  corporate_account_id text REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  title text,
  email text,
  phone text,
  contact_type text DEFAULT 'prospect',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2k. Marketing Spend (for CAC tracking)
CREATE TABLE IF NOT EXISTS public.marketing_spend (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  property_id uuid,
  channel text,
  amount numeric DEFAULT 0,
  spend_date date DEFAULT now(),
  campaign text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 3. Triggers for new tables
-- =============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_opportunities_updated_at ON public.sales_opportunities;
CREATE TRIGGER trg_sales_opportunities_updated_at
  BEFORE UPDATE ON public.sales_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_event_orders_updated_at ON public.banquet_event_orders;
CREATE TRIGGER trg_banquet_event_orders_updated_at
  BEFORE UPDATE ON public.banquet_event_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_event_resources_updated_at ON public.event_resources;
CREATE TRIGGER trg_event_resources_updated_at
  BEFORE UPDATE ON public.event_resources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_event_resource_bookings_updated_at ON public.event_resource_bookings;
CREATE TRIGGER trg_event_resource_bookings_updated_at
  BEFORE UPDATE ON public.event_resource_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_event_actuals_updated_at ON public.event_actuals;
CREATE TRIGGER trg_event_actuals_updated_at
  BEFORE UPDATE ON public.event_actuals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_crm_guests_updated_at ON public.crm_guests;
CREATE TRIGGER trg_crm_guests_updated_at
  BEFORE UPDATE ON public.crm_guests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_guest_preferences_updated_at ON public.guest_preferences;
CREATE TRIGGER trg_guest_preferences_updated_at
  BEFORE UPDATE ON public.guest_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_communication_history_updated_at ON public.communication_history;
CREATE TRIGGER trg_communication_history_updated_at
  BEFORE UPDATE ON public.communication_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_contacts_updated_at ON public.sales_contacts;
CREATE TRIGGER trg_sales_contacts_updated_at
  BEFORE UPDATE ON public.sales_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_marketing_spend_updated_at ON public.marketing_spend;
CREATE TRIGGER trg_marketing_spend_updated_at
  BEFORE UPDATE ON public.marketing_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_loyalty_members_updated_at ON public.sales_loyalty_members;
CREATE TRIGGER trg_sales_loyalty_members_updated_at
  BEFORE UPDATE ON public.sales_loyalty_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_promotions_updated_at ON public.sales_promotions;
CREATE TRIGGER trg_sales_promotions_updated_at
  BEFORE UPDATE ON public.sales_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_gift_vouchers_updated_at ON public.sales_gift_vouchers;
CREATE TRIGGER trg_sales_gift_vouchers_updated_at
  BEFORE UPDATE ON public.sales_gift_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_reviews_updated_at ON public.sales_reviews;
CREATE TRIGGER trg_sales_reviews_updated_at
  BEFORE UPDATE ON public.sales_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_guest_feedback_updated_at ON public.sales_guest_feedback;
CREATE TRIGGER trg_sales_guest_feedback_updated_at
  BEFORE UPDATE ON public.sales_guest_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_segment_members_updated_at ON public.sales_segment_members;
CREATE TRIGGER trg_sales_segment_members_updated_at
  BEFORE UPDATE ON public.sales_segment_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 4. Indexes on property_id
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_corporate_accounts_property ON public.corporate_accounts(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_leads_property ON public.sales_leads(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_proposals_property ON public.sales_proposals(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_contracts_property ON public.sales_contracts(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_activities_property ON public.sales_activities(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_campaigns_property ON public.sales_campaigns(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_email_campaigns_property ON public.sales_email_campaigns(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_sms_messages_property ON public.sales_sms_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_loyalty_members_property ON public.sales_loyalty_members(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_promotions_property ON public.sales_promotions(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_gift_vouchers_property ON public.sales_gift_vouchers(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_reviews_property ON public.sales_reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_guest_feedback_property ON public.sales_guest_feedback(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_segment_members_property ON public.sales_segment_members(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_communications_property ON public.sales_communications(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_reports_property ON public.sales_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_settings_property ON public.sales_settings(property_id);

CREATE INDEX IF NOT EXISTS idx_sales_opportunities_property ON public.sales_opportunities(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_status ON public.sales_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_corporate ON public.sales_opportunities(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_events_property ON public.events(property_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON public.events(event_date);
CREATE INDEX IF NOT EXISTS idx_banquet_event_orders_property ON public.banquet_event_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_banquet_event_orders_event ON public.banquet_event_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_resources_property ON public.event_resources(property_id);
CREATE INDEX IF NOT EXISTS idx_event_resource_bookings_property ON public.event_resource_bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_event_resource_bookings_date ON public.event_resource_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_event_actuals_event ON public.event_actuals(event_id);
CREATE INDEX IF NOT EXISTS idx_crm_guests_property ON public.crm_guests(property_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest ON public.guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_communication_history_guest ON public.communication_history(guest_id);
CREATE INDEX IF NOT EXISTS idx_sales_contacts_property ON public.sales_contacts(property_id);
CREATE INDEX IF NOT EXISTS idx_marketing_spend_property ON public.marketing_spend(property_id);

-- =============================================================
-- 5. Enable RLS on all sales tables
--    Policies allow authenticated users with service-role bypass.
--    Client-side access is denied by default (no anon/authenticated SELECT).
-- =============================================================

DO $$
DECLARE
  tbl text;
  sales_tables text[] := ARRAY[
    'corporate_accounts','sales_leads','sales_proposals','sales_contracts',
    'group_blocks','sales_activities','sales_campaigns','sales_email_campaigns',
    'sales_sms_messages','sales_loyalty_members','sales_promotions',
    'sales_gift_vouchers','sales_reviews','sales_guest_feedback',
    'sales_segment_members','sales_communications','sales_reports',
    'sales_settings','sales_dashboard','sales_staff','sales_staff_attendance',
    'sales_staff_training','sales_staff_productivity','sales_staff_shift_reqs',
    'sales_staff_staffing_reqs','sales_opportunities','events',
    'banquet_event_orders','event_resources','event_resource_bookings',
    'event_actuals','crm_guests','guest_preferences','communication_history',
    'sales_contacts','marketing_spend'
  ];
BEGIN
  FOREACH tbl IN ARRAY sales_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    -- Service role bypasses RLS by default; add explicit policy for authenticated
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      tbl || '_service_role_all', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      tbl || '_service_role_all', tbl
    );
  END LOOP;
END $$;

-- =============================================================
-- 6. refresh_sales_dashboard() function
--    Recomputes KPI widgets from real data and upserts into sales_dashboard.
-- =============================================================

CREATE OR REPLACE FUNCTION public.refresh_sales_dashboard()
RETURNS void AS $$
DECLARE
  v_total_leads int;
  v_won_leads int;
  v_lost_leads int;
  v_open_opps int;
  v_pipeline_value numeric;
  v_conversion_rate numeric;
  v_avg_deal_size numeric;
  v_corp_revenue numeric;
  v_total_contracts numeric;
  v_total_proposals int;
  v_accepted_proposals int;
  v_campaign_count int;
  v_total_campaign_leads int;
  v_total_campaign_conversions int;
  v_email_count int;
  v_avg_open_rate numeric;
  v_avg_click_rate numeric;
  v_loyalty_count int;
  v_total_loyalty_points numeric;
  v_review_count int;
  v_avg_rating numeric;
BEGIN
  -- Sales KPIs
  SELECT count(*), count(*) FILTER (WHERE stage = 'Won'), count(*) FILTER (WHERE stage = 'Lost'),
         count(*) FILTER (WHERE stage NOT IN ('Won','Lost')),
         coalesce(sum(opportunity_value), 0)
    INTO v_total_leads, v_won_leads, v_lost_leads, v_open_opps, v_pipeline_value
  FROM public.sales_leads;

  v_conversion_rate := CASE WHEN v_total_leads > 0 THEN round((v_won_leads::numeric / v_total_leads) * 100, 1) ELSE 0 END;

  SELECT coalesce(avg(total_value), 0)
    INTO v_avg_deal_size
  FROM public.sales_contracts WHERE status = 'Active';

  SELECT coalesce(sum(unpaid_balance), 0)
    INTO v_corp_revenue
  FROM public.corporate_accounts;

  SELECT count(*), count(*) FILTER (WHERE status = 'Accepted')
    INTO v_total_proposals, v_accepted_proposals
  FROM public.sales_proposals;

  SELECT count(*), coalesce(sum(total_value), 0)
    INTO v_total_contracts, v_pipeline_value
  FROM public.sales_contracts;

  -- Marketing KPIs
  SELECT count(*), coalesce(sum(leads), 0), coalesce(sum(conversions), 0)
    INTO v_campaign_count, v_total_campaign_leads, v_total_campaign_conversions
  FROM public.sales_campaigns;

  SELECT count(*), coalesce(avg(open_rate), 0), coalesce(avg(click_rate), 0)
    INTO v_email_count, v_avg_open_rate, v_avg_click_rate
  FROM public.sales_email_campaigns WHERE status = 'Sent';

  -- CRM KPIs
  SELECT count(*), coalesce(sum(points), 0)
    INTO v_loyalty_count, v_total_loyalty_points
  FROM public.sales_loyalty_members WHERE status = 'Active';

  SELECT count(*), coalesce(avg(rating), 0)
    INTO v_review_count, v_avg_rating
  FROM public.sales_reviews;

  -- Upsert Sales KPIs
  INSERT INTO public.sales_dashboard (id, widget_type, category, title, value, change_value, sequence, metadata) VALUES
    ('dash-sales-pipeline', 'kpi', 'sales', 'Revenue Pipeline', '$' || to_char(v_pipeline_value, 'FM999,999,990'), null, 1, '{"icon":"TrendingUp","tone":"accent"}'),
    ('dash-sales-open-opps', 'kpi', 'sales', 'Open Opportunities', v_open_opps::text, null, 2, '{"icon":"Target","tone":"info"}'),
    ('dash-sales-won', 'kpi', 'sales', 'Won Opportunities', v_won_leads::text, null, 3, '{"icon":"Award","tone":"success"}'),
    ('dash-sales-lost', 'kpi', 'sales', 'Lost Opportunities', v_lost_leads::text, null, 4, '{"icon":"Target","tone":"danger"}'),
    ('dash-sales-conversion', 'kpi', 'sales', 'Conversion Rate', v_conversion_rate::text || '%', null, 5, '{"icon":"BarChart3","tone":"warning"}'),
    ('dash-sales-avg-deal', 'kpi', 'sales', 'Average Deal Size', '$' || to_char(v_avg_deal_size, 'FM999,999,990'), null, 6, '{"icon":"DollarSign","tone":"info"}'),
    ('dash-sales-corp-rev', 'kpi', 'sales', 'Corporate Revenue', '$' || to_char(v_corp_revenue, 'FM999,999,990'), null, 7, '{"icon":"Building2","tone":"success"}'),
    ('dash-sales-total-leads', 'kpi', 'sales', 'Total Leads', v_total_leads::text, null, 8, '{"icon":"Users","tone":"accent"}'),
    -- Marketing KPIs
    ('dash-mkt-campaigns', 'kpi', 'marketing', 'Active Campaigns', v_campaign_count::text, null, 1, '{"icon":"Megaphone","tone":"success"}'),
    ('dash-mkt-leads', 'kpi', 'marketing', 'Campaign Leads', v_total_campaign_leads::text, null, 2, '{"icon":"Target","tone":"info"}'),
    ('dash-mkt-conversions', 'kpi', 'marketing', 'Campaign Conversions', v_total_campaign_conversions::text, null, 3, '{"icon":"BarChart3","tone":"accent"}'),
    ('dash-mkt-emails', 'kpi', 'marketing', 'Email Campaigns Sent', v_email_count::text, null, 4, '{"icon":"Mail","tone":"info"}'),
    ('dash-mkt-open-rate', 'kpi', 'marketing', 'Avg Open Rate', round(v_avg_open_rate, 1)::text || '%', null, 5, '{"icon":"MousePointerClick","tone":"success"}'),
    ('dash-mkt-click-rate', 'kpi', 'marketing', 'Avg Click Rate', round(v_avg_click_rate, 1)::text || '%', null, 6, '{"icon":"MousePointerClick","tone":"warning"}'),
    ('dash-mkt-proposals', 'kpi', 'marketing', 'Proposals Sent', v_total_proposals::text, null, 7, '{"icon":"Briefcase","tone":"accent"}'),
    -- CRM KPIs
    ('dash-crm-loyalty', 'kpi', 'crm', 'Active Loyalty Members', v_loyalty_count::text, null, 1, '{"icon":"Crown","tone":"warning"}'),
    ('dash-crm-points', 'kpi', 'crm', 'Total Loyalty Points', to_char(v_total_loyalty_points, 'FM999,999,990'), null, 2, '{"icon":"Star","tone":"accent"}'),
    ('dash-crm-reviews', 'kpi', 'crm', 'Total Reviews', v_review_count::text, null, 3, '{"icon":"Heart","tone":"info"}'),
    ('dash-crm-avg-rating', 'kpi', 'crm', 'Average Rating', round(v_avg_rating, 1)::text || '/5', null, 4, '{"icon":"Star","tone":"success"}'),
    ('dash-crm-contracts', 'kpi', 'crm', 'Active Contracts', v_total_contracts::text, null, 5, '{"icon":"Briefcase","tone":"info"}'),
    ('dash-crm-accepted', 'kpi', 'crm', 'Accepted Proposals', v_accepted_proposals::text, null, 6, '{"icon":"Award","tone":"accent"}')
  ON CONFLICT (id) DO UPDATE SET
    value = EXCLUDED.value,
    change_value = EXCLUDED.change_value,
    metadata = EXCLUDED.metadata,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the refresh once to populate real data
SELECT public.refresh_sales_dashboard();

-- =============================================================
-- 7. create_beo_from_contract function
--    Creates a BEO (Banquet Event Order) in banquet_events from a
--    sales contract and links it back via sales_contracts.beo_id.
--    Called by POST /api/sales/contracts/:id/create-beo
-- =============================================================

DROP FUNCTION IF EXISTS public.create_beo_from_contract(text) CASCADE;

CREATE OR REPLACE FUNCTION public.create_beo_from_contract(p_contract_id text)
RETURNS TABLE(beo_id text, beo_number text) AS $$
DECLARE
  v_contract record;
  v_beo_id text;
  v_beo_number text;
  v_client_name text;
BEGIN
  SELECT * INTO v_contract FROM public.sales_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Resolve client name from corporate account or contract title
  SELECT co.company_name INTO v_client_name
  FROM public.corporate_accounts co
  WHERE co.id = v_contract.corporate_account_id;

  v_beo_id := gen_random_uuid()::text;
  v_beo_number := 'BEO-' || to_char(now(), 'YYYY') || '-' || lpad(extract(epoch from now())::bigint::text, 6, '0');

  INSERT INTO public.banquet_events (
    id, event_name, event_date, client_name, guest_count,
    status, estimated_revenue, notes
  ) VALUES (
    v_beo_id,
    v_contract.title,
    v_contract.start_date,
    COALESCE(v_client_name, v_contract.title),
    v_contract.guest_count,
    'Draft',
    v_contract.total_value,
    'Auto-created from contract ' || COALESCE(v_contract.contract_number, p_contract_id)
  );

  UPDATE public.sales_contracts SET beo_id = v_beo_id WHERE id = p_contract_id;

  RETURN QUERY SELECT v_beo_id, v_beo_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 8. Shared department tables referenced by Sales integrations
--    (CREATE IF NOT EXISTS so earlier migrations still win)
-- =============================================================

-- room_types referenced by rooms.room_type_id
CREATE TABLE IF NOT EXISTS public.room_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  description text,
  base_rate numeric DEFAULT 0,
  capacity integer DEFAULT 2,
  is_active boolean DEFAULT true,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- rooms table required by room_blocks FK and used by Sales group blocks
CREATE TABLE IF NOT EXISTS public.rooms (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  number text NOT NULL,
  type text,
  floor text,
  status text DEFAULT 'Available',
  rate numeric DEFAULT 0,
  room_type_id text REFERENCES public.room_types(id) ON DELETE SET NULL,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- guests table required for CRM guest linking
CREATE TABLE IF NOT EXISTS public.guests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  first_name text,
  last_name text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  date_of_birth date,
  gender text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- reservations table required by folio/reservation integrations
CREATE TABLE IF NOT EXISTS public.reservations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  guest_id text REFERENCES public.guests(id) ON DELETE SET NULL,
  property_id uuid,
  check_in_date date,
  check_out_date date,
  room_type text,
  room_id text REFERENCES public.rooms(id) ON DELETE SET NULL,
  status text DEFAULT 'Reserved',
  total_amount numeric DEFAULT 0,
  payment_status text DEFAULT 'Pending',
  channel text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 9. Group block to Front Office room_blocks conversion
--    Converts a sales group block into individual room_blocks.
-- =============================================================

ALTER TABLE public.group_blocks ADD COLUMN IF NOT EXISTS property_id uuid;

-- Replace the original create_group_block_from_contract to also sync property_id
-- and (optionally) convert to room_blocks.

DROP FUNCTION IF EXISTS public.create_group_block_from_contract(text) CASCADE;

CREATE OR REPLACE FUNCTION public.create_group_block_from_contract(p_contract_id text)
RETURNS TABLE(block_id text, block_name text) AS $$
DECLARE
  v_contract record;
  v_block_id text;
BEGIN
  SELECT * INTO v_contract FROM public.sales_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_block_id := gen_random_uuid()::text;
  INSERT INTO public.group_blocks (id, block_name, contract_id, corporate_account_id,
    property_id, arrival_date, departure_date, total_rooms, blocked_rooms, room_type, rate, status)
  VALUES (
    v_block_id,
    v_contract.title || ' - Group Block',
    p_contract_id, v_contract.corporate_account_id,
    v_contract.property_id,
    v_contract.start_date, v_contract.end_date,
    v_contract.room_nights, v_contract.room_nights,
    'Standard', v_contract.total_value / NULLIF(v_contract.room_nights, 0),
    'Open'
  );

  UPDATE public.sales_contracts SET group_block_id = v_block_id WHERE id = p_contract_id;

  RETURN QUERY SELECT v_block_id, v_contract.title || ' - Group Block';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.convert_group_block_to_room_blocks(p_group_block_id text)
RETURNS TABLE(room_block_id text, room_number text) AS $$
DECLARE
  v_gb record;
  v_property_id uuid;
  v_room record;
  v_created integer := 0;
  v_target integer;
BEGIN
  SELECT * INTO v_gb FROM public.group_blocks WHERE id = p_group_block_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Resolve property_id from the contract if missing on group block
  IF v_gb.contract_id IS NOT NULL THEN
    SELECT COALESCE(v_gb.property_id, c.property_id) INTO v_property_id
    FROM public.sales_contracts c
    WHERE c.id = v_gb.contract_id;
  ELSE
    v_property_id := v_gb.property_id;
  END IF;

  v_target := COALESCE(v_gb.total_rooms, 0);
  IF v_target = 0 THEN RETURN; END IF;

  FOR v_room IN
    SELECT r.id, r.number
    FROM public.rooms r
    WHERE r.property_id = v_property_id
      AND (v_gb.room_type IS NULL OR r.type = v_gb.room_type OR r.room_type_id = v_gb.room_type)
      AND NOT EXISTS (
        SELECT 1 FROM public.room_blocks rb
        WHERE rb.room_id = r.id
          AND rb.end_date >= v_gb.arrival_date
          AND rb.start_date <= v_gb.departure_date
      )
    ORDER BY r.number
    LIMIT v_target
  LOOP
    INSERT INTO public.room_blocks (
      id, room_id, room_number, status, start_date, end_date, reason, created_by
    ) VALUES (
      gen_random_uuid()::text,
      v_room.id,
      v_room.number,
      'Blocked',
      v_gb.arrival_date,
      v_gb.departure_date,
      'Group block ' || COALESCE(v_gb.block_name, p_group_block_id),
      'Sales Group Block Sync'
    );
    v_created := v_created + 1;
    room_block_id := gen_random_uuid()::text;
    room_number := v_room.number;
    RETURN NEXT;
  END LOOP;

  IF v_created > 0 THEN
    UPDATE public.group_blocks SET blocked_rooms = v_created WHERE id = p_group_block_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- 10. Sales KPI summary view for cross-department dashboards
-- =============================================================

CREATE OR REPLACE VIEW public.v_sales_kpi_summary AS
SELECT
  p.property_id,
  COALESCE(p.property_name, p.property_id::text) AS property_name,
  (SELECT count(*) FROM public.sales_leads WHERE property_id = p.property_id) AS total_leads,
  (SELECT count(*) FROM public.sales_leads WHERE property_id = p.property_id AND stage NOT IN ('Won', 'Lost')) AS open_opportunities,
  (SELECT count(*) FROM public.sales_leads WHERE property_id = p.property_id AND stage = 'Won') AS won_leads,
  (SELECT COALESCE(sum(opportunity_value), 0) FROM public.sales_leads WHERE property_id = p.property_id) AS pipeline_value,
  (SELECT count(*) FROM public.sales_contracts WHERE property_id = p.property_id AND status = 'Active') AS active_contracts,
  (SELECT COALESCE(sum(total_value), 0) FROM public.sales_contracts WHERE property_id = p.property_id AND status = 'Active') AS active_contract_value,
  (SELECT count(*) FROM public.corporate_accounts WHERE property_id = p.property_id) AS corporate_accounts,
  (SELECT count(*) FROM public.sales_campaigns WHERE property_id = p.property_id) AS active_campaigns
FROM (
  SELECT DISTINCT property_id, NULL::text AS property_name FROM public.sales_leads
  UNION
  SELECT DISTINCT property_id, NULL::text FROM public.sales_contracts
  UNION
  SELECT DISTINCT property_id, NULL::text FROM public.corporate_accounts
  UNION
  SELECT DISTINCT property_id, NULL::text FROM public.sales_campaigns
) p
WHERE p.property_id IS NOT NULL;

-- =============================================================
-- 11. RLS for shared department tables created above
-- =============================================================

DO $$
DECLARE
  shared_tbl text;
  shared_tables text[] := ARRAY['room_types','rooms','guests','reservations'];
BEGIN
  FOREACH shared_tbl IN ARRAY shared_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', shared_tbl);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      shared_tbl || '_authenticated_all', shared_tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      shared_tbl || '_authenticated_all', shared_tbl
    );
  END LOOP;
END;
$$;
