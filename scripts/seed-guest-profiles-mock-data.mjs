import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const guestProfiles = [
  {
    id: 'GST-MOCK-001',
    name: 'Aster Demissie',
    email: 'aster.demissie@example.com',
    phone: '+251 911 111 111',
    status: 'Loyalty Member',
    loyalty_points: 1500,
    total_spend: 3500,
    nationality: 'Ethiopian',
    special_requests: 'Allergic to feather pillows',
    notes: 'Repeat business guest, prefers city view and high floor',
    preferences: {
      language: 'English',
      roomType: 'Deluxe',
      bedType: 'Queen',
      pillowType: 'Soft',
      dietary: 'Vegetarian',
      newspaper: 'None',
      amenities: ['WiFi', 'City View'],
    },
    identification_doc: { type: 'Passport', number: 'PP-001', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-002',
    name: 'Bereket Solomon',
    email: 'bereket.solomon@example.com',
    phone: '+251 911 222 222',
    status: 'VIP',
    loyalty_points: 12000,
    total_spend: 25000,
    nationality: 'Ethiopian',
    special_requests: 'Late checkout requested whenever available',
    notes: 'High-value guest, frequent suite upgrades, wine enthusiast',
    preferences: {
      language: 'English',
      roomType: 'Suite',
      bedType: 'King',
      pillowType: 'Firm',
      dietary: 'None',
      newspaper: 'English',
      amenities: ['Spa', 'Late Checkout', 'Butler Service'],
    },
    identification_doc: { type: 'Passport', number: 'PP-002', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-003',
    name: 'Hiwot Girma',
    email: 'hiwot.girma@example.com',
    phone: '+251 911 333 333',
    status: 'Regular',
    loyalty_points: 0,
    total_spend: 0,
    nationality: 'Ethiopian',
    special_requests: '',
    notes: 'First-time guest, business traveler',
    preferences: {
      language: 'English',
      roomType: 'Standard',
      bedType: 'Queen',
      pillowType: 'Medium',
      dietary: 'None',
      newspaper: 'None',
      amenities: ['WiFi'],
    },
    identification_doc: { type: 'Passport', number: 'PP-003', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-004',
    name: 'Dawit Hailu',
    email: 'dawit.hailu@example.com',
    phone: '+251 911 444 444',
    status: 'Loyalty Member',
    loyalty_points: 3000,
    total_spend: 7200,
    nationality: 'Ethiopian',
    special_requests: 'Halal meals only',
    notes: 'Travels with family, prefers connecting rooms',
    preferences: {
      language: 'English',
      roomType: 'Deluxe',
      bedType: 'Twin',
      pillowType: 'Medium',
      dietary: 'Halal',
      newspaper: 'None',
      amenities: ['WiFi', 'Connecting Room'],
    },
    identification_doc: { type: 'Passport', number: 'PP-004', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-005',
    name: 'Liya Tesfaye',
    email: 'liya.tesfaye@example.com',
    phone: '+251 911 555 555',
    status: 'VIP',
    loyalty_points: 6000,
    total_spend: 15000,
    nationality: 'Ethiopian',
    special_requests: 'Gluten-free dining options',
    notes: 'Anniversary stay guest, enjoys spa and fine dining',
    preferences: {
      language: 'English',
      roomType: 'Suite',
      bedType: 'Queen',
      pillowType: 'Soft',
      dietary: 'Gluten-Free',
      newspaper: 'English',
      amenities: ['Spa', 'Late Checkout'],
    },
    identification_doc: { type: 'Passport', number: 'PP-005', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-006',
    name: 'Yared Tadesse',
    email: 'yared.tadesse@example.com',
    phone: '+251 911 666 666',
    status: 'Regular',
    loyalty_points: 500,
    total_spend: 800,
    nationality: 'Ethiopian',
    special_requests: '',
    notes: 'Budget-conscious leisure traveler',
    preferences: {
      language: 'English',
      roomType: 'Standard',
      bedType: 'Queen',
      pillowType: 'Medium',
      dietary: 'None',
      newspaper: 'None',
      amenities: ['WiFi'],
    },
    identification_doc: { type: 'Passport', number: 'PP-006', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-007',
    name: 'Mekdes Araya',
    email: 'mekdes.araya@example.com',
    phone: '+251 911 777 777',
    status: 'Loyalty Member',
    loyalty_points: 2500,
    total_spend: 5200,
    nationality: 'Ethiopian',
    special_requests: 'Vegan menu for all meals',
    notes: 'Health-conscious guest, early riser, gym user',
    preferences: {
      language: 'English',
      roomType: 'Deluxe',
      bedType: 'King',
      pillowType: 'Firm',
      dietary: 'Vegan',
      newspaper: 'None',
      amenities: ['Gym', 'Pool'],
    },
    identification_doc: { type: 'Passport', number: 'PP-007', issuingCountry: 'Ethiopia' },
  },
  {
    id: 'GST-MOCK-008',
    name: 'Kalkidan Fikru',
    email: 'kalkidan.fikru@example.com',
    phone: '+251 911 888 888',
    status: 'Regular',
    loyalty_points: 800,
    total_spend: 1200,
    nationality: 'Ethiopian',
    special_requests: '',
    notes: 'Conference attendee, quiet room preferred',
    preferences: {
      language: 'English',
      roomType: 'Standard',
      bedType: 'Queen',
      pillowType: 'Medium',
      dietary: 'None',
      newspaper: 'None',
      amenities: ['WiFi'],
    },
    identification_doc: { type: 'Passport', number: 'PP-008', issuingCountry: 'Ethiopia' },
  },
];

async function seed() {
  console.log('Upserting guest profile mock data...');
  const { error } = await supabase.from('guests').upsert(guestProfiles, { onConflict: 'id' });
  if (error) {
    console.error('Failed to upsert guest profiles:', error);
    process.exit(1);
  }

  const { count, error: countError } = await supabase.from('guests').select('*', { count: 'exact', head: true });
  if (countError) console.error('Count error:', countError);
  else console.log(`Total guests in DB: ${count}`);

  console.log('Guest profile mock data seeded successfully.');
}

seed();
