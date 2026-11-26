-- ============================================================
-- 709_password_reset_requests_platform_audience.sql
--
-- Adds `audience` to password_reset_requests:
--   'tenant'    → reviewed by the tenant's admin-role users in the ERP
--                 Admin portal (default, existing behavior)
--   'platform'  → the requester is themselves an admin (admin role or
--                 tenant super-admin); escalated to platform
--                 super-admins on admin.<domain> via SuperAdminPortal.
-- ============================================================

ALTER TABLE public.password_reset_requests
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'tenant'
  CHECK (audience IN ('tenant', 'platform'));

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_audience_status
  ON public.password_reset_requests (audience, status);

COMMENT ON COLUMN public.password_reset_requests.audience IS
  'tenant = tenant admin queue; platform = platform super-admin queue (admin-role requesters).';
