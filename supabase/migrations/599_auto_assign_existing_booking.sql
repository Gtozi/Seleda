-- Migration 599: Fix auto_assign_table_from_reservation
--
-- The migration-128 version always INSERTed a new fb_table_reservations row
-- (using check_in_date as arrival and a hardcoded "first restaurant" outlet),
-- so calling it on a booking that already existed — e.g. a concierge- or
-- guest-booked row with table_id NULL — produced a duplicate reservation
-- instead of assigning a table to the existing booking.
--
-- New behavior:
--   1. If an unassigned confirmed/seated booking already exists for the given
--      id (matched by fb_table_reservations.id OR linked reservations.id),
--      pick the smallest free table in that booking's outlet across its
--      arrival window and UPDATE the booking — no duplicate row.
--   2. Only when no booking row exists do we fall back to the legacy path of
--      deriving a booking from the reservations row (now populating
--      outlet_id and booked_via added in migration 597).

DROP FUNCTION IF EXISTS auto_assign_table_from_reservation(UUID);
DROP FUNCTION IF EXISTS auto_assign_table_from_reservation(TEXT);

CREATE OR REPLACE FUNCTION auto_assign_table_from_reservation(
  p_reservation_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_booking      fb_table_reservations%ROWTYPE;
  v_table_id     UUID;
  v_party_size   INTEGER;
  v_outlet_id    TEXT;
  v_arrival_time TIMESTAMPTZ;
BEGIN
  -- Preferred path: an existing unassigned booking (booked_via
  -- concierge/guest rows have table_id NULL until the host assigns one).
  SELECT * INTO v_booking
  FROM fb_table_reservations
  WHERE (id::text = p_reservation_id OR reservation_id = p_reservation_id)
    AND status IN ('confirmed', 'seated')
    AND table_id IS NULL
  ORDER BY arrival_time ASC
  LIMIT 1;

  IF FOUND THEN
    -- Smallest table that seats the party, not out of service, and free for
    -- the whole booking window (existing confirmed/seated bookings only —
    -- unassigned rows can't collide on a table identity yet).
    SELECT t.id INTO v_table_id
    FROM fb_tables t
    WHERE t.outlet_id = v_booking.outlet_id
      AND t.is_active = TRUE
      AND t.status <> 'out_of_service'
      AND t.seats >= v_booking.party_size
      AND NOT EXISTS (
        SELECT 1
        FROM fb_table_reservations o
        WHERE o.table_id = t.id
          AND o.id <> v_booking.id
          AND o.status IN ('confirmed', 'seated')
          AND o.arrival_time < v_booking.arrival_time
              + make_interval(mins => COALESCE(v_booking.duration, 120))
          AND o.arrival_time
              + make_interval(mins => COALESCE(o.duration, 120))
              > v_booking.arrival_time
      )
    ORDER BY t.seats ASC, t.table_number ASC
    LIMIT 1;

    IF v_table_id IS NULL THEN
      RAISE EXCEPTION 'No available tables for party size % at %',
        v_booking.party_size, v_booking.arrival_time;
    END IF;

    UPDATE fb_table_reservations
    SET table_id = v_table_id,
        updated_at = NOW()
    WHERE id = v_booking.id;

    RETURN v_table_id;
  END IF;

  -- Legacy fallback: no booking row exists yet — derive one from the
  -- reservations record (original callers pass a reservations.id).
  SELECT
    r.guest_count,
    (SELECT id FROM outlets WHERE type = 'Restaurant' AND is_active = TRUE LIMIT 1),
    r.check_in_date
  INTO v_party_size, v_outlet_id, v_arrival_time
  FROM reservations r
  WHERE r.id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  IF v_outlet_id IS NULL THEN
    RAISE EXCEPTION 'No active restaurant outlet configured';
  END IF;

  SELECT t.id INTO v_table_id
  FROM fb_tables t
  WHERE t.outlet_id = v_outlet_id
    AND t.is_active = TRUE
    AND t.status <> 'out_of_service'
    AND t.seats >= v_party_size
    AND NOT EXISTS (
      SELECT 1
      FROM fb_table_reservations o
      WHERE o.table_id = t.id
        AND o.status IN ('confirmed', 'seated')
        AND o.arrival_time < v_arrival_time + INTERVAL '120 minutes'
        AND o.arrival_time
            + make_interval(mins => COALESCE(o.duration, 120))
            > v_arrival_time
    )
  ORDER BY t.seats ASC, t.table_number ASC
  LIMIT 1;

  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'No available tables for party size %', v_party_size;
  END IF;

  INSERT INTO fb_table_reservations (
    table_id,
    outlet_id,
    reservation_id,
    guest_name,
    party_size,
    arrival_time,
    status,
    booked_via
  ) SELECT
    v_table_id,
    v_outlet_id,
    p_reservation_id,
    (SELECT guest_name FROM reservations WHERE id = p_reservation_id),
    v_party_size,
    v_arrival_time,
    'confirmed',
    'fnb';

  RETURN v_table_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION auto_assign_table_from_reservation(TEXT) TO authenticated;
