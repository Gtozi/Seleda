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

const CUSTOMER_TYPES = [
  'Corporate Client',
  'Travel Agency',
  'Tour Operator',
  'Government',
  'Airlines',
  'Event Organizer',
  'Wedding Planner',
];

const corporateAccounts = [
  {
    id: 'mock-corp-ethiopian-airlines',
    company_name: 'Ethiopian Airlines',
    contact_person: 'Mulugeta Alemu',
    contact_email: 'mulugeta.a@ethiopianairlines.com',
    contact_phone: '+251 11 555 0101',
    discount_percent: 12,
    active_bookings: 5,
    unpaid_balance: 125000,
    credit_limit: 500000,
    credit_terms: 'Net 30',
    billing_address: 'Bole International Airport, Addis Ababa',
    tax_id: 'TIN-001',
    industry: 'Airlines',
    notes: 'Frequent corporate group bookings for crew layovers',
  },
  {
    id: 'mock-corp-sunshine-travel',
    company_name: 'Sunshine Travel Agency',
    contact_person: 'Abebe Kebede',
    contact_email: 'abebe@sunshinetravel.et',
    contact_phone: '+251 911 222 333',
    discount_percent: 8,
    active_bookings: 3,
    unpaid_balance: 45000,
    credit_limit: 200000,
    credit_terms: 'Net 15',
    billing_address: 'Bole Subcity, Addis Ababa',
    tax_id: 'TIN-002',
    industry: 'Travel Agency',
    notes: 'High FIT and group travel volume',
  },
  {
    id: 'mock-corp-horizon-tours',
    company_name: 'Horizon Tours PLC',
    contact_person: 'Tigist Haile',
    contact_email: 'tigist@horizontours.et',
    contact_phone: '+251 911 444 555',
    discount_percent: 10,
    active_bookings: 2,
    unpaid_balance: 32000,
    credit_limit: 150000,
    credit_terms: 'Net 30',
    billing_address: 'Piassa, Addis Ababa',
    tax_id: 'TIN-003',
    industry: 'Tour Operator',
    notes: 'European inbound tour operator',
  },
  {
    id: 'mock-corp-aac-gov',
    company_name: 'Addis Ababa City Administration',
    contact_person: 'Yonas Bekele',
    contact_email: 'procurement@aac.gov.et',
    contact_phone: '+251 11 333 0000',
    discount_percent: 0,
    active_bookings: 4,
    unpaid_balance: 87000,
    credit_limit: 1000000,
    credit_terms: 'Net 45',
    billing_address: 'City Hall, Addis Ababa',
    tax_id: 'TIN-004',
    industry: 'Government',
    notes: 'Government conference and training events',
  },
  {
    id: 'mock-corp-techcorp',
    company_name: 'TechCorp Ethiopia',
    contact_person: 'Sara Tadesse',
    contact_email: 'sara.tadesse@techcorp.et',
    contact_phone: '+251 911 777 888',
    discount_percent: 15,
    active_bookings: 6,
    unpaid_balance: 210000,
    credit_limit: 600000,
    credit_terms: 'Net 30',
    billing_address: 'Kazanchis, Addis Ababa',
    tax_id: 'TIN-005',
    industry: 'Corporate Client',
    notes: 'Tech sector conferences and executive stays',
  },
  {
    id: 'mock-corp-royal-events',
    company_name: 'Royal Events PLC',
    contact_person: 'Dawit Mekonnen',
    contact_email: 'events@royalplc.et',
    contact_phone: '+251 911 999 000',
    discount_percent: 5,
    active_bookings: 1,
    unpaid_balance: 15000,
    credit_limit: 100000,
    credit_terms: 'Net 15',
    billing_address: 'Cazanchis, Addis Ababa',
    tax_id: 'TIN-006',
    industry: 'Event Organizer',
    notes: 'Wedding and banquet event organizer',
  },
  {
    id: 'mock-corp-dream-wedding',
    company_name: 'Dream Wedding Planners',
    contact_person: 'Mekdes Araya',
    contact_email: 'mekdes@dreamwedding.et',
    contact_phone: '+251 911 123 456',
    discount_percent: 7,
    active_bookings: 0,
    unpaid_balance: 0,
    credit_limit: 50000,
    credit_terms: 'Net 15',
    billing_address: 'Mekanissa, Addis Ababa',
    tax_id: 'TIN-007',
    industry: 'Wedding Planner',
    notes: 'Luxury wedding planning and honeymoon packages',
  },
];

const individualLeads = [
  {
    lead_number: 'LEAD-001',
    lead_name: 'Aster Demissie',
    contact_person: 'Aster Demissie',
    contact_email: 'aster.demissie@gmail.com',
    contact_phone: '+251 911 111 111',
    source: 'Website',
    stage: 'Prospect',
    opportunity_value: 2500,
    priority: 'Medium',
    notes: 'Inquired about weekend spa package',
  },
  {
    lead_number: 'LEAD-002',
    lead_name: 'Bereket Solomon',
    contact_person: 'Bereket Solomon',
    contact_email: 'bereket.solomon@yahoo.com',
    contact_phone: '+251 911 222 222',
    source: 'Referral',
    stage: 'Qualified',
    opportunity_value: 8000,
    priority: 'High',
    notes: 'Referred by existing gold member',
  },
  {
    lead_number: 'LEAD-003',
    lead_name: 'Hiwot Girma',
    contact_person: 'Hiwot Girma',
    contact_email: 'hiwot.girma@outlook.com',
    contact_phone: '+251 911 333 333',
    source: 'Social Media',
    stage: 'Proposal',
    opportunity_value: 12000,
    priority: 'High',
    notes: 'Interested in anniversary dinner package',
  },
  {
    lead_number: 'LEAD-004',
    lead_name: 'Dawit Hailu',
    contact_person: 'Dawit Hailu',
    contact_email: 'dawit.hailu@gmail.com',
    contact_phone: '+251 911 444 444',
    source: 'Walk-in',
    stage: 'Negotiation',
    opportunity_value: 15000,
    priority: 'Medium',
    notes: 'Negotiating rates for extended stay',
  },
  {
    lead_number: 'LEAD-005',
    lead_name: 'Liya Tesfaye',
    contact_person: 'Liya Tesfaye',
    contact_email: 'liya.tesfaye@hotmail.com',
    contact_phone: '+251 911 555 555',
    source: 'OTA',
    stage: 'Won',
    opportunity_value: 5000,
    priority: 'Low',
    conversion_date: '2026-08-28',
    notes: 'Confirmed booking via Booking.com',
  },
  {
    lead_number: 'LEAD-006',
    lead_name: 'Yared Tadesse',
    contact_person: 'Yared Tadesse',
    contact_email: 'yared.tadesse@gmail.com',
    contact_phone: '+251 911 666 666',
    source: 'Telephone',
    stage: 'Lost',
    opportunity_value: 3000,
    priority: 'Low',
    lost_reason: 'Chose a competitor property',
    notes: 'Price sensitive, will re-engage next quarter',
  },
];

const linkedLeads = [
  {
    lead_number: 'LEAD-007',
    lead_name: 'TechCorp Annual Retreat',
    company: 'TechCorp Ethiopia',
    contact_person: 'Sara Tadesse',
    contact_email: 'sara.tadesse@techcorp.et',
    contact_phone: '+251 911 777 888',
    corporate_account_id: 'mock-corp-techcorp',
    source: 'Direct',
    stage: 'Qualified',
    opportunity_value: 45000,
    priority: 'High',
    notes: '150 pax offsite, Q4 2026',
  },
  {
    lead_number: 'LEAD-008',
    lead_name: 'AU Summit Delegation',
    company: 'African Union Commission',
    contact_person: 'Yonas Bekele',
    contact_email: 'yonas.bekele@aac.gov.et',
    contact_phone: '+251 11 333 0000',
    corporate_account_id: 'mock-corp-aac-gov',
    source: 'Trade Show',
    stage: 'Negotiation',
    opportunity_value: 78000,
    priority: 'High',
    notes: 'Diplomatic block, 80 rooms, security requirements',
  },
];

async function seed() {
  console.log('Upserting corporate accounts...');
  const { error: accountsError } = await supabase
    .from('corporate_accounts')
    .upsert(corporateAccounts, { onConflict: 'id' });
  if (accountsError) {
    console.error('Failed to upsert corporate accounts:', accountsError);
    process.exit(1);
  }
  console.log(`  -> ${corporateAccounts.length} corporate accounts`);

  const allLeads = [...individualLeads, ...linkedLeads].map((l, i) => ({
    id: `mock-lead-${String(i + 1).padStart(3, '0')}`,
    ...l,
  }));

  console.log('Upserting sales leads...');
  const { error: leadsError } = await supabase
    .from('sales_leads')
    .upsert(allLeads, { onConflict: 'id' });
  if (leadsError) {
    console.error('Failed to upsert sales leads:', leadsError);
    process.exit(1);
  }
  console.log(`  -> ${allLeads.length} sales leads`);

  const { count, error: countError } = await supabase
    .from('corporate_accounts')
    .select('*', { count: 'exact', head: true });
  if (countError) console.error('Count error:', countError);
  else console.log(`Total corporate_accounts in DB: ${count}`);

  const { count: leadCount, error: leadCountError } = await supabase
    .from('sales_leads')
    .select('*', { count: 'exact', head: true });
  if (leadCountError) console.error('Lead count error:', leadCountError);
  else console.log(`Total sales_leads in DB: ${leadCount}`);

  console.log('CRM mock data seeded successfully.');
}

seed();
