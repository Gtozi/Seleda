import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function makeNotes({ commissionRate, totalBookings, totalRevenue, productionScore, notesText = '' }) {
  return JSON.stringify({
    commissionRate,
    totalBookings,
    totalRevenue,
    productionScore,
    notesText,
  });
}

const travelAgents = [
  {
    code: 'TA-001',
    name: 'Sunrise Travel',
    contact_name: 'Meron Tadesse',
    contact_email: 'meron@sunrisetravel.example',
    contact_phone: '+251 911 111 111',
    payment_terms: 'Net 15',
    commission_model: 'commissionable',
    credit_limit: 50000,
    is_active: true,
    notes: makeNotes({ commissionRate: 12, totalBookings: 145, totalRevenue: 285000, productionScore: 87, notesText: 'Key OTA partner for East Africa' }),
  },
  {
    code: 'TA-002',
    name: 'Horizon Tours PLC',
    contact_name: 'Dawit Hailu',
    contact_email: 'dawit@horizontours.example',
    contact_phone: '+251 911 222 222',
    payment_terms: 'Net 30',
    commission_model: 'net',
    credit_limit: 30000,
    is_active: true,
    notes: makeNotes({ commissionRate: 10, totalBookings: 98, totalRevenue: 172000, productionScore: 74, notesText: 'Reliable tour operator, strong corporate segment' }),
  },
  {
    code: 'TA-003',
    name: 'Blue Sky Agency',
    contact_name: 'Hiwot Girma',
    contact_email: 'hiwot@bluesky.example',
    contact_phone: '+251 911 333 333',
    payment_terms: 'Net 15',
    commission_model: 'commissionable',
    credit_limit: 80000,
    is_active: true,
    notes: makeNotes({ commissionRate: 15, totalBookings: 210, totalRevenue: 540000, productionScore: 92, notesText: 'Top producer, negotiates high-value packages' }),
  },
  {
    code: 'TA-004',
    name: 'Ethiopian Experience',
    contact_name: 'Yonas Bekele',
    contact_email: 'yonas@ethioexperience.example',
    contact_phone: '+251 911 444 444',
    payment_terms: 'Net 30',
    commission_model: 'net',
    credit_limit: 20000,
    is_active: true,
    notes: makeNotes({ commissionRate: 8, totalBookings: 65, totalRevenue: 98000, productionScore: 58, notesText: 'Growing boutique agency, cultural tours focus' }),
  },
  {
    code: 'TA-005',
    name: 'Global Nomads',
    contact_name: 'Sara Lemma',
    contact_email: 'sara@globalnomads.example',
    contact_phone: '+251 911 555 555',
    payment_terms: 'Net 45',
    commission_model: 'commissionable',
    credit_limit: 40000,
    is_active: false,
    notes: makeNotes({ commissionRate: 11, totalBookings: 120, totalRevenue: 215000, productionScore: 81, notesText: 'Contract under review, temporarily inactive' }),
  },
  {
    code: 'TA-006',
    name: 'Apex Travel Solutions',
    contact_name: 'Kirubel Alemu',
    contact_email: 'kirubel@apextravel.example',
    contact_phone: '+251 911 666 666',
    payment_terms: 'Net 15',
    commission_model: 'commissionable',
    credit_limit: 70000,
    is_active: true,
    notes: makeNotes({ commissionRate: 14, totalBookings: 188, totalRevenue: 410000, productionScore: 90, notesText: 'High-volume business travel specialist' }),
  },
];

async function seed() {
  console.log('Upserting travel agent mock data into tour_operators...');
  const { error } = await supabase.from('tour_operators').upsert(travelAgents, { onConflict: 'code' });
  if (error) {
    console.error('Failed to upsert travel agents:', error);
    process.exit(1);
  }

  const { count, error: countError } = await supabase.from('tour_operators').select('*', { count: 'exact', head: true });
  if (countError) console.error('Count error:', countError);
  else console.log(`Total tour_operators in DB: ${count}`);

  console.log('Travel agent mock data seeded successfully.');
}

seed();
