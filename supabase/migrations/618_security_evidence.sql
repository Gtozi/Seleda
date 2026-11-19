-- ============================================================================
-- 618_security_evidence.sql — Evidence Management
-- Backs /erp/security/evidence (EvidenceManagement.tsx).
--
--   sec_evidence          — evidence item register: type (Photo/Video/
--                           Document/Physical Item/Digital File/Audio/Other),
--                           storage location, collector, source, nullable
--                           links to sec_incidents + sec_investigations +
--                           sec_fraud_cases (all SET NULL), lifecycle
--                           Collected → Secured → In Analysis →
--                           Released | Archived.
--   sec_evidence_custody  — real chain-of-custody log (Collected/Logged/
--                           Transferred/Analysis Started/Analysis Complete/
--                           Released/Archived/Note), CASCADE on evidence
--                           delete. Recipient + location + note per entry.
--
-- Chain-of-custody entries are written both by the routes (auto-entries on
-- create/status change) and manually via POST /:id/custody.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sec_evidence (
  id               TEXT PRIMARY KEY,
  property_id      UUID,
  title            TEXT NOT NULL,
  evidence_type    TEXT NOT NULL DEFAULT 'Other' CHECK (evidence_type IN (
                     'Photo', 'Video', 'Document', 'Physical Item',
                     'Digital File', 'Audio', 'Other'
                   )),
  status           TEXT NOT NULL DEFAULT 'Collected' CHECK (status IN (
                     'Collected', 'Secured', 'In Analysis', 'Released', 'Archived'
                   )),
  description      TEXT,
  location         TEXT,          -- where the item was found/collected
  storage_location TEXT,          -- locker / drive path / evidence room
  collected_by     TEXT,
  collected_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  source           TEXT,          -- e.g. 'CCTV CAM-003', 'Guest statement', 'POS export'
  incident_id      TEXT REFERENCES public.sec_incidents(id) ON DELETE SET NULL,
  investigation_id TEXT REFERENCES public.sec_investigations(id) ON DELETE SET NULL,
  case_id          TEXT REFERENCES public.sec_fraud_cases(id) ON DELETE SET NULL,
  released_to      TEXT,
  released_at      TIMESTAMP WITH TIME ZONE,
  notes            TEXT,
  created_by       TEXT,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_evidence_prop   ON public.sec_evidence(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_evidence_status ON public.sec_evidence(status);
CREATE INDEX IF NOT EXISTS idx_sec_evidence_inc    ON public.sec_evidence(incident_id);
CREATE INDEX IF NOT EXISTS idx_sec_evidence_inv    ON public.sec_evidence(investigation_id);
CREATE INDEX IF NOT EXISTS idx_sec_evidence_case   ON public.sec_evidence(case_id);

CREATE OR REPLACE FUNCTION public.update_sec_evidence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_evidence_updated_at ON public.sec_evidence;
CREATE TRIGGER trigger_sec_evidence_updated_at
  BEFORE UPDATE ON public.sec_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_evidence_timestamp();

ALTER TABLE public.sec_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_evidence TO authenticated;

CREATE TABLE IF NOT EXISTS public.sec_evidence_custody (
  id          BIGSERIAL PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES public.sec_evidence(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN (
                'Collected', 'Logged', 'Transferred', 'Analysis Started',
                'Analysis Complete', 'Released', 'Archived', 'Note'
              )),
  actor       TEXT,
  recipient   TEXT,             -- who received the item (transfers/releases)
  location    TEXT,             -- where the custody event happened
  detail      TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_evidence_custody_ev ON public.sec_evidence_custody(evidence_id);

ALTER TABLE public.sec_evidence_custody ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_evidence_custody TO authenticated;

-- ── Seed: evidence register ──────────────────────────────────────────────
INSERT INTO public.sec_evidence
  (id, property_id, title, evidence_type, status, description, location,
   storage_location, collected_by, collected_at, source,
   incident_id, investigation_id, case_id, released_to, released_at, notes)
VALUES
  ('EVD-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Lobby CCTV clip — altercation',
   'Video', 'In Analysis',
   '4-minute export covering the lobby altercation, two camera angles (CAM-001, CAM-002).',
   'Main Lobby', 'Evidence Drive /INC-001/', 'Shift Supervisor',
   NOW() - INTERVAL '6 days', 'CCTV CAM-001/CAM-002',
   'INC-001', 'INV-001', NULL, NULL, NULL,
   'Frame-by-frame review in progress with lead investigator.'),
  ('EVD-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Terminal 3 POS refund logs',
   'Digital File', 'In Analysis',
   'POS transaction log export covering 2 weeks of Terminal 3 refund activity.',
   'Front Desk', 'Evidence Drive /FRD-001/', 'IT Administrator',
   NOW() - INTERVAL '4 days', 'POS export',
   NULL, NULL, 'FRD-001', NULL, NULL,
   'Correlates with refund-abuse case timeline.'),
  ('EVD-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest statement — Room 412 dispute',
   'Document', 'Secured',
   'Signed written statement from guest disputing in-room charges.',
   'Front Office', 'Evidence Locker B / Bin 7', 'Front Office Manager',
   NOW() - INTERVAL '2 days', 'Guest statement',
   NULL, NULL, 'FRD-002', NULL, NULL, NULL),
  ('EVD-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Broken door lock — Room 205',
   'Physical Item', 'Secured',
   'Damaged door lock mechanism removed after forced-entry attempt; photographed in situ.',
   'Room 205', 'Evidence Locker A / Bin 2', 'Security Officer T. Bekele',
   NOW() - INTERVAL '9 days', 'Physical collection',
   'INC-002', NULL, NULL, NULL, NULL,
   'Awaiting forensic locksmith assessment.'),
  ('EVD-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Radio call audio — gas leak response',
   'Audio', 'Archived',
   'Security radio channel recording during gas-leak emergency response.',
   'Security Office', 'Archive /EMG-001/', 'Security Manager',
   NOW() - INTERVAL '20 days', 'Radio recording',
   NULL, NULL, NULL, NULL, NULL,
   'Archived after post-incident review.'),
  ('EVD-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Night audit photos — minibar voids',
   'Photo', 'Collected',
   'Phone photos of minibar post-and-void folio entries taken during night audit.',
   'Night Audit Desk', NULL, 'Night Auditor',
   NOW() - INTERVAL '12 hours', 'Night audit',
   NULL, NULL, NULL, NULL, NULL,
   'Needs to be transferred to evidence drive and logged.'),
  ('EVD-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Vendor delivery logbook page',
   'Document', 'Released',
   'Photocopy of linen supplier delivery log showing quantities vs invoice.',
   'Receiving Dock', NULL, 'Receiving Clerk',
   NOW() - INTERVAL '8 days', 'Receiving log',
   NULL, 'INV-003', 'FRD-003', 'Corporate Legal',
   NOW() - INTERVAL '1 day',
   'Original retained by Legal; copy released for external counsel review.')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: chain of custody ───────────────────────────────────────────────
INSERT INTO public.sec_evidence_custody (evidence_id, action, actor, recipient, location, detail, created_at)
VALUES
  ('EVD-001', 'Collected', 'Shift Supervisor', NULL, 'Main Lobby',
   'CCTV export pulled from DVR — 2 camera angles, hash-verified.', NOW() - INTERVAL '6 days'),
  ('EVD-001', 'Logged', 'Security Manager', NULL, 'Evidence Drive',
   'Copied to evidence drive /INC-001/; write-protected.', NOW() - INTERVAL '6 days' + INTERVAL '30 minutes'),
  ('EVD-001', 'Transferred', 'Security Manager', 'Lead Investigator', 'Security Office',
   'Handed off for frame-by-frame review.', NOW() - INTERVAL '5 days'),
  ('EVD-001', 'Analysis Started', 'Lead Investigator', NULL, 'Security Office',
   'Timestamp sync across both camera angles.', NOW() - INTERVAL '4 days'),
  ('EVD-002', 'Collected', 'IT Administrator', NULL, 'Front Desk',
   'POS log export — Terminal 3, 14-day window.', NOW() - INTERVAL '4 days'),
  ('EVD-002', 'Logged', 'Security Manager', NULL, 'Evidence Drive',
   'Stored under /FRD-001/ with checksum record.', NOW() - INTERVAL '4 days' + INTERVAL '1 hour'),
  ('EVD-002', 'Analysis Started', 'Security Manager', NULL, 'Security Office',
   'Cross-referencing refunds against sale records.', NOW() - INTERVAL '3 days'),
  ('EVD-003', 'Collected', 'Front Office Manager', NULL, 'Front Office',
   'Signed guest statement received at check-out desk.', NOW() - INTERVAL '2 days'),
  ('EVD-003', 'Logged', 'Security Manager', NULL, 'Evidence Locker B',
   'Original filed in Locker B, Bin 7; scan on evidence drive.', NOW() - INTERVAL '2 days' + INTERVAL '2 hours'),
  ('EVD-004', 'Collected', 'Security Officer T. Bekele', NULL, 'Room 205',
   'Lock removed and bagged; scene photographed.', NOW() - INTERVAL '9 days'),
  ('EVD-004', 'Logged', 'Security Manager', NULL, 'Evidence Locker A',
   'Sealed in Locker A, Bin 2.', NOW() - INTERVAL '9 days' + INTERVAL '45 minutes'),
  ('EVD-005', 'Collected', 'Security Manager', NULL, 'Security Office',
   'Radio channel export for incident window.', NOW() - INTERVAL '20 days'),
  ('EVD-005', 'Analysis Complete', 'Security Manager', NULL, 'Security Office',
   'Response timeline documented for post-incident review.', NOW() - INTERVAL '18 days'),
  ('EVD-005', 'Archived', 'Security Manager', NULL, 'Archive /EMG-001/',
   'Moved to archive after review sign-off.', NOW() - INTERVAL '17 days'),
  ('EVD-006', 'Collected', 'Night Auditor', NULL, 'Night Audit Desk',
   'Photos of voided minibar postings.', NOW() - INTERVAL '12 hours'),
  ('EVD-007', 'Collected', 'Receiving Clerk', NULL, 'Receiving Dock',
   'Logbook photocopy — quantities vs invoices.', NOW() - INTERVAL '8 days'),
  ('EVD-007', 'Transferred', 'Security Manager', 'Lead Investigator', 'Security Office',
   'Added to vendor-fraud case file.', NOW() - INTERVAL '7 days'),
  ('EVD-007', 'Released', 'Security Manager', 'Corporate Legal', 'Security Office',
   'Copy released for external counsel; original retained.', NOW() - INTERVAL '1 day');
