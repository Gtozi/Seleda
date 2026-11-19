-- Migration 122: Sales Gift Cards & Vouchers
-- Tracks gift cards, promotional vouchers, discount coupons, and corporate vouchers.

-- =============================================================
-- 1. Sales Gift Vouchers table
-- =============================================================

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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_gift_vouchers_updated_at ON public.sales_gift_vouchers;
CREATE TRIGGER trg_sales_gift_vouchers_updated_at
  BEFORE UPDATE ON public.sales_gift_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_gift_vouchers_status ON public.sales_gift_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_sales_gift_vouchers_expiry_date ON public.sales_gift_vouchers(expiry_date);
CREATE INDEX IF NOT EXISTS idx_sales_gift_vouchers_code ON public.sales_gift_vouchers(code);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_gift_vouchers (id, code, type, value, balance, recipient, issue_date, expiry_date, status, created_by) VALUES
  ('mock-voucher-001', 'GC-2026-001A', 'Gift Card', 5000, 2500, 'Aster Demissie', '2026-01-15', '2027-01-15', 'Active', 'system'),
  ('mock-voucher-002', 'GC-2026-002B', 'Gift Card', 10000, 0, 'Bereket Solomon', '2025-12-20', '2026-12-20', 'Redeemed', 'system'),
  ('mock-voucher-003', 'PV-SUMMER-003', 'Promotional Voucher', 1500, 1500, 'Hiwot Girma', '2026-08-01', '2026-10-31', 'Active', 'system'),
  ('mock-voucher-004', 'DC-WELCOME-004', 'Discount Coupon', 20, 20, 'Dawit Hailu', '2026-09-01', '2026-09-30', 'Active', 'system'),
  ('mock-voucher-005', 'CV-CORP-005', 'Corporate Voucher', 25000, 12000, 'Ethiopian Airlines Procurement', '2026-02-10', '2026-12-31', 'Active', 'system'),
  ('mock-voucher-006', 'GC-2026-006F', 'Gift Card', 3000, 3000, 'Meron Tadesse', '2026-09-05', '2027-09-05', 'Active', 'system'),
  ('mock-voucher-007', 'DC-EXPIRED-007', 'Discount Coupon', 10, 0, 'Yared Tadesse', '2026-01-01', '2026-03-01', 'Expired', 'system')
ON CONFLICT (id) DO NOTHING;
