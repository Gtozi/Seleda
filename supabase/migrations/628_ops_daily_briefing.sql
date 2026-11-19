-- 628_ops_daily_briefing.sql
-- Operations Portal — Daily Briefing module.
-- Backs the /erp/operations/daily-briefing tab (DailyBriefing.tsx).
-- Previously the module rendered a hardcoded mockBriefingData object and the
-- "Refresh" button only simulated a delay. This migration adds a snapshot
-- table so a generated briefing is persisted per property+date and can be
-- retrieved later (the date picker reads back saved snapshots; "Generate"
-- recomputes from live data and upserts the snapshot).
--
-- The briefing payload itself is computed live by the API from the real
-- tables of the other portals (reservations, guests, group_blocks,
-- banquet_events/venues, work_orders, corrective_maintenance_tasks,
-- transport_airport_transfers, *_shift_requirements, orders,
-- spa_appointments, ops_command_alerts) — this table only stores the
-- generated document, not the source data.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_daily_briefings (
  id              TEXT PRIMARY KEY,          -- 'brief-{propertyId|all}-{YYYY-MM-DD}'
  property_id     UUID,
  briefing_date   DATE NOT NULL,
  data            JSONB NOT NULL,            -- full briefing payload
  generated_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_daily_briefings_prop_date
  ON public.ops_daily_briefings(property_id, briefing_date);
CREATE INDEX IF NOT EXISTS idx_ops_daily_briefings_date
  ON public.ops_daily_briefings(briefing_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ops_daily_briefings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_daily_briefings_updated_at
  ON public.ops_daily_briefings;
CREATE TRIGGER trg_ops_daily_briefings_updated_at
  BEFORE UPDATE ON public.ops_daily_briefings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ops_daily_briefings_timestamp();

ALTER TABLE public.ops_daily_briefings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_daily_briefings TO authenticated;
