-- =============================================================================
-- Migration 493: Spa provider ↔ HR roster integration
-- =============================================================================
-- The appointment calendar reads provider availability from the shared HR
-- staff-management roster (hr_team_roster, migration 416). For that to work,
-- each spa_therapists row needs a linked employees record (employee_id) and
-- roster entries for upcoming days.
--
--   1. Creates employees rows (department 'Spa & Wellness') for providers
--      that are not yet linked.
--   2. Links spa_therapists.employee_id to those records.
--   3. Seeds hr_team_roster for two weeks around the current date — each
--      provider works their default shift with one staggered 'Off' day
--      per week (a real rest-day pattern).
-- =============================================================================

DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  t                 RECORD;
  v_emp_id          TEXT;
  v_idx             INT := 0;
  v_date            DATE;
  v_shift           TEXT;
BEGIN
  FOR t IN
    SELECT id, name, title, shift, email, phone, hire_date, employee_id
    FROM public.spa_therapists
    ORDER BY id
  LOOP
    v_idx := v_idx + 1;

    -- 1/2. Employee record + link (skip if already linked).
    IF t.employee_id IS NULL THEN
      v_emp_id := 'EMP-SPA-' || lpad(v_idx::text, 3, '0');
      INSERT INTO public.employees
        (id, employee_number, name, email, phone, department, position, status,
         hire_date, employment_type, property_id)
      VALUES
        (v_emp_id, 'SPA-' || lpad(v_idx::text, 3, '0'), t.name, t.email, t.phone,
         'Spa & Wellness', COALESCE(t.title, 'Therapist'), 'Active',
         COALESCE(t.hire_date, CURRENT_DATE - INTERVAL '1 year')::date,
         'Full-time', v_main_property)
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.spa_therapists
      SET employee_id = v_emp_id
      WHERE id = t.id AND employee_id IS NULL;
    ELSE
      v_emp_id := t.employee_id;
    END IF;

    -- 3. Roster: two weeks (current week Mon → +13d), staggered weekly off day.
    FOR v_date IN
      SELECT generate_series(
        date_trunc('week', CURRENT_DATE)::date,
        date_trunc('week', CURRENT_DATE)::date + 13,
        '1 day'::interval
      )::date
    LOOP
      v_shift := CASE
        WHEN (v_date - date_trunc('week', CURRENT_DATE)::date) % 7 = (v_idx - 1) % 7
          THEN 'Off'
        ELSE COALESCE(t.shift, 'Morning')
      END;

      INSERT INTO public.hr_team_roster
        (property_id, employee_id, employee_name, department, roster_date, shift, role)
      VALUES
        (v_main_property, v_emp_id, t.name, 'Spa & Wellness', v_date, v_shift,
         COALESCE(t.title, '-'))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMENT ON TABLE public.hr_team_roster IS
  'Shared staff roster. Spa provider shifts/off-days live here too — written by '
  'PUT /api/spa-wellness/provider-schedule and read by the appointment calendar.';
