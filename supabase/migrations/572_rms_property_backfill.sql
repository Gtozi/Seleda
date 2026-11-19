-- ============================================================================
-- Migration: 572_rms_property_backfill.sql
-- ----------------------------------------------------------------------------
-- Audit item 3.4 — nullable property_id leaked seed/demo data.
--
-- Every RMS data table was seeded with property_id = NULL, so the rows were
-- invisible to property-scoped users (withProp filters them out) yet mixed
-- into unscoped queries for full-access roles. This backfills all NULL
-- property_id rows to the primary property (resolved from room_types, which
-- the rest of the seed data already uses; falls back to the first active
-- property).
--
-- Channel child rows inherit their parent channel's property first, then the
-- primary property for any remainder.
--
-- NULL property_id remains meaningful ONLY on registry tables where it is the
-- documented "global scope" sentinel (569): rms_config_settings,
-- rms_system_status, rms_reports, rms_rate_plans, rms_daily_rate_overrides and
-- the legacy rms_config. Those are deliberately untouched.
-- ============================================================================

DO $$
DECLARE
  v_prop uuid;
  t text;
  -- Channel-linked tables: inherit from the parent channel.
  channel_children text[] := ARRAY[
    'channel_room_mapping', 'channel_inventory_snapshot', 'channel_bookings',
    'channel_performance', 'channel_lead_time', 'rate_parity_monitor',
    'inventory_sync_log', 'rate_sync_log', 'webhook_log'
  ];
  -- RMS data tables (NULL = leaked seed row, not a scope sentinel).
  -- booking_sync_log / webhook_retry_queue have no channel_id, so they get a
  -- flat backfill here too.
  data_tables text[] := ARRAY[
    'booking_sync_log', 'webhook_retry_queue',
    'rms_pricing_recommendations', 'rms_demand_forecasts', 'rms_demand_factors',
    'rms_forecast_accuracy', 'rms_competitors', 'rms_corporate_accounts',
    'rms_corporate_rates', 'rms_los_rules', 'rms_los_pricing_adjustments',
    'rms_dynamic_pricing_rules', 'rms_dynamic_pricing_adjustments',
    'rms_dynamic_pricing_strategies', 'rms_seasonal_rates', 'rms_weekend_rates',
    'rms_inventory_sell_limits', 'rms_inventory_allotments',
    'rms_inventory_stop_sell', 'rms_inventory_room_types',
    'rms_displacement_formula', 'rms_displacement_scenarios',
    'rms_yield_scenarios', 'rms_yield_optimization_types', 'rms_yield_metrics',
    'rms_yield_opportunities', 'rms_market_segments', 'rms_channel_performance',
    'rms_sync_schedule', 'rms_group_inquiries', 'rms_evaluation_criteria',
    'rms_distribution_channels', 'rms_distribution_rules',
    'rms_rate_parity_issues', 'rms_noshow_predictions', 'rms_walk_partners',
    'rms_restriction_alerts', 'rms_risk_assessment', 'rms_overbooking_limits',
    'rms_wash_analysis', 'rms_cancellation_trends', 'rms_restrictions',
    'rms_packages', 'rms_promotions', 'rms_coupon_performance',
    'rms_bi_heat_map', 'rms_bi_revenue_periods', 'rms_bi_yoy_metrics',
    'rms_bi_market_trends', 'rms_bi_forecast_accuracy',
    'rms_ai_recommendations', 'rms_ai_insights', 'rms_scenarios',
    'rms_dashboard_metrics'
  ];
BEGIN
  -- Primary property = the one the existing scoped seed data points at.
  SELECT property_id INTO v_prop FROM room_types WHERE property_id IS NOT NULL LIMIT 1;
  IF v_prop IS NULL THEN
    SELECT id INTO v_prop FROM properties WHERE is_active ORDER BY created_at LIMIT 1;
  END IF;
  IF v_prop IS NULL THEN
    RAISE NOTICE 'No property found — skipping backfill';
    RETURN;
  END IF;

  FOREACH t IN ARRAY channel_children LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    -- Inherit the parent channel's property where the link exists.
    EXECUTE format(
      'UPDATE %I c SET property_id = ch.property_id
         FROM channel_connections ch
        WHERE c.channel_id = ch.id AND c.property_id IS NULL', t);
    -- Any remainder gets the primary property.
    EXECUTE format('UPDATE %I SET property_id = $1 WHERE property_id IS NULL', t)
      USING v_prop;
  END LOOP;

  FOREACH t IN ARRAY data_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('UPDATE %I SET property_id = $1 WHERE property_id IS NULL', t)
      USING v_prop;
  END LOOP;
END $$;
