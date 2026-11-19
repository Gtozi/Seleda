import { describe, it, expect } from 'vitest';
import {
  competitorAverage,
  forecastByRoom,
  recommendationAdjustment,
  buildRecommendationRows,
  rateKpis,
  derivedRevenueKpis,
  revenueGrowthPct,
  meanForecastAccuracy,
  competitorFeedSource,
} from './rmsAnalytics';

// ── competitorAverage ─────────────────────────────────────────────────────

describe('competitorAverage', () => {
  it('returns null when no real rates exist', () => {
    expect(competitorAverage([])).toBeNull();
  });
  it('averages and rounds to 2 decimals', () => {
    expect(competitorAverage([100, 110, 121])).toBe(110.33);
  });
});

// ── forecastByRoom ────────────────────────────────────────────────────────

describe('forecastByRoom', () => {
  it('keeps the first row per room type', () => {
    const { byRoom } = forecastByRoom([
      { room_type: 'Suite', occupancy: 90 },
      { room_type: 'Suite', occupancy: 50 },
    ]);
    expect(byRoom.Suite.occupancy).toBe(90);
  });
  it('uses the "all" row as fallback, else a medium-demand default', () => {
    expect(forecastByRoom([{ room_type: 'all', demand: 'high' }]).fallback.demand).toBe('high');
    const { fallback } = forecastByRoom([]);
    expect(fallback).toEqual({ demand: 'medium', occupancy: 75, confidence: 70 });
  });
});

// ── recommendationAdjustment ──────────────────────────────────────────────

describe('recommendationAdjustment', () => {
  it('raises 5% on high demand', () => {
    expect(recommendationAdjustment({ demand: 'high', occupancy: 92 }, 200).factor).toBe(0.05);
  });
  it('drops 3% on low demand', () => {
    expect(recommendationAdjustment({ demand: 'low', occupancy: 40 }, 200).factor).toBe(-0.03);
  });
  it('holds on stable/medium demand', () => {
    expect(recommendationAdjustment({ demand: 'medium', occupancy: 75 }, 200).factor).toBe(0);
  });
  it('annotates reason with competitor avg when present', () => {
    expect(recommendationAdjustment({ demand: 'high', occupancy: 92 }, 185).reason).toContain('competitor avg 185');
  });
  it('annotates reason with "no live competitor data" when compAvg is null', () => {
    expect(recommendationAdjustment({ demand: 'low', occupancy: 40 }, null).reason).toContain('no live competitor data');
  });
});

// ── buildRecommendationRows ───────────────────────────────────────────────

describe('buildRecommendationRows', () => {
  const types = [
    { id: 'rt_single', name: 'Single', base_price: 100 },
    { id: 'rt_suite', name: 'Suite', base_price: 200 },
  ];

  it('produces one row per room type keyed to real room type ids', () => {
    const rows = buildRecommendationRows(types, [], {}, { today: '2026-01-15', propertyId: 'prop-1' });
    expect(rows).toHaveLength(2);
    expect(rows[0].room_type_id).toBe('rt_single');
    expect(rows[0].property_id).toBe('prop-1');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].recommendation_date).toBe('2026-01-15');
  });

  it('applies the high-demand factor to the matched room type only', () => {
    const rows = buildRecommendationRows(types, [{ room_type: 'Suite', demand: 'high', occupancy: 95, confidence: 88 }], {}, { today: '2026-01-15' });
    const single = rows.find(r => r.room_type === 'Single')!;
    const suite = rows.find(r => r.room_type === 'Suite')!;
    expect(suite.recommended_rate).toBe(210); // 200 * 1.05
    expect(single.recommended_rate).toBe(100); // fallback medium demand → 0
  });

  it('records competitor_avg only for room types with real rates', () => {
    const rows = buildRecommendationRows(types, [], { Suite: [180, 200] }, { today: '2026-01-15' });
    expect(rows.find(r => r.room_type === 'Suite')!.competitor_avg).toBe(190);
    expect(rows.find(r => r.room_type === 'Single')!.competitor_avg).toBeNull();
  });

  it('rounds recommended_rate to 2 decimals', () => {
    const rows = buildRecommendationRows(
      [{ id: 'rt_x', name: 'X', base_price: 99.99 }],
      [{ room_type: 'X', demand: 'low', occupancy: 30 }],
      {},
      { today: '2026-01-15' },
    );
    expect(rows[0].recommended_rate).toBe(96.99); // 99.99 * 0.97
  });
});

// ── rateKpis ──────────────────────────────────────────────────────────────

describe('rateKpis', () => {
  it('derives occupancy, ADR, RevPAR from totals', () => {
    expect(rateKpis({ totalRooms: 100, totalSold: 75, roomRevenue: 15000 })).toEqual({
      occupancyRate: 75, adr: 200, revpar: 150,
    });
  });
  it('is zero-safe', () => {
    expect(rateKpis({ totalRooms: 0, totalSold: 0, roomRevenue: 0 })).toEqual({ occupancyRate: 0, adr: 0, revpar: 0 });
    expect(rateKpis({ totalRooms: 10, totalSold: 0, roomRevenue: 500 })).toEqual({ occupancyRate: 0, adr: 0, revpar: 50 });
  });
});

// ── derivedRevenueKpis ────────────────────────────────────────────────────

describe('derivedRevenueKpis', () => {
  it('applies configured metric ratios', () => {
    const k = derivedRevenueKpis({
      adr: 200, revpar: 150, totalSold: 75, roomRevenue: 15000,
      metrics: { goppar_ratio: 0.4, revenue_per_guest_factor: 2, ancillary_ratio: 0.2, forecast_revenue_factor: 1.1 },
    });
    expect(k.goppar).toBe(60);            // 150 * 0.4
    expect(k.revenuePerGuest).toBe(400);  // 200 * 2
    expect(k.totalRevenue).toBe(18000);   // 15000 * 1.2
    expect(k.forecastRevenue).toBe(19800);// 18000 * 1.1
  });
  it('uses route fallback ratios when metrics are absent', () => {
    const k = derivedRevenueKpis({ adr: 100, revpar: 80, totalSold: 10, roomRevenue: 1000, metrics: {} });
    expect(k.goppar).toBe(28);            // 80 * 0.35
    expect(k.revenuePerGuest).toBe(150);  // 100 * 1.5
    expect(k.totalRevenue).toBe(1250);    // 1000 * 1.25
    expect(k.forecastRevenue).toBe(1400); // 1250 * 1.12
  });
  it('revenuePerGuest is 0 when nothing sold', () => {
    expect(derivedRevenueKpis({ adr: 0, revpar: 0, totalSold: 0, roomRevenue: 0, metrics: {} }).revenuePerGuest).toBe(0);
  });
});

// ── revenueGrowthPct / meanForecastAccuracy ───────────────────────────────

describe('revenueGrowthPct', () => {
  it('computes percent growth', () => {
    expect(revenueGrowthPct(11000, 10000)).toBe(10);
    expect(revenueGrowthPct(9000, 10000)).toBe(-10);
  });
  it('returns 0 when not computable', () => {
    expect(revenueGrowthPct(100, 0)).toBe(0);
    expect(revenueGrowthPct(null, 100)).toBe(0);
    expect(revenueGrowthPct(100, undefined)).toBe(0);
  });
});

describe('meanForecastAccuracy', () => {
  it('means and rounds', () => {
    expect(meanForecastAccuracy([80, 90, 85])).toBe(85);
  });
  it('returns 0 when empty', () => {
    expect(meanForecastAccuracy([])).toBe(0);
  });
});

// ── competitorFeedSource ──────────────────────────────────────────────────

describe('competitorFeedSource', () => {
  it('labels feed-configured competitors', () => {
    expect(competitorFeedSource({ feed_config: { endpoint: 'https://x' } })).toBe('feed');
  });
  it('labels simulated competitors', () => {
    expect(competitorFeedSource({ feed_config: { mode: 'simulated' } })).toBe('simulated');
  });
  it('labels everything else as snapshot', () => {
    expect(competitorFeedSource({ feed_config: {} })).toBe('snapshot');
    expect(competitorFeedSource({})).toBe('snapshot');
  });
});
