import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const seedProposals = [
  {
    proposal_number: 'PROP-2026-001',
    lead_id: 'mock-lead-003',
    corporate_account_id: null,
    title: 'Sunshine Travel Q4 Conference',
    event_type: 'Conference',
    event_dates: 'Oct 14-16, 2026',
    guest_count: 45,
    room_nights: 120,
    proposed_revenue: 85000,
    discount_percent: 5,
    terms_conditions: 'Net 15, 50% deposit required upon acceptance.',
    status: 'Draft',
    valid_until: '2026-09-30',
    notes: 'Transport and AV equipment included.',
  },
  {
    proposal_number: 'PROP-2026-002',
    lead_id: 'mock-lead-004',
    corporate_account_id: 'mock-corp-horizon-tours',
    title: 'Horizon Tours Group Package',
    event_type: 'Corporate Retreat',
    event_dates: 'Nov 4-7, 2026',
    guest_count: 80,
    room_nights: 240,
    proposed_revenue: 145000,
    discount_percent: 8,
    terms_conditions: 'Prepaid, final numbers 14 days before arrival.',
    status: 'Draft',
    valid_until: '2026-10-15',
    notes: 'Negotiating F&B package upgrades.',
  },
  {
    proposal_number: 'PROP-2026-003',
    lead_id: 'mock-lead-007',
    corporate_account_id: 'mock-corp-techcorp',
    title: 'TechCorp Annual Retreat 2026',
    event_type: 'Corporate Retreat',
    event_dates: 'Dec 5-8, 2026',
    guest_count: 120,
    room_nights: 360,
    proposed_revenue: 240000,
    discount_percent: 10,
    terms_conditions: 'Net 30, 25% deposit to hold dates.',
    status: 'Sent',
    valid_until: '2026-11-01',
    sent_date: '2026-08-20',
    notes: 'Sent to CTO for review.',
  },
  {
    proposal_number: 'PROP-2026-004',
    lead_id: 'mock-lead-008',
    corporate_account_id: 'mock-corp-aac-gov',
    title: 'AU Summit Banquet & Rooms',
    event_type: 'Banquet',
    event_dates: 'Jan 12-15, 2027',
    guest_count: 300,
    room_nights: 900,
    proposed_revenue: 420000,
    discount_percent: 0,
    terms_conditions: 'Government billing terms, 100% deposit on acceptance.',
    status: 'Accepted',
    valid_until: '2026-12-01',
    sent_date: '2026-07-15',
    accepted_date: '2026-07-25',
    notes: 'Security and protocol briefing required.',
  },
];

const seedContracts = [
  {
    contract_number: 'CONTRACT-2026-001',
    lead_id: 'mock-lead-008',
    corporate_account_id: 'mock-corp-aac-gov',
    title: 'AU Summit Banquet & Rooms Contract',
    event_type: 'Banquet',
    start_date: '2027-01-12',
    end_date: '2027-01-15',
    guest_count: 300,
    room_nights: 900,
    total_value: 420000,
    deposit_amount: 420000,
    deposit_paid: true,
    status: 'Active',
    terms: 'Government billing terms, full deposit paid.',
    signed_by_client: 'Ato Kebede Bekele',
    signed_date: '2026-07-26',
  },
  {
    contract_number: 'CONTRACT-2026-002',
    lead_id: 'mock-lead-007',
    corporate_account_id: 'mock-corp-techcorp',
    title: 'TechCorp Annual Retreat 2026 Contract',
    event_type: 'Corporate Retreat',
    start_date: '2026-12-05',
    end_date: '2026-12-08',
    guest_count: 120,
    room_nights: 360,
    total_value: 240000,
    deposit_amount: 60000,
    deposit_paid: false,
    status: 'Active',
    terms: 'Net 30, deposit due on signing.',
    signed_by_client: 'Sara Lemma',
    signed_date: '2026-09-01',
  },
];

async function seed() {
  console.log('Seeding sales_proposals...');
  const { data: insertedProposals, error: propError } = await supabase.from('sales_proposals').insert(seedProposals).select('id, proposal_number, lead_id');
  if (propError) {
    console.error('Failed to insert proposals:', propError);
    process.exit(1);
  }
  console.log(`Inserted ${insertedProposals.length} proposals`);

  // Map lead_id to proposal id for contracts
  const propIdByLead = Object.fromEntries(insertedProposals.map((p) => [p.lead_id, p.id]));

  console.log('Seeding sales_contracts...');
  const contractsWithProposalIds = seedContracts.map((c) => ({
    ...c,
    proposal_id: propIdByLead[c.lead_id],
  }));

  const { data: insertedContracts, error: contractError } = await supabase.from('sales_contracts').insert(contractsWithProposalIds).select('id, proposal_id, lead_id');
  if (contractError) {
    console.error('Failed to insert contracts:', contractError);
    process.exit(1);
  }
  console.log(`Inserted ${insertedContracts.length} contracts`);

  // Update accepted proposals with contract_id
  const updates = [];
  for (const c of insertedContracts) {
    const p = insertedProposals.find((x) => x.id === c.proposal_id);
    if (p && seedProposals.find((x) => x.proposal_number === p.proposal_number)?.status === 'Accepted') {
      updates.push({ id: p.id, contract_id: c.id });
    }
  }

  if (updates.length > 0) {
    console.log('Linking accepted proposals to contracts...');
    for (const u of updates) {
      const { error: updateError } = await supabase.from('sales_proposals').update({ contract_id: u.contract_id }).eq('id', u.id);
      if (updateError) console.error('Failed to update proposal contract link:', updateError.message);
    }
  }

  const { count: pCount, error: pCountError } = await supabase.from('sales_proposals').select('*', { count: 'exact', head: true });
  if (pCountError) console.error('proposals count error:', pCountError);
  else console.log(`Total sales_proposals in DB: ${pCount}`);

  const { count: cCount, error: cCountError } = await supabase.from('sales_contracts').select('*', { count: 'exact', head: true });
  if (cCountError) console.error('contracts count error:', cCountError);
  else console.log(`Total sales_contracts in DB: ${cCount}`);
}

seed();
