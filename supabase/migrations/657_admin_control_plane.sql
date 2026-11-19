-- ============================================================
-- Migration 657: Admin control plane
-- ============================================================
-- Backs the System Administration portal modules that previously
-- rendered local mock state: departments, feature flags, approval
-- matrix, workflow definitions, business rules, notification and
-- document templates, payment gateways, tax rules, locales,
-- licenses, devices and identity providers.
-- Served by src/server/routes/adminControl.routes.ts under
-- /api/admin/control/:resource. Service-role only (RLS on, no policies).

CREATE TABLE IF NOT EXISTS public.admin_departments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  parent_id text,
  head_name text,
  cost_center text,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS public.admin_feature_flags (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  flag_key text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  rollout_pct integer NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','staging','development')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_key, environment)
);

CREATE TABLE IF NOT EXISTS public.admin_approval_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  entity_type text NOT NULL,
  department text,
  min_amount numeric(18,2) NOT NULL DEFAULT 0,
  max_amount numeric(18,2),
  currency text NOT NULL DEFAULT 'USD',
  approver_roles text[] NOT NULL DEFAULT '{}',
  steps integer NOT NULL DEFAULT 1 CHECK (steps >= 1),
  escalation_hours integer,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_workflows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  entity_type text NOT NULL,
  trigger_event text NOT NULL,
  description text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_business_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  condition_expr text NOT NULL,
  action_expr text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_notification_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','push','in_app')),
  trigger_event text,
  subject text,
  body text NOT NULL,
  recipient_roles text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_document_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  doc_type text NOT NULL DEFAULT 'general',
  body text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Secrets never live here: secret_ref names an env var / vault entry.
CREATE TABLE IF NOT EXISTS public.admin_payment_gateways (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  provider text NOT NULL,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
  currencies text[] NOT NULL DEFAULT '{}',
  public_key text,
  secret_ref text,
  webhook_url text,
  fee_percent numeric(6,3) NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_tax_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  tax_type text NOT NULL DEFAULT 'vat' CHECK (tax_type IN ('vat','service_charge','city_tax','tourism','other')),
  rate numeric(8,4) NOT NULL CHECK (rate >= 0),
  applies_to text NOT NULL DEFAULT 'all',
  inclusive boolean NOT NULL DEFAULT false,
  effective_from date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);

CREATE TABLE IF NOT EXISTS public.admin_locales (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  native_name text,
  rtl boolean NOT NULL DEFAULT false,
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  number_format text NOT NULL DEFAULT '1,234.56',
  is_default boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_locales_single_default ON public.admin_locales (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.admin_licenses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  license_key text NOT NULL UNIQUE,
  holder text NOT NULL,
  plan text NOT NULL DEFAULT 'standard',
  seats integer NOT NULL DEFAULT 1 CHECK (seats >= 0),
  modules text[] NOT NULL DEFAULT '{}',
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_devices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  device_type text NOT NULL DEFAULT 'terminal',
  location text,
  ip_address text,
  serial_number text,
  firmware text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','maintenance','retired')),
  last_seen_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_identity_providers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'oidc' CHECK (provider_type IN ('oidc','saml','ldap','oauth2')),
  issuer_url text,
  client_id text,
  secret_ref text,
  email_domains text[] NOT NULL DEFAULT '{}',
  mfa_required boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_departments','admin_feature_flags','admin_approval_rules','admin_workflows','admin_business_rules','admin_notification_templates','admin_document_templates','admin_payment_gateways','admin_tax_rules','admin_locales','admin_licenses','admin_devices','admin_identity_providers']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

INSERT INTO public.admin_locales (code, name, native_name, rtl, is_default, enabled) VALUES
  ('en', 'English', 'English', false, true, true),
  ('am', 'Amharic', 'አማርኛ', false, false, true),
  ('fr', 'French', 'Français', false, false, false),
  ('ar', 'Arabic', 'العربية', true, false, false)
ON CONFLICT (code) DO NOTHING;
