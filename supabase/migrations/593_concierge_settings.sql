-- Migration 593: Concierge portal settings store
--
-- Backs /erp/concierge/configuration. Mirrors the spa_settings pattern:
-- keyed settings rows (id = 'section.slug') with a jsonb `value` payload
-- and a Configured / Not Configured status. Edited via
-- /api/concierge/settings endpoints.

CREATE TABLE IF NOT EXISTS concierge_settings (
  id          text PRIMARY KEY,
  section     text NOT NULL CHECK (section IN ('requests','notifications','hours','vendors','service')),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  value       jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'Configured' CHECK (status IN ('Configured','Not Configured')),
  property_id uuid REFERENCES properties(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO concierge_settings (id, section, name, description, value, status) VALUES
-- ── Request Management ──────────────────────────────────────────────
('requests.auto-assign',        'requests', 'Auto-assign Requests',        'Automatically assign new requests to available concierge staff',        '{"enabled": true}'::jsonb,            'Configured'),
('requests.default-priority',   'requests', 'Default Priority',            'Priority applied to new requests when none is specified',               '{"value": "Normal"}'::jsonb,         'Configured'),
('requests.response-target',    'requests', 'Response Time Target',        'Minutes to acknowledge a new request before it is flagged overdue',     '{"minutes": 15}'::jsonb,            'Configured'),
('requests.escalation-threshold','requests','Escalation Threshold',        'Minutes an open request may sit idle before escalating to the duty manager', '{"minutes": 45}'::jsonb,     'Configured'),

-- ── Notifications ───────────────────────────────────────────────────
('notifications.enable-alerts', 'notifications', 'Enable Notifications',   'Receive alerts for new requests and status updates',                    '{"enabled": true}'::jsonb,            'Configured'),
('notifications.auto-reply',    'notifications', 'Auto-reply to Guests',   'Send automatic confirmations for common requests',                      '{"enabled": false}'::jsonb,           'Configured'),
('notifications.daily-digest',  'notifications', 'Daily Digest',           'Morning summary of pending requests delivered to the concierge desk',   '{"enabled": true, "time": "07:00"}'::jsonb, 'Configured'),

-- ── Working Hours ───────────────────────────────────────────────────
('hours.desk-hours',            'hours', 'Concierge Desk Hours',           'Staffed hours for the concierge desk; overnight requests route to duty manager', '{"start": "06:00", "end": "23:00"}'::jsonb, 'Configured'),
('hours.wakeup-window',         'hours', 'Wake-up Call Window',            'Earliest and latest times wake-up calls may be scheduled',              '{"start": "04:00", "end": "10:00"}'::jsonb, 'Configured'),

-- ── Vendor Settings ─────────────────────────────────────────────────
('vendors.min-rating',          'vendors', 'Minimum Vendor Rating',        'Vendors below this rating are flagged for review',                      '{"rating": 4.0}'::jsonb,            'Configured'),
('vendors.require-approval',    'vendors', 'Require Approval for New Vendors', 'New vendor bookings need duty manager sign-off before confirming to the guest', '{"enabled": false}'::jsonb, 'Not Configured'),

-- ── Service Settings ────────────────────────────────────────────────
('service.auto-post-charges',   'service', 'Auto-post Charges to Folio',   'Post concierge service charges to the guest folio on completion',       '{"enabled": true}'::jsonb,            'Configured'),
('service.feedback-prompt',     'service', 'Guest Feedback Prompt',        'Ask guests to rate completed concierge services',                       '{"enabled": true}'::jsonb,            'Configured')
ON CONFLICT (id) DO NOTHING;
