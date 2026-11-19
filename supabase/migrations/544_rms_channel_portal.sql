-- RMS Channel Manager portal integration.
-- Reuses the channel manager schema created by migration 126.

CREATE INDEX IF NOT EXISTS idx_channel_room_mapping_channel_active
  ON channel_room_mapping(channel_id, active);
CREATE INDEX IF NOT EXISTS idx_inventory_sync_log_channel_started
  ON inventory_sync_log(channel_id, sync_start DESC);

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_room_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin write access to channel_connections" ON channel_connections;
DROP POLICY IF EXISTS rms_channel_connections_write ON channel_connections;
CREATE POLICY rms_channel_connections_write ON channel_connections
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_channel_mapping_read ON channel_room_mapping;
CREATE POLICY rms_channel_mapping_read ON channel_room_mapping
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_channel_mapping_write ON channel_room_mapping;
CREATE POLICY rms_channel_mapping_write ON channel_room_mapping
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_channel_sync_read ON inventory_sync_log;
CREATE POLICY rms_channel_sync_read ON inventory_sync_log
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_channel_sync_write ON inventory_sync_log;
CREATE POLICY rms_channel_sync_write ON inventory_sync_log
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

INSERT INTO channel_connections (
  channel_name, channel_code, channel_type, api_endpoint, api_version, credentials,
  sync_interval_minutes, last_sync_at, last_sync_status, last_sync_error,
  rate_parity_enabled, rate_parity_threshold, inventory_sync_enabled,
  booking_sync_enabled, active, test_mode, settings
) VALUES
  ('Booking.com','BOOKINGCOM','ota','https://supply-xml.booking.com/hotel-v3','3.0','{}',30,'2026-07-19T11:00:00Z','success',NULL,true,5,true,true,true,false,'{}'),
  ('Expedia','EXPEDIA','ota','https://services.expediapartnercentral.com','2.0','{}',60,'2026-07-19T10:30:00Z','success',NULL,true,5,true,true,true,false,'{}'),
  ('Airbnb','AIRBNB','ota','https://api.airbnb.com/v2','2.0','{}',120,'2026-07-19T09:00:00Z','failed','API rate limit exceeded',true,10,true,true,true,false,'{}'),
  ('Amadeus','AMADEUS','gds','https://webservices.amadeus.com','1.0','{}',180,'2026-07-19T08:00:00Z','success',NULL,true,3,true,true,true,true,'{}')
ON CONFLICT (channel_code) DO UPDATE SET
  last_sync_at = EXCLUDED.last_sync_at,
  last_sync_status = EXCLUDED.last_sync_status,
  last_sync_error = EXCLUDED.last_sync_error,
  active = EXCLUDED.active,
  test_mode = EXCLUDED.test_mode,
  inventory_sync_enabled = EXCLUDED.inventory_sync_enabled,
  booking_sync_enabled = EXCLUDED.booking_sync_enabled;

INSERT INTO channel_room_mapping (
  channel_id, our_room_type_id, channel_room_code, channel_room_name,
  quality_score, rate_multiplier, inventory_multiplier, active, sync_enabled
)
SELECT c.id, v.room_type_id, v.room_code, v.room_name, v.quality, v.rate_mult, v.inv_mult, true, true
FROM (VALUES
  ('BOOKINGCOM','rt_suite','DS001','Deluxe Suite',1.00::numeric,1.00::numeric,1.00::numeric),
  ('BOOKINGCOM','rt_double','SR001','Standard Room',1.00::numeric,1.00::numeric,1.00::numeric),
  ('EXPEDIA','rt_suite','DLX','Deluxe',0.95::numeric,1.05::numeric,1.00::numeric),
  ('AIRBNB','rt_penthouse','OV001','Ocean View Suite',0.90::numeric,1.10::numeric,0.95::numeric)
) AS v(channel_code, room_type_id, room_code, room_name, quality, rate_mult, inv_mult)
JOIN channel_connections c ON c.channel_code = v.channel_code
ON CONFLICT (channel_id, our_room_type_id) DO UPDATE SET
  channel_room_code = EXCLUDED.channel_room_code,
  channel_room_name = EXCLUDED.channel_room_name,
  quality_score = EXCLUDED.quality_score,
  rate_multiplier = EXCLUDED.rate_multiplier,
  inventory_multiplier = EXCLUDED.inventory_multiplier,
  active = true,
  sync_enabled = true;

INSERT INTO inventory_sync_log (
  channel_id, sync_type, sync_start, sync_end, records_processed,
  records_successful, records_failed, status, error_summary, trigger_type
)
SELECT c.id, v.sync_type, v.started_at, v.finished_at, v.processed,
       v.succeeded, v.failed, v.status, v.error_summary, 'manual'
FROM (VALUES
  ('BOOKINGCOM','full','2026-07-19T11:00:00Z'::timestamptz,'2026-07-19T11:00:02.3Z'::timestamptz,45,45,0,'success',NULL::jsonb),
  ('EXPEDIA','full','2026-07-19T10:30:00Z'::timestamptz,'2026-07-19T10:30:03.1Z'::timestamptz,38,38,0,'success',NULL::jsonb),
  ('AIRBNB','full','2026-07-19T09:00:00Z'::timestamptz,'2026-07-19T09:00:05.2Z'::timestamptz,0,0,1,'failed','{"message":"API rate limit exceeded"}'::jsonb)
) AS v(channel_code, sync_type, started_at, finished_at, processed, succeeded, failed, status, error_summary)
JOIN channel_connections c ON c.channel_code = v.channel_code
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_sync_log l
  WHERE l.channel_id = c.id AND l.sync_start = v.started_at
);
