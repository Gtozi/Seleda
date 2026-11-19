-- 447_checklist_templates_consolidate.sql
--
-- Goals:
--   1. Add a configurable checklist-template table so hotels can define
--      planning checklists once in Configuration and have them auto-seed
--      on every event that enters Planning.
--   2. Consolidate banquet_checklists + banquet_event_type_checklists into
--      a single table (banquet_checklists) with an optional item_type
--      column, eliminating the dual-table maintenance burden.
--   3. Add a planning gate: at least one schedule must exist before an
--      event can advance Planning -> InProgress.
--   4. Update generate_beo_for_event to pull event-type detail items
--      (wedding, conference, meeting, social) into the BEO's
--      special_requests so that data captured upstream flows downstream.
--   5. Seed default checklist templates.

-- ── 1. Checklist templates table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_checklist_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_name text NOT NULL,
  category text,
  due_offset_days int NOT NULL DEFAULT 0,  -- days before event start_date
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.banquet_checklist_templates IS
  'Configurable planning-checklist templates. When an event enters Planning, '
  'one checklist row per active template is auto-created in banquet_checklists.';

-- ── 2. Consolidate: add item_type + source to banquet_checklists ─────
ALTER TABLE public.banquet_checklists
  ADD COLUMN IF NOT EXISTS item_type text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Migrate existing event-type checklists into banquet_checklists
INSERT INTO public.banquet_checklists (id, property_id, event_id, item_name, category, due_date, assigned_to, is_completed, item_type, source, created_at, updated_at)
SELECT
  c.id, c.property_id, c.event_id, c.item_name, NULL, c.due_date, c.assigned_to, c.is_completed,
  c.item_type, 'event-type', c.created_at, c.updated_at
FROM public.banquet_event_type_checklists c
ON CONFLICT (id) DO NOTHING;

-- ── 3. seed_checklists_for_event function ────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_checklists_for_event(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.event_bookings%ROWTYPE;
  v_template record;
  v_count int := 0;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  FOR v_template IN
    SELECT * FROM public.banquet_checklist_templates
    WHERE is_active = true
    AND (property_id IS NULL OR property_id = v_event.property_id)
    AND id NOT IN (
      SELECT source_template_id FROM public.banquet_checklists
      WHERE event_id = p_event_id AND source = 'template'
    )
  LOOP
    INSERT INTO public.banquet_checklists (id, property_id, event_id, item_name, category, due_date, is_completed, source, source_template_id)
    VALUES (
      gen_random_uuid()::text,
      v_event.property_id,
      p_event_id,
      v_template.item_name,
      v_template.category,
      CASE
        WHEN v_template.due_offset_days > 0 AND v_event.start_date IS NOT NULL
          THEN (v_event.start_date::date - v_template.due_offset_days)::date
        ELSE v_event.start_date
      END,
      false,
      'template',
      v_template.id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'seeded', v_count);
END;
$function$;

-- Add source_template_id column to banquet_checklists (for idempotency)
ALTER TABLE public.banquet_checklists
  ADD COLUMN IF NOT EXISTS source_template_id text;

-- ── 4. Update advance_event_status ──────────────────────────────────
-- Add: (a) auto-seed checklists when entering Planning
--      (b) planning gate: require >=1 schedule before InProgress
CREATE OR REPLACE FUNCTION public.advance_event_status(
  p_event_id text, p_status text, p_user_id text DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.event_bookings%ROWTYPE;
  v_from integer;
  v_to integer;
  v_venue text;
  v_conflict text;
  v_sched_count integer;
  v_seed_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  v_from := public.event_status_rank(v_event.status);
  v_to := public.event_status_rank(p_status);

  IF v_to = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', format('Unknown status %L', p_status));
  END IF;

  IF v_event.status = 'Completed' OR v_event.status = 'Cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', format('Event is %s and cannot change status', v_event.status));
  END IF;

  -- Cancel can happen from any pre-completed stage
  IF p_status <> 'Cancelled' AND v_to <> v_from + 1 THEN
    RETURN jsonb_build_object('success', false, 'error', format('Invalid transition %s -> %s. Events must progress one stage at a time.', v_event.status, p_status));
  END IF;

  -- Confirmed gate: client + venue + no double-booking
  IF p_status = 'Confirmed' THEN
    IF v_event.client_name IS NULL OR v_event.client_name = 'Unassigned' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot confirm: event has no client');
    END IF;
    IF array_length(v_event.venue_ids, 1) IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot confirm: no venue assigned');
    END IF;
    FOREACH v_venue IN ARRAY v_event.venue_ids LOOP
      SELECT eb.event_code INTO v_conflict
      FROM public.event_bookings eb
      WHERE eb.id <> v_event.id
        AND eb.status IN ('Confirmed','Planning','InProgress')
        AND v_venue = ANY (eb.venue_ids)
        AND daterange(eb.start_date, COALESCE(eb.end_date, eb.start_date), '[]')
        && daterange(v_event.start_date, COALESCE(v_event.end_date, v_event.start_date), '[]')
      LIMIT 1;
      IF v_conflict IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', format('Venue conflict: %s is already held by event %s', v_venue, v_conflict));
      END IF;
    END LOOP;
  END IF;

  -- Planning gate: require at least 1 schedule before InProgress
  IF p_status = 'InProgress' THEN
    SELECT count(*) INTO v_sched_count FROM public.banquet_schedules WHERE event_id = p_event_id;
    IF v_sched_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot start: at least one schedule task must be created in Planning');
    END IF;
  END IF;

  -- Completed gate: can't complete before end date
  IF p_status = 'Completed' AND COALESCE(v_event.end_date, v_event.start_date) > CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot complete an event before its end date');
  END IF;

  -- Apply the status change
  UPDATE public.event_bookings SET
    status = p_status,
    confirmed_at = CASE WHEN p_status = 'Confirmed' THEN now() ELSE confirmed_at END,
    completed_at = CASE WHEN p_status = 'Completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN p_status = 'Cancelled' THEN now() ELSE cancelled_at END,
    cancellation_reason = CASE WHEN p_status = 'Cancelled' THEN p_reason ELSE cancellation_reason END,
    billing_status = CASE WHEN p_status = 'Cancelled' AND billing_status = 'Unbilled' THEN 'Cancelled' ELSE billing_status END,
    updated_at = now()
  WHERE id = p_event_id;

  -- Auto-seed checklists when entering Planning
  IF p_status = 'Planning' THEN
    v_seed_result := public.seed_checklists_for_event(p_event_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'eventId', p_event_id, 'fromStatus', v_event.status, 'toStatus', p_status,
    'checklistsSeeded', COALESCE((v_seed_result->>'seeded')::int, 0));
END;
$function$;

-- ── 5. Update generate_beo_for_event to pull event-type details ──────
CREATE OR REPLACE FUNCTION public.generate_beo_for_event(
  p_event_id text, p_user_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.event_bookings%ROWTYPE;
  v_beo_id text;
  v_special_requests text[] := '{}';
  v_type_item record;
BEGIN
  SELECT * INTO v_event FROM public.event_bookings WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF v_event.status IN ('Inquiry','Tentative') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Confirm the event before generating a BEO');
  END IF;

  -- Idempotent: return existing BEO
  SELECT id INTO v_beo_id FROM public.banquet_beos WHERE event_id = p_event_id LIMIT 1;
  IF v_beo_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'beoId', v_beo_id, 'created', false);
  END IF;

  -- Collect event-type details as special-request lines
  FOR v_type_item IN
    SELECT item_type, item_data FROM public.banquet_event_type_items WHERE event_id = p_event_id
  LOOP
    IF v_type_item.item_type = 'wedding' THEN
      v_special_requests := array_append(v_special_requests, 'Wedding: ' ||
        COALESCE((v_type_item.item_data->>'brideName') || ' & ' || (v_type_item.item_data->>'groomName'), ''));
      IF v_type_item.item_data ? 'ceremonyLocation' THEN
        v_special_requests := array_append(v_special_requests, 'Ceremony: ' || (v_type_item.item_data->>'ceremonyLocation'));
      END IF;
      IF v_type_item.item_data ? 'receptionLocation' THEN
        v_special_requests := array_append(v_special_requests, 'Reception: ' || (v_type_item.item_data->>'receptionLocation'));
      END IF;
      IF v_type_item.item_data ? 'theme' THEN
        v_special_requests := array_append(v_special_requests, 'Theme: ' || (v_type_item.item_data->>'theme'));
      END IF;
    ELSIF v_type_item.item_type = 'conference' THEN
      v_special_requests := array_append(v_special_requests, 'Session: ' ||
        COALESCE(v_type_item.item_data->>'sessionTitle', '') ||
        CASE WHEN v_type_item.item_data ? 'speaker' THEN ' — ' || (v_type_item.item_data->>'speaker') ELSE '' END);
      IF v_type_item.item_data ? 'room' THEN
        v_special_requests := array_append(v_special_requests, 'Room: ' || (v_type_item.item_data->>'room'));
      END IF;
      IF v_type_item.item_data ? 'equipment' THEN
        v_special_requests := array_append(v_special_requests, 'Equipment: ' || (v_type_item.item_data->>'equipment'));
      END IF;
    ELSIF v_type_item.item_type = 'meeting' THEN
      v_special_requests := array_append(v_special_requests, 'Agenda: ' ||
        COALESCE(v_type_item.item_data->>'agendaItem', '') ||
        CASE WHEN v_type_item.item_data ? 'presenter' THEN ' — ' || (v_type_item.item_data->>'presenter') ELSE '' END);
    ELSIF v_type_item.item_type = 'social' THEN
      v_special_requests := array_append(v_special_requests, 'Social: ' ||
        COALESCE(v_type_item.item_data->>'eventType', '') ||
        ' — ' || COALESCE(v_type_item.item_data->>'honoreeName', ''));
      IF v_type_item.item_data ? 'theme' THEN
        v_special_requests := array_append(v_special_requests, 'Theme: ' || (v_type_item.item_data->>'theme'));
      END IF;
    ELSIF v_type_item.item_type = 'roomblock' THEN
      v_special_requests := array_append(v_special_requests, 'Room Block: ' ||
        COALESCE(v_type_item.item_data->>'roomType', '') ||
        ' x' || COALESCE(v_type_item.item_data->>'roomCount', '0') ||
        ' @ ' || COALESCE(v_type_item.item_data->>'ratePerRoom', '0') || ' ETB/night');
    END IF;
  END LOOP;

  -- Merge with event-level special requirements
  IF v_event.special_requirements IS NOT NULL AND v_event.special_requirements <> '' THEN
    v_special_requests := array_append(v_special_requests, v_event.special_requirements);
  END IF;

  v_beo_id := gen_random_uuid()::text;

  INSERT INTO public.banquet_beos (
    id, property_id, event_id, event_name, client_name, event_date, venue_ids,
    setup_time, event_start_time, event_end_time, breakdown_time,
    menu_items, beverage_items, equipment, staffing, special_requests, vip_information, status
  ) VALUES (
    v_beo_id, v_event.property_id, v_event.id, v_event.event_name, v_event.client_name,
    v_event.start_date, v_event.venue_ids,
    v_event.setup_time, v_event.event_start_time, v_event.event_end_time, v_event.breakdown_time,
    COALESCE((SELECT array_agg(dish_name ORDER BY course_type, dish_name) FROM public.banquet_menu_items WHERE event_id = p_event_id), '{}'::text[]),
    COALESCE((SELECT array_agg(name ORDER BY category, name) FROM public.banquet_beverages WHERE event_id = p_event_id), '{}'::text[]),
    COALESCE((SELECT array_agg(equipment_name ORDER BY equipment_name) FROM public.banquet_equipment WHERE event_id = p_event_id), '{}'::text[]),
    '[]'::jsonb,
    v_special_requests,
    '{}'::text[],
    'Draft'
  );

  UPDATE public.event_bookings SET
    beo_generated = true,
    beo_generated_at = now(),
    status = CASE WHEN status = 'Confirmed' THEN 'Planning' ELSE status END,
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'beoId', v_beo_id, 'created', true);
END;
$function$;

-- ── 6. Seed default checklist templates ──────────────────────────────
INSERT INTO public.banquet_checklist_templates (item_name, category, due_offset_days, is_active) VALUES
  ('Confirm venue booking and layout', 'Venue', 14, true),
  ('Confirm guest count with client', 'Coordination', 7, true),
  ('Send out invitations / confirmations', 'Coordination', 10, true),
  ('Finalize menu selection with client', 'Catering', 5, true),
  ('Order beverage quantities', 'Catering', 3, true),
  ('Confirm equipment and AV requirements', 'Logistics', 5, true),
  ('Arrange staffing schedule', 'Staffing', 3, true),
  ('Confirm room blocks with Front Office', 'Accommodation', 7, true),
  ('Prepare and distribute BEO', 'BEO', 2, true),
  ('Final walkthrough with client', 'Coordination', 1, true),
  ('Confirm payment of deposit', 'Billing', 7, true),
  ('Prepare event setup checklist', 'Venue', 1, true)
ON CONFLICT DO NOTHING;

-- ── 7. Drop the now-redundant event-type-checklists view (compat) ────
-- The table is kept for backward compatibility but all new checklists
-- go to banquet_checklists with source='event-type' or source='template'.
