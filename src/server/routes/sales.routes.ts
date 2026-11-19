import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { dispatchEmail, dispatchSMS } from '../services/salesMessageDispatch';

const router = Router();

// =====================
// Validation helpers
// =====================
const VALID_STAGES = ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const VALID_SOURCES = ['Direct', 'Referral', 'Website', 'Trade Show', 'Cold Call', 'Email Campaign', 'Social Media', 'Travel Agent', 'Other'];

function validateRequired(body: any, fields: string[]): string | null {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') return `Missing required field: ${f}`;
  }
  return null;
}

function validateEnum(value: string | undefined, allowed: string[], field: string): string | null {
  if (value && !allowed.includes(value)) return `Invalid ${field}: must be one of ${allowed.join(', ')}`;
  return null;
}

function applyPropertyFilter(query: any, propertyId: string | undefined) {
  return propertyId ? query.eq('property_id', propertyId) : query;
}

// =====================
// Sales & Events API
// =====================
router.get('/leads', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_leads').select('*, corporate_accounts(company_name, industry)').order('created_at', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/leads', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { leadName, company, contactPerson, contactEmail, contactPhone, source, stage, opportunityValue, expectedCloseDate, assignedTo, corporateAccountId, priority, notes, propertyId } = req.body;
  const missing = validateRequired(req.body, ['leadName']);
  if (missing) return res.status(400).json({ error: missing });
  const stageErr = validateEnum(stage, VALID_STAGES, 'stage');
  if (stageErr) return res.status(400).json({ error: stageErr });
  const priorityErr = validateEnum(priority, VALID_PRIORITIES, 'priority');
  if (priorityErr) return res.status(400).json({ error: priorityErr });
  const sourceErr = validateEnum(source, VALID_SOURCES, 'source');
  if (sourceErr) return res.status(400).json({ error: sourceErr });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const leadNum = `LEAD-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('sales_leads')
      .insert({ id: randomUUID(), lead_number: leadNum, lead_name: leadName, company, contact_person: contactPerson, contact_email: contactEmail, contact_phone: contactPhone, source: source || 'Direct', stage: stage || 'Prospect', opportunity_value: opportunityValue || 0, expected_close_date: expectedCloseDate, assigned_to: assignedTo, corporate_account_id: corporateAccountId, priority: priority || 'Medium', notes, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, lead: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/leads/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { stage, opportunityValue, expectedCloseDate, assignedTo, priority, notes, lostReason, conversionDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (stage) updateData.stage = stage;
    if (opportunityValue !== undefined) updateData.opportunity_value = opportunityValue;
    if (expectedCloseDate) updateData.expected_close_date = expectedCloseDate;
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
    if (priority) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;
    if (lostReason !== undefined) updateData.lost_reason = lostReason;
    if (conversionDate) updateData.conversion_date = conversionDate;
    const { data, error } = await supabaseAdmin.from('sales_leads').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, lead: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Proposals
router.get('/proposals', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_proposals').select('*, sales_leads(lead_name, company), corporate_accounts(company_name)').order('created_at', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/proposals', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { leadId, corporateAccountId, title, eventType, eventDates, guestCount, roomNights, proposedRevenue, discountPercent, termsConditions, validUntil, notes, propertyId } = req.body;
  const missing = validateRequired(req.body, ['title']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propNum = `PROP-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('sales_proposals')
      .insert({ proposal_number: propNum, lead_id: leadId || null, corporate_account_id: corporateAccountId || null, title, event_type: eventType, event_dates: eventDates, guest_count: guestCount || 0, room_nights: roomNights || 0, proposed_revenue: proposedRevenue || 0, discount_percent: discountPercent || 0, terms_conditions: termsConditions, valid_until: validUntil, notes, created_by: req.user!.id, status: 'Draft', property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, proposal: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/proposals/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { status, sentDate, acceptedDate, rejectedDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (sentDate) updateData.sent_date = sentDate;
    if (acceptedDate) updateData.accepted_date = acceptedDate;
    if (rejectedDate) updateData.rejected_date = rejectedDate;
    const { data, error } = await supabaseAdmin.from('sales_proposals').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, proposal: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Contracts
router.get('/contracts', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_contracts').select('*, sales_proposals(proposal_number, title), corporate_accounts(company_name)').order('created_at', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/contracts', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { proposalId, leadId, corporateAccountId, title, eventType, startDate, endDate, guestCount, roomNights, totalValue, depositAmount, terms, signedByClient, signedDate, propertyId } = req.body;
  const missing = validateRequired(req.body, ['title']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const contractNum = `CONTRACT-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('sales_contracts')
      .insert({ contract_number: contractNum, proposal_id: proposalId || null, lead_id: leadId || null, corporate_account_id: corporateAccountId || null, title, event_type: eventType, start_date: startDate, end_date: endDate, guest_count: guestCount || 0, room_nights: roomNights || 0, total_value: totalValue || 0, deposit_amount: depositAmount || 0, terms, signed_by_client: signedByClient, signed_date: signedDate, status: 'Active', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, contract: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/contracts/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { status, depositPaid, signedByClient, signedDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (depositPaid !== undefined) updateData.deposit_paid = depositPaid;
    if (signedByClient !== undefined) updateData.signed_by_client = signedByClient;
    if (signedDate) updateData.signed_date = signedDate;
    const { data, error } = await supabaseAdmin.from('sales_contracts').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Twin-write: when contract is signed, create an AR invoice in Finance
    if (signedByClient && signedDate) {
      try {
        const invNum = `INV-SALES-${Date.now().toString().slice(-6)}`;
        await supabaseAdmin.from('ar_invoices').insert({
          invoice_number: invNum,
          customer_id: data.corporate_account_id || null,
          invoice_date: signedDate,
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: `Sales Contract ${data.contract_number || data.id} - ${data.title || ''}`,
          status: 'Posted',
          subtotal: Number(data.total_value) || 0,
          tax_amount: 0,
          total_amount: Number(data.total_value) || 0,
          paid_amount: Number(data.deposit_amount) || 0,
          currency: 'ETB',
          property_id: data.property_id || null,
        });
      } catch {
        // twin-write is best-effort
      }
    }

    return res.json({ success: true, contract: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Create group block from contract
router.post('/contracts/:id/create-group-block', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data: block, error } = await supabaseAdmin.rpc('create_group_block_from_contract', { p_contract_id: req.params.id });
    if (error) return res.status(500).json({ error: error.message });

    // Convert group block into Front Office room_blocks for availability syncing
    let roomBlocks: any[] = [];
    try {
      const { data: rbData, error: rbError } = await supabaseAdmin.rpc('convert_group_block_to_room_blocks', { p_group_block_id: block[0]?.block_id });
      if (!rbError) roomBlocks = rbData || [];
    } catch {
      // room block conversion is best-effort; FO rooms may not exist yet
    }

    return res.json({ success: true, block, roomBlocks });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Create event from contract (migration 444 renamed create_beo_from_contract
// to create_event_from_contract — a contract now produces an EVENT, and the
// BEO is generated later from the event in the ops portal).
router.post('/contracts/:id/create-beo', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('create_event_from_contract', { p_contract_id: req.params.id });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.success) return res.status(409).json({ error: data?.error });
    return res.json({ success: true, event: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Corporate Accounts
router.get('/corporate-accounts', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('corporate_accounts').select('*').order('company_name', { ascending: true });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/corporate-accounts', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { companyName, contactPerson, contactEmail, contactPhone, discountPercent, creditLimit, creditTerms, billingAddress, taxId, industry, notes, propertyId } = req.body;
  const missing = validateRequired(req.body, ['companyName', 'contactPerson', 'contactEmail']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('corporate_accounts')
      .insert({ id: randomUUID(), company_name: companyName, contact_person: contactPerson, contact_email: contactEmail, contact_phone: contactPhone, discount_percent: discountPercent || 0, credit_limit: creditLimit || 0, credit_terms: creditTerms || 'Net 30', billing_address: billingAddress, tax_id: taxId, industry, notes, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, account: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/corporate-accounts/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { companyName, contactPerson, contactEmail, contactPhone, discountPercent, creditLimit, creditTerms, billingAddress, taxId, industry, notes, activeBookings, unpaidBalance } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (companyName !== undefined) updateData.company_name = companyName;
    if (contactPerson !== undefined) updateData.contact_person = contactPerson;
    if (contactEmail !== undefined) updateData.contact_email = contactEmail;
    if (contactPhone !== undefined) updateData.contact_phone = contactPhone;
    if (discountPercent !== undefined) updateData.discount_percent = discountPercent;
    if (creditLimit !== undefined) updateData.credit_limit = creditLimit;
    if (creditTerms !== undefined) updateData.credit_terms = creditTerms;
    if (billingAddress !== undefined) updateData.billing_address = billingAddress;
    if (taxId !== undefined) updateData.tax_id = taxId;
    if (industry !== undefined) updateData.industry = industry;
    if (notes !== undefined) updateData.notes = notes;
    if (activeBookings !== undefined) updateData.active_bookings = activeBookings;
    if (unpaidBalance !== undefined) updateData.unpaid_balance = unpaidBalance;
    const { data, error } = await supabaseAdmin.from('corporate_accounts').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, account: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Sales Activities
router.get('/activities', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_activities').select('*').order('due_date', { ascending: true });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/activities', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { activityType, title, relatedTo, assignedTo, dueDate, status, priority, notes, propertyId } = req.body;
  const missing = validateRequired(req.body, ['activityType', 'title']);
  if (missing) return res.status(400).json({ error: missing });
  const priorityErr = validateEnum(priority, VALID_PRIORITIES, 'priority');
  if (priorityErr) return res.status(400).json({ error: priorityErr });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_activities')
      .insert({ activity_type: activityType, title, related_to: relatedTo, assigned_to: assignedTo, due_date: dueDate, status: status || 'Pending', priority: priority || 'Medium', notes, created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, activity: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/activities/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { status, title, relatedTo, assignedTo, dueDate, priority, notes } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (title !== undefined) updateData.title = title;
    if (relatedTo !== undefined) updateData.related_to = relatedTo;
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
    if (dueDate) updateData.due_date = dueDate;
    if (priority) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;
    const { data, error } = await supabaseAdmin.from('sales_activities').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, activity: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Campaigns
router.get('/campaigns', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_campaigns').select('*').order('created_at', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/campaigns', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { campaignName, campaignType, status, audience, budget, spent, leads, conversions, startDate, endDate, notes, propertyId } = req.body;
  const missing = validateRequired(req.body, ['campaignName']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_campaigns')
      .insert({ campaign_name: campaignName, campaign_type: campaignType, status: status || 'Draft', audience, budget: budget || 0, spent: spent || 0, leads: leads || 0, conversions: conversions || 0, start_date: startDate, end_date: endDate, notes, created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, campaign: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/campaigns/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { campaignName, campaignType, status, audience, budget, spent, leads, conversions, startDate, endDate, notes } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (campaignName !== undefined) updateData.campaign_name = campaignName;
    if (campaignType !== undefined) updateData.campaign_type = campaignType;
    if (status) updateData.status = status;
    if (audience !== undefined) updateData.audience = audience;
    if (budget !== undefined) updateData.budget = budget;
    if (spent !== undefined) updateData.spent = spent;
    if (leads !== undefined) updateData.leads = leads;
    if (conversions !== undefined) updateData.conversions = conversions;
    if (startDate) updateData.start_date = startDate;
    if (endDate) updateData.end_date = endDate;
    if (notes !== undefined) updateData.notes = notes;
    const { data, error } = await supabaseAdmin.from('sales_campaigns').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, campaign: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Email Campaigns
router.get('/email-campaigns', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_email_campaigns').select('*').order('sent_date', { ascending: false, nullsFirst: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/email-campaigns', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { subject, template, recipients, body, propertyId } = req.body;
  const missing = validateRequired(req.body, ['subject']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_email_campaigns')
      .insert({ subject, template, recipients: recipients || 0, body, status: 'Draft', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, emailCampaign: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/email-campaigns/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { subject, template, recipients, body, status, sentDate, openRate, clickRate, bounceRate, unsubscribeRate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (subject !== undefined) updateData.subject = subject;
    if (template !== undefined) updateData.template = template;
    if (recipients !== undefined) updateData.recipients = recipients;
    if (body !== undefined) updateData.body = body;
    if (status) updateData.status = status;
    if (sentDate) updateData.sent_date = sentDate;
    if (openRate !== undefined) updateData.open_rate = openRate;
    if (clickRate !== undefined) updateData.click_rate = clickRate;
    if (bounceRate !== undefined) updateData.bounce_rate = bounceRate;
    if (unsubscribeRate !== undefined) updateData.unsubscribe_rate = unsubscribeRate;
    const { data, error } = await supabaseAdmin.from('sales_email_campaigns').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, emailCampaign: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Send email campaign — dispatches via configured provider
router.post('/email-campaigns/:id/send', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { recipientList } = req.body as { recipientList?: string[] };
    const { data: campaign, error: fetchErr } = await supabaseAdmin.from('sales_email_campaigns').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!campaign) return res.status(404).json({ error: 'Email campaign not found' });
    const recipients = recipientList && recipientList.length > 0 ? recipientList : [];
    const result = await dispatchEmail(campaign.subject || '(No Subject)', campaign.body || '', recipients);
    const { error: updateErr } = await supabaseAdmin.from('sales_email_campaigns')
      .update({ status: 'Sent', sent_date: new Date().toISOString().split('T')[0], recipients: recipients.length, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });
    return res.json({ success: true, dispatch: result });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// SMS & Messaging
router.get('/sms-messages', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_sms_messages').select('*').order('sent_date', { ascending: false, nullsFirst: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/sms-messages', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { messageType, content, recipients, propertyId } = req.body;
  const missing = validateRequired(req.body, ['messageType', 'content']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_sms_messages')
      .insert({ message_type: messageType, content, recipients: recipients || 0, delivered: 0, failed: 0, status: 'Draft', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, message: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/sms-messages/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { messageType, content, recipients, delivered, failed, status, sentDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (messageType !== undefined) updateData.message_type = messageType;
    if (content !== undefined) updateData.content = content;
    if (recipients !== undefined) updateData.recipients = recipients;
    if (delivered !== undefined) updateData.delivered = delivered;
    if (failed !== undefined) updateData.failed = failed;
    if (status) updateData.status = status;
    if (sentDate) updateData.sent_date = sentDate;
    const { data, error } = await supabaseAdmin.from('sales_sms_messages').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Send SMS campaign — dispatches via configured provider
router.post('/sms-messages/:id/send', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { recipientList } = req.body as { recipientList?: string[] };
    const { data: sms, error: fetchErr } = await supabaseAdmin.from('sales_sms_messages').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!sms) return res.status(404).json({ error: 'SMS message not found' });
    const recipients = recipientList && recipientList.length > 0 ? recipientList : [];
    const result = await dispatchSMS(sms.content || '', recipients);
    const { error: updateErr } = await supabaseAdmin.from('sales_sms_messages')
      .update({ status: 'Sent', sent_date: new Date().toISOString().split('T')[0], recipients: recipients.length, delivered: result.delivered, failed: result.failed, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });
    return res.json({ success: true, dispatch: result });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Loyalty Members
router.get('/loyalty-members', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_loyalty_members').select('*').order('points', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/loyalty-members', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { memberName, tier, points, totalStays, totalSpend, rewardsRedeemed, enrollmentDate, status, propertyId } = req.body;
  const missing = validateRequired(req.body, ['memberName']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_loyalty_members')
      .insert({ member_name: memberName, tier: tier || 'Bronze', points: points || 0, total_stays: totalStays || 0, total_spend: totalSpend || 0, rewards_redeemed: rewardsRedeemed || 0, enrollment_date: enrollmentDate, status: status || 'Active', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, loyaltyMember: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/loyalty-members/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { memberName, tier, points, totalStays, totalSpend, rewardsRedeemed, enrollmentDate, status } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (memberName !== undefined) updateData.member_name = memberName;
    if (tier) updateData.tier = tier;
    if (points !== undefined) updateData.points = points;
    if (totalStays !== undefined) updateData.total_stays = totalStays;
    if (totalSpend !== undefined) updateData.total_spend = totalSpend;
    if (rewardsRedeemed !== undefined) updateData.rewards_redeemed = rewardsRedeemed;
    if (enrollmentDate) updateData.enrollment_date = enrollmentDate;
    if (status) updateData.status = status;
    const { data, error } = await supabaseAdmin.from('sales_loyalty_members').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, loyaltyMember: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Promotions
router.get('/promotions', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_promotions').select('*').order('end_date', { ascending: true, nullsFirst: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/promotions', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, type, code, discountPercent, startDate, endDate, maxUses, propertyId } = req.body;
  const missing = validateRequired(req.body, ['name']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_promotions')
      .insert({ name, type, code: code?.toUpperCase(), discount_percent: discountPercent || 0, start_date: startDate, end_date: endDate, uses: 0, max_uses: maxUses || 0, revenue: 0, status: 'Draft', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, promotion: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/promotions/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, type, code, discountPercent, startDate, endDate, uses, maxUses, revenue, status } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (code !== undefined) updateData.code = code?.toUpperCase();
    if (discountPercent !== undefined) updateData.discount_percent = discountPercent;
    if (startDate) updateData.start_date = startDate;
    if (endDate) updateData.end_date = endDate;
    if (uses !== undefined) updateData.uses = uses;
    if (maxUses !== undefined) updateData.max_uses = maxUses;
    if (revenue !== undefined) updateData.revenue = revenue;
    if (status) updateData.status = status;
    const { data, error } = await supabaseAdmin.from('sales_promotions').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, promotion: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Gift Cards & Vouchers
router.get('/gift-vouchers', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_gift_vouchers').select('*').order('expiry_date', { ascending: true, nullsFirst: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/gift-vouchers', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { type, value, balance, recipient, expiryDate, propertyId } = req.body;
  const missing = validateRequired(req.body, ['type']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const voucherCode = `VOUCHER-${Date.now().toString().slice(-6)}`;
    const { data, error } = await supabaseAdmin.from('sales_gift_vouchers')
      .insert({ code: voucherCode, type, value: value || 0, balance: balance ?? (value || 0), recipient, issue_date: new Date().toISOString().split('T')[0], expiry_date: expiryDate, status: 'Active', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, voucher: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/gift-vouchers/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { code, type, value, balance, recipient, issueDate, expiryDate, status } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (code !== undefined) updateData.code = code;
    if (type !== undefined) updateData.type = type;
    if (value !== undefined) updateData.value = value;
    if (balance !== undefined) updateData.balance = balance;
    if (recipient !== undefined) updateData.recipient = recipient;
    if (issueDate) updateData.issue_date = issueDate;
    if (expiryDate) updateData.expiry_date = expiryDate;
    if (status) updateData.status = status;
    const { data, error } = await supabaseAdmin.from('sales_gift_vouchers').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, voucher: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Reviews / Reputation
router.get('/reviews', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const sentiment = req.query.sentiment as string | undefined;
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_reviews').select('*').order('review_date', { ascending: false });
    if (sentiment && sentiment !== 'all') query = query.eq('sentiment', sentiment);
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/reviews', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { source, guestName, rating, title, sentiment, reviewDate, status, response, propertyId } = req.body;
  const missing = validateRequired(req.body, ['guestName', 'rating']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_reviews')
      .insert({ source, guest_name: guestName, rating: rating || 0, title, sentiment, status: status || 'Pending', review_date: reviewDate, response, created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, review: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/reviews/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { source, guestName, rating, title, sentiment, reviewDate, status, response } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (source !== undefined) updateData.source = source;
    if (guestName !== undefined) updateData.guest_name = guestName;
    if (rating !== undefined) updateData.rating = rating;
    if (title !== undefined) updateData.title = title;
    if (sentiment) updateData.sentiment = sentiment;
    if (reviewDate) updateData.review_date = reviewDate;
    if (status) updateData.status = status;
    if (response !== undefined) updateData.response = response;
    const { data, error } = await supabaseAdmin.from('sales_reviews').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, review: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Guest Feedback
router.get('/guest-feedback', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_guest_feedback').select('*').order('feedback_date', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/guest-feedback', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { feedbackType, guestName, rating, comments, status, resolution, feedbackDate, propertyId } = req.body;
  const missing = validateRequired(req.body, ['guestName', 'feedbackType']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_guest_feedback')
      .insert({ feedback_type: feedbackType, guest_name: guestName, rating: rating || 0, comments, status: status || 'Pending', resolution, feedback_date: feedbackDate, created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, feedback: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/guest-feedback/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { feedbackType, guestName, rating, comments, status, resolution, feedbackDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (feedbackType !== undefined) updateData.feedback_type = feedbackType;
    if (guestName !== undefined) updateData.guest_name = guestName;
    if (rating !== undefined) updateData.rating = rating;
    if (comments !== undefined) updateData.comments = comments;
    if (status) updateData.status = status;
    if (resolution !== undefined) updateData.resolution = resolution;
    if (feedbackDate) updateData.feedback_date = feedbackDate;
    const { data, error } = await supabaseAdmin.from('sales_guest_feedback').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, feedback: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Customer Segmentation
router.get('/segment-members', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const segment = req.query.segment as string | undefined;
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_segment_members').select('*').order('total_spend', { ascending: false });
    if (segment && segment !== 'all') query = query.eq('segment', segment);
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/segment-members', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, segment, totalSpend, lastStay, frequency, valueTier, propertyId } = req.body;
  const missing = validateRequired(req.body, ['name', 'segment']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_segment_members')
      .insert({ name, segment, total_spend: totalSpend || 0, last_stay: lastStay, frequency: frequency || 'Occasional', value_tier: valueTier || 'Medium', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, segmentMember: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/segment-members/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, segment, totalSpend, lastStay, frequency, valueTier } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (segment !== undefined) updateData.segment = segment;
    if (totalSpend !== undefined) updateData.total_spend = totalSpend;
    if (lastStay !== undefined) updateData.last_stay = lastStay;
    if (frequency !== undefined) updateData.frequency = frequency;
    if (valueTier) updateData.value_tier = valueTier;
    const { data, error } = await supabaseAdmin.from('sales_segment_members').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, segmentMember: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Communications
router.get('/communications', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_communications').select('*').order('communication_date', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/communications', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { channel, subject, recipient, body, status, communicationDate, propertyId } = req.body;
  const missing = validateRequired(req.body, ['channel', 'subject']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_communications')
      .insert({ channel, subject, recipient, body, status: status || 'Pending', communication_date: communicationDate, created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, communication: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/communications/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { channel, subject, recipient, body, status, communicationDate } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (channel !== undefined) updateData.channel = channel;
    if (subject !== undefined) updateData.subject = subject;
    if (recipient !== undefined) updateData.recipient = recipient;
    if (body !== undefined) updateData.body = body;
    if (status) updateData.status = status;
    if (communicationDate) updateData.communication_date = communicationDate;
    const { data, error } = await supabaseAdmin.from('sales_communications').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, communication: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Reports
router.get('/reports', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const category = req.query.category as string | undefined;
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_reports').select('*').order('category', { ascending: true }).order('name', { ascending: true });
    if (category && category !== 'all') query = query.eq('category', category);
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/reports/stats', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_reports').select('status, category');
    if (error) return res.status(500).json({ error: error.message });
    const reports = data || [];
    const byCategory: Record<string, number> = {};
    reports.forEach((r: any) => { byCategory[r.category] = (byCategory[r.category] || 0) + 1; });
    return res.json({
      total: reports.length,
      ready: reports.filter((r: any) => r.status === 'Ready').length,
      scheduled: reports.filter((r: any) => r.status === 'Scheduled').length,
      failed: reports.filter((r: any) => r.status === 'Failed').length,
      byCategory,
    });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/reports/:id/preview', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data: report } = await supabaseAdmin.from('sales_reports').select('category, name').eq('id', req.params.id).single();
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const category = report.category;
    try {
      let preview: any = null;
      if (category === 'Sales Reports') {
        const { data: leads } = await supabaseAdmin.from('sales_leads').select('stage, priority, source, opportunity_value, created_at').order('created_at', { ascending: false }).limit(50);
        const rows = leads || [];
        const byStage: Record<string, { count: number; value: number }> = {};
        const bySource: Record<string, number> = {};
        rows.forEach((l: any) => {
          byStage[l.stage] = byStage[l.stage] || { count: 0, value: 0 };
          byStage[l.stage].count++;
          byStage[l.stage].value += Number(l.opportunity_value || 0);
          bySource[l.source] = (bySource[l.source] || 0) + 1;
        });
        preview = {
          summary: { totalLeads: rows.length, totalPipelineValue: rows.reduce((s, l) => s + Number(l.opportunity_value || 0), 0) },
          byStage: Object.entries(byStage).map(([stage, v]) => ({ stage, ...v })),
          bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })),
          recentLeads: rows.slice(0, 20),
        };
      } else if (category === 'Marketing Reports') {
        const { data: campaigns } = await supabaseAdmin.from('sales_campaigns').select('*').order('created_at', { ascending: false }).limit(50);
        const { data: emails } = await supabaseAdmin.from('sales_email_campaigns').select('subject, recipients, open_rate, click_rate, status, sent_date').order('sent_date', { ascending: false, nullsFirst: false }).limit(20);
        const rows = campaigns || [];
        preview = {
          summary: { totalCampaigns: rows.length, totalLeads: rows.reduce((s, c) => s + Number(c.leads || 0), 0), totalConversions: rows.reduce((s, c) => s + Number(c.conversions || 0), 0), totalBudget: rows.reduce((s, c) => s + Number(c.budget || 0), 0), totalSpent: rows.reduce((s, c) => s + Number(c.spent || 0), 0) },
          campaigns: rows.slice(0, 20),
          emailCampaigns: emails || [],
        };
      } else if (category === 'CRM Reports') {
        const { data: loyalty } = await supabaseAdmin.from('sales_loyalty_members').select('tier, points, total_stays, total_spend, status').order('points', { ascending: false }).limit(50);
        const { data: reviews } = await supabaseAdmin.from('sales_reviews').select('rating, sentiment, source, status').order('review_date', { ascending: false }).limit(20);
        const rows = loyalty || [];
        const byTier: Record<string, number> = {};
        rows.forEach((m: any) => { byTier[m.tier] = (byTier[m.tier] || 0) + 1; });
        preview = {
          summary: { totalMembers: rows.length, totalPoints: rows.reduce((s, m) => s + Number(m.points || 0), 0), totalSpend: rows.reduce((s, m) => s + Number(m.total_spend || 0), 0), avgRating: (reviews || []).length > 0 ? (reviews || []).reduce((s, r) => s + Number(r.rating || 0), 0) / (reviews || []).length : 0 },
          byTier: Object.entries(byTier).map(([tier, count]) => ({ tier, count })),
          recentReviews: reviews || [],
        };
      } else if (category === 'Financial Reports') {
        const { data: proposals } = await supabaseAdmin.from('sales_proposals').select('proposed_revenue, status, discount_percent, created_at').order('created_at', { ascending: false }).limit(50);
        const { data: contracts } = await supabaseAdmin.from('sales_contracts').select('total_value, deposit_amount, deposit_paid, status, created_at').order('created_at', { ascending: false }).limit(50);
        const propRows = proposals || [];
        const conRows = contracts || [];
        preview = {
          summary: { totalProposed: propRows.reduce((s, p) => s + Number(p.proposed_revenue || 0), 0), acceptedProposals: propRows.filter(p => p.status === 'Accepted').length, totalContractValue: conRows.reduce((s, c) => s + Number(c.total_value || 0), 0), depositsPaid: conRows.filter(c => c.deposit_paid).length },
          proposals: propRows.slice(0, 20),
          contracts: conRows.slice(0, 20),
        };
      } else {
        // Operational Reports — default to leads overview
        const { data: leads } = await supabaseAdmin.from('sales_leads').select('stage, assigned_to, priority, opportunity_value, created_at').order('created_at', { ascending: false }).limit(20);
        preview = { summary: { total: (leads || []).length }, records: leads || [] };
      }
      return res.json(preview);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to generate report preview' });
    }
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/reports', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, category, description, status, format, frequency, propertyId } = req.body;
  const missing = validateRequired(req.body, ['name', 'category']);
  if (missing) return res.status(400).json({ error: missing });
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_reports')
      .insert({ name, category, description, status: status || 'Ready', format: format || 'PDF', frequency: frequency || 'Daily', created_by: req.user!.id, property_id: propertyId || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, report: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/reports/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, category, description, status, lastRun, format, frequency } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (lastRun !== undefined) updateData.last_run = lastRun;
    if (format !== undefined) updateData.format = format;
    if (frequency !== undefined) updateData.frequency = frequency;
    const { data, error } = await supabaseAdmin.from('sales_reports').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, report: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/reports/:id/run', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, report: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/reports/run-all', authenticate, requirePermission('sales:write'), async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_reports')
      .update({ status: 'Ready', last_run: new Date().toISOString(), updated_at: new Date().toISOString() })
      .neq('status', 'Disabled')
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, refreshed: data?.length || 0 });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Dashboard
router.get('/dashboard', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_dashboard').select('*').order('widget_type').order('sequence').order('category');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Dashboard refresh — recomputes KPIs from real data via SQL function
router.post('/dashboard/refresh', authenticate, requirePermission('sales:write'), async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.rpc('refresh_sales_dashboard');
    if (error) return res.status(500).json({ error: error.message });
    const { data, error: fetchError } = await supabaseAdmin.from('sales_dashboard').select('*').order('widget_type').order('sequence').order('category');
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Settings
router.get('/settings', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_settings').select('*').order('category').order('setting_key');
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/settings', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { settingKey, settingValue, settingType, label, category } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_settings')
      .upsert({ setting_key: settingKey, setting_value: String(settingValue), setting_type: settingType || 'string', label, category, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, setting: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/settings/bulk', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { settings } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const upserts = (settings || []).map((s: any) => ({
      setting_key: s.settingKey,
      setting_value: String(s.settingValue),
      setting_type: s.settingType || 'string',
      label: s.label,
      category: s.category,
      updated_at: new Date().toISOString(),
    }));
    const { data, error } = await supabaseAdmin.from('sales_settings')
      .upsert(upserts, { onConflict: 'setting_key' })
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, settings: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Staff Management
router.get('/staff', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff').select('*').order('name');
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.get('/staff/employees/:propertyId', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('employees')
      .select('id, name, email, phone, position, department, status, hire_date, salary')
      .eq('property_id', req.params.propertyId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/staff', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { employeeId, name, email, phone, role, shift, territory, status, workload, salesTarget, ytdRevenue, propertyId } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_staff')
      .insert({ employee_id: employeeId, name, email, phone, role, shift, territory, status: status || 'Active Duty', workload: workload || 0, sales_target: salesTarget || 0, ytd_revenue: ytdRevenue || 0, property_id: propertyId || null, created_by: req.user!.id })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, staff: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { name, email, phone, role, shift, territory, status, workload, salesTarget, ytdRevenue } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (shift !== undefined) updateData.shift = shift;
    if (territory !== undefined) updateData.territory = territory;
    if (status !== undefined) updateData.status = status;
    if (workload !== undefined) updateData.workload = workload;
    if (salesTarget !== undefined) updateData.sales_target = salesTarget;
    if (ytdRevenue !== undefined) updateData.ytd_revenue = ytdRevenue;
    const { data, error } = await supabaseAdmin.from('sales_staff').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, staff: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/staff/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_staff').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Staff attendance
router.get('/staff/attendance', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff_attendance').select('*, sales_staff(name, role)').order('attendance_date', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/staff/attendance', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { staffId, attendanceDate, status, checkIn, checkOut, hoursWorked, overtimeHours, notes } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_staff_attendance')
      .insert({ staff_id: staffId, attendance_date: attendanceDate, status, check_in: checkIn, check_out: checkOut, hours_worked: hoursWorked || 0, overtime_hours: overtimeHours || 0, notes })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, attendance: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/attendance/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { status, checkIn, checkOut, hoursWorked, overtimeHours, notes } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) updateData.status = status;
    if (checkIn !== undefined) updateData.check_in = checkIn;
    if (checkOut !== undefined) updateData.check_out = checkOut;
    if (hoursWorked !== undefined) updateData.hours_worked = hoursWorked;
    if (overtimeHours !== undefined) updateData.overtime_hours = overtimeHours;
    if (notes !== undefined) updateData.notes = notes;
    const { data, error } = await supabaseAdmin.from('sales_staff_attendance').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, attendance: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/staff/attendance/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_staff_attendance').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Staff training
router.get('/staff/training', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff_training').select('*, sales_staff(name, role)').order('due_date', { ascending: true });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/staff/training', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { staffId, course, dueDate, status } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_staff_training')
      .insert({ staff_id: staffId, course, due_date: dueDate, status: status || 'Not Started' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, training: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/training/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { course, dueDate, status } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (course !== undefined) updateData.course = course;
    if (dueDate !== undefined) updateData.due_date = dueDate;
    if (status !== undefined) updateData.status = status;
    const { data, error } = await supabaseAdmin.from('sales_staff_training').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, training: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/staff/training/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_staff_training').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Staff productivity
router.get('/staff/productivity', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff_productivity').select('*, sales_staff(name, role)').order('revenue', { ascending: false });
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.post('/staff/productivity', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { staffId, period, callsMade, meetings, dealsClosed, revenue } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('sales_staff_productivity')
      .insert({ staff_id: staffId, period, calls_made: callsMade || 0, meetings: meetings || 0, deals_closed: dealsClosed || 0, revenue: revenue || 0 })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, productivity: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/productivity/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { period, callsMade, meetings, dealsClosed, revenue } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (period !== undefined) updateData.period = period;
    if (callsMade !== undefined) updateData.calls_made = callsMade;
    if (meetings !== undefined) updateData.meetings = meetings;
    if (dealsClosed !== undefined) updateData.deals_closed = dealsClosed;
    if (revenue !== undefined) updateData.revenue = revenue;
    const { data, error } = await supabaseAdmin.from('sales_staff_productivity').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, productivity: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/staff/productivity/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_staff_productivity').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Shift requirements
router.get('/staff/shift-reqs', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff_shift_reqs').select('*').order('role').order('shift');
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/shift-reqs/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { requiredCount, assignedCount } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (requiredCount !== undefined) updateData.required_count = requiredCount;
    if (assignedCount !== undefined) updateData.assigned_count = assignedCount;
    const { data, error } = await supabaseAdmin.from('sales_staff_shift_reqs').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, shiftReq: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Staffing requirements
router.get('/staff/staffing-reqs', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const propertyId = req.query.propertyId as string | undefined;
    let query = supabaseAdmin.from('sales_staff_staffing_reqs').select('*').order('territory').order('role');
    query = applyPropertyFilter(query, propertyId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.patch('/staff/staffing-reqs/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  const { requiredCount, assignedCount } = req.body;
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (requiredCount !== undefined) updateData.required_count = requiredCount;
    if (assignedCount !== undefined) updateData.assigned_count = assignedCount;
    const { data, error } = await supabaseAdmin.from('sales_staff_staffing_reqs').update(updateData).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, staffingReq: data });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// =============================================================
// DELETE endpoints for entities that were missing them
// =============================================================

router.delete('/leads/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_leads').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/proposals/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_proposals').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/contracts/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_contracts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/corporate-accounts/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('corporate_accounts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/activities/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_activities').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/campaigns/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_campaigns').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/email-campaigns/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_email_campaigns').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/sms-messages/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_sms_messages').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/loyalty-members/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_loyalty_members').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/promotions/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_promotions').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/gift-vouchers/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_gift_vouchers').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/reviews/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_reviews').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/guest-feedback/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_guest_feedback').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/segment-members/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_segment_members').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/communications/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_communications').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

router.delete('/reports/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { error } = await supabaseAdmin.from('sales_reports').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Group Analytics
router.get('/analytics', authenticate, async (_req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const [leads, contracts, proposals] = await Promise.all([
      supabaseAdmin.from('sales_leads').select('stage, opportunity_value, created_at'),
      supabaseAdmin.from('sales_contracts').select('total_value, status, created_at'),
      supabaseAdmin.from('sales_proposals').select('proposed_revenue, status'),
    ]);
    const totalLeads = leads.data?.length || 0;
    const wonLeads = leads.data?.filter(l => l.stage === 'Won').length || 0;
    const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;
    const totalPipelineValue = leads.data?.reduce((s, l) => s + Number(l.opportunity_value || 0), 0) || 0;
    const totalContractValue = contracts.data?.reduce((s, c) => s + Number(c.total_value || 0), 0) || 0;
    const totalProposedValue = proposals.data?.reduce((s, p) => s + Number(p.proposed_revenue || 0), 0) || 0;
    const stageCounts: Record<string, number> = {};
    leads.data?.forEach(l => { stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1; });
    return res.json({ totalLeads, wonLeads, conversionRate, totalPipelineValue, totalContractValue, totalProposedValue, stageCounts });
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// Cross-department KPI summary endpoint - consumed by Finance, Front Office, Ops dashboards
router.get('/kpi-summary', authenticate, async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { propertyId } = req.query as Record<string, string>;
    let q = supabaseAdmin.from('v_sales_kpi_summary').select('*');
    if (propertyId) q = q.eq('property_id', propertyId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.status(503).json({ error: 'Database not configured' });
});

// =====================
// Website testimonials (public_testimonials) — moderated here, shown on /public-portal
// =====================
const TESTIMONIAL_STATUSES = ['pending', 'approved', 'hidden'];
const TESTIMONIAL_FIELDS = ['guest_name', 'location', 'rating', 'comment', 'stay_date', 'room_type', 'avatar_url', 'status', 'property_id'];

function pickTestimonial(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of TESTIMONIAL_FIELDS) if (body[f] !== undefined) out[f] = typeof body[f] === 'string' ? body[f].trim() : body[f];
  if (out.rating !== undefined) out.rating = Math.min(5, Math.max(1, Math.round(Number(out.rating) || 5)));
  for (const f of ['location', 'stay_date', 'room_type', 'avatar_url']) if (out[f] === '') out[f] = null;
  return out;
}

router.get('/testimonials', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { data, error } = await supabaseAdmin.from('public_testimonials').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/testimonials', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const row = pickTestimonial(req.body || {});
  if (!row.guest_name || !row.comment) return res.status(400).json({ error: 'guest_name and comment are required' });
  if (row.status && !TESTIMONIAL_STATUSES.includes(row.status)) return res.status(400).json({ error: `Invalid status: must be one of ${TESTIMONIAL_STATUSES.join(', ')}` });
  const { data, error } = await supabaseAdmin.from('public_testimonials')
    .insert({ id: randomUUID(), source: req.body?.source === 'sales_review' ? 'sales_review' : 'sales_portal', rating: 5, ...row })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/testimonials/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const row = pickTestimonial(req.body || {});
  if (row.status && !TESTIMONIAL_STATUSES.includes(row.status)) return res.status(400).json({ error: `Invalid status: must be one of ${TESTIMONIAL_STATUSES.join(', ')}` });
  if (!Object.keys(row).length) return res.status(400).json({ error: 'Nothing to update' });
  const { data, error } = await supabaseAdmin.from('public_testimonials').update({ ...row, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/testimonials/:id', authenticate, requirePermission('sales:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return res.status(503).json({ error: 'Database not configured' });
  const { error } = await supabaseAdmin.from('public_testimonials').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

export default router;
