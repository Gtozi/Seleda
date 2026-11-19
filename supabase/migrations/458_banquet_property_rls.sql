-- =============================================================================
-- Migration 458: Banquet & Events — Property-aware RLS
-- =============================================================================
-- PROBLEM
--   Migration 456 enabled RLS with USING(true)/WITH CHECK(true) policies.
--   Any authenticated session could read/write every property's banquet data
--   via PostgREST — the policies were a checkbox, not a boundary.
--
-- SOLUTION
--   Scope policies to the property (or properties) the caller belongs to,
--   resolved via system_users.auth_user_id → property_id plus
--   user_property_access (org-hierarchy multi-property membership).
--
--   Progressive-hardening semantics: if the caller has NO property
--   assignment at all (the current state of this deployment — all
--   system_users.property_id are NULL), access is unchanged so nothing
--   breaks. Once operations assigns users to properties, isolation
--   engages automatically. Rows with NULL property_id remain global.
--
--   Staff sub-tables without property_id (attendance, training,
--   productivity) are scoped through their parent banquet_staff row.
--
-- Depends on: 456 (policies being replaced), system_users.auth_user_id,
--             user_property_access
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: the set of property IDs the current auth user may access.
-- SECURITY DEFINER so it can read system_users / user_property_access
-- regardless of those tables' own RLS.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.banquet_user_property_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT p), '{}'::uuid[]) FROM (
    SELECT su.property_id AS p
      FROM public.system_users su
     WHERE su.auth_user_id::text = auth.uid()::text
       AND su.property_id IS NOT NULL
    UNION
    SELECT upa.property_id AS p
      FROM public.user_property_access upa
     WHERE upa.user_id::text = auth.uid()::text
       AND upa.is_active
       AND upa.property_id IS NOT NULL
  ) t;
$$;

-- Can the current user access a row tagged with property p?
-- p IS NULL      → global row, visible to everyone
-- no assignments → legacy behaviour (full access) until ops assigns users
-- otherwise      → p must be one of the user's properties
CREATE OR REPLACE FUNCTION public.banquet_can_access_property(p uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p IS NULL
      OR cardinality(public.banquet_user_property_ids()) = 0
      OR p = ANY(public.banquet_user_property_ids());
$$;

-- Staff sub-table scoping: does the parent staff row belong to an
-- accessible property?
CREATE OR REPLACE FUNCTION public.banquet_can_access_staff_row(p_staff_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.banquet_staff s
     WHERE s.id::text = p_staff_id
       AND public.banquet_can_access_property(s.property_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.banquet_user_property_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.banquet_can_access_property(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.banquet_can_access_staff_row(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Replace the permissive 456 policies on every banquet table that has
-- property_id.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables_with_property text[] := ARRAY[
    'banquet_venues',
    'banquet_schedules',
    'banquet_checklists',
    'banquet_beos',
    'banquet_event_type_items',
    'banquet_event_type_checklists',
    'banquet_menu_items',
    'banquet_beverages',
    'banquet_resources',
    'banquet_equipment',
    'banquet_vendors',
    'banquet_transportation',
    'banquet_checklist_templates',
    'banquet_event_issues',
    'banquet_dept_coordination',
    'banquet_communications',
    'banquet_event_guests',
    'banquet_event_registrations',
    'banquet_event_seating',
    'banquet_event_reports',
    'banquet_event_report_catalog',
    'banquet_event_config',
    'banquet_staff',
    'banquet_staff_shift_reqs',
    'banquet_staff_staffing_reqs'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_property LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_authenticated ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_property_scoped ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_property_scoped ON public.%I FOR ALL TO authenticated
         USING (public.banquet_can_access_property(property_id))
         WITH CHECK (public.banquet_can_access_property(property_id))',
      t, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff sub-tables have no property_id — scope through the parent staff row.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS banquet_staff_attendance_authenticated ON public.banquet_staff_attendance;
DROP POLICY IF EXISTS banquet_staff_attendance_property_scoped ON public.banquet_staff_attendance;
CREATE POLICY banquet_staff_attendance_property_scoped ON public.banquet_staff_attendance
  FOR ALL TO authenticated
  USING (public.banquet_can_access_staff_row(staff_id::text))
  WITH CHECK (public.banquet_can_access_staff_row(staff_id::text));

DROP POLICY IF EXISTS banquet_staff_training_authenticated ON public.banquet_staff_training;
DROP POLICY IF EXISTS banquet_staff_training_property_scoped ON public.banquet_staff_training;
CREATE POLICY banquet_staff_training_property_scoped ON public.banquet_staff_training
  FOR ALL TO authenticated
  USING (public.banquet_can_access_staff_row(staff_id::text))
  WITH CHECK (public.banquet_can_access_staff_row(staff_id::text));

DROP POLICY IF EXISTS banquet_staff_productivity_authenticated ON public.banquet_staff_productivity;
DROP POLICY IF EXISTS banquet_staff_productivity_property_scoped ON public.banquet_staff_productivity;
CREATE POLICY banquet_staff_productivity_property_scoped ON public.banquet_staff_productivity
  FOR ALL TO authenticated
  USING (public.banquet_can_access_staff_row(staff_id::text))
  WITH CHECK (public.banquet_can_access_staff_row(staff_id::text));

-- ─────────────────────────────────────────────────────────────────────────────
-- banquet_events is a VIEW over event_bookings (444) — it inherits the
-- underlying table's security; no policy needed here.
-- =============================================================================
