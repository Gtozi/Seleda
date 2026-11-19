/**
 * Seed F&B sample outlets
 * Run: npx tsx scripts/seed-fb-outlets.ts
 */
import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

const SAMPLE_OUTLETS = [
  {
    name: 'La Maison Restaurant',
    type: 'Restaurant',
    revenue_center_code: 'FB-001',
    is_active: true,
    operating_hours: {
      monday: { open: '06:30', close: '22:30' },
      tuesday: { open: '06:30', close: '22:30' },
      wednesday: { open: '06:30', close: '22:30' },
      thursday: { open: '06:30', close: '22:30' },
      friday: { open: '06:30', close: '23:00' },
      saturday: { open: '07:00', close: '23:00' },
      sunday: { open: '07:00', close: '22:00' },
    }
  },
  {
    name: 'Sky Lounge Bar',
    type: 'Bar',
    revenue_center_code: 'FB-002',
    is_active: true,
    operating_hours: {
      monday: { open: '17:00', close: '00:00' },
      tuesday: { open: '17:00', close: '00:00' },
      wednesday: { open: '17:00', close: '00:00' },
      thursday: { open: '17:00', close: '00:00' },
      friday: { open: '16:00', close: '02:00' },
      saturday: { open: '16:00', close: '02:00' },
      sunday: { open: '17:00', close: '00:00' },
    }
  },
  {
    name: 'Room Service',
    type: 'RoomService',
    revenue_center_code: 'FB-003',
    is_active: true,
    operating_hours: {
      monday: { open: '00:00', close: '23:59' },
      tuesday: { open: '00:00', close: '23:59' },
      wednesday: { open: '00:00', close: '23:59' },
      thursday: { open: '00:00', close: '23:59' },
      friday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    }
  },
  {
    name: 'Grand Ballroom Banquet',
    type: 'Banquet',
    revenue_center_code: 'FB-004',
    is_active: true,
    operating_hours: {
      monday: { open: '08:00', close: '22:00' },
      tuesday: { open: '08:00', close: '22:00' },
      wednesday: { open: '08:00', close: '22:00' },
      thursday: { open: '08:00', close: '22:00' },
      friday: { open: '08:00', close: '23:00' },
      saturday: { open: '08:00', close: '23:00' },
      sunday: { open: '08:00', close: '22:00' },
    }
  },
  {
    name: 'Minibar',
    type: 'Minibar',
    revenue_center_code: 'FB-005',
    is_active: true,
    operating_hours: {
      monday: { open: '00:00', close: '23:59' },
      tuesday: { open: '00:00', close: '23:59' },
      wednesday: { open: '00:00', close: '23:59' },
      thursday: { open: '00:00', close: '23:59' },
      friday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    }
  }
];

async function seedOutlets() {
  const sampleNames = SAMPLE_OUTLETS.map(o => o.name);
  const { data: existing, error: findError } = await supabaseAdmin
    .from('outlets')
    .select('name')
    .in('name', sampleNames);

  if (findError) {
    console.error('[SEED] Failed to query existing outlets:', findError.message);
    process.exit(1);
  }

  const existingNames = new Set(existing?.map(o => o.name) || []);
  const toInsert = SAMPLE_OUTLETS.filter(o => !existingNames.has(o.name));

  if (toInsert.length === 0) {
    console.log('[SEED] All sample outlets already exist. No inserts.');
    return;
  }

  const { data, error } = await supabaseAdmin.from('outlets').insert(toInsert).select();

  if (error) {
    console.error('[SEED] Failed to insert outlets:', error.message);
    process.exit(1);
  }

  console.log(`[SEED] Inserted ${data?.length} sample outlet(s):`);
  for (const o of data || []) {
    console.log(`  - ${o.name} (${o.type})`);
  }
}

seedOutlets().catch(err => {
  console.error('[SEED] Unexpected error:', err);
  process.exit(1);
});
