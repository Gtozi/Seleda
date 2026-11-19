-- Migration 659: Consolidate POS tax profiles into central admin_tax_rules
--
-- pos_tax_profiles (per-outlet VAT/service-charge/exemption bundles) is replaced
-- by outlet-scoped rows in admin_tax_rules:
--   * outlet_id  — restricts a rule to a single POS outlet (highest precedence)
--   * calc_base  — 'subtotal' | 'total', base for non-VAT/service-charge taxes
-- Exemptions are expressed as rate = 0 rules.
-- Existing pos_tax_profiles are migrated to per-outlet admin_tax_rules rows,
-- pos_outlets.tax_profile_id is cleared, and pos_tax_profiles is dropped.
-- pos_transactions.tax_profile_id is kept as a plain historical column (FK dropped).

ALTER TABLE public.admin_tax_rules
  ADD COLUMN IF NOT EXISTS outlet_id uuid,
  ADD COLUMN IF NOT EXISTS calc_base text NOT NULL DEFAULT 'subtotal'
    CHECK (calc_base IN ('subtotal', 'total'));

CREATE INDEX IF NOT EXISTS admin_tax_rules_outlet_idx
  ON public.admin_tax_rules (outlet_id) WHERE outlet_id IS NOT NULL;

-- VAT rule per outlet that had a tax profile (rate 0 when VAT-exempt)
INSERT INTO public.admin_tax_rules (property_id, outlet_id, code, name, tax_type, rate, applies_to, calc_base, active)
SELECT o.property_id, o.id,
       'POS-' || upper(o.code) || '-VAT',
       p.name || ' — VAT',
       'vat',
       CASE WHEN p.is_vat_exempt THEN 0 ELSE p.vat_rate END,
       'f&b', 'subtotal', COALESCE(p.is_active, true)
FROM public.pos_outlets o
JOIN public.pos_tax_profiles p ON p.id = o.tax_profile_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_tax_rules r
  WHERE r.outlet_id = o.id AND r.tax_type = 'vat' AND r.code = 'POS-' || upper(o.code) || '-VAT'
);

-- Service-charge rule per outlet
INSERT INTO public.admin_tax_rules (property_id, outlet_id, code, name, tax_type, rate, applies_to, calc_base, active)
SELECT o.property_id, o.id,
       'POS-' || upper(o.code) || '-SVC',
       p.name || ' — Service Charge',
       'service_charge',
       CASE WHEN p.is_service_charge_exempt THEN 0 ELSE p.service_charge_rate END,
       'f&b', 'subtotal', COALESCE(p.is_active, true)
FROM public.pos_outlets o
JOIN public.pos_tax_profiles p ON p.id = o.tax_profile_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_tax_rules r
  WHERE r.outlet_id = o.id AND r.tax_type = 'service_charge' AND r.code = 'POS-' || upper(o.code) || '-SVC'
);

-- Additional tax rules (e.g. Tourism Levy) → tax_type 'other' rows
INSERT INTO public.admin_tax_rules (property_id, outlet_id, code, name, tax_type, rate, applies_to, calc_base, active)
SELECT o.property_id, o.id,
       'POS-' || upper(o.code) || '-OTH-' || t.ord,
       COALESCE(NULLIF(t.rule->>'name', ''), 'Additional tax'),
       'other',
       (t.rule->>'rate')::numeric,
       'f&b',
       CASE WHEN t.rule->>'applies_to' = 'total' THEN 'total' ELSE 'subtotal' END,
       COALESCE(p.is_active, true)
FROM public.pos_outlets o
JOIN public.pos_tax_profiles p ON p.id = o.tax_profile_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.additional_tax_rules) = 'array' THEN p.additional_tax_rules ELSE '[]'::jsonb END
) WITH ORDINALITY AS t(rule, ord)
WHERE COALESCE(t.rule->>'rate', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_tax_rules r
    WHERE r.outlet_id = o.id AND r.code = 'POS-' || upper(o.code) || '-OTH-' || t.ord
  );

-- Clear outlet → profile links, then drop the legacy table
UPDATE public.pos_outlets SET tax_profile_id = NULL WHERE tax_profile_id IS NOT NULL;

ALTER TABLE public.pos_outlets DROP CONSTRAINT IF EXISTS pos_outlets_tax_profile_fk;
ALTER TABLE public.pos_outlets DROP COLUMN IF EXISTS tax_profile_id;

-- Keep pos_transactions.tax_profile_id values for history but drop the FK
ALTER TABLE public.pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_tax_profile_id_fkey;

DROP TABLE IF EXISTS public.pos_tax_profiles;
