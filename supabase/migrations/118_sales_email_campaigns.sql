-- Migration 118: Sales Email Marketing Campaigns
-- Tracks email campaigns, templates, delivery metrics, and status.

-- =============================================================
-- 1. Sales Email Campaigns table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_email_campaigns (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  subject text NOT NULL,
  template text,
  recipients integer DEFAULT 0,
  open_rate numeric DEFAULT 0,
  click_rate numeric DEFAULT 0,
  bounce_rate numeric DEFAULT 0,
  unsubscribe_rate numeric DEFAULT 0,
  status text DEFAULT 'Draft',
  sent_date date,
  body text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_email_campaigns_updated_at ON public.sales_email_campaigns;
CREATE TRIGGER trg_sales_email_campaigns_updated_at
  BEFORE UPDATE ON public.sales_email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_email_campaigns_status ON public.sales_email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_sales_email_campaigns_sent_date ON public.sales_email_campaigns(sent_date);
CREATE INDEX IF NOT EXISTS idx_sales_email_campaigns_template ON public.sales_email_campaigns(template);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_email_campaigns (id, subject, template, recipients, open_rate, click_rate, bounce_rate, unsubscribe_rate, status, sent_date, body, created_by) VALUES
  ('mock-email-001', 'Exclusive Summer Offer Just for You', 'Promotion', 5200, 24.5, 3.8, 1.2, 0.4, 'Sent', '2026-08-15', 'Save up to 30% on stays and dining this summer.', 'system'),
  ('mock-email-002', 'Welcome to Our Loyalty Program', 'Welcome', 1800, 42.0, 8.5, 0.8, 0.2, 'Sent', '2026-08-22', 'Welcome aboard — here is how to earn and redeem points.', 'system'),
  ('mock-email-003', 'September Newsletter', 'Newsletter', 9400, 18.3, 2.1, 2.5, 0.6, 'Sent', '2026-09-01', 'Monthly updates, events, and special packages.', 'system'),
  ('mock-email-004', 'Corporate Event Invitation', 'Event Invitation', 450, 35.6, 12.4, 0.0, 0.0, 'Sent', '2026-09-03', 'Invite to the annual corporate showcase and cocktail.', 'system'),
  ('mock-email-005', 'Abandoned Booking Follow-up', 'Follow-up', 1200, 28.0, 5.2, 1.0, 0.3, 'Scheduled', '2026-09-12', 'Complete your reservation with an extra 10% off.', 'system'),
  ('mock-email-006', 'Loyalty Points Expiring Soon', 'Loyalty Update', 3200, 31.5, 6.7, 0.9, 0.1, 'Draft', NULL, 'Your points expire at year end — use them now.', 'system')
ON CONFLICT (id) DO NOTHING;
