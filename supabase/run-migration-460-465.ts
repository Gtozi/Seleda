/**
 * Apply migrations 460–465: Banquet & Events gap fixes
 *   460 — registration check-in (code, checked_in, walk-in)
 *   461 — schedule task status/priority/depends_on + readiness view
 *   462 — menu approval (item approval_status + event menu_status)
 *   463 — central equipment catalog + demand view
 *   464 — deposit schedule + interim invoices
 *   465 — alert acknowledgments + extended event_alerts view
 *
 * Run: npx tsx supabase/run-migration-460-465.ts
 */
import dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const migrations = [
  { num: '460', file: '460_registration_checkin.sql', desc: 'registration check-in columns' },
  { num: '461', file: '461_schedule_task_status.sql', desc: 'schedule task status/priority + readiness view' },
  { num: '462', file: '462_menu_approval.sql', desc: 'menu approval workflow' },
  { num: '463', file: '463_equipment_catalog.sql', desc: 'equipment catalog + demand view' },
  { num: '464', file: '464_deposit_schedule.sql', desc: 'deposit schedule + interim invoices' },
  { num: '465', file: '465_alert_acks_and_types.sql', desc: 'alert acks + extended event_alerts' },
];

async function main() {
  for (const mig of migrations) {
    const sqlPath = path.join(__dirname, 'migrations', mig.file);
    if (!fs.existsSync(sqlPath)) {
      console.error(`Migration file not found: ${sqlPath}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log(`Applying migration ${mig.num}: ${mig.desc}`);
    const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`exec_sql failed for migration ${mig.num}: ${res.status} ${text}`);
      process.exit(1);
    }
    console.log(`  ✓ Migration ${mig.num} applied successfully.`);
    console.log(`  Response: ${text.substring(0, 200)}`);
  }
  console.log('\nAll migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
