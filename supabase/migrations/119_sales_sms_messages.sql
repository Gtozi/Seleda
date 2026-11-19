-- Migration 119: Sales SMS & Messaging
-- Tracks SMS, WhatsApp, push, and reservation/loyalty messages.

-- =============================================================
-- 1. Sales SMS Messages table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_sms_messages (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  message_type text NOT NULL,
  content text NOT NULL,
  recipients integer DEFAULT 0,
  delivered integer DEFAULT 0,
  failed integer DEFAULT 0,
  status text DEFAULT 'Draft',
  sent_date date,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_sms_messages_updated_at ON public.sales_sms_messages;
CREATE TRIGGER trg_sales_sms_messages_updated_at
  BEFORE UPDATE ON public.sales_sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_sms_messages_status ON public.sales_sms_messages(status);
CREATE INDEX IF NOT EXISTS idx_sales_sms_messages_sent_date ON public.sales_sms_messages(sent_date);
CREATE INDEX IF NOT EXISTS idx_sales_sms_messages_message_type ON public.sales_sms_messages(message_type);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_sms_messages (id, message_type, content, recipients, delivered, failed, status, sent_date, created_by) VALUES
  ('mock-sms-001', 'Promotional SMS', 'Get 20% off weekend stays! Book by Sep 15. T&C apply.', 8500, 8320, 180, 'Sent', '2026-09-01', 'system'),
  ('mock-sms-002', 'Reservation Notification', 'Your reservation #12345 is confirmed. Check-in: Sep 10.', 1200, 1198, 2, 'Sent', '2026-09-05', 'system'),
  ('mock-sms-003', 'Loyalty Notification', 'You earned 500 points! Redeem on your next stay.', 3400, 3380, 20, 'Sent', '2026-09-06', 'system'),
  ('mock-sms-004', 'WhatsApp Message', 'Hi! Need help booking your group event? Reply here.', 450, 445, 5, 'Sent', '2026-09-07', 'system'),
  ('mock-sms-005', 'Push Notification', 'Flash sale: 30% off spa treatments today only!', 2100, 2050, 50, 'Scheduled', '2026-09-10', 'system'),
  ('mock-sms-006', 'Promotional SMS', 'Back-to-work package: meeting rooms + lunch from $99.', 0, 0, 0, 'Draft', NULL, 'system')
ON CONFLICT (id) DO NOTHING;
