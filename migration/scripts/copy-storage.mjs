#!/usr/bin/env node
/**
 * Copies every Storage object from the OLD Supabase project to the NEW
 * self-hosted Supabase Storage API.
 *
 * Run from the repo root (uses the project's @supabase/supabase-js):
 *
 *   OLD_SUPABASE_URL=https://<old-ref>.supabase.co \
 *   OLD_SERVICE_ROLE_KEY=<old service key> \
 *   NEW_SUPABASE_URL=https://<new-api-domain> \
 *   NEW_SERVICE_ROLE_KEY=<new service key> \
 *   node migration/scripts/copy-storage.mjs
 *
 * Env-var alternative: create migration/scripts/.storage-env (gitignored)
 * with the four vars above.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '.storage-env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY } =
  process.env;

for (const [k, v] of Object.entries({
  OLD_SUPABASE_URL,
  OLD_SERVICE_ROLE_KEY,
  NEW_SUPABASE_URL,
  NEW_SERVICE_ROLE_KEY,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

const oldClient = createClient(OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const newClient = createClient(NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 1000;
let totalCopied = 0;
let totalFailed = 0;

async function listAll(storage, bucket) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await storage.from(bucket).list('', {
      limit: PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Recursively collect file paths (storage list is per-directory)
async function collectFiles(storage, bucket, prefix = '') {
  const files = [];
  const items = await listAll(storage, bucket).catch(() => null);
  // NOTE: list() only lists one "folder" level; walk prefixes instead.
  void items;
  const walk = async (dir) => {
    const { data, error } = await storage.from(bucket).list(dir, {
      limit: PAGE,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${dir}: ${error.message}`);
    if (!data || data.length === 0) return;
    for (const item of data) {
      const path = dir ? `${dir}/${item.name}` : item.name;
      // Folders have no id; files do.
      if (item.id === null) await walk(path);
      else files.push({ name: path, metadata: item.metadata || {} });
    }
  };
  await walk(prefix);
  return files;
}

const { data: buckets, error: bucketErr } = await oldClient.storage.listBuckets();
if (bucketErr) throw new Error(`listBuckets: ${bucketErr.message}`);
console.log(`Found ${buckets.length} bucket(s): ${buckets.map((b) => b.name).join(', ')}`);

for (const bucket of buckets) {
  // Recreate bucket on target (public flag + size limit preserved)
  const { error: createErr } = await newClient.storage.createBucket(bucket.name, {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit || undefined,
    allowedMimeTypes: bucket.allowed_mime_types || undefined,
  });
  if (createErr && !/already exists|duplicate/i.test(createErr.message)) {
    console.warn(`  ! bucket ${bucket.name}: ${createErr.message}`);
  }

  const files = await collectFiles(oldClient.storage, bucket.name);
  console.log(`  ${bucket.name}: ${files.length} object(s)`);

  for (const file of files) {
    const { data: blob, error: dlErr } = await oldClient.storage
      .from(bucket.name)
      .download(file.name);
    if (dlErr) {
      console.warn(`    ! download ${file.name}: ${dlErr.message}`);
      totalFailed++;
      continue;
    }
    const { error: upErr } = await newClient.storage
      .from(bucket.name)
      .upload(file.name, blob, {
        contentType: file.metadata.mimetype || blob.type || 'application/octet-stream',
        upsert: true,
      });
    if (upErr) {
      console.warn(`    ! upload ${file.name}: ${upErr.message}`);
      totalFailed++;
      continue;
    }
    totalCopied++;
    if (totalCopied % 100 === 0) console.log(`    ... ${totalCopied} copied`);
  }
}

console.log(`\nDone. Copied: ${totalCopied}, Failed: ${totalFailed}`);
if (totalFailed > 0) process.exitCode = 2;
