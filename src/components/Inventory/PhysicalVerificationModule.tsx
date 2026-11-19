/**
 * Physical Verification — /erp/inventory/physical-verification
 *
 * Spec §77 — consolidated year-end physical resource verification module:
 *   - Asset verification campaigns + results (uinv_verification_campaigns, uinv_asset_verifications)
 *   - Tool verification status (uinv_tools, uinv_tool_assignments)
 *   - Linen verification status (uinv_linen)
 *   - Uniform verification status (uinv_uniforms, uinv_uniform_assignments)
 *   - Custody verification (active assignments across assets/tools/uniforms)
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardCheck, Plus, Search, Loader2, ServerCrash, MoreVertical, Trash2, Edit3, Check, AlertTriangle, Package, Wrench, Shirt, BedDouble, Users, ShieldCheck } from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchVerificationCampaigns, createVerificationCampaign, updateVerificationCampaign, deleteVerificationCampaign,
  fetchAssetVerifications, updateAssetVerification,
  fetchAssets, fetchTools, fetchLinen, fetchUniforms, fetchToolAssignments, fetchUniformAssignments,
  type UinvVerificationCampaign, type UinvAssetVerification, type UinvAsset,
  type UinvTool, type UinvLinenItem, type UinvUniformItem, type UinvToolAssignment, type UinvUniformAssignment,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const SUB_TABS = [
  { id: 'campaigns', label: 'Campaigns', icon: ClipboardCheck },
  { id: 'asset-verification', label: 'Asset Verification', icon: ShieldCheck },
  { id: 'resource-summary', label: 'Resource Summary', icon: Package },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

function statusToneFor(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['Completed', 'Found', 'Resolved', 'Returned', 'Available', 'In Stock'].includes(status)) return 'success';
  if (['Open', 'In Progress', 'Pending', 'Investigating', 'Issued', 'Active', 'Overdue'].includes(status)) return 'warning';
  if (['Cancelled', 'Damaged', 'Missing', 'Lost', 'Stolen', 'Disposed', 'Retired', 'Out of Service'].includes(status)) return 'danger';
  if (['Wrong Location', 'Wrong Custodian', 'Duplicate', 'Unidentified'].includes(status)) return 'info';
  return 'neutral';
}

function resultTone(result: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (result === 'Found') return 'success';
  if (['Wrong Location', 'Wrong Custodian', 'Duplicate', 'Unidentified'].includes(result)) return 'info';
  if (['Damaged'].includes(result)) return 'warning';
  if (['Missing'].includes(result)) return 'danger';
  return 'neutral';
}

interface PhysicalVerificationModuleProps {
  /** Optional initial sub-tab (used when routed from /erp/inventory/:tab). */
  initialTab?: SubTab;
  /** Optional sub-tab bar rendered after KPI cards (used by wrapper components) */
  subTabBar?: React.ReactNode;
}

const PhysicalVerificationModule: React.FC<PhysicalVerificationModuleProps> = ({ initialTab = 'campaigns', subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [sub, setSub] = useState<SubTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Data
  const [campaigns, setCampaigns] = useState<UinvVerificationCampaign[]>([]);
  const [assetVerifications, setAssetVerifications] = useState<UinvAssetVerification[]>([]);
  const [assets, setAssets] = useState<UinvAsset[]>([]);
  const [tools, setTools] = useState<UinvTool[]>([]);
  const [linen, setLinen] = useState<UinvLinenItem[]>([]);
  const [uniforms, setUniforms] = useState<UinvUniformItem[]>([]);
  const [toolAssignments, setToolAssignments] = useState<UinvToolAssignment[]>([]);
  const [uniformAssignments, setUniformAssignments] = useState<UinvUniformAssignment[]>([]);

  // Filters (Asset Verification tab)
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterResult, setFilterResult] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Forms
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState<Partial<UinvVerificationCampaign>>({});
  const [detailCampaign, setDetailCampaign] = useState<UinvVerificationCampaign | null>(null);

  // Asset verification edit modal
  const [editVerification, setEditVerification] = useState<UinvAssetVerification | null>(null);
  const [verificationForm, setVerificationForm] = useState<Partial<UinvAssetVerification>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [cpg, av, ast, tl, ln, uf, ta, ua] = await Promise.all([
        fetchVerificationCampaigns({ propertyId }),
        fetchAssetVerifications(),
        fetchAssets({ propertyId }),
        fetchTools({ propertyId }),
        fetchLinen({ propertyId }),
        fetchUniforms({ propertyId }),
        fetchToolAssignments({ propertyId, status: 'Active' }),
        fetchUniformAssignments({ propertyId, status: 'Issued' }),
      ]);
      setCampaigns(cpg);
      setAssetVerifications(av);
      setAssets(ast);
      setTools(tl);
      setLinen(ln);
      setUniforms(uf);
      setToolAssignments(ta);
      setUniformAssignments(ua);
    } catch (e: any) {
      setError(e?.message || 'Failed to load physical verification data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const assetLabel = (id?: string | null) => assets.find(a => a.id === id)?.asset_name || id || '—';
  const campaignLabel = (id?: string | null) => campaigns.find(c => c.id === id)?.campaign_name || id || '—';

  const kpis = useMemo(() => ({
    openCampaigns: campaigns.filter(c => c.status === 'Open').length,
    inProgress: campaigns.filter(c => c.status === 'In Progress').length,
    completed: campaigns.filter(c => c.status === 'Completed').length,
    totalExceptions: assetVerifications.filter(v => v.result !== 'Found').length,
  }), [campaigns, assetVerifications]);

  const resourceSummary = useMemo(() => {
    const verifiedAssets = assetVerifications.filter(v => v.result === 'Found').length;
    const missingAssets = assetVerifications.filter(v => v.result === 'Missing').length;
    const damagedAssets = assetVerifications.filter(v => v.result === 'Damaged').length;

    const toolsAssigned = tools.filter(t => t.status === 'Issued').length;
    const toolsAvailable = tools.filter(t => t.status === 'In Stock').length;

    const linenBelowPar = linen.filter(l => (l.clean_quantity + l.store_quantity) < l.par_level).length;

    const uniformsAssigned = uniforms.reduce((sum, u) => sum + (u.issued_quantity || 0), 0);
    const uniformsAvailable = uniforms.reduce((sum, u) => sum + Math.max(0, (u.stock_quantity - u.issued_quantity)), 0);

    return {
      totalAssets: assets.length,
      verifiedAssets,
      missingAssets,
      damagedAssets,
      totalTools: tools.length,
      toolsAssigned,
      toolsAvailable,
      totalLinen: linen.length,
      linenBelowPar,
      totalUniforms: uniforms.length,
      uniformsAssigned,
      uniformsAvailable,
    };
  }, [assets, assetVerifications, tools, linen, uniforms]);

  const matchSearch = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());

  // ── Campaign actions ──
  const openCampaignForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    setCampaignForm({
      property_id: currentPropertyId,
      scope: 'Full',
      start_date: today,
      status: 'Open',
      assigned_verifiers: [],
      scope_filter: {},
    });
    setShowCampaignForm(true);
  };
  const submitCampaign = async () => {
    if (!campaignForm.campaign_name || !campaignForm.start_date) {
      addNotification('Campaign name and start date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createVerificationCampaign({ ...campaignForm, property_id: currentPropertyId });
      addNotification('Verification campaign created.', 'success', 'Inventory');
      setShowCampaignForm(false);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create campaign', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const advanceCampaign = async (c: UinvVerificationCampaign, status: UinvVerificationCampaign['status']) => {
    if (!c.id) return;
    setActingOn(c.id);
    try {
      await updateVerificationCampaign(c.id, {
        status,
        end_date: status === 'Completed' ? new Date().toISOString().slice(0, 10) : c.end_date,
      });
      addNotification(`Campaign → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update campaign', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };
  const removeCampaign = async (id: string) => {
    setActingOn(id);
    try { await deleteVerificationCampaign(id); addNotification('Campaign deleted.', 'task', 'Inventory'); load(); }
    catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Asset Verification actions ──
  const openVerificationEdit = (v: UinvAssetVerification) => {
    setEditVerification(v);
    setVerificationForm({
      confirmed_location: v.confirmed_location || v.expected_location,
      confirmed_custodian: v.confirmed_custodian || v.expected_custodian,
      confirmed_condition: v.confirmed_condition || 'Good',
      result: v.result,
      exception_notes: v.exception_notes,
      resolution: v.resolution,
      status: v.status,
    });
  };
  const submitVerification = async () => {
    if (!editVerification?.id) return;
    setSubmitting(true);
    try {
      await updateAssetVerification(editVerification.id, {
        ...verificationForm,
        scanned_at: new Date().toISOString(),
        resolved_at: verificationForm.status === 'Resolved' ? new Date().toISOString() : null,
      });
      addNotification('Verification result updated.', 'success', 'Inventory');
      setEditVerification(null);
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update verification', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const resolveVerification = async (v: UinvAssetVerification) => {
    if (!v.id) return;
    setActingOn(v.id);
    try {
      await updateAssetVerification(v.id, { status: 'Resolved', resolved_at: new Date().toISOString() });
      addNotification('Exception resolved.', 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to resolve', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  const renderMenu = (id: string, children: ReactNode) => (
    <div className="relative">
      <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === id ? null : id)}>
        <MoreVertical className="w-4 h-4" />
      </IconButton>
      {menuOpen === id && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1" onMouseLeave={() => setMenuOpen(null)}>
          {children}
        </div>
      )}
    </div>
  );

  const filteredVerifications = useMemo(() => {
    return assetVerifications.filter(v => {
      if (filterCampaign && v.campaign_id !== filterCampaign) return false;
      if (filterResult && v.result !== filterResult) return false;
      if (filterStatus && v.status !== filterStatus) return false;
      if (search) {
        const hay = `${assetLabel(v.asset_id)} ${v.confirmed_location || ''} ${v.confirmed_custodian || ''} ${v.exception_notes || ''}`;
        if (!hay.toLowerCase().includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [assetVerifications, filterCampaign, filterResult, filterStatus, search, assets]);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Physical Verification"
        subtitle="Year-end physical resource verification — asset campaigns, tool, linen, uniform and custody verification."
        icon={ClipboardCheck}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Refresh
            </button>
            {sub === 'campaigns' && <button onClick={openCampaignForm} className={button.primary}><Plus className="w-4 h-4" /> New Campaign</button>}
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Open Campaigns" value={kpis.openCampaigns} icon={ClipboardCheck} tone="warning" />
        <StatCard title="In Progress" value={kpis.inProgress} icon={Loader2} tone="info" />
        <StatCard title="Completed" value={kpis.completed} icon={Check} tone="success" />
        <StatCard title="Total Exceptions" value={kpis.totalExceptions} icon={AlertTriangle} tone="danger" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {SUB_TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => { setSub(t.id); setSearch(''); setMenuOpen(null); }}
                  className={['px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                    sub === t.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
        </div>
      </SectionCard>

      {/* ── Campaigns ── */}
      {sub === 'campaigns' && (
        <InventoryTable
          rows={campaigns.filter(c => matchSearch(c.campaign_name) || matchSearch(c.campaign_number))}
          rowKey={c => c.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No verification campaigns. Create one to begin year-end verification."
          columns={[
            { key: 'number', header: 'Campaign #', widthClass: 'md:w-40 shrink-0', render: c => <span className="font-medium text-slate-900 dark:text-white">{c.campaign_number}</span> },
            { key: 'name', header: 'Campaign', widthClass: 'md:w-56 shrink-0', render: c => <span className="text-sm text-slate-700 dark:text-slate-300">{c.campaign_name}</span> },
            { key: 'scope', header: 'Scope', widthClass: 'md:w-32 shrink-0', render: c => <Badge tone="neutral">{c.scope}</Badge> },
            { key: 'dates', header: 'Period', widthClass: 'md:w-40 shrink-0', render: c => <span className="text-xs text-slate-500">{c.start_date} → {c.end_date || '—'}</span> },
            { key: 'verifiers', header: 'Verifiers', widthClass: 'md:w-40 shrink-0', render: c => <span className="text-xs text-slate-500">{(c.assigned_verifiers || []).join(', ') || '—'}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: c => <Badge tone={statusToneFor(c.status)} variant="solid">{c.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: c => (
              <OpsCell>
                {c.status === 'Open' && <IconButton onClick={() => advanceCampaign(c, 'In Progress')} title="Start"><Edit3 className="w-4 h-4" /></IconButton>}
                {c.status === 'In Progress' && <IconButton onClick={() => advanceCampaign(c, 'Completed')} title="Complete"><Check className="w-4 h-4" /></IconButton>}
                <IconButton onClick={() => setDetailCampaign(c)} title="Details"><ShieldCheck className="w-4 h-4" /></IconButton>
                {renderMenu(c.id, (
                  <>
                    {c.status !== 'Completed' && c.status !== 'Cancelled' && (
                      <button onClick={() => advanceCampaign(c, 'Cancelled')} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Cancel Campaign</button>
                    )}
                    <button onClick={() => removeCampaign(c.id)} disabled={actingOn === c.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  </>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Asset Verification ── */}
      {sub === 'asset-verification' && (
        <>
          {/* Exceptions banner */}
          {filteredVerifications.some(v => v.result !== 'Found' && v.status !== 'Resolved') && (
            <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {filteredVerifications.filter(v => v.result !== 'Found' && v.status !== 'Resolved').length} unresolved exception(s) require attention.
            </div>
          )}

          {/* Filters */}
          <SectionCard pad="md">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <Field label="Campaign">
                  <select className={inputClass} value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}>
                    <option value="">All campaigns</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.campaign_name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex-1 min-w-[160px]">
                <Field label="Result">
                  <select className={inputClass} value={filterResult} onChange={e => setFilterResult(e.target.value)}>
                    <option value="">All results</option>
                    {['Found', 'Wrong Location', 'Wrong Custodian', 'Damaged', 'Missing', 'Duplicate', 'Unidentified'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex-1 min-w-[140px]">
                <Field label="Status">
                  <select className={inputClass} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {['Open', 'Investigating', 'Resolved'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              {(filterCampaign || filterResult || filterStatus) && (
                <button onClick={() => { setFilterCampaign(''); setFilterResult(''); setFilterStatus(''); }} className={button.ghost + ' mt-5'}>Clear</button>
              )}
            </div>
          </SectionCard>

          <InventoryTable
            rows={filteredVerifications}
            rowKey={v => v.id}
            loading={loading}
            error={error}
            onRetry={load}
            emptyMessage="No asset verification records. Run a campaign to generate verification lines."
            columns={[
              { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: v => <span className="font-medium text-slate-900 dark:text-white">{assetLabel(v.asset_id)}</span> },
              { key: 'campaign', header: 'Campaign', widthClass: 'md:w-48 shrink-0', render: v => <span className="text-xs text-slate-500">{campaignLabel(v.campaign_id)}</span> },
              { key: 'location', header: 'Location', widthClass: 'md:w-40 shrink-0', render: v => (
                <div className="text-xs">
                  <span className="text-slate-400">Exp: </span><span className="text-slate-600 dark:text-slate-300">{v.expected_location || '—'}</span>
                  {v.confirmed_location && v.confirmed_location !== v.expected_location && (
                    <div><span className="text-amber-500">Act: </span><span className="text-amber-700 dark:text-amber-300">{v.confirmed_location}</span></div>
                  )}
                </div>
              ) },
              { key: 'custodian', header: 'Custodian', widthClass: 'md:w-40 shrink-0', render: v => (
                <div className="text-xs">
                  <span className="text-slate-400">Exp: </span><span className="text-slate-600 dark:text-slate-300">{v.expected_custodian || '—'}</span>
                  {v.confirmed_custodian && v.confirmed_custodian !== v.expected_custodian && (
                    <div><span className="text-amber-500">Act: </span><span className="text-amber-700 dark:text-amber-300">{v.confirmed_custodian}</span></div>
                  )}
                </div>
              ) },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: v => <Badge tone={v.confirmed_condition === 'Damaged' || v.confirmed_condition === 'Unusable' ? 'danger' : 'neutral'}>{v.confirmed_condition || '—'}</Badge> },
              { key: 'result', header: 'Result', widthClass: 'md:w-32 shrink-0', render: v => <Badge tone={resultTone(v.result)} variant="solid">{v.result}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: v => <Badge tone={statusToneFor(v.status)} variant="solid">{v.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: v => (
                <OpsCell>
                  <IconButton onClick={() => openVerificationEdit(v)} title="Edit Verification"><Edit3 className="w-4 h-4" /></IconButton>
                  {v.result !== 'Found' && v.status !== 'Resolved' && <IconButton onClick={() => resolveVerification(v)} title="Resolve"><Check className="w-4 h-4" /></IconButton>}
                  {renderMenu(v.id, (
                    <button onClick={() => openVerificationEdit(v)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Edit Details</button>
                  ))}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Resource Summary ── */}
      {sub === 'resource-summary' && (
        <>
          {/* Assets summary */}
          <SectionCard title="Asset Verification Summary" icon={Package} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Total Assets" value={resourceSummary.totalAssets} icon={Package} tone="info" />
              <StatCard title="Verified (Found)" value={resourceSummary.verifiedAssets} icon={Check} tone="success" />
              <StatCard title="Missing" value={resourceSummary.missingAssets} icon={AlertTriangle} tone="danger" />
              <StatCard title="Damaged" value={resourceSummary.damagedAssets} icon={AlertTriangle} tone="warning" />
            </div>
          </SectionCard>

          {/* Tools summary */}
          <SectionCard title="Tool Verification Status" icon={Wrench} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Total Tools" value={resourceSummary.totalTools} icon={Wrench} tone="info" />
              <StatCard title="Assigned" value={resourceSummary.toolsAssigned} icon={Users} tone="warning" />
              <StatCard title="Available" value={resourceSummary.toolsAvailable} icon={Check} tone="success" />
            </div>
            <div className="mt-4">
              <InventoryTable
                rows={tools.filter(t => matchSearch(t.tool_name) || matchSearch(t.tool_code))}
                rowKey={t => t.id}
                loading={loading}
                emptyMessage="No tools registered."
                columns={[
                  { key: 'tool', header: 'Tool', widthClass: 'md:w-48 shrink-0', render: t => <span className="font-medium text-slate-900 dark:text-white">{t.tool_name}</span> },
                  { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: t => <span className="text-xs text-slate-500">{t.tool_code}</span> },
                  { key: 'type', header: 'Type', widthClass: 'md:w-32 shrink-0', render: t => <Badge tone="neutral">{t.type}</Badge> },
                  { key: 'custodian', header: 'Custodian', widthClass: 'md:w-40 shrink-0', render: t => <span className="text-sm text-slate-600">{t.custodian || '—'}</span> },
                  { key: 'location', header: 'Location', widthClass: 'md:w-40 shrink-0', render: t => <span className="text-sm text-slate-600">{t.location || '—'}</span> },
                  { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={t.condition === 'Damaged' || t.condition === 'Unusable' ? 'danger' : 'neutral'}>{t.condition}</Badge> },
                  { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={statusToneFor(t.status)} variant="solid">{t.status}</Badge> },
                ]}
              />
            </div>
          </SectionCard>

          {/* Linen summary */}
          <SectionCard title="Linen Verification Status" icon={BedDouble} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Total Linen Items" value={resourceSummary.totalLinen} icon={BedDouble} tone="info" />
              <StatCard title="Below PAR" value={resourceSummary.linenBelowPar} icon={AlertTriangle} tone="danger" />
            </div>
            <div className="mt-4">
              <InventoryTable
                rows={linen.filter(l => matchSearch(l.item_name) || matchSearch(l.item_code))}
                rowKey={l => l.id}
                loading={loading}
                emptyMessage="No linen items registered."
                columns={[
                  { key: 'item', header: 'Item', widthClass: 'md:w-48 shrink-0', render: l => <span className="font-medium text-slate-900 dark:text-white">{l.item_name}</span> },
                  { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-xs text-slate-500">{l.item_code}</span> },
                  { key: 'category', header: 'Category', widthClass: 'md:w-32 shrink-0', render: l => <Badge tone="neutral">{l.category}</Badge> },
                  { key: 'clean', header: 'Clean Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => <span className="text-sm font-medium">{l.clean_quantity}</span> },
                  { key: 'dirty', header: 'Dirty Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => <span className="text-sm font-medium">{l.dirty_quantity}</span> },
                  { key: 'damaged', header: 'Damaged', widthClass: 'md:w-24 shrink-0', align: 'right', render: l => <span className="text-sm font-medium text-red-600">{l.damaged_quantity}</span> },
                  { key: 'par', header: 'PAR', widthClass: 'md:w-20 shrink-0', align: 'right', render: l => <span className="text-sm text-slate-500">{l.par_level}</span> },
                  { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: l => <Badge tone={(l.clean_quantity + l.store_quantity) < l.par_level ? 'danger' : 'success'} variant="solid">{(l.clean_quantity + l.store_quantity) < l.par_level ? 'Below PAR' : 'OK'}</Badge> },
                ]}
              />
            </div>
          </SectionCard>

          {/* Uniform summary */}
          <SectionCard title="Uniform Verification Status" icon={Shirt} pad="md">
            <div className={layout.kpiGrid}>
              <StatCard title="Total Uniform Items" value={resourceSummary.totalUniforms} icon={Shirt} tone="info" />
              <StatCard title="Assigned" value={resourceSummary.uniformsAssigned} icon={Users} tone="warning" />
              <StatCard title="Available" value={resourceSummary.uniformsAvailable} icon={Check} tone="success" />
            </div>
            <div className="mt-4">
              <InventoryTable
                rows={uniforms.filter(u => matchSearch(u.item_name) || matchSearch(u.item_code))}
                rowKey={u => u.id}
                loading={loading}
                emptyMessage="No uniform items registered."
                columns={[
                  { key: 'item', header: 'Item', widthClass: 'md:w-48 shrink-0', render: u => <span className="font-medium text-slate-900 dark:text-white">{u.item_name}</span> },
                  { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: u => <span className="text-xs text-slate-500">{u.item_code}</span> },
                  { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: u => <span className="text-sm text-slate-600">{u.department || '—'}</span> },
                  { key: 'role', header: 'Role', widthClass: 'md:w-32 shrink-0', render: u => <span className="text-sm text-slate-600">{u.role || '—'}</span> },
                  { key: 'stock', header: 'Stock', widthClass: 'md:w-20 shrink-0', align: 'right', render: u => <span className="text-sm font-medium">{u.stock_quantity}</span> },
                  { key: 'issued', header: 'Issued', widthClass: 'md:w-20 shrink-0', align: 'right', render: u => <span className="text-sm font-medium">{u.issued_quantity}</span> },
                  { key: 'avail', header: 'Available', widthClass: 'md:w-24 shrink-0', align: 'right', render: u => <span className="text-sm font-medium text-green-600">{Math.max(0, u.stock_quantity - u.issued_quantity)}</span> },
                ]}
              />
            </div>
          </SectionCard>

          {/* Custody verification */}
          <SectionCard title="Custody Verification — Active Assignments" icon={Users} pad="none">
            <div className="px-4 pt-4 pb-2 text-xs font-bold text-gray-500 uppercase tracking-wide">Tool Assignments (Active)</div>
            <InventoryTable
              rows={toolAssignments.filter(t => matchSearch(t.employee) || matchSearch(t.department || ''))}
              rowKey={t => t.id}
              loading={loading}
              emptyMessage="No active tool assignments."
              columns={[
                { key: 'employee', header: 'Employee', widthClass: 'md:w-48 shrink-0', render: t => <span className="font-medium text-slate-900 dark:text-white">{t.employee}</span> },
                { key: 'tool', header: 'Tool', widthClass: 'md:w-48 shrink-0', render: t => <span className="text-sm text-slate-700 dark:text-slate-300">{t.tool?.tool_name || '—'}</span> },
                { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: t => <span className="text-sm text-slate-600">{t.department || '—'}</span> },
                { key: 'issue', header: 'Issue Date', widthClass: 'md:w-32 shrink-0', render: t => <span className="text-xs text-slate-500">{t.issue_date}</span> },
                { key: 'return', header: 'Expected Return', widthClass: 'md:w-32 shrink-0', render: t => <span className="text-xs text-slate-500">{t.expected_return_date || '—'}</span> },
                { key: 'cond', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone="neutral">{t.condition_at_issue}</Badge> },
                { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={statusToneFor(t.status)} variant="solid">{t.status}</Badge> },
              ]}
            />
            <div className="px-4 pt-4 pb-2 text-xs font-bold text-gray-500 uppercase tracking-wide">Uniform Assignments (Issued)</div>
            <InventoryTable
              rows={uniformAssignments.filter(u => matchSearch(u.employee) || matchSearch(u.department || ''))}
              rowKey={u => u.id}
              loading={loading}
              emptyMessage="No active uniform assignments."
              columns={[
                { key: 'employee', header: 'Employee', widthClass: 'md:w-48 shrink-0', render: u => <span className="font-medium text-slate-900 dark:text-white">{u.employee}</span> },
                { key: 'uniform', header: 'Uniform', widthClass: 'md:w-48 shrink-0', render: u => <span className="text-sm text-slate-700 dark:text-slate-300">{u.uniform?.item_name || '—'}</span> },
                { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: u => <span className="text-sm text-slate-600">{u.department || '—'}</span> },
                { key: 'role', header: 'Role', widthClass: 'md:w-32 shrink-0', render: u => <span className="text-sm text-slate-600">{u.role || '—'}</span> },
                { key: 'size', header: 'Size', widthClass: 'md:w-20 shrink-0', render: u => <span className="text-sm text-slate-600">{u.size || '—'}</span> },
                { key: 'qty', header: 'Qty', widthClass: 'md:w-20 shrink-0', align: 'right', render: u => <span className="text-sm font-medium">{u.quantity}</span> },
                { key: 'issue', header: 'Issue Date', widthClass: 'md:w-32 shrink-0', render: u => <span className="text-xs text-slate-500">{u.issue_date}</span> },
                { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: u => <Badge tone={statusToneFor(u.status)} variant="solid">{u.status}</Badge> },
              ]}
            />
          </SectionCard>
        </>
      )}

      {/* ── Modals ── */}
      <ModalSystem isOpen={showCampaignForm} onClose={() => setShowCampaignForm(false)} onConfirm={submitCampaign} title="New Verification Campaign" loading={submitting} confirmLabel="Create" size="lg">
        <div className="space-y-4">
          <Field label="Campaign Name *"><input className={inputClass} value={campaignForm.campaign_name || ''} onChange={e => setCampaignForm({ ...campaignForm, campaign_name: e.target.value })} placeholder="e.g. FY2025 Year-End Asset Verification" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Scope">
              <select className={inputClass} value={campaignForm.scope || 'Full'} onChange={e => setCampaignForm({ ...campaignForm, scope: e.target.value as UinvVerificationCampaign['scope'] })}>
                {['Full', 'By Class', 'By Department', 'By Location', 'By Custodian', 'Sample'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} value={campaignForm.status || 'Open'} onChange={e => setCampaignForm({ ...campaignForm, status: e.target.value as UinvVerificationCampaign['status'] })}>
                {['Open', 'In Progress', 'Completed', 'Cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date *"><input type="date" className={inputClass} value={campaignForm.start_date || ''} onChange={e => setCampaignForm({ ...campaignForm, start_date: e.target.value })} /></Field>
            <Field label="End Date"><input type="date" className={inputClass} value={campaignForm.end_date || ''} onChange={e => setCampaignForm({ ...campaignForm, end_date: e.target.value || null })} /></Field>
          </div>
          <Field label="Assigned Verifiers (comma-separated)"><input className={inputClass} value={(campaignForm.assigned_verifiers || []).join(', ')} onChange={e => setCampaignForm({ ...campaignForm, assigned_verifiers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="e.g. John Doe, Jane Smith" /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={campaignForm.notes || ''} onChange={e => setCampaignForm({ ...campaignForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      {/* Campaign detail modal */}
      <ModalSystem isOpen={!!detailCampaign} onClose={() => setDetailCampaign(null)} title={detailCampaign?.campaign_name || 'Campaign Details'} size="lg" showFooter={false}>
        {detailCampaign && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-xs font-bold text-gray-500 uppercase">Campaign #</span><p className="text-slate-900 dark:text-white">{detailCampaign.campaign_number}</p></div>
              <div><span className="text-xs font-bold text-gray-500 uppercase">Status</span><p><Badge tone={statusToneFor(detailCampaign.status)} variant="solid">{detailCampaign.status}</Badge></p></div>
              <div><span className="text-xs font-bold text-gray-500 uppercase">Scope</span><p className="text-slate-900 dark:text-white">{detailCampaign.scope}</p></div>
              <div><span className="text-xs font-bold text-gray-500 uppercase">Period</span><p className="text-slate-900 dark:text-white">{detailCampaign.start_date} → {detailCampaign.end_date || '—'}</p></div>
              <div><span className="text-xs font-bold text-gray-500 uppercase">Verifiers</span><p className="text-slate-900 dark:text-white">{(detailCampaign.assigned_verifiers || []).join(', ') || '—'}</p></div>
              <div><span className="text-xs font-bold text-gray-500 uppercase">Created By</span><p className="text-slate-900 dark:text-white">{detailCampaign.created_by || '—'}</p></div>
            </div>
            {detailCampaign.notes && (
              <div><span className="text-xs font-bold text-gray-500 uppercase">Notes</span><p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{detailCampaign.notes}</p></div>
            )}
            <div>
              <span className="text-xs font-bold text-gray-500 uppercase">Verification Results</span>
              <div className="mt-2">
                <InventoryTable
                  rows={assetVerifications.filter(v => v.campaign_id === detailCampaign.id)}
                  rowKey={v => v.id}
                  loading={loading}
                  emptyMessage="No verification results for this campaign yet."
                  columns={[
                    { key: 'asset', header: 'Asset', widthClass: 'md:w-48 shrink-0', render: v => <span className="text-sm font-medium text-slate-900 dark:text-white">{assetLabel(v.asset_id)}</span> },
                    { key: 'result', header: 'Result', widthClass: 'md:w-32 shrink-0', render: v => <Badge tone={resultTone(v.result)} variant="solid">{v.result}</Badge> },
                    { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: v => <Badge tone={statusToneFor(v.status)} variant="solid">{v.status}</Badge> },
                    { key: 'scanned', header: 'Scanned At', widthClass: 'md:w-40 shrink-0', render: v => <span className="text-xs text-slate-500">{v.scanned_at ? new Date(v.scanned_at).toLocaleString() : '—'}</span> },
                  ]}
                />
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Asset Verification edit modal */}
      <ModalSystem isOpen={!!editVerification} onClose={() => setEditVerification(null)} onConfirm={submitVerification} title="Update Verification Result" loading={submitting} confirmLabel="Save" size="lg">
        {editVerification && (
          <div className="space-y-4">
            <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm">
              <span className="text-xs font-bold text-gray-500 uppercase">Asset</span>
              <p className="text-slate-900 dark:text-white font-medium">{assetLabel(editVerification.asset_id)}</p>
              <div className="mt-1 text-xs text-slate-500">
                Expected: {editVerification.expected_location || '—'} · {editVerification.expected_custodian || '—'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Confirmed Location"><input className={inputClass} value={verificationForm.confirmed_location || ''} onChange={e => setVerificationForm({ ...verificationForm, confirmed_location: e.target.value || null })} /></Field>
              <Field label="Confirmed Custodian"><input className={inputClass} value={verificationForm.confirmed_custodian || ''} onChange={e => setVerificationForm({ ...verificationForm, confirmed_custodian: e.target.value || null })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Confirmed Condition">
                <select className={inputClass} value={verificationForm.confirmed_condition || 'Good'} onChange={e => setVerificationForm({ ...verificationForm, confirmed_condition: e.target.value as any })}>
                  {['New', 'Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Unusable'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Result">
                <select className={inputClass} value={verificationForm.result || 'Found'} onChange={e => setVerificationForm({ ...verificationForm, result: e.target.value as UinvAssetVerification['result'] })}>
                  {['Found', 'Wrong Location', 'Wrong Custodian', 'Damaged', 'Missing', 'Duplicate', 'Unidentified'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Status">
              <select className={inputClass} value={verificationForm.status || 'Open'} onChange={e => setVerificationForm({ ...verificationForm, status: e.target.value as UinvAssetVerification['status'] })}>
                {['Open', 'Investigating', 'Resolved'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Exception Notes"><textarea className={inputClass} rows={2} value={verificationForm.exception_notes || ''} onChange={e => setVerificationForm({ ...verificationForm, exception_notes: e.target.value || null })} /></Field>
            <Field label="Resolution"><textarea className={inputClass} rows={2} value={verificationForm.resolution || ''} onChange={e => setVerificationForm({ ...verificationForm, resolution: e.target.value || null })} /></Field>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default PhysicalVerificationModule;
