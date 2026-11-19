-- Migration 123: Sales Reputation / Reviews
-- Tracks online reviews, ratings, sentiment, status, and response workflow.

-- =============================================================
-- 1. Sales Reviews table
-- =============================================================

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_reviews_updated_at ON public.sales_reviews;
CREATE TRIGGER trg_sales_reviews_updated_at
  BEFORE UPDATE ON public.sales_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_reviews_status ON public.sales_reviews(status);
CREATE INDEX IF NOT EXISTS idx_sales_reviews_sentiment ON public.sales_reviews(sentiment);
CREATE INDEX IF NOT EXISTS idx_sales_reviews_review_date ON public.sales_reviews(review_date DESC);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_reviews (id, source, guest_name, rating, title, sentiment, status, review_date, response, created_by) VALUES
  ('mock-review-001', 'Google', 'Aster Demissie', 5, 'Fantastic stay, wonderful staff and breakfast!', 'positive', 'Responded', '2026-08-15', 'Thank you for your kind words, Aster! We look forward to welcoming you back.', 'system'),
  ('mock-review-002', 'TripAdvisor', 'Bereket Solomon', 4, 'Great location, rooms were clean and comfortable.', 'positive', 'Responded', '2026-08-20', 'Thank you for staying with us, Bereket!', 'system'),
  ('mock-review-003', 'Booking.com', 'Hiwot Girma', 3, 'Good but check-in was slow.', 'neutral', 'Pending', '2026-09-01', NULL, 'system'),
  ('mock-review-004', 'Google', 'Dawit Hailu', 2, 'Noise from the corridor kept me awake.', 'negative', 'Escalated', '2026-09-03', NULL, 'system'),
  ('mock-review-005', 'Expedia', 'Liya Tesfaye', 5, 'Perfect honeymoon destination!', 'positive', 'Responded', '2026-08-28', 'Congratulations and thank you for choosing us!', 'system'),
  ('mock-review-006', 'TripAdvisor', 'Yared Tadesse', 1, 'Room not ready on arrival and no apology.', 'negative', 'Pending', '2026-09-05', NULL, 'system'),
  ('mock-review-007', 'Google', 'Meron Tadesse', 4, 'Lovely spa and friendly team.', 'positive', 'Responded', '2026-09-06', 'Thank you, Meron! We are glad you enjoyed the spa.', 'system'),
  ('mock-review-008', 'Booking.com', 'Kirubel Alemu', 3, 'Average experience, expected more for the price.', 'neutral', 'Pending', '2026-09-07', NULL, 'system')
ON CONFLICT (id) DO NOTHING;
