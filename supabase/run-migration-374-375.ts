/**
 * Apply migrations 374 + 375:
 *   374 — uinv_stock_ledger: add theoretical_qty + actual_qty columns
 *   375 — issue_stock_to_department RPC (transactional stock distribution)
 *
 * Run: npx tsx supabase/run-migration-374-375.ts
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
  { num: '374', file: '374_uinv_ledger_variance_columns.sql', desc: 'uinv_stock_ledger variance columns' },
  { num: '375', file: '375_issue_stock_to_department_rpc.sql', desc: 'issue_stock_to_department RPC' },
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
