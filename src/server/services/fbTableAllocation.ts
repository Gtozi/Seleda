/**
 * Table-identity-aware capacity check for fb_table_reservations.
 *
 * Replaces the old "count overlapping bookings vs count of big-enough tables"
 * heuristic, which could wrongly reject (a big party counted against small
 * tables) or wrongly accept (two big bookings sharing one large table while
 * small tables sat empty).
 *
 * canAccommodateBookings simulates an actual assignment: bookings are placed
 * in arrival order onto the smallest free table that seats the party
 * (interval partitioning with a best-fit tiebreak). A candidate slot is
 * bookable iff the whole set — existing bookings plus the candidate — can be
 * placed simultaneously. Greedy-by-start-time is optimal for pure interval
 * partitioning; the seat-size constraint makes this a heuristic, but it is
 * strictly more accurate than counting.
 *
 * Shared by concierge.routes.ts (staff bookings) and
 * guestMobilePortal.routes.ts (guest availability + booking).
 */

export interface AllocatableTable {
  id: string;
  seats: number;
}

export interface TimedBooking {
  party_size: number;
  arrival_time: string;
  duration?: number | null;
}

export function canAccommodateBookings(
  tables: AllocatableTable[],
  bookings: TimedBooking[],
): boolean {
  if (tables.length === 0) return bookings.length === 0;

  const intervals = bookings
    .map((b) => {
      const start = new Date(b.arrival_time).getTime();
      return {
        party: Math.max(1, Number(b.party_size) || 1),
        start,
        end: start + (Number(b.duration) || 120) * 60000,
      };
    })
    .filter((b) => !Number.isNaN(b.start))
    .sort((a, b) => a.start - b.start || b.party - a.party);

  const busy = new Map<string, Array<{ start: number; end: number }>>();

  for (const booking of intervals) {
    const table = tables
      .filter(
        (t) =>
          Number(t.seats) >= booking.party &&
          !(busy.get(t.id) || []).some(
            (iv) => booking.start < iv.end && booking.end > iv.start,
          ),
      )
      .sort((a, b) => Number(a.seats) - Number(b.seats))[0];

    if (!table) return false;

    const iv = busy.get(table.id);
    if (iv) iv.push({ start: booking.start, end: booking.end });
    else busy.set(table.id, [{ start: booking.start, end: booking.end }]);
  }

  return true;
}
