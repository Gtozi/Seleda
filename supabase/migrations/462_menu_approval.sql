-- =============================================================================
-- Migration 462: Banquet & Events — menu approval workflow
-- =============================================================================
-- GAP: Menu Planning (§15) requires Menu Approval, but banquet_menu_items had
-- no approval state and the MenuApprovalPending alert (446) actually fired
-- when NO menu was captured at all — it was a "menu missing" alert wearing
-- the wrong name.
--
-- Adds:
--   banquet_menu_items.approval_status — per-item approval.
--   event_bookings.menu_status (+ approved_by/at) — the event-level approval
--   the BEO/alerts key off. Values: Draft | Proposed | Approved | Rejected.
--
-- The alert view is rewritten in 465 so MenuApprovalPending fires when items
-- exist but the menu isn't approved, and a separate MenuMissing alert covers
-- the old no-menu case.
--
-- Depends on: 107 (banquet_menu_items), 444 (event_bookings)
-- =============================================================================

ALTER TABLE public.banquet_menu_items
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'Pending';

COMMENT ON COLUMN public.banquet_menu_items.approval_status IS
  'Pending | Approved | Rejected';

ALTER TABLE public.event_bookings
  ADD COLUMN IF NOT EXISTS menu_status      text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS menu_approved_by text,
  ADD COLUMN IF NOT EXISTS menu_approved_at timestamptz;

COMMENT ON COLUMN public.event_bookings.menu_status IS
  'Draft | Proposed | Approved | Rejected — set via PUT /events/:id/menu-status.';

-- When every line is approved, the event menu counts as approved too; when
-- any line is rejected the menu goes back to Draft for rework. Item-level
-- changes keep the event flag honest without a second write path.
CREATE OR REPLACE FUNCTION public.trg_sync_event_menu_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event  text;
  v_total  integer;
  v_ok     integer;
  v_rej    integer;
BEGIN
  v_event := COALESCE(NEW.event_id, OLD.event_id);
  SELECT count(*),
         count(*) FILTER (WHERE approval_status = 'Approved'),
         count(*) FILTER (WHERE approval_status = 'Rejected')
    INTO v_total, v_ok, v_rej
  FROM public.banquet_menu_items WHERE event_id = v_event;

  UPDATE public.event_bookings
  SET menu_status = CASE
                      WHEN v_total = 0                       THEN 'Draft'
                      WHEN v_rej > 0                         THEN 'Draft'
                      WHEN v_ok = v_total                    THEN 'Approved'
                      WHEN v_ok > 0                          THEN 'Proposed'
                      ELSE menu_status
                    END,
      updated_at = now()
  WHERE id = v_event
    -- Never stomp an explicit Approved/Rejected decision made at event level.
    AND menu_status NOT IN ('Approved', 'Rejected');

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_items_event_status ON public.banquet_menu_items;
CREATE TRIGGER trg_menu_items_event_status
  AFTER INSERT OR UPDATE OF approval_status OR DELETE ON public.banquet_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_event_menu_status();
