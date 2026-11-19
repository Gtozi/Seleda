-- 487: Spa & Wellness Configuration — settings store
-- Replaces the placeholder config screen. One table holds:
--   section='general'   → scalar app settings (value = {"value": ...})
--   section='treatments'|'memberships'|'facilities' → config cards
--     (value = {"fields": {"Key": "Value", ...}} edited via Configure modal)

create table if not exists public.spa_settings (
  id          text primary key,
  section     text not null
              check (section in ('general','treatments','memberships','facilities')),
  name        text not null,
  description text not null default '',
  value       jsonb not null default '{}',
  status      text not null default 'Configured'
              check (status in ('Configured','Not Configured')),
  property_id text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.spa_settings enable row level security;

drop policy if exists spa_settings_all on public.spa_settings;
create policy spa_settings_all on public.spa_settings
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_settings to authenticated;

create index if not exists idx_spa_settings_section on public.spa_settings(section);

-- ── General settings (the former non-persisting form) ──────────────
insert into public.spa_settings (id, section, name, description, value, status)
select * from (values
  ('general.default_duration','general','Default Appointment Duration','Default length for new appointments.','{"value": "60 minutes"}'::jsonb,'Configured'),
  ('general.cancellation_policy','general','Cancellation Policy','Notice required to cancel without charge.','{"value": "12 hours notice"}'::jsonb,'Configured'),
  ('general.gratuity_rate','general','Default Gratuity Rate','Suggested gratuity percentage on services.','{"value": 18}'::jsonb,'Configured'),
  ('general.tax_rate','general','Tax Rate','Sales tax applied to spa charges.','{"value": 9}'::jsonb,'Configured')
) as t(id, section, name, description, value, status)
where not exists (select 1 from public.spa_settings where id = t.id);

-- ── Section config cards (the former placeholder lists) ────────────
insert into public.spa_settings (id, section, name, description, value, status)
select * from (values
  ('treatments.service-categories','treatments','Service Categories','Manage massage, facial, body treatment categories.',
   '{"fields":{"Massage":"Enabled","Facial":"Enabled","Body Treatment":"Enabled","Nail Care":"Enabled","Hair Styling":"Enabled"}}'::jsonb,'Configured'),
  ('treatments.treatment-duration','treatments','Treatment Duration','Set default durations for each treatment type.',
   '{"fields":{"Express":"30 min","Standard":"60 min","Extended":"90 min","Signature":"120 min"}}'::jsonb,'Configured'),
  ('treatments.pricing','treatments','Pricing Structure','Configure base pricing and seasonal rates.',
   '{"fields":{"Base Pricing":"Standard","Seasonal Rates":"Enabled","Member Discount":"15%"}}'::jsonb,'Configured'),
  ('treatments.therapist-qualifications','treatments','Therapist Qualifications','Define required certifications per treatment.',
   '{"fields":{"Massage License":"Required","Esthetician License":"Required for facials","Nail Tech Cert":"Required for nail services"}}'::jsonb,'Configured'),
  ('memberships.membership-types','memberships','Membership Types','Monthly, quarterly, annual, family, corporate, VIP.',
   '{"fields":{"Monthly":"$149/mo","Quarterly":"$399/qtr","Annual":"$1,499/yr","Family":"$249/mo","Corporate":"Custom","VIP":"$499/mo"}}'::jsonb,'Configured'),
  ('memberships.benefits','memberships','Benefits Configuration','Define benefits for each membership tier.',
   '{"fields":{"Monthly":"4 treatments + thermal access","Quarterly":"10 treatments + thermal + guest pass","Annual":"Unlimited + priority booking","VIP":"Unlimited + concierge + suite access"}}'::jsonb,'Configured'),
  ('memberships.renewal-rules','memberships','Renewal Rules','Set renewal policies and grace periods.',
   '{"fields":{"Auto-Renew":"Optional","Grace Period":"7 days","Freeze Allowance":"30 days/yr"}}'::jsonb,'Configured'),
  ('memberships.pricing','memberships','Membership Pricing','Configure pricing for all membership types.',
   '{"fields":{"Joining Fee":"$50","Upgrade Fee":"$25","Cancellation Fee":"None"}}'::jsonb,'Configured'),
  ('facilities.treatment-rooms','facilities','Treatment Rooms','Configure room types and capacities.',
   '{"fields":{"Single Rooms":"5","Couples Rooms":"2","Consultation":"1"}}'::jsonb,'Configured'),
  ('facilities.fitness-areas','facilities','Fitness Areas','Set up gym, yoga studio, and fitness spaces.',
   '{"fields":{"Gym":"Open 06:00–22:00","Yoga Studio":"Classes daily","Pool Deck":"Shared with hotel"}}'::jsonb,'Configured'),
  ('facilities.thermal-facilities','facilities','Thermal Facilities','Configure sauna, steam room, jacuzzi settings.',
   '{"fields":{"Sauna":"80–90°C","Steam Room":"45°C 100% RH","Jacuzzi":"36°C","Cold Plunge":"12°C"}}'::jsonb,'Configured'),
  ('facilities.equipment','facilities','Equipment Management','Track and maintain spa equipment.',
   '{"fields":{"Maintenance Cycle":"Monthly","Inspection":"Weekly","Service Vendor":"SpaTech Services"}}'::jsonb,'Configured')
) as t(id, section, name, description, value, status)
where not exists (select 1 from public.spa_settings where id = t.id);
