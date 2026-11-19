-- Migration 124: Sales Guest Feedback
-- Tracks post-stay surveys, in-stay surveys, event feedback, restaurant feedback, and complaints.

-- =============================================================
-- 1. Sales Guest Feedback table
-- =============================================================

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_guest_feedback_updated_at ON public.sales_guest_feedback;
CREATE TRIGGER trg_sales_guest_feedback_updated_at
  BEFORE UPDATE ON public.sales_guest_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_guest_feedback_status ON public.sales_guest_feedback(status);
CREATE INDEX IF NOT EXISTS idx_sales_guest_feedback_feedback_type ON public.sales_guest_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_sales_guest_feedback_feedback_date ON public.sales_guest_feedback(feedback_date DESC);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_guest_feedback (id, feedback_type, guest_name, rating, comments, status, resolution, feedback_date, created_by) VALUES
  ('mock-feedback-001', 'Post-Stay Survey', 'Aster Demissie', 5, 'Everything was perfect, especially the breakfast buffet.', 'Resolved', 'Thanked guest and offered loyalty bonus.', '2026-08-15', 'system'),
  ('mock-feedback-002', 'In-Stay Survey', 'Bereket Solomon', 4, 'Room service was quick but the menu could use more vegetarian options.', 'Pending', NULL, '2026-09-02', 'system'),
  ('mock-feedback-003', 'Complaint', 'Hiwot Girma', 2, 'Air conditioning was noisy and did not cool the room properly.', 'Escalated', NULL, '2026-09-04', 'system'),
  ('mock-feedback-004', 'Event Feedback', 'Dawit Hailu', 5, 'The conference facilities and AV support were excellent.', 'Resolved', 'Shared compliments with events team.', '2026-09-03', 'system'),
  ('mock-feedback-005', 'Restaurant Feedback', 'Liya Tesfaye', 3, 'Food was good but service was slow during peak hours.', 'Pending', NULL, '2026-09-06', 'system'),
  ('mock-feedback-006', 'Complaint', 'Yared Tadesse', 1, 'Charged twice for the same booking; front desk was unhelpful.', 'Escalated', NULL, '2026-09-05', 'system'),
  ('mock-feedback-007', 'Post-Stay Survey', 'Meron Tadesse', 5, 'Loved the spa and rooftop bar. Will return soon.', 'Resolved', 'Thanked guest and sent spa voucher.', '2026-09-07', 'system'),
  ('mock-feedback-008', 'In-Stay Survey', 'Kirubel Alemu', 4, 'Clean rooms and friendly staff. Wi-Fi could be faster.', 'Pending', NULL, '2026-09-08', 'system')
ON CONFLICT (id) DO NOTHING;
