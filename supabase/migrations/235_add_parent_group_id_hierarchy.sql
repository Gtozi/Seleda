-- Migration 235: Add parent_group_id to group_profiles for hierarchy
--
-- This enables group profiles to be children of other group profiles.
-- Use case:
--   - A GroupReservation profile can be a child of a TravelAgent profile
--   - A GroupReservation profile can be a child of a CorporateAccount profile
--   - This lets all group bookings made through a given travel agency or
--     corporation be nested under that parent entity.
--
-- The CHECK constraint on `type` already allows:
--   GroupReservation, CorporateAccount, TravelAgent, TourOperator,
--   CrewBooking, Conference, Event, LongTermContract

-- ── 1. Add parent_group_id column ────────────────────────────────────────────
ALTER TABLE public.group_profiles
  ADD COLUMN IF NOT EXISTS parent_group_id text;

-- ── 2. Self-referencing FK (parent must be another group profile) ───────────
ALTER TABLE public.group_profiles
  DROP CONSTRAINT IF EXISTS group_profiles_parent_group_id_fkey;

ALTER TABLE public.group_profiles
  ADD CONSTRAINT group_profiles_parent_group_id_fkey
  FOREIGN KEY (parent_group_id) REFERENCES public.group_profiles(id)
  ON DELETE SET NULL;

-- ── 3. Index for efficient child lookups ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_group_profiles_parent_group_id
  ON public.group_profiles(parent_group_id);

-- ── 4. Trigger to enforce parent must be an organization-type profile ────────
-- (TravelAgent, CorporateAccount, TourOperator) — not another GroupReservation.
-- Postgres CHECK constraints cannot use subqueries, so we use a trigger.
CREATE OR REPLACE FUNCTION public.validate_group_profile_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
declare
  v_parent_type text;
begin
  if NEW.parent_group_id is not null then
    select type into v_parent_type from group_profiles where id = NEW.parent_group_id;
    if v_parent_type is null then
      raise exception 'Parent group profile % does not exist', NEW.parent_group_id;
    end if;
    if v_parent_type not in ('TravelAgent', 'CorporateAccount', 'TourOperator') then
      raise exception 'Parent group profile must be of type TravelAgent, CorporateAccount, or TourOperator (got %)', v_parent_type;
    end if;
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trigger_validate_group_profile_parent ON public.group_profiles;
CREATE TRIGGER trigger_validate_group_profile_parent
BEFORE INSERT OR UPDATE OF parent_group_id ON public.group_profiles
FOR EACH ROW
EXECUTE FUNCTION validate_group_profile_parent();

GRANT EXECUTE ON FUNCTION public.validate_group_profile_parent() TO anon, authenticated;
