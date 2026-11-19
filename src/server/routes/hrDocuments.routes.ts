/**
 * HR Document Management API (property-scoped)
 * ──────────────────────────────────────────────────────────────────────────
 * DB-backed read/write for contracts, personal docs, certifications, and
 * payroll documents. All stored in the generic hr_documents table.
 * Mounted at /api/hr-portal/documents.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

const CACHE_PREFIX = 'hr-documents:';

// ── Statistics ─────────────────────────────────────────────────────────────
router.get('/statistics/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId } = req.params;

  const cacheKey = `${CACHE_PREFIX}stats:${propertyId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const { data, error } = await supabaseAdmin.from('hr_documents').select('*').eq('property_id', propertyId);
  if (error) return res.status(500).json({ error: error.message });

  const docs = data || [];
  const today = new Date();
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiringSoon = docs.filter((d) => {
    if (!d.expiry_date) return false;
    const exp = new Date(d.expiry_date);
    return exp > today && exp <= thirtyDays;
  }).length;

  const expired = docs.filter((d) => {
    if (!d.expiry_date) return false;
    return new Date(d.expiry_date) <= today;
  }).length;

  const thisMonth = docs.filter((d) => {
    const cd = new Date(d.created_at);
    return cd.getFullYear() === today.getFullYear() && cd.getMonth() === today.getMonth();
  }).length;

  const stats = { totalDocuments: docs.length, expiringSoon, expired, thisMonth };
  cacheService.set(cacheKey, stats, 60 * 1000);
  return res.json(stats);
});

// ── Documents by type ──────────────────────────────────────────────────────
router.get('/:docType/:propertyId', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { docType, propertyId } = req.params;
  const { data, error } = await supabaseAdmin.from('hr_documents')
    .select('*').eq('property_id', propertyId).eq('doc_type', docType).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ documents: data || [] });
});

router.post('/', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { propertyId, docType, employee, documentName, category, documentNumber,
    startDate, endDate, issuedDate, issueDate, expiryDate, generatedDate, version,
    status, lastUpdated, period, issuingOrganization, reason, fileUrl } = req.body || {};

  if (!propertyId || !docType || !documentName) return res.status(400).json({ error: 'propertyId, docType and documentName are required' });

  const { data, error } = await supabaseAdmin.from('hr_documents').insert({
    property_id: propertyId, doc_type: docType, employee: employee || null,
    document_name: documentName, category: category || null,
    document_number: documentNumber || null,
    start_date: startDate || null, end_date: endDate || null,
    issued_date: issuedDate || null, issue_date: issueDate || null,
    expiry_date: expiryDate || null, generated_date: generatedDate || null,
    version: version || null,
    status: status || 'Active',
    last_updated: lastUpdated || null,
    period: period || null,
    issuing_organization: issuingOrganization || null,
    reason: reason || null,
    file_url: fileUrl || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.status(201).json(data);
});

router.put('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { employee, documentName, category, documentNumber, startDate, endDate,
    issuedDate, issueDate, expiryDate, generatedDate, version, status, lastUpdated,
    period, issuingOrganization, reason, fileUrl } = req.body || {};

  const patch: any = { updated_at: new Date().toISOString() };
  if (employee !== undefined) patch.employee = employee;
  if (documentName !== undefined) patch.document_name = documentName;
  if (category !== undefined) patch.category = category;
  if (documentNumber !== undefined) patch.document_number = documentNumber;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  if (issuedDate !== undefined) patch.issued_date = issuedDate;
  if (issueDate !== undefined) patch.issue_date = issueDate;
  if (expiryDate !== undefined) patch.expiry_date = expiryDate;
  if (generatedDate !== undefined) patch.generated_date = generatedDate;
  if (version !== undefined) patch.version = version;
  if (status !== undefined) patch.status = status;
  if (lastUpdated !== undefined) patch.last_updated = lastUpdated;
  if (period !== undefined) patch.period = period;
  if (issuingOrganization !== undefined) patch.issuing_organization = issuingOrganization;
  if (reason !== undefined) patch.reason = reason;
  if (fileUrl !== undefined) patch.file_url = fileUrl;

  const { data, error } = await supabaseAdmin.from('hr_documents').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json(data);
});

router.delete('/:id', authenticate, requirePermission('hr:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('hr_documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidatePattern(`^${CACHE_PREFIX.replace(':', '\\:')}`);
  return res.json({ success: true });
});

export default router;
