import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  isInsideGeofence,
  geofenceTransitions,
  detectFuelAnomaly,
  computeQuote,
  intervalsOverlap,
  pickAutoAssign,
  computeSafetyScore,
  expectedInvoiceAmount,
  type GeofenceShape,
  type PricingRule,
  type ScheduleLike,
  type DriverLike,
} from './transportOps';

// ── Geo ─────────────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineKm(9.0, 38.7, 9.0, 38.7)).toBeCloseTo(0, 5);
  });
  it('computes a plausible distance', () => {
    // Addis Ababa → Bole airport ≈ 5-6 km
    const d = haversineKm(9.0054, 38.7636, 8.9779, 38.7993);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(8);
  });
});

const fence: GeofenceShape = {
  id: 'f1', name: 'Airport', center_latitude: 8.9779, center_longitude: 38.7993, radius_km: 2,
};

describe('geofences', () => {
  it('detects a point inside the radius', () => {
    expect(isInsideGeofence(8.9779, 38.7993, fence)).toBe(true);
    expect(isInsideGeofence(9.1, 38.9, fence)).toBe(false);
  });

  it('emits enter on first sighting and exit when leaving', () => {
    const inside = geofenceTransitions(8.9779, 38.7993, [fence], []);
    expect(inside.transitions).toEqual([{ geofence: fence, eventType: 'enter', alert: true }]);
    expect(inside.nowInside).toEqual(['f1']);

    const exit = geofenceTransitions(9.5, 39.5, [fence], ['f1']);
    // exit alerts only when alert_on_exit is explicitly enabled
    expect(exit.transitions).toEqual([{ geofence: fence, eventType: 'exit', alert: false }]);
    expect(exit.nowInside).toEqual([]);
  });

  it('respects alert_on_exit and inactive fences', () => {
    const alertFence = { ...fence, alert_on_exit: true };
    expect(geofenceTransitions(9.5, 39.5, [alertFence], ['f1']).transitions[0].alert).toBe(true);
    const inactive = { ...fence, active: false };
    expect(geofenceTransitions(8.9779, 38.7993, [inactive], []).transitions).toHaveLength(0);
  });
});

// ── Fuel anomaly ────────────────────────────────────────────────────────────

describe('detectFuelAnomaly', () => {
  const vehicle = { tank_capacity_gal: 15, mileage: 50000 };

  it('flags tank overfill', () => {
    expect(detectFuelAnomaly({ gallons: 20 }, vehicle, null)).toMatch(/tank capacity/);
  });
  it('flags cost mismatch', () => {
    expect(detectFuelAnomaly({ gallons: 10, price_per_gallon: 5, total_cost: 200 }, vehicle, null)).toMatch(/does not match/);
  });
  it('flags decreasing odometer', () => {
    expect(detectFuelAnomaly({ gallons: 5, odometer: 40000 }, vehicle, { odometer: 45000 })).toMatch(/Odometer decreased/);
  });
  it('flags implausible efficiency', () => {
    expect(detectFuelAnomaly({ gallons: 50, odometer: 50100, price_per_gallon: 5, total_cost: 250 }, { tank_capacity_gal: 60 }, { odometer: 50000 }))
      .toMatch(/Implausible efficiency/);
  });
  it('passes a normal purchase', () => {
    expect(detectFuelAnomaly({ gallons: 10, price_per_gallon: 5, total_cost: 50, odometer: 50250 }, vehicle, { odometer: 50000 })).toBeNull();
  });
});

// ── Pricing ─────────────────────────────────────────────────────────────────

const rules: PricingRule[] = [
  { id: 'r1', rule_type: 'Fixed', base_fare: 25, priority: 1 },
  { id: 'r2', rule_type: 'Distance-Based', base_fare: 5, per_km_rate: 2, min_fare: 15, priority: 2 },
  { id: 'r3', rule_type: 'Zone-Based', zone_from: 'airport', zone_to: 'hotel', package_price: 40, priority: 3 },
  { id: 'r4', rule_type: 'Fixed', base_fare: 99, transport_type: 'Limo', priority: 9 },
  { id: 'r5', rule_type: 'Fixed', base_fare: 1, active: false, priority: 10 },
];

describe('computeQuote', () => {
  it('uses the highest-priority applicable rule', () => {
    const { amount, rule } = computeQuote(rules, { type: 'Shuttle', distanceKm: 10 });
    expect(rule?.id).toBe('r2');
    expect(amount).toBe(25); // 5 + 2*10
  });
  it('applies min_fare', () => {
    const { amount } = computeQuote(rules, { type: 'Shuttle', distanceKm: 2 });
    expect(amount).toBe(15); // 5 + 4 = 9 → min 15
  });
  it('matches zone rules by location keywords', () => {
    const { amount, rule } = computeQuote(rules, { type: 'Shuttle', distanceKm: 12, pickupLocation: 'Bole Airport', destination: 'Grand Hotel' });
    expect(rule?.id).toBe('r3');
    expect(amount).toBe(40);
  });
  it('filters by transport type and inactive rules', () => {
    const { amount } = computeQuote(rules, { type: 'Limo' });
    expect(amount).toBe(99);
    const { rule } = computeQuote([rules[4]], { type: 'Shuttle' });
    expect(rule).toBeNull();
  });
  it('skips distance rules when distance is unknown', () => {
    const { rule } = computeQuote([rules[1]], { type: 'Shuttle' });
    expect(rule).toBeNull();
  });
});

// ── Auto-assignment ─────────────────────────────────────────────────────────

const base = Date.parse('2026-01-01T09:00:00Z');
const item: ScheduleLike = { id: 'i1', scheduled_time: new Date(base).toISOString(), duration_minutes: 60, status: 'Unassigned' };
const drivers: DriverLike[] = [
  { id: 'd1', status: 'Active', assigned_vehicle: 'VH-1' },
  { id: 'd2', status: 'Active', assigned_vehicle: 'VH-2' },
  { id: 'd3', status: 'On Leave' },
];

describe('pickAutoAssign', () => {
  it('picks the first free active driver', () => {
    const pick = pickAutoAssign(item, drivers, [item], []);
    expect(pick).toEqual({ driverId: 'd1', vehicle: 'VH-1' });
  });
  it('skips drivers with overlapping trips', () => {
    const busy: ScheduleLike = { id: 'i2', scheduled_time: new Date(base + 30 * 60000).toISOString(), duration_minutes: 60, driver_id: 'd1', status: 'Scheduled' };
    expect(pickAutoAssign(item, drivers, [item, busy], [])).toEqual({ driverId: 'd2', vehicle: 'VH-2' });
  });
  it('ignores terminal items and inactive drivers', () => {
    const done: ScheduleLike = { id: 'i2', scheduled_time: item.scheduled_time, duration_minutes: 60, driver_id: 'd1', status: 'Completed' };
    expect(pickAutoAssign(item, drivers, [item, done], [])?.driverId).toBe('d1');
    const pick = pickAutoAssign(item, [{ id: 'd3', status: 'On Leave' }], [item], []);
    expect(pick).toBeNull();
  });
  it('finds a free vehicle when the driver has none', () => {
    const noCar: DriverLike[] = [{ id: 'd9', status: 'Active' }];
    const taken: ScheduleLike = { id: 'i2', scheduled_time: item.scheduled_time, duration_minutes: 60, assigned_vehicle: 'VH-1', status: 'Scheduled' };
    const pick = pickAutoAssign(item, noCar, [item, taken], [{ vehicle_number: 'VH-1', status: 'Active' }, { vehicle_number: 'VH-2', status: 'Active' }]);
    expect(pick?.vehicle).toBe('VH-2');
  });
  it('detects interval overlap edges', () => {
    expect(intervalsOverlap(0, 30, 30 * 60000, 30)).toBe(false); // back-to-back is fine
    expect(intervalsOverlap(0, 30, 29 * 60000, 30)).toBe(true);
  });
});

// ── Safety score & invoice verification ─────────────────────────────────────

describe('computeSafetyScore', () => {
  it('deducts by severity, half for resolved', () => {
    expect(computeSafetyScore([])).toBe(100);
    expect(computeSafetyScore([{ severity: 'Major' }])).toBe(88);
    expect(computeSafetyScore([{ severity: 'Critical', status: 'Resolved' }])).toBe(88); // 25/2 rounded
    expect(computeSafetyScore([{ severity: 'Critical' }, { severity: 'Critical' }, { severity: 'Critical' }, { severity: 'Critical' }, { severity: 'Critical' }])).toBe(0);
  });
});

describe('expectedInvoiceAmount', () => {
  it('computes Per Trip from trip count', () => {
    expect(expectedInvoiceAmount({ rate_structure: 'Per Trip', base_rate: 25 }, 10)).toBe(250);
  });
  it('returns null for other structures (manual verification)', () => {
    expect(expectedInvoiceAmount({ rate_structure: 'Hourly', base_rate: 40 }, 10)).toBeNull();
    expect(expectedInvoiceAmount({ rate_structure: 'Per Mile', base_rate: 5, per_mile_rate: 2 }, 10)).toBeNull();
  });
});
