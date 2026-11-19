/**
 * RMS analytics — pure computation extracted from rmsPortal.routes.ts so the
 * pricing-recommendation generator and dashboard KPI aggregation are unit
 * testable (audit 4.4). No I/O here: callers fetch rows and pass them in.
 */

export interface DemandForecastRow {
  room_type: string;
  occupancy?: number | null;
  demand?: string | null;
  confidence?: number | null;
}

export interface RoomTypeLike {
  id: string;
  name: string;
  base_price?: number | null;
}

export interface RecommendationInsert {
  property_id: string | null;
  room_type_id: string;
  room_type: string;
  recommendation_date: string;
  current_rate: number;
  recommended_rate: number;
  confidence: number | null;
  reason: string;
  demand_score: number | null;
  competitor_avg: number | null;
  occupancy_forecast: number | null;
  seasonality: number;
  events_impact: number;
  status: 'pending';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rounded mean of a rate set, or null when no real rates exist. */
export const competitorAverage = (rates: number[]): number | null =>
  rates.length ? round2(rates.reduce((a, c) => a + c, 0) / rates.length) : null;

/** First forecast row per room_type, plus the 'all' default row. */
export const forecastByRoom = (rows: DemandForecastRow[]) => {
  const byRoom: Record<string, DemandForecastRow> = {};
  rows.forEach((f) => { if (!(f.room_type in byRoom)) byRoom[f.room_type] = f; });
  return { byRoom, fallback: byRoom.all || { demand: 'medium', occupancy: 75, confidence: 70 } };
};

/**
 * Recommendation-rate factor for a forecast: +5% on high demand, -3% on low,
 * 0 otherwise. `reason` names the driver and notes the competitor context.
 */
export const recommendationAdjustment = (
  forecast: Pick<DemandForecastRow, 'demand' | 'occupancy'>,
  compAvg: number | null,
): { factor: number; reason: string } => {
  const compNote = compAvg == null ? 'no live competitor data' : `competitor avg ${compAvg}`;
  if (forecast.demand === 'high') {
    return { factor: 0.05, reason: `High demand forecast - ${forecast.occupancy}% occupancy (${compNote})` };
  }
  if (forecast.demand === 'low') {
    return { factor: -0.03, reason: `Low demand forecast - ${forecast.occupancy}% occupancy (${compNote})` };
  }
  return { factor: 0, reason: `Simulated AI recommendation - stable demand (${compNote})` };
};

/**
 * One insert row per room type — mirrors POST /recommendations/generate.
 * `compRatesByRoom` must already exclude non-real sources (simulated/seed).
 */
export const buildRecommendationRows = (
  roomTypes: RoomTypeLike[],
  forecastRows: DemandForecastRow[],
  compRatesByRoom: Record<string, number[]>,
  opts: { today: string; propertyId?: string | null },
): RecommendationInsert[] => {
  const { byRoom, fallback } = forecastByRoom(forecastRows);
  return roomTypes.map((p) => {
    const base = Number(p.base_price) || 0;
    const fc = byRoom[p.name] || fallback;
    const compAvg = competitorAverage(compRatesByRoom[p.name] || []);
    const { factor, reason } = recommendationAdjustment(fc, compAvg);
    return {
      property_id: opts.propertyId || null,
      room_type_id: p.id,
      room_type: p.name,
      recommendation_date: opts.today,
      current_rate: base,
      recommended_rate: round2(base * (1 + factor)),
      confidence: fc.confidence ?? null,
      reason,
      demand_score: fc.confidence ?? null,
      competitor_avg: compAvg,
      occupancy_forecast: fc.occupancy ?? null,
      seasonality: 1.0,
      events_impact: 0,
      status: 'pending',
    };
  });
};

// ── Dashboard KPI derivation ──────────────────────────────────────────────

export interface DashboardMetricRatios {
  goppar_ratio?: number;
  revenue_per_guest_factor?: number;
  ancillary_ratio?: number;
  forecast_revenue_factor?: number;
}

export interface DashboardKpis {
  occupancyRate: number;
  adr: number;
  revpar: number;
  goppar: number;
  revenuePerGuest: number;
  totalRevenue: number;
  forecastRevenue: number;
}

/**
 * Occupancy/ADR/RevPAR from room counts and revenue — used on the live-PMS
 * path of GET /dashboard. (The seed path takes ADR/RevPAR directly from BI
 * period rows instead.)
 */
export const rateKpis = (input: {
  totalRooms: number;
  totalSold: number;
  roomRevenue: number;
}): Pick<DashboardKpis, 'occupancyRate' | 'adr' | 'revpar'> => {
  const { totalRooms, totalSold, roomRevenue } = input;
  return {
    occupancyRate: totalRooms > 0 ? Math.round((totalSold / totalRooms) * 100) : 0,
    adr: totalSold > 0 ? round2(roomRevenue / totalSold) : 0,
    revpar: totalRooms > 0 ? round2(roomRevenue / totalRooms) : 0,
  };
};

/**
 * Ratio-derived revenue KPIs — applied identically on both the seed and live
 * paths. `metrics` holds configured ratios from rms_dashboard_metrics;
 * defaults match the route's fallbacks.
 */
export const derivedRevenueKpis = (input: {
  adr: number;
  revpar: number;
  totalSold: number;
  roomRevenue: number;
  metrics: DashboardMetricRatios;
}): Pick<DashboardKpis, 'goppar' | 'revenuePerGuest' | 'totalRevenue' | 'forecastRevenue'> => {
  const { adr, revpar, totalSold, roomRevenue, metrics } = input;
  const totalRevenue = Math.round(roomRevenue * (1 + (metrics.ancillary_ratio ?? 0.25)));
  return {
    goppar: Math.round(revpar * (metrics.goppar_ratio ?? 0.35)),
    revenuePerGuest: totalSold > 0 ? Math.round(adr * (metrics.revenue_per_guest_factor ?? 1.5)) : 0,
    totalRevenue,
    forecastRevenue: Math.round(totalRevenue * (metrics.forecast_revenue_factor ?? 1.12)),
  };
};

/** Percent growth between two period revenues; 0 when not computable. */
export const revenueGrowthPct = (latest: number | null | undefined, prev: number | null | undefined): number =>
  latest != null && prev != null && Number(prev) > 0
    ? Math.round(((Number(latest) - Number(prev)) / Number(prev)) * 100)
    : 0;

/** Mean accuracy across forecast-accuracy rows; 0 when empty. */
export const meanForecastAccuracy = (accuracies: number[]): number =>
  accuracies.length ? Math.round(accuracies.reduce((s, a) => s + a, 0) / accuracies.length) : 0;

/** Dashboard competitor source label — mirrors GET /dashboard. */
export const competitorFeedSource = (competitor: { feed_config?: any }): 'feed' | 'simulated' | 'snapshot' =>
  competitor?.feed_config?.endpoint ? 'feed'
    : competitor?.feed_config?.mode === 'simulated' ? 'simulated'
    : 'snapshot';
