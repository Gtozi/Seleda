-- 486: Spa & Wellness Reports Registry
-- Backs the /erp/spa-wellness/reports screen. Replaces the hardcoded mock
-- report catalog in SpaWellnessReportsModule.tsx with a DB-backed registry,
-- mirroring the HK pattern (hk_reports / housekeepingPortal.routes.ts /
-- HKReportsModule.tsx, migration 316).
--
-- Status values:   Ready | Scheduled | Generating | Failed
-- Format values:   PDF | Excel | CSV
-- Category values: operational | financial | inventory | performance | executive

create table if not exists public.spa_reports (
  id          text primary key,
  category    text not null
              check (category in ('operational','financial','inventory','performance','executive')),
  name        text not null,
  description text not null default '',
  last_run    timestamptz,
  status      text not null default 'Scheduled'
              check (status in ('Ready','Scheduled','Generating','Failed')),
  format      text not null default 'PDF' check (format in ('PDF','Excel','CSV')),
  frequency   text not null default '',
  property_id text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.spa_reports enable row level security;

drop policy if exists spa_reports_all on public.spa_reports;
create policy spa_reports_all on public.spa_reports
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_reports to authenticated;

create index if not exists idx_spa_reports_category on public.spa_reports(category);
create index if not exists idx_spa_reports_status on public.spa_reports(status);

create or replace function public.spa_reports_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_spa_reports_updated_at on public.spa_reports;
create trigger trg_spa_reports_updated_at
  before update on public.spa_reports
  for each row execute function public.spa_reports_set_updated_at();

-- ── Seed (mirrors the former hardcoded report catalog, 23 reports) ──
insert into public.spa_reports (id, category, name, description, last_run, status, format, frequency)
select * from (values
  -- Operational Reports (5)
  ('spa-daily-appointment','operational','Daily Appointment Report','Summary of all appointments for the day.','2026-09-12 06:00'::timestamptz,'Ready','Excel','Daily 06:00'),
  ('spa-therapist-schedule','operational','Therapist Schedule','Daily schedule and therapist assignments.','2026-09-12 07:00','Ready','PDF','Daily 07:00'),
  ('spa-room-utilization','operational','Room Utilization','Treatment room and thermal facility usage statistics.','2026-09-12 08:00','Ready','Excel','Daily 08:00'),
  ('spa-attendance-report','operational','Attendance Report','Member and guest attendance tracking.','2026-09-05 08:00','Ready','Excel','Monday 08:00'),
  ('spa-cancellation-report','operational','Cancellation Report','Cancelled and no-show appointments.','2026-09-12 11:00','Ready','PDF','Daily 11:00'),
  -- Financial Reports (5)
  ('spa-revenue','financial','Spa Revenue','Total spa revenue breakdown by service line.','2026-09-01 08:00','Ready','Excel','1st of month'),
  ('spa-retail-revenue','financial','Retail Revenue','Product sales and retail income.','2026-09-01 08:00','Ready','Excel','1st of month'),
  ('spa-membership-revenue','financial','Membership Revenue','Membership fees and renewals.','2026-09-01 08:00','Ready','Excel','1st of month'),
  ('spa-package-revenue','financial','Package Revenue','Wellness package sales and redemption value.','2026-09-01 08:00','Scheduled','PDF','1st of month'),
  ('spa-product-sales','financial','Product Sales','Individual retail product sales analysis.','2026-09-01 09:00','Ready','Excel','1st of month'),
  -- Inventory Reports (4)
  ('spa-product-consumption','inventory','Product Consumption','Product usage by treatment.','2026-09-01 08:00','Ready','Excel','1st of month'),
  ('spa-low-stock','inventory','Low Stock Report','Retail items below minimum stock level.','2026-09-12 09:00','Ready','PDF','Daily 09:00'),
  ('spa-retail-stock','inventory','Retail Stock','Current retail inventory status.','2026-09-12 09:30','Ready','Excel','Daily 09:30'),
  ('spa-inventory-valuation','inventory','Inventory Valuation','Total retail inventory value.','2026-09-01 10:00','Scheduled','PDF','1st of month'),
  -- Performance Reports (4)
  ('spa-therapist-productivity','performance','Therapist Productivity','Individual therapist performance and revenue.','2026-09-07 08:00','Ready','Excel','Monday 08:00'),
  ('spa-guest-satisfaction','performance','Guest Satisfaction','Customer ratings and feedback.','2026-09-07 08:00','Scheduled','PDF','Monday 08:00'),
  ('spa-popular-treatments','performance','Popular Treatments','Most requested treatments.','2026-09-01 08:00','Ready','Excel','1st of month'),
  ('spa-treatment-trends','performance','Treatment Trends','Treatment popularity over time.','2026-09-01 09:00','Ready','PDF','1st of month'),
  -- Executive Reports (5)
  ('spa-monthly-performance','executive','Monthly Performance','Monthly operational summary.','2026-09-01 07:00','Ready','PDF','1st of month'),
  ('spa-revenue-by-service','executive','Revenue by Service','Revenue breakdown by service type.','2026-09-01 07:30','Ready','Excel','1st of month'),
  ('spa-occupancy','executive','Occupancy Report','Facility and room occupancy rates.','2026-09-07 09:00','Ready','Excel','Monday 09:00'),
  ('spa-membership-growth','executive','Membership Growth','New membership acquisition.','2026-09-01 08:00','Scheduled','PDF','1st of month'),
  ('spa-profitability','executive','Profitability Analysis','Cost and profit analysis.','2026-09-01 10:00','Ready','PDF','1st of month')
) as t(id, category, name, description, last_run, status, format, frequency)
where not exists (select 1 from public.spa_reports where id = t.id);
