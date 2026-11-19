import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { getGlobalSettings } from '../services/settingsService';

const router = Router();

// Generate invoice for a folio and link payments
// Supports partial invoicing: pass lineIds to invoice only specific charge lines.
// When lineIds is omitted, invoices all non-voided, non-invoiced lines (backward compatible).
router.post('/:folioId/generate-invoice', authenticate, async (req, res) => {
  const { folioId } = req.params;
  const { invoiceType, dueDate, notes, lineIds, preview } = req.body;

  // Invoice generation writes invoice + journal-entry records — staff only.
  // Guests download a folio statement rendered client-side instead.
  if (req.user?.role === 'guest') {
    return res.status(403).json({ error: 'Invoices are issued by the front office' });
  }

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Get folio details
    const { data: folio, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('*, reservations(*)')
      .eq('id', folioId)
      .single();

    if (folioError || !folio) {
      return res.status(404).json({ error: 'Folio not found' });
    }

    const reservation = folio.reservations;

    // ── Reservation-less folios (Company / Master, owner_type='group_profile') ──
    // These are per-company folios (created in reservations.routes.ts
    // ensureCompanyFolio()/ensureMasterFolio()) that aggregate charges across
    // many stays, so they have no single reservation_id. Source customer/tax
    // info from the owning group_profile instead of erroring out.
    let customerTin: string | null = null;
    let customerVatNo: string | null = null;
    let customerVatDate: string | null = null;
    let customerName: string = 'Guest';
    let customerAddress: string | null = null;
    let customerEmail: string | null = null;
    let journalCustomerLabel: string = 'Guest';

    if (!reservation) {
      // ── Resolve customer info from group_profiles ──────────────
      // Folios without a reservation can be:
      //   1. Company folios: owner_type='group_profile', owner_id=company code
      //   2. Master folios: owner_type='group_profile', owner_id=company code (if company exists)
      //   3. Master folios without company: owner_type=null, group_id=group code
      //   4. Group folios: owner_type=null, group_id=group code
      // For cases 3 & 4, resolve via group_id instead of owner_id.
      let profileLookupId = folio.owner_id;
      let profileLookupField = 'id';

      if ((!folio.owner_type || !folio.owner_id) && folio.group_id) {
        // Group/Master folio without owner_type — look up by group_id (which stores group_profiles.code)
        profileLookupId = folio.group_id;
        profileLookupField = 'code';
      }

      if (!profileLookupId) {
        return res.status(400).json({ error: 'Folio has no associated reservation, owning company profile, or group' });
      }

      const { data: ownerProfile, error: ownerError } = await supabaseAdmin
        .from('group_profiles')
        .select('id, name, organization_name, billing_address, tax_id, vat_number, vat_registration_date, contact_email, contact_name')
        .eq(profileLookupField, profileLookupId)
        .maybeSingle();

      if (ownerError || !ownerProfile) {
        return res.status(400).json({ error: 'Owning company/group profile not found for this folio' });
      }

      // Parse billing_address (jsonb) — may contain street, city, country, etc.
      const billingAddr = ownerProfile.billing_address || {};
      const addrParts = [
        billingAddr.street || billingAddr.address || billingAddr.line1,
        billingAddr.city,
        billingAddr.state || billingAddr.region,
        billingAddr.country,
      ].filter(Boolean);

      customerName = ownerProfile.organization_name || ownerProfile.name || ownerProfile.contact_name || 'Guest';
      customerEmail = ownerProfile.contact_email || null;
      customerAddress = addrParts.join(', ') || null;
      customerTin = ownerProfile.tax_id || null;
      customerVatNo = ownerProfile.vat_number || null;
      customerVatDate = ownerProfile.vat_registration_date || null;
      journalCustomerLabel = customerName;
    }

    // ── Fetch tax / VAT info for the invoice (reservation-backed folios) ──
    // Priority for customer TIN/VAT:
    //   1. Group profile linked via booking_group_id (group reservation)
    //   2. Corporate account linked via corporate_account_id
    //   3. Parent group profile (TravelAgent / CorporateAccount) of the group
    //   4. Fallback to reservation.guest_tin / guest_vat_no
    if (reservation) {
    customerTin = reservation.guest_tin || null;
    customerVatNo = reservation.guest_vat_no || null;
    customerName = reservation.guest_name;
    customerEmail = reservation.guest_email || null;
    journalCustomerLabel = reservation.guest_name || 'Guest';

    const groupProfileId = reservation.booking_group_id || reservation.group_booking_id;
    if (groupProfileId) {
      const { data: groupProfile } = await supabaseAdmin
        .from('group_profiles')
        .select('id, name, type, tax_id, vat_number, vat_registration_date, organization_name, billing_address, parent_group_id')
        .eq('id', groupProfileId)
        .maybeSingle();

      if (groupProfile) {
        // Use the group profile's tax info if available
        if (groupProfile.tax_id) customerTin = groupProfile.tax_id;
        if (groupProfile.vat_number) customerVatNo = groupProfile.vat_number;
        if (groupProfile.vat_registration_date) customerVatDate = groupProfile.vat_registration_date;

        // If the group reservation has a parent (TravelAgent/CorporateAccount),
        // prefer the parent's tax info (the agency/corporation is the legal
        // billing entity).
        if (groupProfile.parent_group_id) {
          const { data: parentProfile } = await supabaseAdmin
            .from('group_profiles')
            .select('id, name, type, tax_id, vat_number, vat_registration_date, organization_name, billing_address')
            .eq('id', groupProfile.parent_group_id)
            .maybeSingle();

          if (parentProfile) {
            if (parentProfile.tax_id) customerTin = parentProfile.tax_id;
            if (parentProfile.vat_number) customerVatNo = parentProfile.vat_number;
            if (parentProfile.vat_registration_date) customerVatDate = parentProfile.vat_registration_date;
            // Use the parent org name as the billing name for group/corporate invoices
            if (parentProfile.organization_name || parentProfile.name) {
              customerName = parentProfile.organization_name || parentProfile.name;
            }
            const pAddr = parentProfile.billing_address || {};
            const addrParts = [pAddr.street || pAddr.address || pAddr.line1, pAddr.city, pAddr.state || pAddr.region, pAddr.country].filter(Boolean);
            if (addrParts.length > 0) customerAddress = addrParts.join(', ');
          }
        } else if (groupProfile.type === 'TravelAgent' || groupProfile.type === 'CorporateAccount') {
          // The group profile itself IS the parent (direct invoice to agency/corp)
          if (groupProfile.organization_name || groupProfile.name) {
            customerName = groupProfile.organization_name || groupProfile.name;
          }
          const gAddr = groupProfile.billing_address || {};
          const addrParts = [gAddr.street || gAddr.address || gAddr.line1, gAddr.city, gAddr.state || gAddr.region, gAddr.country].filter(Boolean);
          if (addrParts.length > 0) customerAddress = addrParts.join(', ');
        }
      }
    }

    // Also check corporate_account_id if no group profile matched
    if (!customerTin && reservation.corporate_account_id) {
      const { data: corpAcct } = await supabaseAdmin
        .from('group_profiles')
        .select('tax_id, vat_number, vat_registration_date')
        .eq('id', reservation.corporate_account_id)
        .maybeSingle();
      if (corpAcct) {
        if (corpAcct.tax_id) customerTin = corpAcct.tax_id;
        if (corpAcct.vat_number) customerVatNo = corpAcct.vat_number;
        if (corpAcct.vat_registration_date) customerVatDate = corpAcct.vat_registration_date;
      }
    }
    } // end if (reservation)

    // ── Allow client to override customer info (editable invoice) ──
    // The frontend can pass customerName, customerTin, customerVatNo,
    // customerAddress, customerEmail in the request body to override
    // the auto-resolved values. This lets the user edit the invoice
    // header before generating.
    if (req.body.customerName) customerName = req.body.customerName;
    if (req.body.customerTin !== undefined) customerTin = req.body.customerTin || null;
    if (req.body.customerVatNo !== undefined) customerVatNo = req.body.customerVatNo || null;
    if (req.body.customerAddress !== undefined) customerAddress = req.body.customerAddress || null;
    if (req.body.customerEmail !== undefined) customerEmail = req.body.customerEmail || null;
    journalCustomerLabel = customerName;

    // ── Fetch hotel TIN / VAT from global settings ────────────────────
    const settings = await getGlobalSettings();
    const hotelTin = settings?.hotel_tin || null;
    const hotelVatNo = settings?.hotel_vat_no || null;
    const hotelVatDate = settings?.hotel_vat_date || null;

    // ── Determine which lines to invoice ──────────────────────────────
    let linesQuery = supabaseAdmin
      .from('folio_lines')
      .select('id, amount, line_type, description, quantity, tax_amount')
      .eq('folio_id', folioId)
      .eq('is_voided', false)
      .is('invoice_id', null);

    if (Array.isArray(lineIds) && lineIds.length > 0) {
      // Partial invoice: only the selected line IDs
      linesQuery = linesQuery.in('id', lineIds);
    }
    // else: invoice all non-voided, non-invoiced lines (full / remaining)

    const { data: linesToInvoice, error: linesError } = await linesQuery;

    if (linesError) {
      return res.status(500).json({ error: 'Failed to fetch folio lines', details: linesError.message });
    }

    if (!linesToInvoice || linesToInvoice.length === 0) {
      return res.status(400).json({ error: 'No invoiceable charge lines found (all selected lines may already be invoiced or voided)' });
    }

    // Compute invoice totals from the selected lines
    const subtotal = linesToInvoice.reduce((sum: number, l: any) => sum + Number(l.amount || 0), 0);
    const taxTotal = linesToInvoice.reduce((sum: number, l: any) => sum + Number(l.tax_amount || 0), 0);
    const invoiceTotal = Math.round((subtotal) * 100) / 100;

    // ── Preview mode: return line items + totals without creating the invoice ──
    if (preview) {
      return res.json({
        success: true,
        preview: true,
        folioId,
        folioType: folio.folio_type,
        customerName,
        customerTin,
        customerVatNo,
        customerAddress,
        customerEmail,
        hotelTin,
        hotelVatNo,
        lines: linesToInvoice.map((l: any) => ({
          id: l.id,
          description: l.description,
          lineType: l.line_type,
          quantity: l.quantity || 1,
          amount: Number(l.amount || 0),
          taxAmount: Number(l.tax_amount || 0),
        })),
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        total: invoiceTotal,
        lineCount: linesToInvoice.length,
      });
    }

    // Get folio-wide payment totals (for folio balance context)
    const { data: folioTotals } = await supabaseAdmin.rpc('recompute_folio_totals', {
      p_folio_id: folioId
    });
    const folioBalance = folioTotals?.folio_balance || 0;

    // For a new invoice, no payments are linked yet — amount_paid starts at 0
    // and status is 'Issued'. The link_payments_to_invoice RPC may link existing
    // folio payments to this invoice, in which case we'll update amount_paid below.
    const invoiceAmountPaid = 0;
    const invoiceStatus: string = 'Issued';

    // Generate invoice number
    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create invoice document
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoice_documents')
      .insert({
        id: crypto.randomUUID(),
        folio_id: folioId,
        invoice_number: invoiceNumber,
        invoice_type: invoiceType === 'Group Master' || !reservation ? 'Group Master' : 'Guest',
        issue_date: new Date().toISOString().split('T')[0],
        due_date: dueDate || null,
        subtotal: invoiceTotal,
        tax_total: taxTotal,
        discount_total: 0,
        total: invoiceTotal,
        amount_paid: invoiceAmountPaid,
        status: invoiceStatus,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_address: customerAddress,
        customer_tin: customerTin,
        customer_vat_no: customerVatNo,
        customer_vat_date: customerVatDate,
        hotel_tin: hotelTin,
        hotel_vat_no: hotelVatNo,
        hotel_vat_date: hotelVatDate,
        payment_terms: 'Net 30',
        notes: notes || null,
        is_voided: false,
        created_by: req.user?.id
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError);
      return res.status(500).json({ error: 'Failed to create invoice', details: invoiceError.message });
    }

    // Mark the invoiced lines with the new invoice_id (prevents re-invoicing)
    const invoicedLineIds = linesToInvoice.map((l: any) => l.id);
    const { error: markError } = await supabaseAdmin
      .from('folio_lines')
      .update({ invoice_id: invoice.id })
      .in('id', invoicedLineIds);

    if (markError) {
      console.error('Error marking lines as invoiced:', markError);
      // Non-fatal — invoice was created, just couldn't mark lines
    }

    // Link payments to the invoice
    const { data: linkResult, error: linkError } = await supabaseAdmin.rpc('link_payments_to_invoice', {
      p_invoice_id: invoice.id,
      p_folio_id: folioId
    });

    if (linkError) {
      console.error('Error linking payments to invoice:', linkError);
      // Don't fail the whole operation if linking fails, just log it
    }

    // ── Post outstanding invoice amount to A/R chart of accounts ──────
    // The outstanding amount = invoice total - payments already linked
    const linkedPaymentsCount = linkResult?.paymentsLinked || 0;
    const paymentsOnInvoice = linkedPaymentsCount > 0
      ? await supabaseAdmin
          .from('folio_payments')
          .select('amount')
          .eq('folio_id', folioId)
          .eq('is_voided', false)
          .not('invoice_id', 'is', null)
          .eq('invoice_id', invoice.id)
      : { data: [], error: null };

    const collectedOnInvoice = (paymentsOnInvoice.data || []).reduce(
      (s: number, p: any) => s + Number(p.amount || 0), 0
    );
    const outstandingAmount = Math.round((invoiceTotal - collectedOnInvoice) * 100) / 100;

    // Update the invoice's amount_paid and status to reflect actual collection
    const finalStatus = outstandingAmount <= 0.005 ? 'Paid' : 'Issued';
    await supabaseAdmin
      .from('invoice_documents')
      .update({ amount_paid: collectedOnInvoice, status: finalStatus })
      .eq('id', invoice.id);

    if (outstandingAmount > 0) {
      try {
        // 1. Create a journal entry (AR posting)
        const journalId = crypto.randomUUID();
        const journalRef = `AR-INV-${invoice.invoice_number}`;
        const journalDesc = `A/R posting — Invoice ${invoice.invoice_number} · ${journalCustomerLabel}`;

        // Try inserting journal entry — handle both possible schemas
        try {
          await supabaseAdmin.from('journal_entries').insert({
            id: journalId,
            date: new Date().toISOString().split('T')[0],
            reference: journalRef,
            description: journalDesc,
            status: 'Posted',
            created_by: req.user?.id,
            amount: outstandingAmount,
            department: 'Front Office',
          });
        } catch (jeErr: any) {
          // The journal_entries table may use the migration 074 schema
          // (period, source, total_debit, total_credit instead of amount)
          try {
            await supabaseAdmin.from('journal_entries').insert({
              id: journalId,
              date: new Date().toISOString().split('T')[0],
              period: new Date().toISOString().slice(0, 7),
              source: 'AR',
              reference: journalRef,
              description: journalDesc,
              status: 'Posted',
              total_debit: outstandingAmount,
              total_credit: outstandingAmount,
              department: 'Front Office',
              created_by: req.user?.id,
              posted_at: new Date().toISOString(),
            });
          } catch (jeErr2: any) {
            console.error('[generate-invoice] Could not create journal entry:', jeErr2.message);
          }
        }

        // 2. Insert journal lines — Debit AR (1100), Credit Guest Deposits (2030)
        const arAccount = { code: '1100', name: 'Accounts Receivable - Guests' };
        const clearingAccount = { code: '2030', name: 'Guest Deposits & Advances' };

        // Try with account_id column (baseline schema)
        try {
          await supabaseAdmin.from('journal_lines').insert([
            {
              id: crypto.randomUUID(),
              journal_id: journalId,
              account_id: arAccount.code,
              account_name: arAccount.name,
              description: `Invoice ${invoice.invoice_number} — receivable`,
              debit: outstandingAmount,
              credit: 0,
            },
            {
              id: crypto.randomUUID(),
              journal_id: journalId,
              account_id: clearingAccount.code,
              account_name: clearingAccount.name,
              description: `Invoice ${invoice.invoice_number} — unearned revenue offset`,
              debit: 0,
              credit: outstandingAmount,
            },
          ]);
        } catch (jlErr: any) {
          // Try with account_code column (migration 074 schema)
          try {
            await supabaseAdmin.from('journal_lines').insert([
              {
                id: crypto.randomUUID(),
                journal_id: journalId,
                account_code: arAccount.code,
                account_name: arAccount.name,
                description: `Invoice ${invoice.invoice_number} — receivable`,
                debit: outstandingAmount,
                credit: 0,
              },
              {
                id: crypto.randomUUID(),
                journal_id: journalId,
                account_code: clearingAccount.code,
                account_name: clearingAccount.name,
                description: `Invoice ${invoice.invoice_number} — unearned revenue offset`,
                debit: 0,
                credit: outstandingAmount,
              },
            ]);
          } catch (jlErr2: any) {
            console.error('[generate-invoice] Could not create journal lines:', jlErr2.message);
          }
        }

        // 3. Update chart_of_accounts + usali_chart_of_accounts balances
        //    Debit AR → increase asset balance
        //    Credit Guest Deposits → increase liability balance
        //    Update both CoA tables (chart_of_accounts for operational, usali_chart_of_accounts for finance UI)
        const updateCoaBalance = async (table: string, code: string, delta: number) => {
          try {
            const { data: row } = await supabaseAdmin
              .from(table)
              .select('balance')
              .eq('code', code)
              .single();
            if (row) {
              await supabaseAdmin
                .from(table)
                .update({ balance: Number(row.balance || 0) + delta })
                .eq('code', code);
            }
          } catch { /* table or row may not exist — skip */ }
        };

        await updateCoaBalance('chart_of_accounts', arAccount.code, outstandingAmount);
        await updateCoaBalance('usali_chart_of_accounts', arAccount.code, outstandingAmount);
        await updateCoaBalance('chart_of_accounts', clearingAccount.code, outstandingAmount);
        await updateCoaBalance('usali_chart_of_accounts', clearingAccount.code, outstandingAmount);

        console.log(`[generate-invoice] Posted ${outstandingAmount} to A/R (1100) for invoice ${invoice.invoice_number}`);
      } catch (arErr: any) {
        console.error('[generate-invoice] AR posting failed (non-fatal):', arErr.message);
        // Non-fatal — invoice was created successfully, AR posting is secondary
      }
    }

    return res.json({
      success: true,
      invoice: invoice,
      paymentsLinked: linkResult?.paymentsLinked || 0,
      linesInvoiced: invoicedLineIds.length,
      partial: invoicedLineIds.length < (folioTotals?.total_charges || 0),
      arPosted: outstandingAmount > 0,
      arAmount: outstandingAmount,
    });
  } catch (err: any) {
    console.error('[generate-invoice] UNEXPECTED ERROR:', err);
    return res.status(500).json({ error: 'Failed to generate invoice', details: err.message });
  }
});

// List invoices for a folio
router.get('/:folioId/invoices', authenticate, async (req, res) => {
  const { folioId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('invoice_documents')
      .select('id, invoice_number, invoice_type, issue_date, due_date, subtotal, tax_total, discount_total, total, amount_paid, status, is_voided, created_at')
      .eq('folio_id', folioId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invoices: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch invoices', details: err.message });
  }
});

// Close folio with automatic invoice generation
router.post('/:folioId/close-with-invoice', authenticate, async (req, res) => {
  const { folioId } = req.params;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('close_folio_with_invoice', {
      p_folio_id: folioId,
      p_user_id: req.user?.id
    });

    if (error) {
      console.error('Error closing folio with invoice:', error);
      return res.status(500).json({ error: 'Failed to close folio', details: error.message });
    }

    return res.json(data);
  } catch (err: any) {
    console.error('Unexpected error closing folio:', err);
    return res.status(500).json({ error: 'Failed to close folio', details: err.message });
  }
});

// Collect payment on an outstanding invoice
// Accepts the same payload as the Add Payment endpoint: { paymentSplits: [...] }
// or a single { amount, paymentMethod, reference, bankAccountId }.
// Posts folio_payments linked to the invoice, updates invoice amount_paid/status,
// settles the A/R chart of accounts, and syncs folio totals.
router.post('/invoices/:invoiceId/collect-payment', authenticate, async (req, res) => {
  const { invoiceId } = req.params;
  const body = req.body;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  // Normalize to a splits array (same as POST /:id/payments)
  let splits: Array<{ amount: number; paymentMethod: string; reference?: string; bankAccountId?: string; idempotencyKey?: string }>;
  if (Array.isArray(body?.paymentSplits)) {
    splits = body.paymentSplits;
  } else {
    splits = [{
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      reference: body.reference,
      bankAccountId: body.bankAccountId,
      idempotencyKey: body.idempotencyKey,
    }];
  }

  // Validate splits
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    if (!s.amount || typeof s.amount !== 'number' || s.amount <= 0) {
      return res.status(400).json({ error: `Split ${i + 1}: a positive amount is required` });
    }
    if (!s.paymentMethod) {
      return res.status(400).json({ error: `Split ${i + 1}: payment method is required` });
    }
  }

  try {
    // 1. Fetch the invoice with its folio
    const { data: invoice, error: invError } = await supabaseAdmin
      .from('invoice_documents')
      .select('*, folios!inner(id, reservation_id, status)')
      .eq('id', invoiceId)
      .single();

    if (invError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const folio = invoice.folios;
    if (!folio) {
      return res.status(400).json({ error: 'Invoice has no associated folio' });
    }

    // 2. Compute current outstanding on this invoice
    const { data: existingPayments } = await supabaseAdmin
      .from('folio_payments')
      .select('amount')
      .eq('invoice_id', invoiceId)
      .eq('is_voided', false);

    const collected = (existingPayments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const outstanding = Number(invoice.total || 0) - collected;

    if (outstanding <= 0.005) {
      return res.status(400).json({ error: 'This invoice is already fully paid' });
    }

    const totalRequested = splits.reduce((s, p) => s + p.amount, 0);
    if (totalRequested > outstanding + 0.01) {
      return res.status(400).json({
        error: `Total (${totalRequested.toFixed(2)}) exceeds outstanding balance (${outstanding.toFixed(2)})`,
      });
    }

    // 3. Process each split
    const paymentResults: any[] = [];
    let cumulativeCollected = collected;

    for (const split of splits) {
      const paymentId = crypto.randomUUID();
      const now = new Date().toISOString();

      const { error: payError } = await supabaseAdmin
        .from('folio_payments')
        .insert({
          id: paymentId,
          folio_id: folio.id,
          amount: split.amount,
          payment_method: split.paymentMethod,
          reference_number: split.reference || null,
          user_id: req.user?.id,
          bank_account_id: split.bankAccountId || null,
          invoice_id: invoiceId,
          created_at: now,
        });

      if (payError) {
        console.error('[collect-payment] Failed to insert payment:', payError);
        return res.status(500).json({ error: 'Failed to post payment', details: payError.message });
      }

      cumulativeCollected += split.amount;
      paymentResults.push({
        success: true,
        folioId: folio.id,
        paymentId,
        amount: split.amount,
        method: split.paymentMethod,
      });

      // Settle A/R for this split: Credit AR (1100), Debit Guest Deposits (2030)
      try {
        const arCode = '1100';
        const arName = 'Accounts Receivable - Guests';
        const cdCode = '2030';
        const cdName = 'Guest Deposits & Advances';

        const arJournalId = crypto.randomUUID();
        try {
          await supabaseAdmin.from('journal_entries').insert({
            id: arJournalId,
            date: now.split('T')[0],
            reference: `AR-SETTLE-${paymentId}`,
            description: `A/R settlement — Payment collected on invoice ${invoice.invoice_number}`,
            status: 'Posted',
            created_by: req.user?.id,
            amount: split.amount,
            department: 'Front Office',
          });
        } catch {
          await supabaseAdmin.from('journal_entries').insert({
            id: arJournalId,
            date: now.split('T')[0],
            period: now.slice(0, 7),
            source: 'AR',
            reference: `AR-SETTLE-${paymentId}`,
            description: `A/R settlement — Payment collected on invoice ${invoice.invoice_number}`,
            status: 'Posted',
            total_debit: split.amount,
            total_credit: split.amount,
            department: 'Front Office',
            created_by: req.user?.id,
            posted_at: now,
          });
        }

        // Journal lines: Debit Guest Deposits, Credit AR
        try {
          await supabaseAdmin.from('journal_lines').insert([
            {
              id: crypto.randomUUID(),
              journal_id: arJournalId,
              account_id: cdCode,
              account_name: cdName,
              description: `A/R settlement — invoice ${invoice.invoice_number}`,
              debit: split.amount,
              credit: 0,
            },
            {
              id: crypto.randomUUID(),
              journal_id: arJournalId,
              account_id: arCode,
              account_name: arName,
              description: `A/R settlement — invoice ${invoice.invoice_number}`,
              debit: 0,
              credit: split.amount,
            },
          ]);
        } catch {
          await supabaseAdmin.from('journal_lines').insert([
            {
              id: crypto.randomUUID(),
              journal_id: arJournalId,
              account_code: cdCode,
              account_name: cdName,
              description: `A/R settlement — invoice ${invoice.invoice_number}`,
              debit: split.amount,
              credit: 0,
            },
            {
              id: crypto.randomUUID(),
              journal_id: arJournalId,
              account_code: arCode,
              account_name: arName,
              description: `A/R settlement — invoice ${invoice.invoice_number}`,
              debit: 0,
              credit: split.amount,
            },
          ]);
        }

        // Update CoA balances (both tables)
        const settleCoaBalance = async (table: string, code: string, delta: number) => {
          try {
            const { data: row } = await supabaseAdmin
              .from(table)
              .select('balance')
              .eq('code', code)
              .single();
            if (row) {
              await supabaseAdmin
                .from(table)
                .update({ balance: Number(row.balance || 0) + delta })
                .eq('code', code);
            }
          } catch { /* table or row may not exist — skip */ }
        };

        await settleCoaBalance('chart_of_accounts', arCode, -split.amount);
        await settleCoaBalance('usali_chart_of_accounts', arCode, -split.amount);
        await settleCoaBalance('chart_of_accounts', cdCode, -split.amount);
        await settleCoaBalance('usali_chart_of_accounts', cdCode, -split.amount);

        console.log(`[collect-payment] Settled ${split.amount} from A/R (1100) for invoice ${invoice.invoice_number}`);
      } catch (arErr: any) {
        console.error('[collect-payment] A/R settlement failed (non-fatal):', arErr.message);
      }
    }

    // 4. Update invoice amount_paid and status
    const newOutstanding = Number(invoice.total || 0) - cumulativeCollected;
    const newStatus = newOutstanding <= 0.005 ? 'Paid' : 'Issued';

    await supabaseAdmin
      .from('invoice_documents')
      .update({ amount_paid: cumulativeCollected, status: newStatus })
      .eq('id', invoiceId);

    // 5. Sync folio totals
    try {
      await supabaseAdmin.rpc('recompute_folio_totals', { p_folio_id: folio.id });
    } catch { /* non-fatal */ }

    return res.json({
      success: true,
      paymentResults,
      invoiceId,
      invoiceStatus: newStatus,
      remainingOutstanding: newOutstanding,
    });
  } catch (err: any) {
    console.error('[collect-payment] UNEXPECTED ERROR:', err);
    return res.status(500).json({ error: 'Failed to collect payment', details: err.message });
  }
});

// Get folios by reservation ID
router.get('/', authenticate, async (req, res) => {
  const { reservation_id } = req.query;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Join reservations so the list view has guest_name / room_number without
    // a second round-trip. Selecting a nested object keeps the row shape flat
    // for callers that ignore the join.
    let query = supabaseAdmin
      .from('folios')
      .select('*, reservations(guest_name, room_number, check_in_date, check_out_date)');

    if (reservation_id) {
      query = query.eq('reservation_id', reservation_id);
    }

    query = query.order('opened_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching folios:', error);
      return res.status(500).json({ error: 'Failed to fetch folios', details: error.message });
    }

    return res.json({ folios: data || [] });
  } catch (err: any) {
    console.error('Unexpected error fetching folios:', err);
    return res.status(500).json({ error: 'Failed to fetch folios', details: err.message });
  }
});

// Move a folio line to a different folio
router.post('/folio-lines/:lineId/move', authenticate, async (req, res) => {

  const { lineId } = req.params;
  const { targetFolioId } = req.body;

  if (!targetFolioId) return res.status(400).json({ error: 'targetFolioId is required' });

  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('move_folio_line', {
      p_line_id: lineId,
      p_target_folio_id: targetFolioId,
      p_user_id: req.user!.id,
    });

    if (error) return res.status(500).json({ error: error.message });
    if (!data?.success) return res.status(409).json({ error: data?.error || 'Move failed' });

    return res.json({ success: true, lineId, fromFolio: data.fromFolio, toFolio: data.toFolio });
  }

  return res.status(503).json({ error: 'Database not configured' });
});

// Folio payments audit
router.get('/folio-payments/audit', authenticate, async (req, res) => {
  const { startDate, endDate, paymentMethod, search } = req.query;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Simple query without complex joins first
    let query = supabaseAdmin
      .from('folio_payments')
      .select('*')
      .order('payment_date', { ascending: false });

    if (startDate) {
      query = query.gte('payment_date', startDate);
    }
    if (endDate) {
      query = query.lte('payment_date', endDate);
    }
    if (paymentMethod) {
      query = query.eq('payment_method', paymentMethod);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching folio payments audit:', error);
      return res.status(500).json({ error: 'Failed to fetch folio payments', details: error.message });
    }

    // Fetch folio details for each payment
    const paymentsWithDetails = await Promise.all(
      (data || []).map(async (payment) => {
        const sa = supabaseAdmin!;
        const { data: folio } = await sa
          .from('folios')
          .select('reservation_id, folio_type, status')
          .eq('id', payment.folio_id)
          .single();

        let reservation = null;
        if (folio?.reservation_id) {
          const { data: res } = await sa
            .from('reservations')
            .select('id, guest_name, room_number, check_in_date, check_out_date')
            .eq('id', folio.reservation_id)
            .single();
          reservation = res;
        }

        // Fetch invoice details if payment is linked to an invoice
        let invoice = null;
        if (payment.invoice_id) {
          const { data: inv } = await sa
            .from('invoice_documents')
            .select('id, invoice_number, invoice_type, issue_date, total, status')
            .eq('id', payment.invoice_id)
            .single();
          invoice = inv;
        }

        // Fetch bank account details if payment has a bank account
        let bankAccount = null;
        if (payment.bank_account_id) {
          const { data: bank } = await sa
            .from('bank_accounts')
            .select('id, account_name, account_number, bank_name')
            .eq('id', payment.bank_account_id)
            .single();
          bankAccount = bank;
        }

        return {
          ...payment,
          folios: folio,
          reservations: reservation,
          invoice_documents: invoice,
          bank_accounts: bankAccount
        };
      })
    );

    // Client-side filtering for search
    let filteredPayments = paymentsWithDetails || [];
    if (search) {
      const searchLower = String(search).toLowerCase();
      filteredPayments = filteredPayments.filter(p =>
        (p.reservations?.guest_name?.toLowerCase().includes(searchLower)) ||
        (p.reservations?.room_number?.toLowerCase().includes(searchLower)) ||
        (p.reference_number?.toLowerCase().includes(searchLower))
      );
    }

    return res.json({ payments: filteredPayments });
  } catch (err: any) {
    console.error('Unexpected error fetching folio payments:', err);
    return res.status(500).json({ error: 'Failed to fetch folio payments', details: err.message });
  }
});

// ── Group & Company Folio Endpoints ───────────────────────────────────────

// Get all folios for a group booking (by group_id)
router.get('/group/:groupId', authenticate, async (req, res) => {
  const { groupId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const { data: folios, error } = await supabaseAdmin
      .from('folios')
      .select(`
        id, folio_type, target_folio, status, balance, total_charges,
        total_payments, currency, group_id, owner_type, owner_id,
        opened_at, closed_at, notes,
        reservations ( id, guest_name, room_number, check_in_date, check_out_date, status )
      `)
      .eq('group_id', groupId)
      .order('opened_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Group the folios by type for easy frontend consumption
    const grouped = {
      groupFolio: folios?.find(f => f.folio_type === 'Group') || null,
      companyFolio: folios?.find(f => f.folio_type === 'Company') || null,
      guestFolios: folios?.filter(f => f.folio_type === 'Guest' && f.target_folio !== 'B') || [],
      masterFolios: folios?.filter(f => f.folio_type === 'Master') || [],
      incidentalFolios: folios?.filter(f => f.folio_type === 'Guest' && f.target_folio === 'B') || [],
      all: folios || [],
    };

    return res.json(grouped);
  } catch (err: any) {
    console.error('Error fetching group folios:', err);
    return res.status(500).json({ error: 'Failed to fetch group folios', details: err.message });
  }
});

// Get the company folio tree for a corporate account / group profile
// Returns: Company folio → Group folios → Guest folios + A/R (invoices + payments)
router.get('/company/:profileId', authenticate, async (req, res) => {
  const { profileId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    // 1. Get the profile details
    const { data: profile } = await supabaseAdmin
      .from('group_profiles')
      .select('id, name, type, organization_name, tax_id, vat_number, vat_registration_date, contact_email, contact_phone')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // 2. Get the Company folio(s) owned by this profile
    const { data: companyFolios, error: companyError } = await supabaseAdmin
      .from('folios')
      .select('id, folio_type, status, balance, total_charges, total_payments, currency, owner_type, owner_id, group_id, opened_at, closed_at, notes, parent_folio_id')
      .eq('owner_type', 'group_profile')
      .eq('owner_id', profileId)
      .order('opened_at', { ascending: false });

    if (companyError) return res.status(500).json({ error: companyError.message });

    // 3. Get all Group folios that are children of any Company folio
    const companyFolioIds = (companyFolios || []).map(f => f.id);
    let groupFolios: any[] = [];
    if (companyFolioIds.length > 0) {
      const { data: groups } = await supabaseAdmin
        .from('folios')
        .select('id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, closed_at, notes')
        .in('parent_folio_id', companyFolioIds)
        .eq('folio_type', 'Group')
        .order('opened_at', { ascending: true });
      groupFolios = groups || [];
    }

    // Also get Group folios by group_id matching the profile's child group reservations
    // (covers Group folios created before parent_folio_id linking was added)
    const { data: childGroupProfiles } = await supabaseAdmin
      .from('group_profiles')
      .select('id')
      .eq('parent_group_id', profileId);
    const childGroupIds = (childGroupProfiles || []).map(g => g.id);
    if (childGroupIds.length > 0) {
      const { data: legacyGroups } = await supabaseAdmin
        .from('folios')
        .select('id, folio_type, status, balance, total_charges, total_payments, currency, group_id, parent_folio_id, opened_at, closed_at, notes')
        .in('group_id', childGroupIds)
        .eq('folio_type', 'Group')
        .is('parent_folio_id', null);
      // Merge, avoiding duplicates by id
      const existingIds = new Set(groupFolios.map(g => g.id));
      for (const g of (legacyGroups || [])) {
        if (!existingIds.has(g.id)) groupFolios.push(g);
      }
    }

    // 4. Get all Guest/Master folios that are children of any Group folio
    const groupFolioIds = groupFolios.map(g => g.id);
    let guestFolios: any[] = [];
    if (groupFolioIds.length > 0) {
      const { data: guests } = await supabaseAdmin
        .from('folios')
        .select(`
          id, folio_type, target_folio, status, balance, total_charges, total_payments,
          currency, group_id, parent_folio_id, opened_at, closed_at, notes,
          reservations ( id, guest_name, room_number, check_in_date, check_out_date, status )
        `)
        .in('parent_folio_id', groupFolioIds)
        .in('folio_type', ['Guest', 'Master'])
        .order('opened_at', { ascending: true });
      guestFolios = guests || [];
    }

    // Also get folios by group_id (for folios created before parent_folio_id)
    if (childGroupIds.length > 0) {
      const { data: legacyGuests } = await supabaseAdmin
        .from('folios')
        .select(`
          id, folio_type, target_folio, status, balance, total_charges, total_payments,
          currency, group_id, parent_folio_id, opened_at, closed_at, notes,
          reservations ( id, guest_name, room_number, check_in_date, check_out_date, status )
        `)
        .in('group_id', childGroupIds)
        .in('folio_type', ['Guest', 'Master'])
        .is('parent_folio_id', null);
      const existingIds = new Set(guestFolios.map(g => g.id));
      for (const g of (legacyGuests || [])) {
        if (!existingIds.has(g.id)) guestFolios.push(g);
      }
    }

    // 5. Get A/R: invoices and payments from all folios in the tree
    const allFolioIds = [...companyFolioIds, ...groupFolioIds, ...guestFolios.map(g => g.id)];
    let invoices: any[] = [];
    let payments: any[] = [];

    if (allFolioIds.length > 0) {
      const { data: invData } = await supabaseAdmin
        .from('invoice_documents')
        .select('id, invoice_number, invoice_type, issue_date, due_date, subtotal, tax_total, total, amount_paid, status, is_voided, folio_id, created_at')
        .in('folio_id', allFolioIds)
        .order('created_at', { ascending: false });
      invoices = invData || [];

      const { data: payData } = await supabaseAdmin
        .from('folio_payments')
        .select('id, folio_id, amount, payment_method, reference_number, payment_date, is_voided')
        .in('folio_id', allFolioIds)
        .eq('is_voided', false)
        .order('payment_date', { ascending: false });
      payments = payData || [];
    }

    // 6. Build the tree structure
    const tree = (companyFolios || []).map(companyFolio => {
      const groups = groupFolios
        .filter(g => g.parent_folio_id === companyFolio.id)
        .map(groupFolio => {
          const guests = guestFolios
            .filter(g => g.parent_folio_id === groupFolio.id)
            .map(g => ({ ...g }));
          const groupInvoices = invoices.filter(i => i.folio_id === groupFolio.id);
          const groupPayments = payments.filter(p => p.folio_id === groupFolio.id);
          return {
            ...groupFolio,
            guestFolios: guests,
            invoices: groupInvoices,
            payments: groupPayments,
          };
        });

      const companyInvoices = invoices.filter(i => i.folio_id === companyFolio.id);
      const companyPayments = payments.filter(p => p.folio_id === companyFolio.id);

      return {
        ...companyFolio,
        groupFolios: groups,
        invoices: companyInvoices,
        payments: companyPayments,
      };
    });

    // Compute totals across the entire tree
    const totalCharges = [...(companyFolios || []), ...groupFolios, ...guestFolios]
      .reduce((s, f) => s + Number(f.total_charges || 0), 0);
    const totalPayments = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalBalance = totalCharges - totalPayments;

    return res.json({
      profile,
      companyFolios: tree,
      totals: {
        charges: totalCharges,
        payments: totalPayments,
        balance: totalBalance,
        invoiceCount: invoices.length,
        paymentCount: payments.length,
      },
    });
  } catch (err: any) {
    console.error('Error fetching company folios:', err);
    return res.status(500).json({ error: 'Failed to fetch company folios', details: err.message });
  }
});

// Post a charge directly to a Group folio (transportation, banquet, etc.)
router.post('/group/:groupId/charges', authenticate, async (req, res) => {
  const { groupId } = req.params;
  const { description, amount, quantity, lineType, discountPercent } = req.body;

  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  if (!description || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Description and positive amount are required' });
  }

  try {
    // Find the Group folio for this group booking
    const { data: groupFolio, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('id, status')
      .eq('folio_type', 'Group')
      .eq('group_id', groupId)
      .eq('status', 'Open')
      .maybeSingle();

    if (folioError) return res.status(500).json({ error: folioError.message });
    if (!groupFolio) return res.status(404).json({ error: 'No open Group folio found for this group booking' });

    const { data, error } = await supabaseAdmin.rpc('post_folio_charge_with_routing', {
      p_origin_folio_id: groupFolio.id,
      p_description: description,
      p_amount: amount,
      p_quantity: quantity || 1,
      p_line_type: lineType || 'Extra',
      p_revenue_account_code: null,
      p_user_id: req.user?.id || 'system',
      p_source_reference: null,
      p_discount_percent: discountPercent || 0,
      p_reservation_id: null,
      p_source_module: 'frontoffice',
    });

    if (error) return res.status(500).json({ error: 'Failed to post charge', details: error.message });

    return res.json({ success: true, folioId: groupFolio.id, lineId: data?.line_id });
  } catch (err: any) {
    console.error('Error posting group charge:', err);
    return res.status(500).json({ error: 'Failed to post group charge', details: err.message });
  }
});

// Get consolidated folio data for a group (aggregates all folio lines + payments)
router.get('/group/:groupId/consolidated', authenticate, async (req, res) => {
  const { groupId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    // Get all folio IDs for this group
    const { data: folios, error: folioError } = await supabaseAdmin
      .from('folios')
      .select('id, folio_type, target_folio, status')
      .eq('group_id', groupId);

    if (folioError) return res.status(500).json({ error: folioError.message });
    if (!folios || folios.length === 0) return res.json({ charges: [], payments: [], totals: { charges: 0, payments: 0, balance: 0 } });

    const folioIds = folios.map(f => f.id);

    // Get all folio lines across these folios
    const { data: lines, error: linesError } = await supabaseAdmin
      .from('folio_lines')
      .select('id, folio_id, description, amount, quantity, line_type, is_voided, created_at')
      .in('folio_id', folioIds)
      .eq('is_voided', false)
      .order('created_at', { ascending: true });

    if (linesError) return res.status(500).json({ error: linesError.message });

    // Get all payments across these folios
    const { data: payments, error: paymentsError } = await supabaseAdmin
      .from('folio_payments')
      .select('id, folio_id, amount, payment_method, reference_number, payment_date, is_voided')
      .in('folio_id', folioIds)
      .eq('is_voided', false)
      .order('payment_date', { ascending: true });

    if (paymentsError) return res.status(500).json({ error: paymentsError.message });

    // Map folio_id → folio_type for reference
    const folioMap = new Map(folios.map(f => [f.id, f]));

    const charges = (lines || []).map(l => ({
      ...l,
      folio_type: folioMap.get(l.folio_id)?.folio_type,
      target_folio: folioMap.get(l.folio_id)?.target_folio,
    }));

    const enrichedPayments = (payments || []).map(p => ({
      ...p,
      folio_type: folioMap.get(p.folio_id)?.folio_type,
    }));

    const totalCharges = charges.reduce((s, c) => s + Number(c.amount || 0), 0);
    const totalPayments = enrichedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    return res.json({
      charges,
      payments: enrichedPayments,
      folios,
      totals: {
        charges: totalCharges,
        payments: totalPayments,
        balance: totalCharges - totalPayments,
      },
    });
  } catch (err: any) {
    console.error('Error fetching consolidated group folio:', err);
    return res.status(500).json({ error: 'Failed to fetch consolidated group folio', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// CONSOLIDATED VIEW — all charges across the folio hierarchy
// Returns this folio + all child folios (by parent_folio_id) + all lines
// ══════════════════════════════════════════════════════════════════

router.get('/:folioId/consolidated', authenticate, async (req, res) => {
  const { folioId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    // 1. Get this folio + all descendants (walk parent_folio_id chain)
    const { data: rootFolio } = await supabaseAdmin
      .from('folios')
      .select('id, folio_type, target_folio, status, reservation_id, group_id, owner_type, owner_id, parent_folio_id, total_charges, total_payments, balance, currency')
      .eq('id', folioId)
      .maybeSingle();

    if (!rootFolio) return res.status(404).json({ error: 'Folio not found' });

    // Collect all folio IDs: this one + all children recursively
    const allFolios: any[] = [rootFolio];
    const folioIdQueue: string[] = [folioId];
    const visited = new Set<string>([folioId]);

    while (folioIdQueue.length > 0) {
      const currentId = folioIdQueue.shift()!;
      const { data: children } = await supabaseAdmin
        .from('folios')
        .select('id, folio_type, target_folio, status, reservation_id, group_id, owner_type, owner_id, parent_folio_id, total_charges, total_payments, balance, currency')
        .eq('parent_folio_id', currentId);

      if (children) {
        for (const child of children) {
          if (!visited.has(child.id)) {
            visited.add(child.id);
            allFolios.push(child);
            folioIdQueue.push(child.id);
          }
        }
      }
    }

    const allFolioIds = allFolios.map((f) => f.id);

    // 2. Get all folio_lines across all folios in the hierarchy
    const { data: allLines, error: linesError } = await supabaseAdmin
      .from('folio_lines')
      .select('id, folio_id, description, amount, quantity, line_type, is_voided, created_at, transaction_date, window_id, origin_folio_id, is_routed, routed_from_folio_id, is_disputed, invoice_id')
      .in('folio_id', allFolioIds)
      .order('created_at', { ascending: true });

    if (linesError) return res.status(500).json({ error: linesError.message });

    // 3. Get all payments across all folios
    const { data: allPayments, error: paymentsError } = await supabaseAdmin
      .from('folio_payments')
      .select('id, folio_id, amount, payment_method, reference_number, payment_date, is_voided')
      .in('folio_id', allFolioIds)
      .eq('is_voided', false)
      .order('payment_date', { ascending: true });

    if (paymentsError) return res.status(500).json({ error: paymentsError.message });

    // 4. Build a folio map for reference
    const folioMap = new Map(allFolios.map((f) => [f.id, f]));

    // 5. Enrich lines with folio info
    const enrichedLines = (allLines || []).map((l) => ({
      ...l,
      folio_type: folioMap.get(l.folio_id)?.folio_type,
      target_folio: folioMap.get(l.folio_id)?.target_folio,
      reservation_id: folioMap.get(l.folio_id)?.reservation_id,
    }));

    const enrichedPayments = (allPayments || []).map((p) => ({
      ...p,
      folio_type: folioMap.get(p.folio_id)?.folio_type,
    }));

    // 6. Compute totals
    const totalCharges = enrichedLines
      .filter((l) => !l.is_voided)
      .reduce((s, l) => s + Number(l.amount || 0), 0);
    const totalPayments = enrichedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    return res.json({
      folios: allFolios,
      lines: enrichedLines,
      payments: enrichedPayments,
      totals: {
        charges: totalCharges,
        payments: totalPayments,
        balance: totalCharges - totalPayments,
        folioCount: allFolios.length,
      },
    });
  } catch (err: any) {
    console.error('Error fetching consolidated folio:', err);
    return res.status(500).json({ error: 'Failed to fetch consolidated folio', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// FOLIO WINDOWS — sub-folio windows for split billing
// ══════════════════════════════════════════════════════════════════

// Get all windows for a folio
router.get('/:folioId/windows', authenticate, async (req, res) => {
  const { folioId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('folio_windows')
      .select('*')
      .eq('folio_id', folioId)
      .order('window_number', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ windows: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch folio windows', details: err.message });
  }
});

// Create a new window on a folio
router.post('/:folioId/windows', authenticate, async (req, res) => {
  const { folioId } = req.params;
  const { label, paymentMethodId, isDefault } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    // Get next window number
    const { data: existing } = await supabaseAdmin
      .from('folio_windows')
      .select('window_number')
      .eq('folio_id', folioId)
      .order('window_number', { ascending: false })
      .limit(1);
    const nextNumber = (existing && existing.length > 0 ? existing[0].window_number : 0) + 1;

    // If this is set as default, unset other defaults
    if (isDefault) {
      await supabaseAdmin
        .from('folio_windows')
        .update({ is_default: false })
        .eq('folio_id', folioId);
    }

    const windowId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from('folio_windows')
      .insert({
        id: windowId,
        folio_id: folioId,
        window_number: nextNumber,
        label: label || `Window ${nextNumber}`,
        payment_method_id: paymentMethodId || null,
        is_default: isDefault || nextNumber === 1,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ window: data });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to create folio window', details: err.message });
  }
});

// Update a window
router.patch('/windows/:windowId', authenticate, async (req, res) => {
  const { windowId } = req.params;
  const { label, paymentMethodId, isDefault } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    if (isDefault) {
      // Get the folio_id for this window, then unset other defaults
      const { data: window } = await supabaseAdmin
        .from('folio_windows')
        .select('folio_id')
        .eq('id', windowId)
        .single();
      if (window) {
        await supabaseAdmin
          .from('folio_windows')
          .update({ is_default: false })
          .eq('folio_id', window.folio_id);
      }
    }
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (label !== undefined) updates.label = label;
    if (paymentMethodId !== undefined) updates.payment_method_id = paymentMethodId;
    if (isDefault !== undefined) updates.is_default = isDefault;
    const { data, error } = await supabaseAdmin
      .from('folio_windows')
      .update(updates)
      .eq('id', windowId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ window: data });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update folio window', details: err.message });
  }
});

// Delete a window (only if it has no lines)
router.delete('/windows/:windowId', authenticate, async (req, res) => {
  const { windowId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    // Check if window has lines
    const { count } = await supabaseAdmin
      .from('folio_lines')
      .select('id', { count: 'exact', head: true })
      .eq('window_id', windowId);
    if (count && count > 0) {
      return res.status(400).json({ error: 'Cannot delete a window that has charges. Move charges first.' });
    }
    const { error } = await supabaseAdmin
      .from('folio_windows')
      .delete()
      .eq('id', windowId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete folio window', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// ROUTING RULES — auto-sweep rules for charge routing
// ══════════════════════════════════════════════════════════════════

// Get all routing rules for a folio (the scope folio)
router.get('/:folioId/routing-rules', authenticate, async (req, res) => {
  const { folioId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('routing_rules')
      .select('*')
      .eq('scope_folio_id', folioId)
      .order('priority', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rules: data || [] });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch routing rules', details: err.message });
  }
});

// Create a routing rule
router.post('/:folioId/routing-rules', authenticate, async (req, res) => {
  const { folioId } = req.params;
  const {
    appliesTo,
    chargeCategoryFilter,
    specificReservationId,
    targetFolioId,
    targetWindowId,
    effectiveFrom,
    effectiveTo,
    maxAmount,
    priority,
    notes,
  } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  if (!appliesTo || !['all_charges', 'charge_category', 'specific_reservation'].includes(appliesTo)) {
    return res.status(400).json({ error: 'appliesTo must be all_charges, charge_category, or specific_reservation' });
  }
  try {
    const ruleId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from('routing_rules')
      .insert({
        id: ruleId,
        scope_folio_id: folioId,
        applies_to: appliesTo,
        charge_category_filter: chargeCategoryFilter || [],
        specific_reservation_id: specificReservationId || null,
        target_folio_id: targetFolioId || null,
        target_window_id: targetWindowId || null,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        max_amount: maxAmount || null,
        is_active: true,
        priority: priority || 0,
        created_by: req.user?.id || null,
        notes: notes || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rule: data });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to create routing rule', details: err.message });
  }
});

// Update a routing rule
router.patch('/routing-rules/:ruleId', authenticate, async (req, res) => {
  const { ruleId } = req.params;
  const {
    appliesTo,
    chargeCategoryFilter,
    specificReservationId,
    targetFolioId,
    targetWindowId,
    effectiveFrom,
    effectiveTo,
    maxAmount,
    isActive,
    priority,
    notes,
  } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (appliesTo !== undefined) updates.applies_to = appliesTo;
    if (chargeCategoryFilter !== undefined) updates.charge_category_filter = chargeCategoryFilter;
    if (specificReservationId !== undefined) updates.specific_reservation_id = specificReservationId;
    if (targetFolioId !== undefined) updates.target_folio_id = targetFolioId;
    if (targetWindowId !== undefined) updates.target_window_id = targetWindowId;
    if (effectiveFrom !== undefined) updates.effective_from = effectiveFrom;
    if (effectiveTo !== undefined) updates.effective_to = effectiveTo;
    if (maxAmount !== undefined) updates.max_amount = maxAmount;
    if (isActive !== undefined) updates.is_active = isActive;
    if (priority !== undefined) updates.priority = priority;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabaseAdmin
      .from('routing_rules')
      .update(updates)
      .eq('id', ruleId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rule: data });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update routing rule', details: err.message });
  }
});

// Delete a routing rule
router.delete('/routing-rules/:ruleId', authenticate, async (req, res) => {
  const { ruleId } = req.params;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  try {
    const { error } = await supabaseAdmin
      .from('routing_rules')
      .delete()
      .eq('id', ruleId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete routing rule', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// MASS POST — post a charge to all member folios of a group
// ══════════════════════════════════════════════════════════════════

router.post('/group/:groupId/mass-post', authenticate, async (req, res) => {
  const { groupId } = req.params;
  const { description, amount, lineType, reservationIds, excludeRouted } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  if (!description || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'description and positive amount are required' });
  }
  try {
    // Get all Guest folios for this group
    let folioQuery = supabaseAdmin
      .from('folios')
      .select('id, reservation_id, folio_type, status')
      .eq('group_id', groupId)
      .eq('status', 'Open');
    if (reservationIds && Array.isArray(reservationIds) && reservationIds.length > 0) {
      folioQuery = folioQuery.in('reservation_id', reservationIds);
    }
    const { data: groupFolios, error: folioError } = await folioQuery;
    if (folioError) return res.status(500).json({ error: folioError.message });
    if (!groupFolios || groupFolios.length === 0) {
      return res.status(404).json({ error: 'No open folios found for this group' });
    }

    // Post charge to each folio using the routing-enabled RPC
    const results: any[] = [];
    for (const folio of groupFolios) {
      const { data, error } = await supabaseAdmin.rpc('post_folio_charge_with_routing', {
        p_origin_folio_id: folio.id,
        p_description: description,
        p_amount: amount,
        p_quantity: 1,
        p_line_type: lineType || 'Extra',
        p_revenue_account_code: null,
        p_user_id: req.user?.id || 'system',
        p_source_reference: null,
        p_discount_percent: 0,
        p_reservation_id: folio.reservation_id,
        p_source_module: 'frontoffice',
      });
      results.push({
        folioId: folio.id,
        reservationId: folio.reservation_id,
        success: !error && data?.success,
        isRouted: data?.isRouted || false,
        targetFolioId: data?.folioId,
        error: error?.message || null,
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const routed = results.filter(r => r.isRouted).length;

    return res.json({
      success: true,
      posted: succeeded,
      routed,
      failed: results.length - succeeded,
      results,
    });
  } catch (err: any) {
    console.error('Error in mass post:', err);
    return res.status(500).json({ error: 'Failed to mass post charges', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// CHARGE POSTING WITH ROUTING — post a charge with auto-routing
// ══════════════════════════════════════════════════════════════════

router.post('/:folioId/charges-routed', authenticate, async (req, res) => {
  const { folioId } = req.params;
  const { description, amount, quantity, lineType, revenueAccountCode, sourceReference, discountPercent, reservationId, sourceModule } = req.body;
  if (!hasSupabaseAdminConfig || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  if (!description || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'description and positive amount are required' });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('post_folio_charge_with_routing', {
      p_origin_folio_id: folioId,
      p_description: description,
      p_amount: amount,
      p_quantity: quantity || 1,
      p_line_type: lineType || 'Extra',
      p_revenue_account_code: revenueAccountCode || null,
      p_user_id: req.user?.id || 'system',
      p_source_reference: sourceReference || null,
      p_discount_percent: discountPercent || 0,
      p_reservation_id: reservationId || null,
      p_source_module: sourceModule || 'frontoffice',
    });
    if (error) return res.status(500).json({ error: 'Failed to post charge', details: error.message });
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to post charge with routing', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// FOLIO MANAGEMENT REBUILD (migration 246 / docs/Folio & billing.md)
// New spec-compliant endpoints. The legacy endpoints above remain
// for backward compatibility with existing consumers.
// ══════════════════════════════════════════════════════════════════

import {
  listFolios, getFolio, getFolioTree, getFolioTransactions, getFolioSummary,
  getFolioAuditTimeline, postCharge, postPayment, postSplitPayment, splitFolio, transferFolio,
  reverseLine, editLine, voidLine, voidPayment, closeFolio, reopenFolio, voidFolio, updateFolio,
  FolioServiceError,
} from '../services/folioService';

function handleFolioError(res: any, err: any) {
  if (err instanceof FolioServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('Folio service error:', err);
  return res.status(500).json({ error: 'Internal server error', details: err.message });
}

// ── GET /folios/v2 — list folios with filters ───────────────────
router.get('/v2', authenticate, async (req, res) => {
  try {
    const rows = await listFolios({
      reservationId: req.query.reservationId as string | undefined,
      folioType: req.query.folioType as string | undefined,
      status: req.query.status as string | undefined,
      groupId: req.query.groupId as string | undefined,
      ownerId: req.query.ownerId as string | undefined,
    });
    res.json({ folios: rows });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── GET /folios/v2/:folioId — single folio ──────────────────────
router.get('/v2/:folioId', authenticate, async (req, res) => {
  try {
    const folio = await getFolio(req.params.folioId);
    res.json({ folio });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── GET /folios/v2/:folioId/tree — folio hierarchy tree ─────────
router.get('/v2/:folioId/tree', authenticate, async (req, res) => {
  try {
    const tree = await getFolioTree(req.params.folioId);
    res.json({ tree });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── GET /folios/v2/:folioId/summary — folio summary ─────────────
router.get('/v2/:folioId/summary', authenticate, async (req, res) => {
  try {
    const summary = await getFolioSummary(req.params.folioId);
    res.json(summary);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── GET /folios/v2/:folioId/transactions — unified ledger ───────
router.get('/v2/:folioId/transactions', authenticate, async (req, res) => {
  try {
    const txns = await getFolioTransactions(req.params.folioId, {
      type: req.query.type as string | undefined,
      department: req.query.department as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      status: req.query.status as string | undefined,
    });
    res.json({ transactions: txns });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── GET /folios/v2/:folioId/activity — audit timeline ───────────
router.get('/v2/:folioId/activity', authenticate, async (req, res) => {
  try {
    const entries = await getFolioAuditTimeline(req.params.folioId);
    res.json({ entries });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/charges — post a charge ────────────
router.post('/v2/:folioId/charges', authenticate, async (req, res) => {
  try {
    const result = await postCharge(req.params.folioId, req.body, req.user);
    res.json({ success: true, ...result });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/payments — post a payment (single or split) ──
router.post('/v2/:folioId/payments', authenticate, async (req, res) => {
  try {
    const body = req.body;
    // Support split payments: { paymentSplits: [...] }
    if (Array.isArray(body.paymentSplits) && body.paymentSplits.length > 0) {
      const result = await postSplitPayment(req.params.folioId, body.paymentSplits, req.user);
      res.json({ success: true, ...result });
    } else {
      const result = await postPayment(req.params.folioId, body, req.user);
      res.json({ success: true, ...result });
    }
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/split — split folio ────────────────
router.post('/v2/:folioId/split', authenticate, async (req, res) => {
  try {
    const { lineIds, destFolioId, destFolioType, destReservationId, reason } = req.body;
    if (!Array.isArray(lineIds) || lineIds.length === 0) {
      return res.status(400).json({ error: 'lineIds array is required' });
    }
    const result = await splitFolio(req.params.folioId, lineIds, {
      destFolioId, destFolioType, destReservationId, reason,
    }, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/transfer — transfer transactions ───
router.post('/v2/:folioId/transfer', authenticate, async (req, res) => {
  try {
    const { destFolioId, lineIds, transferType, reason, reference } = req.body;
    if (!destFolioId) return res.status(400).json({ error: 'destFolioId is required' });
    const result = await transferFolio(req.params.folioId, destFolioId, {
      lineIds, transferType, reason, reference,
    }, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/lines/:lineId/reverse — reverse a charge ────
router.post('/v2/lines/:lineId/reverse', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await reverseLine(req.params.lineId, reason, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── PATCH /folios/v2/lines/:lineId — edit a charge line ─────────
router.patch('/v2/lines/:lineId', authenticate, async (req, res) => {
  try {
    const { description, amount, lineType, quantity } = req.body;
    const updates: any = {};
    if (description !== undefined) updates.description = description;
    if (amount !== undefined) updates.amount = amount;
    if (lineType !== undefined) updates.lineType = lineType;
    if (quantity !== undefined) updates.quantity = quantity;
    const result = await editLine(req.params.lineId, updates, req.user);
    res.json({ success: true, ...result });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/lines/:lineId/void — void a charge line ────
router.post('/v2/lines/:lineId/void', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await voidLine(req.params.lineId, reason, req.user);
    res.json({ success: true, ...result });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/payments/:paymentId/void — void payment
router.post('/v2/:folioId/payments/:paymentId/void', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await voidPayment(req.params.folioId, req.params.paymentId, reason, req.user);
    res.json({ success: true, ...result });
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/close — close folio ────────────────
router.post('/v2/:folioId/close', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await closeFolio(req.params.folioId, reason, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/reopen — reopen folio ──────────────
router.post('/v2/:folioId/reopen', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await reopenFolio(req.params.folioId, reason, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── POST /folios/v2/:folioId/void — void folio ──────────────────
router.post('/v2/:folioId/void', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const result = await voidFolio(req.params.folioId, reason, req.user);
    res.json(result);
  } catch (err) {
    handleFolioError(res, err);
  }
});

// ── PATCH /folios/v2/:folioId — update folio metadata ───────────
router.patch('/v2/:folioId', authenticate, async (req, res) => {
  try {
    const result = await updateFolio(req.params.folioId, req.body, req.user);
    res.json({ success: true, folio: result });
  } catch (err) {
    handleFolioError(res, err);
  }
});

export default router;
