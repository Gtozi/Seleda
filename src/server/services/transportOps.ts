/**
 * Transport operations — pure business logic
 * ──────────────────────────────────────────────────────────────────────────
 * DB-free functions shared by the transport route modules so they stay
 * unit-testable: geofence math, fuel anomaly detection, pricing quotes,
 * auto-assignment, contractor invoice verification and driver safety scoring.
 */

// ── Geo ─────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface GeofenceShape {
  id: string;
  name: string;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  alert_on_enter?: boolean;
  alert_on_exit?: boolean;
  active?: boolean;
}

export function isInsideGeofence(lat: number, lng: number, fence: GeofenceShape): boolean {
  return haversineKm(lat, lng, Number(fence.center_latitude), Number(fence.center_longitude)) <= Number(fence.radius_km);
}

export interface GeofenceTransition {
  geofence: GeofenceShape;
  eventType: 'enter' | 'exit';
  alert: boolean;
}

/**
 * Diff a vehicle's previous inside-set against the fences it is inside now.
 * Returns the enter/exit transitions that should be logged (and whether each
 * should raise an alert per the fence's alert_on_* flags).
 */
export function geofenceTransitions(
  lat: number,
  lng: number,
  fences: GeofenceShape[],
  previousInsideIds: string[]
): { transitions: GeofenceTransition[]; nowInside: string[] } {
  const transitions: GeofenceTransition[] = [];
  const nowInside: string[] = [];
  const prev = new Set(previousInsideIds);

  for (const f of fences) {
    if (f.active === false) continue;
    const inside = isInsideGeofence(lat, lng, f);
    if (inside) nowInside.push(f.id);
    if (inside && !prev.has(f.id)) {
      transitions.push({ geofence: f, eventType: 'enter', alert: f.alert_on_enter !== false });
    } else if (!inside && prev.has(f.id)) {
      transitions.push({ geofence: f, eventType: 'exit', alert: f.alert_on_exit === true });
    }
  }
  return { transitions, nowInside };
}

// ── Fuel anomaly detection ──────────────────────────────────────────────────

export interface FuelPurchaseInput {
  gallons?: number | null;
  odometer?: number | null;
  total_cost?: number | null;
  price_per_gallon?: number | null;
  efficiency?: number | null;
}

export interface VehicleShape {
  tank_capacity_gal?: number | null;
  mileage?: number | null;
}

/**
 * Flag suspicious fuel purchases. Returns a human-readable reason or null.
 * Checks, in order: tank overfill, cost mismatch, negative odometer delta,
 * implausible computed efficiency.
 */
export function detectFuelAnomaly(
  purchase: FuelPurchaseInput,
  vehicle: VehicleShape | null,
  previousPurchase: { odometer?: number | null } | null
): string | null {
  const gallons = Number(purchase.gallons) || 0;

  if (vehicle?.tank_capacity_gal && gallons > Number(vehicle.tank_capacity_gal) * 1.05) {
    return `Gallons (${gallons}) exceed tank capacity (${vehicle.tank_capacity_gal})`;
  }

  const cost = Number(purchase.total_cost) || 0;
  const ppg = Number(purchase.price_per_gallon) || 0;
  if (gallons > 0 && ppg > 0 && cost > 0 && Math.abs(cost - gallons * ppg) > Math.max(1, cost * 0.05)) {
    return `Total cost (${cost}) does not match gallons × price (${(gallons * ppg).toFixed(2)})`;
  }

  if (purchase.odometer != null && previousPurchase?.odometer != null) {
    const delta = Number(purchase.odometer) - Number(previousPurchase.odometer);
    if (delta < 0) {
      return `Odometer decreased (${previousPurchase.odometer} → ${purchase.odometer})`;
    }
    if (gallons > 0 && delta > 0) {
      const mpg = delta / gallons;
      if (mpg < 3) return `Implausible efficiency: ${mpg.toFixed(1)} mi/gal (possible over-fuelling claim)`;
      if (mpg > 150) return `Implausible efficiency: ${mpg.toFixed(1)} mi/gal (odometer or gallons error)`;
    }
  }
  return null;
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export interface PricingRule {
  id: string;
  name?: string | null;
  transport_type?: string | null;
  rule_type: 'Fixed' | 'Distance-Based' | 'Time-Based' | 'Zone-Based' | 'Package';
  base_fare?: number | null;
  per_km_rate?: number | null;
  per_minute_rate?: number | null;
  zone_from?: string | null;
  zone_to?: string | null;
  package_price?: number | null;
  min_fare?: number | null;
  active?: boolean;
  priority?: number | null;
}

export interface QuoteInput {
  type: string;
  distanceKm?: number | null;
  durationMin?: number | null;
  pickupLocation?: string | null;
  destination?: string | null;
}

function ruleApplies(rule: PricingRule, input: QuoteInput): boolean {
  if (rule.active === false) return false;
  if (rule.transport_type && rule.transport_type !== input.type) return false;
  if (rule.rule_type === 'Zone-Based') {
    const norm = (s?: string | null) => (s || '').toLowerCase();
    const pickup = norm(input.pickupLocation);
    const dest = norm(input.destination);
    if (rule.zone_from && !pickup.includes(norm(rule.zone_from))) return false;
    if (rule.zone_to && !dest.includes(norm(rule.zone_to))) return false;
  }
  return true;
}

/** Compute a trip price from the highest-priority matching rule. */
export function computeQuote(rules: PricingRule[], input: QuoteInput): { amount: number; rule: PricingRule | null } {
  const candidates = rules
    .filter((r) => ruleApplies(r, input))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of candidates) {
    const base = Number(rule.base_fare) || 0;
    let amount: number | null = null;
    switch (rule.rule_type) {
      case 'Fixed':
        amount = base;
        break;
      case 'Package':
        amount = Number(rule.package_price) ?? base;
        break;
      case 'Distance-Based':
        if (input.distanceKm == null) continue;
        amount = base + Number(rule.per_km_rate || 0) * input.distanceKm;
        break;
      case 'Time-Based':
        if (input.durationMin == null) continue;
        amount = base + Number(rule.per_minute_rate || 0) * input.durationMin;
        break;
      case 'Zone-Based':
        amount = base || Number(rule.package_price) || 0;
        break;
    }
    if (amount == null) continue;
    amount = Math.max(amount, Number(rule.min_fare) || 0);
    return { amount: Math.round(amount * 100) / 100, rule };
  }
  return { amount: 0, rule: null };
}

// ── Auto-assignment ─────────────────────────────────────────────────────────

export interface ScheduleLike {
  id: string;
  scheduled_time: string;
  duration_minutes?: number | null;
  driver_id?: string | null;
  assigned_vehicle?: string | null;
  status: string;
}

export interface DriverLike {
  id: string;
  status: string;
  assigned_vehicle?: string | null;
}

const TERMINAL = new Set(['Cancelled', 'Completed']);

export function intervalsOverlap(
  aStart: number, aDurMin: number,
  bStart: number, bDurMin: number
): boolean {
  return aStart < bStart + bDurMin * 60000 && bStart < aStart + aDurMin * 60000;
}

/**
 * Pick the first Active driver with no overlapping non-terminal schedule item.
 * Deterministic: iterate `drivers` in the caller's order (usually by name or
 * performance) so results are stable and testable.
 */
export function pickAutoAssign(
  item: ScheduleLike,
  drivers: DriverLike[],
  items: ScheduleLike[],
  vehicles: { vehicle_number: string; status: string }[]
): { driverId: string; vehicle: string | null } | null {
  const start = new Date(item.scheduled_time).getTime();
  const dur = Number(item.duration_minutes) || 30;
  if (!Number.isFinite(start)) return null;

  const overlapsItem = (i: ScheduleLike) =>
    i.id !== item.id &&
    !TERMINAL.has(i.status) &&
    intervalsOverlap(start, dur, new Date(i.scheduled_time).getTime(), Number(i.duration_minutes) || 30);

  for (const d of drivers) {
    if (d.status !== 'Active') continue;
    if (items.some((i) => i.driver_id === d.id && overlapsItem(i))) continue;

    let vehicle = d.assigned_vehicle || null;
    if (!vehicle) {
      const freeVehicle = vehicles.find(
        (v) => v.status === 'Active' && !items.some((i) => i.assigned_vehicle === v.vehicle_number && overlapsItem(i))
      );
      vehicle = freeVehicle?.vehicle_number || null;
    }
    return { driverId: d.id, vehicle };
  }
  return null;
}

// ── Driver safety score ─────────────────────────────────────────────────────

const SEVERITY_DEDUCTION: Record<string, number> = {
  Minor: 2, Moderate: 5, Major: 12, Critical: 25,
};

/**
 * 100 minus severity-weighted deductions for open incidents (Resolved/Closed
 * incidents deduct at half weight — they still happened).
 */
export function computeSafetyScore(incidents: { severity: string; status?: string }[]): number {
  let score = 100;
  for (const i of incidents) {
    const d = SEVERITY_DEDUCTION[i.severity] ?? 2;
    score -= i.status === 'Resolved' || i.status === 'Closed' ? d / 2 : d;
  }
  return Math.max(0, Math.round(score));
}

// ── Contractor invoice verification ─────────────────────────────────────────

export interface ContractorRate {
  rate_structure?: string | null;
  base_rate?: number | null;
  per_mile_rate?: number | null;
}

/**
 * Expected invoice amount from the contractor's rate card. Only 'Per Trip'
 * can be computed from trip count alone — other structures need details the
 * invoice doesn't carry, so they return null (manual verification).
 */
export function expectedInvoiceAmount(contractor: ContractorRate, tripCount: number): number | null {
  if (contractor.rate_structure === 'Per Trip') {
    return (Number(contractor.base_rate) || 0) * tripCount;
  }
  return null;
}
