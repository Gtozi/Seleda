-- 629_ops_morning_meeting.sql
-- Operations Portal — Morning Meeting module.
-- Backs the /erp/operations/morning-meeting tab (MorningMeetingDashboard.tsx).
-- Previously the agenda was a hardcoded mockAgendaItems array and all
-- edits (add/status/delete) lived only in component state. This migration
-- persists agenda items per property+meeting_date so the checklist is
-- shared and survives reloads.
--
-- Model:
--   source 'template' — the standard 10-item agenda auto-generated on
--                       first view of a date, with descriptions filled
--                       from live data (occupancy, VIP counts, open
--                       complaints, work orders, staffing gaps, revenue).
--   source 'manual'   — items added by hand through the Edit Agenda UI.
--   status: pending → in-progress → completed (checkbox/inline controls)

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_meeting_agenda_items (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  meeting_date    DATE NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  title           TEXT NOT NULL,
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
                    'low', 'medium', 'high'
                  )),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'in-progress', 'completed'
                  )),
  assigned_to     TEXT,
  estimated_time  INTEGER,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
                    'template', 'manual'
                  )),
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_meeting_agenda_items_prop_date
  ON public.ops_meeting_agenda_items(property_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_ops_meeting_agenda_items_date
  ON public.ops_meeting_agenda_items(meeting_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ops_meeting_agenda_items_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_meeting_agenda_items_updated_at
  ON public.ops_meeting_agenda_items;
CREATE TRIGGER trg_ops_meeting_agenda_items_updated_at
  BEFORE UPDATE ON public.ops_meeting_agenda_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ops_meeting_agenda_items_timestamp();

ALTER TABLE public.ops_meeting_agenda_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_meeting_agenda_items TO authenticated;
