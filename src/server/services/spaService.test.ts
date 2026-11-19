import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabaseAdmin before importing the service ────────────────────────
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../supabaseAdmin', () => ({
  hasSupabaseAdminConfig: true,
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('./folioService', () => ({
  postCharge: vi.fn(),
  voidFolioLine: vi.fn(),
  voidLine: vi.fn(),
}));
vi.mock('./salesMessageDispatch', () => ({
  dispatchEmail: vi.fn(async () => ({ provider: 'mock', delivered: 1, failed: 0 })),
  dispatchSMS: vi.fn(async () => ({ provider: 'mock', delivered: 1, failed: 0 })),
}));

import {
  canActForGuest,
  checkBookingResources,
  guestPropertyId,
  timeToMin,
} from './spaService';

/** Chainable postgrest builder stub resolving to `result`. */
function chain(result: any) {
  const b: any = {};
  for (const m of [
    'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or',
    'order', 'limit', 'filter', 'update', 'insert', 'delete', 'upsert',
    'ilike', 'not', 'match',
  ]) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => result);
  b.single = vi.fn(async () => result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

const PROP = '11111111-2222-3333-4444-555555555555';

beforeEach(() => mocks.from.mockReset());

describe('timeToMin', () => {
  it('parses HH:MM', () => {
    expect(timeToMin('09:30')).toBe(570);
    expect(timeToMin('14:00')).toBe(840);
  });
  it('returns null for malformed input', () => {
    expect(timeToMin(null)).toBeNull();
    expect(timeToMin('99')).toBeNull();
    expect(timeToMin('')).toBeNull();
  });
});

describe('canActForGuest', () => {
  const guestId = 'guest-1';

  it('allows full-access roles without a reservation', async () => {
    expect(await canActForGuest({ user: { role: 'admin' } }, guestId)).toBe(true);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('allows spa/front-office proxy roles without a reservation', async () => {
    expect(await canActForGuest({ user: { role: 'spa_receptionist' } }, guestId)).toBe(true);
    expect(await canActForGuest({ user: { role: 'concierge' } }, guestId)).toBe(true);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects when no reservation credential is presented', async () => {
    expect(await canActForGuest({ user: { role: 'housekeeping' }, body: {}, query: {} }, guestId)).toBe(false);
    expect(await canActForGuest({ user: {} }, guestId)).toBe(false);
    expect(await canActForGuest({ user: { role: 'spa' } }, null)).toBe(false);
  });

  it('allows when the presented reservation belongs to the guest and is active', async () => {
    mocks.from.mockImplementation((t: string) =>
      t === 'reservations'
        ? chain({ data: { guest_id: guestId, status: 'CheckedIn' } })
        : chain({ data: null }));
    const req = { user: { role: 'housekeeping' }, body: { reservationId: 'res-9' }, query: {} };
    expect(await canActForGuest(req, guestId)).toBe(true);
  });

  it('rejects when the reservation belongs to another guest or is inactive', async () => {
    mocks.from.mockImplementation((t: string) =>
      t === 'reservations'
        ? chain({ data: { guest_id: 'someone-else', status: 'CheckedIn' } })
        : chain({ data: null }));
    expect(await canActForGuest(
      { user: {}, body: { reservationId: 'res-9' }, query: {} }, guestId)).toBe(false);

    mocks.from.mockImplementation((t: string) =>
      t === 'reservations'
        ? chain({ data: { guest_id: guestId, status: 'CheckedOut' } })
        : chain({ data: null }));
    expect(await canActForGuest(
      { user: {}, body: { reservationId: 'res-9' }, query: {} }, guestId)).toBe(false);
  });
});

describe('guestPropertyId', () => {
  it('prefers an in-house stay', async () => {
    mocks.from.mockImplementation((t: string) =>
      t === 'reservations'
        ? chain({
            data: [
              { property_id: 'other-prop', status: 'CheckedOut', check_in_date: '2024-01-01' },
              { property_id: PROP, status: 'CheckedIn', check_in_date: '2024-02-01' },
            ],
          })
        : chain({ data: [] }));
    expect(await guestPropertyId('g1')).toBe(PROP);
  });

  it('returns null when the guest has no reservations', async () => {
    mocks.from.mockImplementation(() => chain({ data: [] }));
    expect(await guestPropertyId('g-none')).toBeNull();
  });
});

describe('checkBookingResources', () => {
  const treatment = { therapist_qualifications: ['Massage L2'], room_type: 'Treatment' };
  const base = { treatment, date: '2030-01-01', startTime: '10:00', durationMin: 60 };

  function mockTables(t: Record<string, any>) {
    mocks.from.mockImplementation((name: string) => chain(t[name] ?? { data: null }));
  }

  it('rejects a non-bookable room', async () => {
    mockTables({
      spa_rooms: { data: { name: 'R1', status: 'Available', is_bookable: false } },
    });
    await expect(checkBookingResources({ ...base, roomId: 'r1' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects a room under maintenance', async () => {
    mockTables({
      spa_rooms: { data: { name: 'R1', status: 'Maintenance', is_bookable: true } },
    });
    await expect(checkBookingResources({ ...base, roomId: 'r1' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects a provider missing required qualifications', async () => {
    mockTables({
      spa_therapists: { data: { name: 'Ana', certifications: ['Facial L1'] } },
    });
    await expect(checkBookingResources({ ...base, therapistId: 't1' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects bookings outside configured operating hours', async () => {
    mockTables({
      spa_settings: { data: { value: { open: '08:00', close: '20:00' } } },
    });
    await expect(checkBookingResources({ ...base, startTime: '21:00' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('passes a valid booking and returns warnings only', async () => {
    mockTables({
      spa_rooms: { data: { name: 'R1', status: 'Available', is_bookable: true, room_type: 'Treatment' } },
      spa_therapists: { data: { name: 'Ana', certifications: ['Massage L2'] } },
      spa_settings: { data: { value: { open: '08:00', close: '20:00' } } },
    });
    const warnings = await checkBookingResources({ ...base, roomId: 'r1', therapistId: 't1' });
    expect(warnings).toEqual([]);
  });
});
