-- ============================================================
-- 708_password_reset_requests.sql
--
-- Staff self-service password recovery queue.
--
-- Flow: a staff member clicks "Forgot password" on the tenant login
-- screen → a row lands here → the tenant's admin-role users see it in
-- ERP Admin → User Management & Security → Password Resets → approve
-- generates a temporary password (force_password_change = true) and
-- optionally dispatches it via email/SMS provider.
--
-- tenant_id is explicit (table created after migration 707's sweep).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES public.system_users(id) ON DELETE CASCADE,
  requested_identifier TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'expired')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT REFERENCES public.system_users(id) ON DELETE SET NULL,
  delivery_method   TEXT,           -- 'email' | 'sms' | 'both' | 'manual'
  delivery_result   JSONB,          -- { email?: {...}, sms?: {...} }
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_tenant_status
  ON public.password_reset_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user
  ON public.password_reset_requests (user_id);

-- One open request per user per tenant — re-requests update requested_at
-- instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_requests_pending_unique
  ON public.password_reset_requests (tenant_id, user_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.password_reset_requests IS
  'Staff password-reset approval queue. Tenant admins approve to issue a temporary password (force_password_change).';
