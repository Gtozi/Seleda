-- Migration 126: Sales Communications
-- Tracks unified messages across email, SMS, WhatsApp, push notifications, and in-app messages.

-- =============================================================
-- 1. Sales Communications table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_communications (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  channel text,
  subject text,
  recipient text,
  body text,
  status text DEFAULT 'Pending',
  communication_date date,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_communications_updated_at ON public.sales_communications;
CREATE TRIGGER trg_sales_communications_updated_at
  BEFORE UPDATE ON public.sales_communications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_communications_status ON public.sales_communications(status);
CREATE INDEX IF NOT EXISTS idx_sales_communications_channel ON public.sales_communications(channel);
CREATE INDEX IF NOT EXISTS idx_sales_communications_comm_date ON public.sales_communications(communication_date DESC);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_communications (id, channel, subject, recipient, body, status, communication_date, created_by) VALUES
  ('mock-comm-001', 'Email', 'Exclusive Summer Offer', 'aster.demissie@example.com', 'Enjoy 20% off your next stay with code SUMMER20. Book before August 31.', 'Sent', '2026-08-15', 'system'),
  ('mock-comm-002', 'SMS', 'Booking Reminder', '+251911223344', 'Reminder: Your reservation is confirmed for Sep 10. We look forward to welcoming you.', 'Delivered', '2026-09-05', 'system'),
  ('mock-comm-003', 'WhatsApp', 'Welcome Back', '+251922334455', 'Hi Bereket, welcome back! Your room is ready and check-in starts at 2 PM.', 'Read', '2026-08-20', 'system'),
  ('mock-comm-004', 'Push Notification', 'Flash Sale', 'device-token-abc', '24-hour flash sale: 30% off spa packages. Book now!', 'Sent', '2026-09-06', 'system'),
  ('mock-comm-005', 'In-App Message', 'Feedback Request', 'hiwot.girma@example.com', 'How was your recent stay? Your feedback helps us improve.', 'Pending', '2026-09-07', 'system'),
  ('mock-comm-006', 'Email', 'Loyalty Points Update', 'meron.tadesse@example.com', 'You have 56,800 points. Redeem them for free nights or spa rewards.', 'Delivered', '2026-09-02', 'system'),
  ('mock-comm-007', 'SMS', 'Verification Code', '+251933445566', 'Your verification code is 884321. Valid for 10 minutes.', 'Failed', '2026-09-08', 'system'),
  ('mock-comm-008', 'WhatsApp', 'Event Invitation', '+251944556677', 'You are invited to our rooftop wine tasting on Sep 15. RSVP today.', 'Sent', '2026-09-03', 'system')
ON CONFLICT (id) DO NOTHING;
