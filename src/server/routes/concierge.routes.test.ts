import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabaseAdmin before importing anything that touches it ──────────
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../supabaseAdmin', () => ({
  hasSupabaseAdminConfig: true,
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('../services/spaService', () => ({
  dispatchDueCommunications: vi.fn(async () => []),
  sendAppointmentReminders: vi.fn(async () => []),
}));
vi.mock('../services/channelSync', () => ({
  runChannelSync: vi.fn(async () => ({ status: 'success' })),
}));
vi.mock('../services/transportLifecycle', () => ({
  runTransportStatusSideEffects: vi.fn(async () => {}),
}));

import { executeJob } from '../scheduler';
import {
  transportToShuttleShape,
  TRANSPORT_TO_CONCIERGE_STATUS,
  SHUTTLE_STATUS_MAP,
} from './concierge.routes';

/** Chainable postgrest builder stub that records every call and resolves `result`. */
function recorder(result: any, table: string) {
  const calls: any[] = [];
  const b: any = { calls, table };
  for (const m of [
    'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or',
    'order', 'limit', 'filter', 'update', 'insert', 'delete', 'upsert',
    'ilike', 'not', 'match',
  ]) {
    b[m] = vi.fn((...args: any[]) => { calls.push([m, ...args]); return b; });
  }
  b.maybeSingle = vi.fn(async () => result);
  b.single = vi.fn(async () => result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

beforeEach(() => mocks.from.mockReset());

describe('transport status mapping', () => {
  it('maps every transport status to a concierge status', () => {
    const transportStatuses = [
      'Requested', 'Confirmed', 'Assigned', 'Driver En Route',
      'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show',
    ];
    for (const s of transportStatuses) {
      expect(TRANSPORT_TO_CONCIERGE_STATUS[s]).toBeTruthy();
    }
  });

  it('round-trips through the shuttle PUT vocabulary', () => {
    // Every concierge status the UI can set maps to a transport status that
    // maps back to a concierge status.
    for (const [concierge, transport] of Object.entries(SHUTTLE_STATUS_MAP)) {
      expect(TRANSPORT_TO_CONCIERGE_STATUS[transport]).toBe(concierge);
    }
  });
});

describe('transportToShuttleShape', () => {
  const row = {
    id: 'tr-1',
    request_number: 'TR-001',
    guest_id: 'g-1',
    reservation_id: 'res-1',
    guest_name: 'John Smith',
    room: '302',
    type: 'Airport Pickup',
    special_instructions: 'Flight ET302 | Child seat',
    scheduled_time: '2030-01-01T08:00:00Z',
    pickup_location: 'Airport',
    destination: 'Hotel',
    passenger_count: 2,
    status: 'Driver En Route',
    assigned_vehicle: 'VH-003',
    created_at: '2030-01-01T00:00:00Z',
  };

  it('preserves reservation_id for guest-profile deep links', () => {
    expect(transportToShuttleShape(row).reservation_id).toBe('res-1');
  });

  it('extracts the flight number from special instructions', () => {
    expect(transportToShuttleShape(row).flight_number).toBe('ET302');
  });

  it('maps transport status to concierge vocabulary', () => {
    expect(transportToShuttleShape(row).status).toBe('In Progress');
  });

  it('handles missing notes and reservation', () => {
    const shaped = transportToShuttleShape({ ...row, special_instructions: null, reservation_id: null });
    expect(shaped.flight_number).toBeNull();
    expect(shaped.reservation_id).toBeNull();
    expect(shaped.notes).toBe('');
  });
});

describe('concierge_wakeup_dispatch job', () => {
  const job = {
    id: 'job-1',
    name: 'Concierge Wake-up Dispatch',
    type: 'concierge_wakeup_dispatch',
    schedule_cron: '*/5 * * * *',
    config: {},
    enabled: true,
    last_run: null,
    next_run: null,
  };

  it('promotes due wake-up requests and posts a guest communication', async () => {
    const due = {
      id: 'req-1',
      reservation_id: 'res-1',
      room_number: '301',
      guest_name: 'John Smith',
      description: 'Wake-up Call · 6:00 AM',
    };
    const recorders: any[] = [];
    mocks.from.mockImplementation((table: string) => {
      const r = recorder(table === 'guest_requests' ? { data: [due] } : { data: null }, table);
      recorders.push(r);
      return r;
    });

    await executeJob(job);

    // The request is promoted to In Progress with a status guard.
    const upd = recorders.find(
      (r) => r.table === 'guest_requests' && r.calls.some((c: any[]) => c[0] === 'update')
    );
    expect(upd).toBeTruthy();
    const updCall = upd.calls.find((c: any[]) => c[0] === 'update');
    expect(updCall[1].status).toBe('In Progress');
    expect(updCall[1].acknowledged_at).toBeTruthy();
    // Guarded re-check of Open/Assigned prevents double-dispatch.
    const inCall = upd.calls.find((c: any[]) => c[0] === 'in' && c[1] === 'status');
    expect(inCall[2]).toEqual(['Open', 'Assigned']);

    // A guest-visible communication is posted.
    const comm = recorders.find(
      (r) => r.table === 'guest_communications' && r.calls.some((c: any[]) => c[0] === 'insert')
    );
    expect(comm).toBeTruthy();
    const insCall = comm.calls.find((c: any[]) => c[0] === 'insert');
    expect(insCall[1].reservation_id).toBe('res-1');
    expect(insCall[1].room_number).toBe('301');
    expect(insCall[1].message).toContain('Wake-up call due now');
    expect(insCall[1].status).toBe('Pending');
  });

  it('does nothing when no wake-up requests are due', async () => {
    const recorders: any[] = [];
    mocks.from.mockImplementation((table: string) => {
      const r = recorder({ data: [] }, table);
      recorders.push(r);
      return r;
    });

    await executeJob(job);

    const comm = recorders.find((r) => r.table === 'guest_communications');
    expect(comm).toBeUndefined();
    const reqUpdate = recorders.find(
      (r) => r.table === 'guest_requests' && r.calls.some((c: any[]) => c[0] === 'update')
    );
    expect(reqUpdate).toBeUndefined();
  });
});
