/**
 * Backup worker — processes backup_jobs rows asynchronously.
 *
 * - schema_only : uploads the live PostgREST schema spec as schema.json
 * - full / incremental : exports every PostgREST relation to per-table JSON
 *   files under backups/<jobId>/ in the `backups` storage bucket, plus a
 *   manifest.json summarizing row counts and sizes.
 *
 * Jobs are picked up by startBackupWorker() (interval scan) and also kicked
 * immediately after creation via processBackupJob().
 */

import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

const BUCKET = 'backups';
const PAGE = 1000;
const MAX_ROWS_PER_TABLE = 100_000;
const WORKER_INTERVAL_MS = 60_000;

let bucketReady = false;
let workerStarted = false;

const supabaseUrl = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function ensureBucket() {
  if (bucketReady || !supabaseAdmin) return;
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketReady = true;
}

export async function listPublicRelations(): Promise<string[]> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) throw new Error(`Schema spec request failed (${res.status})`);
  const spec = await res.json();
  return Object.keys(spec.paths || {})
    .filter(p => !p.startsWith('/rpc/'))
    .map(p => decodeURIComponent(p.slice(1)))
    .filter(Boolean);
}

async function fetchSchemaSpec(): Promise<any> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) throw new Error(`Schema spec request failed (${res.status})`);
  return res.json();
}

async function uploadJson(path: string, payload: any): Promise<number> {
  const body = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body).length;
  const { error } = await supabaseAdmin!.storage
    .from(BUCKET)
    .upload(path, new Blob([body], { type: 'application/json' }), { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`Storage upload failed (${path}): ${error.message}`);
  return bytes;
}

async function setJob(jobId: string, patch: Record<string, any>) {
  await supabaseAdmin!.from('backup_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
}

async function exportRelation(name: string): Promise<{ rows: any[]; bytes: number; error?: string }> {
  const rows: any[] = [];
  let offset = 0;
  try {
    for (;;) {
      const { data, error } = await supabaseAdmin!.from(name).select('*').range(offset, offset + PAGE - 1);
      if (error) return { rows, bytes: 0, error: error.message };
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE || rows.length >= MAX_ROWS_PER_TABLE) break;
      offset += PAGE;
    }
  } catch (e: any) {
    return { rows, bytes: 0, error: e?.message || 'export failed' };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
  return { rows, bytes };
}

export async function processBackupJob(jobId: string): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;
  await setJob(jobId, { status: 'running' });
  try {
    await ensureBucket();
    const { data: job } = await supabaseAdmin.from('backup_jobs').select('backup_type').eq('id', jobId).single();
    const backupType = job?.backup_type || 'full';
    const prefix = `${jobId}/`;
    const manifest: any = {
      jobId,
      backupType,
      generatedAt: new Date().toISOString(),
      storageBucket: BUCKET,
      tables: {},
      errors: {},
      totalRows: 0,
      totalBytes: 0,
    };
    let totalBytes = 0;

    if (backupType === 'schema_only') {
      const spec = await fetchSchemaSpec();
      totalBytes += await uploadJson(`${prefix}schema.json`, spec);
      manifest.tables['__schema__'] = { rows: 1, bytes: totalBytes };
    } else {
      const relations = await listPublicRelations();
      for (const name of relations) {
        const { rows, error } = await exportRelation(name);
        if (error) {
          manifest.errors[name] = error;
          continue;
        }
        const fileBytes = await uploadJson(`${prefix}tables/${name}.json`, rows);
        manifest.tables[name] = { rows: rows.length, bytes: fileBytes };
        manifest.totalRows += rows.length;
        totalBytes += fileBytes;
      }
    }

    manifest.totalBytes = totalBytes;
    await uploadJson(`${prefix}manifest.json`, manifest);

    await supabaseAdmin.from('backup_jobs').update({
      status: 'completed',
      backup_size_bytes: totalBytes,
      storage_location: BUCKET,
      storage_path: prefix,
      completed_at: new Date().toISOString(),
      error_message: Object.keys(manifest.errors).length
        ? `${Object.keys(manifest.errors).length} relation(s) skipped: ${Object.entries(manifest.errors).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')}`
        : null,
    }).eq('id', jobId);
    console.log(`[BackupWorker] job ${jobId} completed — ${manifest.totalRows} rows, ${totalBytes} bytes, ${Object.keys(manifest.errors).length} errors`);
  } catch (err: any) {
    console.error(`[BackupWorker] job ${jobId} failed:`, err?.message);
    await supabaseAdmin!.from('backup_jobs').update({
      status: 'failed',
      error_message: err?.message || 'Backup failed',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

async function scanPendingJobs() {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return;
  const { data } = await supabaseAdmin
    .from('backup_jobs')
    .select('id')
    .eq('status', 'pending')
    .order('initiated_at', { ascending: true })
    .limit(1);
  const job = data?.[0];
  if (job) {
    console.log(`[BackupWorker] processing pending job ${job.id}`);
    await processBackupJob(job.id);
  }
}

export function startBackupWorker() {
  if (workerStarted || !hasSupabaseAdminConfig) return;
  workerStarted = true;
  setInterval(() => {
    scanPendingJobs().catch(e => console.error('[BackupWorker] scan error:', e?.message));
  }, WORKER_INTERVAL_MS).unref?.();
  scanPendingJobs().catch(() => {});
  console.log('[BackupWorker] started — scans for pending backup jobs every 60s');
}
