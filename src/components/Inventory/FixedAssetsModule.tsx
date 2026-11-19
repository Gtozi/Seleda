/**
 * Fixed Assets Register — /erp/inventory/fixed-assets
 *
 * DB-backed replacement for the old checkout-oriented module.
 * Covers: Asset register, asset classes, components, assignments,
 * transfers, verification campaigns, warranties, insurance, and disposals.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Package, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  Trash2, Boxes, ArrowRightLeft, AlertOctagon, ShieldCheck, FileCheck,
  Tag, Tags, Building2, Briefcase, FileText, Edit3, Eye, Check, Play, Undo2, Wrench, Archive,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchAssets, fetchAsset, createAsset, updateAsset, deleteAsset,
  fetchAssetClasses, createAssetClass, updateAssetClass, deleteAssetClass,
  fetchAssetAssignments, createAssetAssignment, updateAssetAssignment, deleteAssetAssignment,
  fetchAssetTransfers, createAssetTransfer, updateAssetTransfer, deleteAssetTransfer,
  fetchVerificationCampaigns, createVerificationCampaign, updateVerificationCampaign, deleteVerificationCampaign,
  fetchAssetVerifications, updateAssetVerification,
  fetchAssetWarranties, createAssetWarranty, deleteAssetWarranty,
  fetchAssetInsurance, createAssetInsurance, deleteAssetInsurance,
  fetchAssetDisposals, createAssetDisposal, updateAssetDisposal, deleteAssetDisposal,
  createAssetDocument, deleteAssetDocument,
  fetchAssetComponents, createAssetComponent,
  fetchWarrantyClaims, createWarrantyClaim, updateWarrantyClaim, deleteWarrantyClaim,
  fetchInsuranceClaims, createInsuranceClaim, updateInsuranceClaim, deleteInsuranceClaim,
  retireAsset,
  type UinvAsset, type UinvAssetClass, type UinvAssetAssignment,
  type UinvAssetTransfer, type UinvVerificationCampaign, type UinvAssetVerification,
  type UinvAssetWarranty, type UinvAssetInsurance, type UinvAssetDisposal,
  type UinvAssetDocument, type UinvAssetComponent,
  type UinvWarrantyClaim, type UinvInsuranceClaim,
  type AssetCondition, type AssetStatus,
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

const ASSET_CONDITIONS: AssetCondition[] = ['New', 'Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Unusable'];
const ASSET_STATUSES: AssetStatus[] = ['Ordered', 'Received', 'Inspection', 'Tagged', 'Available', 'Assigned', 'In Service', 'In Transit', 'Under Maintenance', 'Damaged', 'Lost', 'Stolen', 'Impaired', 'Held for Disposal', 'Disposed', 'Retired'];
const DEPARTMENTS = ['Food & Beverage', 'Housekeeping', 'Engineering', 'Front Office', 'Finance', 'Human Resources', 'Security', 'Procurement', 'Sales', 'Transportation', 'Concierge', 'Spa & Wellness', 'Banquet & Events', 'Operations', 'Admin', 'Executive'];

function assetStatusTone(status: AssetStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'Available':
    case 'In Service':
    case 'Tagged':
      return 'success';
    case 'Received':
    case 'Inspection':
    case 'Assigned':
    case 'In Transit':
    case 'Under Maintenance':
      return 'warning';
    case 'Damaged':
    case 'Lost':
    case 'Stolen':
    case 'Impaired':
    case 'Held for Disposal':
    case 'Disposed':
    case 'Retired':
      return 'danger';
    case 'Ordered':
    default:
      return 'neutral';
  }
}

function conditionTone(condition: AssetCondition) {
  if (condition === 'New' || condition === 'Excellent') return 'success';
  if (condition === 'Good' || condition === 'Fair') return 'warning';
  return 'danger';
}

function currencyFmt(n?: number | null) {
  if (n == null) return '—';
  return `ETB ${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ASSET_TABS = [
  { id: 'register', label: 'Asset Register', icon: Boxes },
  { id: 'classes', label: 'Asset Classes', icon: Tags },
  { id: 'assignments', label: 'Assignments', icon: Briefcase },
  { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
  { id: 'verification', label: 'Verification', icon: FileCheck },
  { id: 'warranties', label: 'Warranties', icon: ShieldCheck },
  { id: 'warranty-claims', label: 'Warranty Claims', icon: ShieldCheck },
  { id: 'insurance', label: 'Insurance', icon: AlertOctagon },
  { id: 'insurance-claims', label: 'Insurance Claims', icon: AlertOctagon },
  { id: 'disposals', label: 'Disposals', icon: Trash2 },
  { id: 'retirements', label: 'Retirements', icon: Archive },
] as const;

type AssetView = typeof ASSET_TABS[number]['id'];

const FixedAssetsModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [view, setView] = useState<AssetView>('register');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | AssetStatus>('All');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Collections
  const [assets, setAssets] = useState<UinvAsset[]>([]);
  const [classes, setClasses] = useState<UinvAssetClass[]>([]);
  const [assignments, setAssignments] = useState<UinvAssetAssignment[]>([]);
  const [transfers, setTransfers] = useState<UinvAssetTransfer[]>([]);
  const [campaigns, setCampaigns] = useState<UinvVerificationCampaign[]>([]);
  const [verifications, setVerifications] = useState<UinvAssetVerification[]>([]);
  const [warranties, setWarranties] = useState<UinvAssetWarranty[]>([]);
  const [insurance, setInsurance] = useState<UinvAssetInsurance[]>([]);
  const [disposals, setDisposals] = useState<UinvAssetDisposal[]>([]);
  const [documents, setDocuments] = useState<UinvAssetDocument[]>([]);
  const [warrantyClaims, setWarrantyClaims] = useState<UinvWarrantyClaim[]>([]);
  const [insuranceClaims, setInsuranceClaims] = useState<UinvInsuranceClaim[]>([]);

  // Detail / forms
  const [selectedAsset, setSelectedAsset] = useState<UinvAsset | null>(null);
  const [showAssetDetail, setShowAssetDetail] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<UinvAsset | null>(null);
  const [assetForm, setAssetForm] = useState<Partial<UinvAsset>>({});
  const [showClassForm, setShowClassForm] = useState(false);
  const [editingClass, setEditingClass] = useState<UinvAssetClass | null>(null);
  const [classForm, setClassForm] = useState<Partial<UinvAssetClass>>({});
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState<Partial<UinvAssetAssignment>>({});
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState<Partial<UinvAssetTransfer>>({});
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState<Partial<UinvVerificationCampaign>>({});
  const [showWarrantyForm, setShowWarrantyForm] = useState(false);
  const [warrantyForm, setWarrantyForm] = useState<Partial<UinvAssetWarranty>>({});
  const [showInsuranceForm, setShowInsuranceForm] = useState(false);
  const [insuranceForm, setInsuranceForm] = useState<Partial<UinvAssetInsurance>>({});
  const [showDisposalForm, setShowDisposalForm] = useState(false);
  const [disposalForm, setDisposalForm] = useState<Partial<UinvAssetDisposal>>({});
  const [showWarrantyClaimForm, setShowWarrantyClaimForm] = useState(false);
  const [warrantyClaimForm, setWarrantyClaimForm] = useState<Partial<UinvWarrantyClaim>>({});
  const [showInsuranceClaimForm, setShowInsuranceClaimForm] = useState(false);
  const [insuranceClaimForm, setInsuranceClaimForm] = useState<Partial<UinvInsuranceClaim>>({});
  const [showRetireForm, setShowRetireForm] = useState(false);
  const [retireAssetId, setRetireAssetId] = useState<string | null>(null);
  const [retireForm, setRetireForm] = useState<{ reason: string; reference: string }>({ reason: '', reference: '' });
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [documentForm, setDocumentForm] = useState<Partial<UinvAssetDocument>>({});
  const [showComponentForm, setShowComponentForm] = useState(false);
  const [componentForm, setComponentForm] = useState<Partial<UinvAssetComponent>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [a, c, as, t, cam, ver, w, i, d, comp, wc, ic] = await Promise.all([
        fetchAssets({ propertyId }),
        fetchAssetClasses({ propertyId }),
        fetchAssetAssignments({ propertyId }),
        fetchAssetTransfers({ propertyId }),
        fetchVerificationCampaigns({ propertyId }),
        fetchAssetVerifications({}),
        fetchAssetWarranties({ propertyId }),
        fetchAssetInsurance({ propertyId }),
        fetchAssetDisposals({ propertyId }),
        fetchAssetComponents({}),
        fetchWarrantyClaims({ propertyId }).catch(() => [] as UinvWarrantyClaim[]),
        fetchInsuranceClaims({ propertyId }).catch(() => [] as UinvInsuranceClaim[]),
      ]);
      setAssets(a);
      setClasses(c);
      setAssignments(as);
      setTransfers(t);
      setCampaigns(cam);
      setVerifications(ver);
      setWarranties(w);
      setInsurance(i);
      setDisposals(d);
      // components list not rendered as a standalone view; comp fetch kept for future use
      setWarrantyClaims(wc);
      setInsuranceClaims(ic);
      if (selectedAsset) {
        const fresh = await fetchAsset(selectedAsset.id);
        setSelectedAsset(fresh);
        setDocuments(fresh.documents || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load fixed assets data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, selectedAsset?.id]);

  useEffect(() => { load(); }, [load]);

  const openAssetDetail = async (asset: UinvAsset) => {
    setShowAssetDetail(true);
    setLoading(true);
    try {
      const fresh = await fetchAsset(asset.id);
      setSelectedAsset(fresh);
      setDocuments(fresh.documents || []);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load asset detail', 'warning', 'Inventory');
    } finally {
      setLoading(false);
    }
  };

  // ── Filters ──
  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      const matchesSearch = !q ||
        a.asset_name.toLowerCase().includes(q) ||
        a.asset_number.toLowerCase().includes(q) ||
        (a.asset_tag || '').toLowerCase().includes(q) ||
        (a.serial_number || '').toLowerCase().includes(q) ||
        (a.department || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'All' || a.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [assets, search, statusFilter]);

  const kpis = useMemo(() => ({
    totalAssets: assets.length,
    totalValue: assets.reduce((s, a) => s + Number(a.acquisition_cost || 0), 0),
    available: assets.filter(a => a.status === 'Available' || a.status === 'In Service').length,
    assigned: assets.filter(a => a.status === 'Assigned').length,
    underMaintenance: assets.filter(a => a.status === 'Under Maintenance' || a.status === 'Damaged').length,
    lostMissing: assets.filter(a => a.status === 'Lost' || a.status === 'Stolen' || a.status === 'Impaired' || a.status === 'Held for Disposal').length,
  }), [assets]);

  // ── Actions: Asset ──
  const openAssetForm = (asset?: UinvAsset) => {
    if (asset) {
      setEditingAsset(asset);
      setAssetForm({ ...asset });
    } else {
      setEditingAsset(null);
      setAssetForm({
        property_id: currentPropertyId, status: 'Received', condition: 'New',
        acquisition_cost: 0, currency: 'ETB', is_active: true,
      });
    }
    setShowAssetForm(true);
    setMenuOpen(null);
  };

  const submitAsset = async () => {
    if (!assetForm.asset_number?.trim() || !assetForm.asset_name?.trim() || !assetForm.class_id) {
      addNotification('Asset number, name and class are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...assetForm, property_id: currentPropertyId || assetForm.property_id };
      if (editingAsset) {
        await updateAsset(editingAsset.id, payload);
        addNotification('Asset updated.', 'success', 'Inventory');
      } else {
        await createAsset(payload);
        addNotification('Asset created.', 'success', 'Inventory');
      }
      setShowAssetForm(false);
      setEditingAsset(null);
      setAssetForm({});
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save asset', 'warning', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  const removeAsset = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAsset(id);
      addNotification('Asset deleted.', 'warning', 'Inventory');
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete asset', 'warning', 'Inventory');
    } finally { setActingOn(null); }
  };

  // ── Actions: Asset Class ──
  const openClassForm = (cls?: UinvAssetClass) => {
    if (cls) { setEditingClass(cls); setClassForm({ ...cls }); }
    else { setEditingClass(null); setClassForm({ property_id: currentPropertyId, is_active: true, capitalization_threshold: 0 }); }
    setShowClassForm(true);
    setMenuOpen(null);
  };

  const submitClass = async () => {
    if (!classForm.class_code?.trim() || !classForm.class_name?.trim()) {
      addNotification('Class code and name are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...classForm, property_id: currentPropertyId || classForm.property_id };
      if (editingClass) await updateAssetClass(editingClass.id, payload);
      else await createAssetClass(payload);
      setShowClassForm(false);
      setClassForm({});
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save class', 'warning', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const removeClass = async (id: string) => {
    setActingOn(id);
    try { await deleteAssetClass(id); addNotification('Class deleted.', 'warning', 'Inventory'); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete class', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Actions: Assignment ──
  const openAssignmentForm = (a?: UinvAsset) => {
    setAssignmentForm({
      property_id: currentPropertyId,
      asset_id: a?.id,
      employee: '', department: '', location: '',
      issue_date: new Date().toISOString().slice(0, 10),
      condition_at_issue: 'Good',
      status: 'Active',
    });
    setShowAssignmentForm(true);
  };

  const submitAssignment = async () => {
    if (!assignmentForm.asset_id || !assignmentForm.employee?.trim() || !assignmentForm.issue_date) {
      addNotification('Asset, employee and issue date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetAssignment({ ...assignmentForm, property_id: currentPropertyId });
      addNotification('Asset assigned.', 'success', 'Inventory');
      setShowAssignmentForm(false);
      setAssignmentForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to assign asset', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  const returnAssignment = async (assignment: UinvAssetAssignment) => {
    if (!assignment.id) return;
    setSubmitting(true);
    try {
      await updateAssetAssignment(assignment.id, { status: 'Returned', return_date: new Date().toISOString().slice(0, 10), condition_at_return: assignment.condition_at_issue });
      addNotification('Asset returned.', 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to return asset', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Actions: Transfer ──
  const openTransferForm = (a?: UinvAsset) => {
    setTransferForm({
      property_id: currentPropertyId,
      asset_id: a?.id,
      transfer_type: 'Location',
      status: 'Pending',
    });
    setShowTransferForm(true);
  };

  const submitTransfer = async () => {
    if (!transferForm.asset_id || !transferForm.transfer_type) {
      addNotification('Asset and transfer type are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetTransfer({ ...transferForm, property_id: currentPropertyId });
      addNotification('Transfer created.', 'success', 'Inventory');
      setShowTransferForm(false);
      setTransferForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create transfer', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  const advanceTransfer = async (t: UinvAssetTransfer, status: UinvAssetTransfer['status']) => {
    if (!t.id) return;
    setActingOn(t.id);
    try {
      await updateAssetTransfer(t.id, { status });
      addNotification(`Transfer → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update transfer', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Actions: Verification ──
  const openCampaignForm = () => {
    setCampaignForm({
      property_id: currentPropertyId,
      scope: 'Full',
      start_date: new Date().toISOString().slice(0, 10),
      status: 'Open',
    });
    setShowCampaignForm(true);
  };

  const submitCampaign = async () => {
    if (!campaignForm.campaign_name?.trim() || !campaignForm.start_date || !campaignForm.scope) {
      addNotification('Campaign name, scope and start date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createVerificationCampaign({ ...campaignForm, property_id: currentPropertyId });
      addNotification('Verification campaign created.', 'success', 'Inventory');
      setShowCampaignForm(false);
      setCampaignForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to create campaign', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  const recordVerification = async (v: UinvAssetVerification, result: UinvAssetVerification['result']) => {
    if (!v.id) return;
    setActingOn(v.id);
    try {
      await updateAssetVerification(v.id, { result, status: 'Resolved' });
      addNotification(`Verification recorded: ${result}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to record verification', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Actions: Warranty ──
  const openWarrantyForm = (a?: UinvAsset) => {
    setWarrantyForm({ property_id: currentPropertyId, asset_id: a?.id, start_date: new Date().toISOString().slice(0, 10) });
    setShowWarrantyForm(true);
  };

  const submitWarranty = async () => {
    if (!warrantyForm.asset_id || !warrantyForm.start_date) {
      addNotification('Asset and start date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetWarranty({ ...warrantyForm, property_id: currentPropertyId });
      addNotification('Warranty added.', 'success', 'Inventory');
      setShowWarrantyForm(false);
      setWarrantyForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to add warranty', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Actions: Insurance ──
  const openInsuranceForm = (a?: UinvAsset) => {
    setInsuranceForm({ property_id: currentPropertyId, asset_id: a?.id, start_date: new Date().toISOString().slice(0, 10), insured_value: 0 });
    setShowInsuranceForm(true);
  };

  const submitInsurance = async () => {
    if (!insuranceForm.asset_id || !insuranceForm.start_date) {
      addNotification('Asset and start date are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetInsurance({ ...insuranceForm, property_id: currentPropertyId });
      addNotification('Insurance added.', 'success', 'Inventory');
      setShowInsuranceForm(false);
      setInsuranceForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to add insurance', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Actions: Disposal ──
  const openDisposalForm = (a?: UinvAsset) => {
    setDisposalForm({
      property_id: currentPropertyId,
      asset_id: a?.id,
      disposal_method: 'Scrap',
      disposal_value: 0,
      status: 'Requested',
    });
    setShowDisposalForm(true);
  };

  const submitDisposal = async () => {
    if (!disposalForm.asset_id || !disposalForm.disposal_method) {
      addNotification('Asset and disposal method are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetDisposal({ ...disposalForm, property_id: currentPropertyId });
      addNotification('Disposal requested.', 'success', 'Inventory');
      setShowDisposalForm(false);
      setDisposalForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to request disposal', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  const advanceDisposal = async (d: UinvAssetDisposal, status: UinvAssetDisposal['status']) => {
    if (!d.id) return;
    setActingOn(d.id);
    try {
      await updateAssetDisposal(d.id, { status });
      addNotification(`Disposal → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to update disposal', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Actions: Document ──
  const openDocumentForm = (asset: UinvAsset) => {
    setDocumentForm({ asset_id: asset.id, document_type: 'Other' });
    setShowDocumentForm(true);
  };

  const submitDocument = async () => {
    if (!documentForm.asset_id || !documentForm.document_type) {
      addNotification('Asset and document type are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetDocument(documentForm);
      addNotification('Document added.', 'success', 'Inventory');
      setShowDocumentForm(false);
      setDocumentForm({});
      openAssetDetail(selectedAsset!);
    } catch (e: any) { addNotification(e?.message || 'Failed to add document', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  const removeDocument = async (id: string) => {
    setActingOn(id);
    try { await deleteAssetDocument(id); addNotification('Document deleted.', 'warning', 'Inventory'); openAssetDetail(selectedAsset!); }
    catch (e: any) { addNotification(e?.message || 'Failed to delete document', 'warning', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Actions: Component ──
  const openComponentForm = (asset: UinvAsset) => {
    setComponentForm({ parent_asset_id: asset.id, relationship: 'Component' });
    setShowComponentForm(true);
  };

  const submitComponent = async () => {
    if (!componentForm.parent_asset_id || !componentForm.child_asset_id) {
      addNotification('Parent and child assets are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetComponent(componentForm);
      addNotification('Component linked.', 'success', 'Inventory');
      setShowComponentForm(false);
      setComponentForm({});
      openAssetDetail(selectedAsset!);
    } catch (e: any) { addNotification(e?.message || 'Failed to link component', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Delete helpers ──
  const removeAssignment = async (id: string) => { setActingOn(id); try { await deleteAssetAssignment(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };
  const removeTransfer = async (id: string) => { setActingOn(id); try { await deleteAssetTransfer(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };
  const removeCampaign = async (id: string) => { setActingOn(id); try { await deleteVerificationCampaign(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };
  const removeWarranty = async (id: string) => { setActingOn(id); try { await deleteAssetWarranty(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };
  const removeInsurance = async (id: string) => { setActingOn(id); try { await deleteAssetInsurance(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };
  const removeDisposal = async (id: string) => { setActingOn(id); try { await deleteAssetDisposal(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // Warranty claim handlers
  const submitWarrantyClaim = async () => {
    if (!warrantyClaimForm.asset_id) { addNotification('Asset is required.', 'warning', 'Inventory'); return; }
    setSubmitting(true);
    try {
      if (warrantyClaimForm.id) {
        await updateWarrantyClaim(warrantyClaimForm.id, warrantyClaimForm);
        addNotification('Warranty claim updated', 'success', 'Inventory');
      } else {
        await createWarrantyClaim({ ...warrantyClaimForm, property_id: currentPropertyId });
        addNotification('Warranty claim created', 'success', 'Inventory');
      }
      setShowWarrantyClaimForm(false);
      setWarrantyClaimForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to save warranty claim', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeWarrantyClaim = async (id: string) => { setActingOn(id); try { await deleteWarrantyClaim(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // Insurance claim handlers
  const submitInsuranceClaim = async () => {
    if (!insuranceClaimForm.asset_id) { addNotification('Asset is required.', 'warning', 'Inventory'); return; }
    setSubmitting(true);
    try {
      if (insuranceClaimForm.id) {
        await updateInsuranceClaim(insuranceClaimForm.id, insuranceClaimForm);
        addNotification('Insurance claim updated', 'success', 'Inventory');
      } else {
        await createInsuranceClaim({ ...insuranceClaimForm, property_id: currentPropertyId });
        addNotification('Insurance claim created', 'success', 'Inventory');
      }
      setShowInsuranceClaimForm(false);
      setInsuranceClaimForm({});
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to save insurance claim', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeInsuranceClaim = async (id: string) => { setActingOn(id); try { await deleteInsuranceClaim(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'warning', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // Retirement handler
  const submitRetirement = async () => {
    if (!retireAssetId) return;
    setSubmitting(true);
    try {
      await retireAsset(retireAssetId, retireForm);
      addNotification('Asset retired — journal posted', 'success', 'Inventory');
      setShowRetireForm(false);
      setRetireAssetId(null);
      setRetireForm({ reason: '', reference: '' });
      load();
    } catch (e: any) { addNotification(e?.message || 'Failed to retire asset', 'warning', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Render helpers ──
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

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register, assignments, transfers, verification, warranties, insurance and disposal lifecycle."
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {view === 'register' && (
              <button onClick={() => openAssetForm()} className={button.primary}>
                <Plus className="w-4 h-4" /> New Asset
              </button>
            )}
            {view === 'classes' && (
              <button onClick={() => openClassForm()} className={button.primary}>
                <Plus className="w-4 h-4" /> New Class
              </button>
            )}
            {view === 'verification' && (
              <button onClick={openCampaignForm} className={button.primary}>
                <Plus className="w-4 h-4" /> New Campaign
              </button>
            )}
            {view === 'warranties' && (
              <button onClick={() => { setWarrantyForm({}); setShowWarrantyForm(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Warranty
              </button>
            )}
            {view === 'warranty-claims' && (
              <button onClick={() => { setWarrantyClaimForm({ claim_date: new Date().toISOString().slice(0, 10), status: 'Open' }); setShowWarrantyClaimForm(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Claim
              </button>
            )}
            {view === 'insurance' && (
              <button onClick={() => { setInsuranceForm({}); setShowInsuranceForm(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Insurance
              </button>
            )}
            {view === 'insurance-claims' && (
              <button onClick={() => { setInsuranceClaimForm({ incident_date: new Date().toISOString().slice(0, 10), status: 'Open', claim_amount: 0 }); setShowInsuranceClaimForm(true); }} className={button.primary}>
                <Plus className="w-4 h-4" /> New Claim
              </button>
            )}
            {view === 'disposals' && (
              <button onClick={() => openDisposalForm()} className={button.primary}>
                <Plus className="w-4 h-4" /> Request Disposal
              </button>
            )}
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Assets" value={kpis.totalAssets} icon={Boxes} tone="accent" />
        <StatCard title="Total Value" value={currencyFmt(kpis.totalValue)} icon={Tag} tone="info" />
        <StatCard title="Available / In Service" value={kpis.available} icon={Package} tone="success" />
        <StatCard title="Assigned" value={kpis.assigned} icon={Briefcase} tone="warning" />
        <StatCard title="Under Maintenance" value={kpis.underMaintenance} icon={Wrench} tone="danger" />
        <StatCard title="Lost / Missing / Disposal" value={kpis.lostMissing} icon={AlertOctagon} tone="danger" />
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
            {ASSET_TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => { setView(tab.id); setSearch(''); setStatusFilter('All'); setMenuOpen(null); }}
                  className={['px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                    view === tab.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                  <Icon className="w-3.5 h-3.5" /> {tab.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            {view === 'register' && (
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
                className="text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 px-3 py-2">
                <option value="All">All Status</option>
                {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── Asset Register ── */}
      {view === 'register' && (
        <InventoryTable
          rows={filteredAssets}
          rowKey={a => a.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage={assets.length === 0 ? 'No fixed assets. Create an asset class first, then register assets.' : 'No assets match the filters.'}
          columns={[
            {
              key: 'asset', header: 'Asset', widthClass: 'md:w-72 shrink-0',
              render: a => (
                <IdentityCell
                  icon={<Package className="w-5 h-5" />}
                  soft={statusTone.accent.soft}
                  text={statusTone.accent.text}
                  name={a.asset_name}
                  code={`${a.asset_number}${a.asset_tag ? ` · Tag: ${a.asset_tag}` : ''}`}
                />
              ),
            },
            {
              key: 'class', header: 'Class / Dept', widthClass: 'md:w-48 shrink-0',
              render: a => (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{a.class || a.class_ref?.class_name || '—'}</p>
                  <p className="text-xs text-slate-500">{a.department || '—'} · {a.location || '—'}</p>
                </div>
              ),
            },
            {
              key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0',
              render: a => <Badge tone={assetStatusTone(a.status)} variant="solid">{a.status}</Badge>,
            },
            {
              key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0',
              render: a => <Badge tone={conditionTone(a.condition)}>{a.condition}</Badge>,
            },
            {
              key: 'value', header: 'Value', widthClass: 'md:w-28 shrink-0', align: 'right',
              render: a => <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{currencyFmt(a.acquisition_cost)}</span>,
            },
            {
              key: 'custodian', header: 'Custodian', widthClass: 'md:w-32 shrink-0',
              render: a => <span className="text-sm text-slate-600 dark:text-slate-400">{a.custodian || '—'}</span>,
            },
            {
              key: 'ops', header: 'Ops', widthClass: 'md:w-28 shrink-0', align: 'right',
              render: a => (
                <OpsCell>
                  <IconButton onClick={() => openAssetDetail(a)} title="View details"><Eye className="w-4 h-4" /></IconButton>
                  <IconButton onClick={() => openAssetForm(a)} title="Edit"><Edit3 className="w-4 h-4" /></IconButton>
                  {renderMenu(a.id, (
                    <>
                      <button onClick={() => openAssignmentForm(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Briefcase className="w-4 h-4" /> Assign</button>
                      <button onClick={() => openTransferForm(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" /> Transfer</button>
                      <button onClick={() => openDisposalForm(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Dispose</button>
                      <button onClick={() => removeAsset(a.id)} disabled={actingOn === a.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                        {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                      </button>
                    </>
                  ))}
                </OpsCell>
              ),
            },
          ]}
        />
      )}

      {/* ── Asset Classes ── */}
      {view === 'classes' && (
        <InventoryTable
          rows={classes.filter(c => !search || c.class_name.toLowerCase().includes(search.toLowerCase()) || c.class_code.toLowerCase().includes(search.toLowerCase()))}
          rowKey={c => c.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No asset classes. Create one to categorize fixed assets."
          columns={[
            { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: c => <span className="font-medium text-slate-700 dark:text-slate-300">{c.class_code}</span> },
            { key: 'name', header: 'Name', widthClass: 'md:w-56 shrink-0', render: c => <span className="font-medium text-slate-900 dark:text-white">{c.class_name}</span> },
            { key: 'threshold', header: 'Capitalization', widthClass: 'md:w-32 shrink-0', align: 'right', render: c => <span className="text-sm text-slate-600">{currencyFmt(c.capitalization_threshold)}</span> },
            { key: 'life', header: 'Life (yrs)', widthClass: 'md:w-24 shrink-0', align: 'right', render: c => <span className="text-sm text-slate-600">{c.default_useful_life_years ?? '—'}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-24 shrink-0', render: c => <Badge tone={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: c => (
              <OpsCell>
                <IconButton onClick={() => openClassForm(c)} title="Edit"><Edit3 className="w-4 h-4" /></IconButton>
                {renderMenu(c.id, (
                  <button onClick={() => removeClass(c.id)} disabled={actingOn === c.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Assignments ── */}
      {view === 'assignments' && (
        <InventoryTable
          rows={assignments.filter(a => !search || a.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()) || a.employee.toLowerCase().includes(search.toLowerCase()))}
          rowKey={a => a.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No asset assignments."
          columns={[
            { key: 'asset', header: 'Asset', widthClass: 'md:w-64 shrink-0', render: a => <span className="font-medium text-slate-900 dark:text-white">{a.asset?.asset_name || a.asset_id}</span> },
            { key: 'employee', header: 'Employee', widthClass: 'md:w-40 shrink-0', render: a => <span className="font-medium text-slate-700 dark:text-slate-300">{a.employee}</span> },
            { key: 'dept', header: 'Department / Location', render: a => <span className="text-sm text-slate-600 dark:text-slate-400">{a.department || '—'} · {a.location || '—'}</span> },
            { key: 'dates', header: 'Issue / Return', widthClass: 'md:w-40 shrink-0', render: a => <span className="text-xs text-slate-500">{a.issue_date} {a.return_date ? `→ ${a.return_date}` : ''}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-24 shrink-0', render: a => <Badge tone={a.status === 'Active' ? 'warning' : a.status === 'Overdue' ? 'danger' : 'success'} variant="solid">{a.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-28 shrink-0', align: 'right', render: a => (
              <OpsCell>
                {a.status === 'Active' && <IconButton onClick={() => returnAssignment(a)} title="Return"><Undo2 className="w-4 h-4" /></IconButton>}
                {renderMenu(a.id, (
                  <button onClick={() => removeAssignment(a.id)} disabled={actingOn === a.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Transfers ── */}
      {view === 'transfers' && (
        <InventoryTable
          rows={transfers.filter(t => !search || t.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()) || t.transfer_number.toLowerCase().includes(search.toLowerCase()))}
          rowKey={t => t.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No asset transfers."
          columns={[
            { key: 'number', header: 'Transfer #', widthClass: 'md:w-40 shrink-0', render: t => <span className="font-medium text-slate-900 dark:text-white">{t.transfer_number}</span> },
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: t => <span className="text-sm text-slate-700 dark:text-slate-300">{t.asset?.asset_name || t.asset_id}</span> },
            { key: 'type', header: 'Type', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone="neutral">{t.transfer_type}</Badge> },
            { key: 'route', header: 'From → To', render: t => <span className="text-sm text-slate-600 dark:text-slate-400">{t.from_location || t.from_custodian || '—'} → {t.to_location || t.to_custodian || '—'}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={t.status === 'Received' ? 'success' : t.status === 'Rejected' ? 'danger' : 'warning'} variant="solid">{t.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-32 shrink-0', align: 'right', render: t => (
              <OpsCell>
                {t.status === 'Pending' && <IconButton onClick={() => advanceTransfer(t, 'Approved')} title="Approve"><Check className="w-4 h-4" /></IconButton>}
                {t.status === 'Approved' && <IconButton onClick={() => advanceTransfer(t, 'Dispatched')} title="Dispatch"><ArrowRightLeft className="w-4 h-4" /></IconButton>}
                {t.status === 'Dispatched' && <IconButton onClick={() => advanceTransfer(t, 'Received')} title="Receive"><Check className="w-4 h-4" /></IconButton>}
                {renderMenu(t.id, (
                  <button onClick={() => removeTransfer(t.id)} disabled={actingOn === t.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Verification ── */}
      {view === 'verification' && (
        <>
          <InventoryTable
            title="Campaigns"
            rows={campaigns.filter(c => !search || c.campaign_name.toLowerCase().includes(search.toLowerCase()) || c.campaign_number.toLowerCase().includes(search.toLowerCase()))}
            rowKey={c => c.id}
            loading={loading}
            error={error}
            onRetry={load}
            emptyMessage="No verification campaigns."
            columns={[
              { key: 'number', header: 'Campaign #', widthClass: 'md:w-40 shrink-0', render: c => <span className="font-medium text-slate-900 dark:text-white">{c.campaign_number}</span> },
              { key: 'name', header: 'Name', widthClass: 'md:w-56 shrink-0', render: c => <span className="font-medium text-slate-700 dark:text-slate-300">{c.campaign_name}</span> },
              { key: 'scope', header: 'Scope', widthClass: 'md:w-32 shrink-0', render: c => <Badge tone="neutral">{c.scope}</Badge> },
              { key: 'dates', header: 'Start / End', widthClass: 'md:w-48 shrink-0', render: c => <span className="text-xs text-slate-500">{c.start_date} {c.end_date ? `→ ${c.end_date}` : ''}</span> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: c => <Badge tone={c.status === 'Completed' ? 'success' : c.status === 'In Progress' ? 'warning' : 'info'} variant="solid">{c.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: c => (
                <OpsCell>
                  {renderMenu(c.id, (
                    <>
                      <button onClick={() => updateVerificationCampaign(c.id, { status: 'In Progress' }).then(load).catch((e: any) => addNotification(e?.message, 'warning', 'Inventory'))} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"><Play className="w-4 h-4" /> Start</button>
                      <button onClick={() => removeCampaign(c.id)} disabled={actingOn === c.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                        {actingOn === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                      </button>
                    </>
                  ))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Verification Results"
            rows={verifications.filter(v => !search || v.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()))}
            rowKey={v => v.id}
            loading={loading}
            emptyMessage="No verification results."
            columns={[
              { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: v => <span className="font-medium text-slate-900 dark:text-white">{v.asset?.asset_name || v.asset_id}</span> },
              { key: 'expected', header: 'Expected', render: v => <span className="text-sm text-slate-600 dark:text-slate-400">{v.expected_location || '—'} · {v.expected_custodian || '—'}</span> },
              { key: 'confirmed', header: 'Confirmed', render: v => <span className="text-sm text-slate-600 dark:text-slate-400">{v.confirmed_location || '—'} · {v.confirmed_custodian || '—'}</span> },
              { key: 'result', header: 'Result', widthClass: 'md:w-28 shrink-0', render: v => <Badge tone={v.result === 'Found' ? 'success' : v.result === 'Missing' ? 'danger' : 'warning'} variant="solid">{v.result}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: v => <Badge tone={v.status === 'Resolved' ? 'success' : 'warning'}>{v.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: v => (
                <OpsCell>
                  {v.status !== 'Resolved' && (
                    <>
                      <IconButton onClick={() => recordVerification(v, 'Found')} title="Found"><Check className="w-4 h-4" /></IconButton>
                      <IconButton onClick={() => recordVerification(v, 'Missing')} title="Missing"><AlertOctagon className="w-4 h-4" /></IconButton>
                    </>
                  )}
                  {renderMenu(v.id, null)}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Warranties ── */}
      {view === 'warranties' && (
        <InventoryTable
          rows={warranties.filter(w => !search || w.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()) || w.provider?.toLowerCase().includes(search.toLowerCase()))}
          rowKey={w => w.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No warranties recorded."
          columns={[
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: w => <span className="font-medium text-slate-900 dark:text-white">{w.asset?.asset_name || w.asset_id}</span> },
            { key: 'provider', header: 'Provider', widthClass: 'md:w-48 shrink-0', render: w => <span className="text-sm text-slate-700 dark:text-slate-300">{w.provider || '—'}</span> },
            { key: 'dates', header: 'Start / End', widthClass: 'md:w-48 shrink-0', render: w => <span className="text-xs text-slate-500">{w.start_date} {w.end_date ? `→ ${w.end_date}` : ''}</span> },
            { key: 'coverage', header: 'Coverage', render: w => <span className="text-sm text-slate-600 dark:text-slate-400 truncate max-w-xs">{w.coverage || '—'}</span> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: w => (
              <OpsCell>
                {renderMenu(w.id, (
                  <button onClick={() => removeWarranty(w.id)} disabled={actingOn === w.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Insurance ── */}
      {view === 'insurance' && (
        <InventoryTable
          rows={insurance.filter(i => !search || i.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()) || i.insurer?.toLowerCase().includes(search.toLowerCase()))}
          rowKey={i => i.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No insurance records."
          columns={[
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: i => <span className="font-medium text-slate-900 dark:text-white">{i.asset?.asset_name || i.asset_id}</span> },
            { key: 'insurer', header: 'Insurer', widthClass: 'md:w-48 shrink-0', render: i => <span className="text-sm text-slate-700 dark:text-slate-300">{i.insurer || '—'}</span> },
            { key: 'value', header: 'Insured Value', widthClass: 'md:w-32 shrink-0', align: 'right', render: i => <span className="text-sm text-slate-600">{currencyFmt(i.insured_value)}</span> },
            { key: 'expiry', header: 'Expiry', widthClass: 'md:w-36 shrink-0', render: i => <span className="text-xs text-slate-500">{i.expiry_date || '—'}</span> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => (
              <OpsCell>
                {renderMenu(i.id, (
                  <button onClick={() => removeInsurance(i.id)} disabled={actingOn === i.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Disposals ── */}
      {view === 'disposals' && (
        <InventoryTable
          rows={disposals.filter(d => !search || d.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()) || d.disposal_number.toLowerCase().includes(search.toLowerCase()))}
          rowKey={d => d.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No disposal records."
          columns={[
            { key: 'number', header: 'Disposal #', widthClass: 'md:w-40 shrink-0', render: d => <span className="font-medium text-slate-900 dark:text-white">{d.disposal_number}</span> },
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: d => <span className="text-sm text-slate-700 dark:text-slate-300">{d.asset?.asset_name || d.asset_id}</span> },
            { key: 'method', header: 'Method', widthClass: 'md:w-32 shrink-0', render: d => <Badge tone="neutral">{d.disposal_method}</Badge> },
            { key: 'value', header: 'Value', widthClass: 'md:w-32 shrink-0', align: 'right', render: d => <span className="text-sm text-slate-600">{currencyFmt(d.disposal_value)}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-32 shrink-0', render: d => <Badge tone={d.status === 'Disposed' ? 'success' : d.status === 'Rejected' ? 'danger' : 'warning'} variant="solid">{d.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-36 shrink-0', align: 'right', render: d => (
              <OpsCell>
                {d.status === 'Requested' && <IconButton onClick={() => advanceDisposal(d, 'Approved')} title="Approve"><Check className="w-4 h-4" /></IconButton>}
                {d.status === 'Approved' && <IconButton onClick={() => advanceDisposal(d, 'Finance Reviewed')} title="Finance Review"><Check className="w-4 h-4" /></IconButton>}
                {d.status === 'Finance Reviewed' && <IconButton onClick={() => advanceDisposal(d, 'Disposed')} title="Dispose"><Trash2 className="w-4 h-4" /></IconButton>}
                {renderMenu(d.id, (
                  <button onClick={() => removeDisposal(d.id)} disabled={actingOn === d.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                    {actingOn === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                  </button>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Warranty Claims ── */}
      {view === 'warranty-claims' && (
        <InventoryTable
          rows={warrantyClaims.filter(wc => !search || wc.claim_number?.toLowerCase().includes(search.toLowerCase()) || wc.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()))}
          rowKey={wc => wc.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No warranty claims."
          columns={[
            { key: 'number', header: 'Claim #', widthClass: 'md:w-40 shrink-0', render: wc => <span className="font-medium text-slate-900 dark:text-white">{wc.claim_number}</span> },
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: wc => <span className="text-sm text-slate-700 dark:text-slate-300">{wc.asset?.asset_name || wc.asset_id}</span> },
            { key: 'date', header: 'Claim Date', widthClass: 'md:w-32 shrink-0', render: wc => <span className="text-sm text-slate-600">{wc.claim_date}</span> },
            { key: 'issue', header: 'Issue', render: wc => <span className="text-sm text-slate-600">{wc.issue_description}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-32 shrink-0', render: wc => <Badge tone={wc.status?.startsWith('Resolved') ? 'success' : wc.status === 'Closed' ? 'neutral' : 'warning'} variant="solid">{wc.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: wc => (
              <OpsCell>
                {renderMenu(wc.id, (
                  <>
                    <button onClick={() => { setWarrantyClaimForm(wc); setShowWarrantyClaimForm(true); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Edit</button>
                    <button onClick={() => removeWarrantyClaim(wc.id)} disabled={actingOn === wc.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === wc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  </>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Insurance Claims ── */}
      {view === 'insurance-claims' && (
        <InventoryTable
          rows={insuranceClaims.filter(ic => !search || ic.claim_number?.toLowerCase().includes(search.toLowerCase()) || ic.asset?.asset_name?.toLowerCase().includes(search.toLowerCase()))}
          rowKey={ic => ic.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No insurance claims."
          columns={[
            { key: 'number', header: 'Claim #', widthClass: 'md:w-40 shrink-0', render: ic => <span className="font-medium text-slate-900 dark:text-white">{ic.claim_number}</span> },
            { key: 'asset', header: 'Asset', widthClass: 'md:w-56 shrink-0', render: ic => <span className="text-sm text-slate-700 dark:text-slate-300">{ic.asset?.asset_name || ic.asset_id}</span> },
            { key: 'date', header: 'Incident Date', widthClass: 'md:w-32 shrink-0', render: ic => <span className="text-sm text-slate-600">{ic.incident_date}</span> },
            { key: 'amount', header: 'Claim Amount', widthClass: 'md:w-32 shrink-0', align: 'right', render: ic => <span className="text-sm text-slate-600">{currencyFmt(ic.claim_amount)}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-32 shrink-0', render: ic => <Badge tone={ic.status === 'Paid' ? 'success' : ic.status === 'Closed' ? 'neutral' : 'warning'} variant="solid">{ic.status}</Badge> },
            { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: ic => (
              <OpsCell>
                {renderMenu(ic.id, (
                  <>
                    <button onClick={() => { setInsuranceClaimForm(ic); setShowInsuranceClaimForm(true); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center gap-2"><Edit3 className="w-4 h-4" /> Edit</button>
                    <button onClick={() => removeInsuranceClaim(ic.id)} disabled={actingOn === ic.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                      {actingOn === ic.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete
                    </button>
                  </>
                ))}
              </OpsCell>
            ) },
          ]}
        />
      )}

      {/* ── Retirements ── */}
      {view === 'retirements' && (
        <InventoryTable
          rows={assets.filter(a => a.status === 'Retired' && (!search || a.asset_name?.toLowerCase().includes(search.toLowerCase()) || a.asset_number?.toLowerCase().includes(search.toLowerCase())))}
          rowKey={a => a.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage="No retired assets. Use the asset register to retire an active asset."
          columns={[
            { key: 'number', header: 'Asset #', widthClass: 'md:w-40 shrink-0', render: a => <span className="font-medium text-slate-900 dark:text-white">{a.asset_number}</span> },
            { key: 'asset', header: 'Asset Name', widthClass: 'md:w-56 shrink-0', render: a => <span className="text-sm text-slate-700 dark:text-slate-300">{a.asset_name}</span> },
            { key: 'reason', header: 'Retirement Reason', render: a => <span className="text-sm text-slate-600">{(a as any).retirement_reason || '—'}</span> },
            { key: 'date', header: 'Retired At', widthClass: 'md:w-40 shrink-0', render: a => <span className="text-sm text-slate-600">{(a as any).retired_at ? new Date((a as any).retired_at).toLocaleDateString() : '—'}</span> },
            { key: 'status', header: 'Status', widthClass: 'md:w-24 shrink-0', render: a => <Badge tone="neutral" variant="solid">Retired</Badge> },
          ]}
        />
      )}
      <ModalSystem isOpen={showAssetForm} onClose={() => setShowAssetForm(false)} onConfirm={submitAsset} title={editingAsset ? 'Edit Asset' : 'New Asset'} loading={submitting} confirmLabel="Save" size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Asset Number *"><input className={inputClass} value={assetForm.asset_number || ''} onChange={e => setAssetForm({ ...assetForm, asset_number: e.target.value })} /></Field>
          <Field label="Asset Name *"><input className={inputClass} value={assetForm.asset_name || ''} onChange={e => setAssetForm({ ...assetForm, asset_name: e.target.value })} /></Field>
          <Field label="Asset Tag"><input className={inputClass} value={assetForm.asset_tag || ''} onChange={e => setAssetForm({ ...assetForm, asset_tag: e.target.value })} /></Field>
          <Field label="Class *">
            <select className={inputClass} value={assetForm.class_id || ''} onChange={e => setAssetForm({ ...assetForm, class_id: e.target.value || null })}>
              <option value="">Select…</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.class_name}</option>)}
            </select>
          </Field>
          <Field label="Serial Number"><input className={inputClass} value={assetForm.serial_number || ''} onChange={e => setAssetForm({ ...assetForm, serial_number: e.target.value || null })} /></Field>
          <Field label="Barcode / QR"><input className={inputClass} value={assetForm.barcode || ''} onChange={e => setAssetForm({ ...assetForm, barcode: e.target.value || null })} /></Field>
          <Field label="Manufacturer"><input className={inputClass} value={assetForm.manufacturer || ''} onChange={e => setAssetForm({ ...assetForm, manufacturer: e.target.value || null })} /></Field>
          <Field label="Model"><input className={inputClass} value={assetForm.model || ''} onChange={e => setAssetForm({ ...assetForm, model: e.target.value || null })} /></Field>
          <Field label="Supplier"><input className={inputClass} value={assetForm.supplier || ''} onChange={e => setAssetForm({ ...assetForm, supplier: e.target.value || null })} /></Field>
          <Field label="Department">
            <select className={inputClass} value={assetForm.department || ''} onChange={e => setAssetForm({ ...assetForm, department: e.target.value || null })}>
              <option value="">Select…</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Location"><input className={inputClass} value={assetForm.location || ''} onChange={e => setAssetForm({ ...assetForm, location: e.target.value || null })} /></Field>
          <Field label="Location Detail"><input className={inputClass} value={assetForm.location_detail || ''} onChange={e => setAssetForm({ ...assetForm, location_detail: e.target.value || null })} /></Field>
          <Field label="Custodian"><input className={inputClass} value={assetForm.custodian || ''} onChange={e => setAssetForm({ ...assetForm, custodian: e.target.value || null })} /></Field>
          <Field label="Status">
            <select className={inputClass} value={assetForm.status || 'Received'} onChange={e => setAssetForm({ ...assetForm, status: e.target.value as AssetStatus })}>
              {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select className={inputClass} value={assetForm.condition || 'New'} onChange={e => setAssetForm({ ...assetForm, condition: e.target.value as AssetCondition })}>
              {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Acquisition Cost (ETB)"><input type="number" className={inputClass} value={assetForm.acquisition_cost ?? 0} onChange={e => setAssetForm({ ...assetForm, acquisition_cost: Number(e.target.value) })} /></Field>
          <Field label="Currency"><input className={inputClass} value={assetForm.currency || 'ETB'} onChange={e => setAssetForm({ ...assetForm, currency: e.target.value })} /></Field>
          <Field label="Purchase Date"><input type="date" className={inputClass} value={assetForm.purchase_date || ''} onChange={e => setAssetForm({ ...assetForm, purchase_date: e.target.value || null })} /></Field>
          <Field label="In Service Date"><input type="date" className={inputClass} value={assetForm.in_service_date || ''} onChange={e => setAssetForm({ ...assetForm, in_service_date: e.target.value || null })} /></Field>
          <Field label="Purchase Order #"><input className={inputClass} value={assetForm.purchase_order || ''} onChange={e => setAssetForm({ ...assetForm, purchase_order: e.target.value || null })} /></Field>
          <Field label="GRN"><input className={inputClass} value={assetForm.grn || ''} onChange={e => setAssetForm({ ...assetForm, grn: e.target.value || null })} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><textarea className={inputClass} rows={3} value={assetForm.notes || ''} onChange={e => setAssetForm({ ...assetForm, notes: e.target.value || null })} /></Field></div>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showClassForm} onClose={() => setShowClassForm(false)} onConfirm={submitClass} title={editingClass ? 'Edit Class' : 'New Asset Class'} loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Class Code *"><input className={inputClass} value={classForm.class_code || ''} onChange={e => setClassForm({ ...classForm, class_code: e.target.value })} /></Field>
          <Field label="Class Name *"><input className={inputClass} value={classForm.class_name || ''} onChange={e => setClassForm({ ...classForm, class_name: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={2} value={classForm.description || ''} onChange={e => setClassForm({ ...classForm, description: e.target.value || null })} /></Field>
          <Field label="Capitalization Threshold (ETB)"><input type="number" className={inputClass} value={classForm.capitalization_threshold ?? 0} onChange={e => setClassForm({ ...classForm, capitalization_threshold: Number(e.target.value) })} /></Field>
          <Field label="Useful Life (years)"><input type="number" className={inputClass} value={classForm.default_useful_life_years ?? ''} onChange={e => setClassForm({ ...classForm, default_useful_life_years: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Active"><input type="checkbox" checked={classForm.is_active ?? true} onChange={e => setClassForm({ ...classForm, is_active: e.target.checked })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showAssignmentForm} onClose={() => setShowAssignmentForm(false)} onConfirm={submitAssignment} title="Assign Asset" loading={submitting} confirmLabel="Assign">
        <div className="space-y-4">
          <Field label="Asset">
            <select className={inputClass} value={assignmentForm.asset_id || ''} onChange={e => setAssignmentForm({ ...assignmentForm, asset_id: e.target.value })}>
              <option value="">Select…</option>
              {assets.filter(a => a.status === 'Available' || a.status === 'In Service').map(a => <option key={a.id} value={a.id}>{a.asset_name} · {a.asset_number}</option>)}
            </select>
          </Field>
          <Field label="Employee *"><input className={inputClass} value={assignmentForm.employee || ''} onChange={e => setAssignmentForm({ ...assignmentForm, employee: e.target.value })} /></Field>
          <Field label="Department"><input className={inputClass} value={assignmentForm.department || ''} onChange={e => setAssignmentForm({ ...assignmentForm, department: e.target.value || null })} /></Field>
          <Field label="Location"><input className={inputClass} value={assignmentForm.location || ''} onChange={e => setAssignmentForm({ ...assignmentForm, location: e.target.value || null })} /></Field>
          <Field label="Issue Date"><input type="date" className={inputClass} value={assignmentForm.issue_date || ''} onChange={e => setAssignmentForm({ ...assignmentForm, issue_date: e.target.value })} /></Field>
          <Field label="Expected Return Date"><input type="date" className={inputClass} value={assignmentForm.expected_return_date || ''} onChange={e => setAssignmentForm({ ...assignmentForm, expected_return_date: e.target.value || null })} /></Field>
          <Field label="Condition at Issue">
            <select className={inputClass} value={assignmentForm.condition_at_issue || 'Good'} onChange={e => setAssignmentForm({ ...assignmentForm, condition_at_issue: e.target.value as AssetCondition })}>
              {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={assignmentForm.notes || ''} onChange={e => setAssignmentForm({ ...assignmentForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showTransferForm} onClose={() => setShowTransferForm(false)} onConfirm={submitTransfer} title="New Asset Transfer" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Asset">
            <select className={inputClass} value={transferForm.asset_id || ''} onChange={e => setTransferForm({ ...transferForm, asset_id: e.target.value })}>
              <option value="">Select…</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} · {a.asset_number}</option>)}
            </select>
          </Field>
          <Field label="Transfer Type">
            <select className={inputClass} value={transferForm.transfer_type || 'Location'} onChange={e => setTransferForm({ ...transferForm, transfer_type: e.target.value as any })}>
              {['Employee', 'Department', 'Location', 'Property', 'Temporary', 'Inter-Company'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="From Location"><input className={inputClass} value={transferForm.from_location || ''} onChange={e => setTransferForm({ ...transferForm, from_location: e.target.value || null })} /></Field>
          <Field label="To Location *"><input className={inputClass} value={transferForm.to_location || ''} onChange={e => setTransferForm({ ...transferForm, to_location: e.target.value || null })} /></Field>
          <Field label="From Custodian"><input className={inputClass} value={transferForm.from_custodian || ''} onChange={e => setTransferForm({ ...transferForm, from_custodian: e.target.value || null })} /></Field>
          <Field label="To Custodian"><input className={inputClass} value={transferForm.to_custodian || ''} onChange={e => setTransferForm({ ...transferForm, to_custodian: e.target.value || null })} /></Field>
          <Field label="From Department"><input className={inputClass} value={transferForm.from_department || ''} onChange={e => setTransferForm({ ...transferForm, from_department: e.target.value || null })} /></Field>
          <Field label="To Department"><input className={inputClass} value={transferForm.to_department || ''} onChange={e => setTransferForm({ ...transferForm, to_department: e.target.value || null })} /></Field>
          <Field label="Reason"><textarea className={inputClass} rows={2} value={transferForm.reason || ''} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showCampaignForm} onClose={() => setShowCampaignForm(false)} onConfirm={submitCampaign} title="New Verification Campaign" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Campaign Name *"><input className={inputClass} value={campaignForm.campaign_name || ''} onChange={e => setCampaignForm({ ...campaignForm, campaign_name: e.target.value })} /></Field>
          <Field label="Scope">
            <select className={inputClass} value={campaignForm.scope || 'Full'} onChange={e => setCampaignForm({ ...campaignForm, scope: e.target.value as any })}>
              {['Full', 'By Class', 'By Department', 'By Location', 'By Custodian', 'Sample'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Start Date *"><input type="date" className={inputClass} value={campaignForm.start_date || ''} onChange={e => setCampaignForm({ ...campaignForm, start_date: e.target.value })} /></Field>
          <Field label="End Date"><input type="date" className={inputClass} value={campaignForm.end_date || ''} onChange={e => setCampaignForm({ ...campaignForm, end_date: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={campaignForm.notes || ''} onChange={e => setCampaignForm({ ...campaignForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showWarrantyForm} onClose={() => setShowWarrantyForm(false)} onConfirm={submitWarranty} title="New Warranty" loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Asset"><select className={inputClass} value={warrantyForm.asset_id || ''} onChange={e => setWarrantyForm({ ...warrantyForm, asset_id: e.target.value })}>
            <option value="">Select…</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
          </select></Field>
          <Field label="Provider"><input className={inputClass} value={warrantyForm.provider || ''} onChange={e => setWarrantyForm({ ...warrantyForm, provider: e.target.value || null })} /></Field>
          <Field label="Start Date"><input type="date" className={inputClass} value={warrantyForm.start_date || ''} onChange={e => setWarrantyForm({ ...warrantyForm, start_date: e.target.value })} /></Field>
          <Field label="End Date"><input type="date" className={inputClass} value={warrantyForm.end_date || ''} onChange={e => setWarrantyForm({ ...warrantyForm, end_date: e.target.value || null })} /></Field>
          <Field label="Coverage"><textarea className={inputClass} rows={2} value={warrantyForm.coverage || ''} onChange={e => setWarrantyForm({ ...warrantyForm, coverage: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={warrantyForm.notes || ''} onChange={e => setWarrantyForm({ ...warrantyForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showInsuranceForm} onClose={() => setShowInsuranceForm(false)} onConfirm={submitInsurance} title="New Insurance" loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Asset"><select className={inputClass} value={insuranceForm.asset_id || ''} onChange={e => setInsuranceForm({ ...insuranceForm, asset_id: e.target.value })}>
            <option value="">Select…</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
          </select></Field>
          <Field label="Insurer"><input className={inputClass} value={insuranceForm.insurer || ''} onChange={e => setInsuranceForm({ ...insuranceForm, insurer: e.target.value || null })} /></Field>
          <Field label="Policy Number"><input className={inputClass} value={insuranceForm.policy_number || ''} onChange={e => setInsuranceForm({ ...insuranceForm, policy_number: e.target.value || null })} /></Field>
          <Field label="Coverage"><textarea className={inputClass} rows={2} value={insuranceForm.coverage || ''} onChange={e => setInsuranceForm({ ...insuranceForm, coverage: e.target.value || null })} /></Field>
          <Field label="Insured Value"><input type="number" className={inputClass} value={insuranceForm.insured_value ?? 0} onChange={e => setInsuranceForm({ ...insuranceForm, insured_value: Number(e.target.value) })} /></Field>
          <Field label="Start Date"><input type="date" className={inputClass} value={insuranceForm.start_date || ''} onChange={e => setInsuranceForm({ ...insuranceForm, start_date: e.target.value })} /></Field>
          <Field label="Expiry Date"><input type="date" className={inputClass} value={insuranceForm.expiry_date || ''} onChange={e => setInsuranceForm({ ...insuranceForm, expiry_date: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showDisposalForm} onClose={() => setShowDisposalForm(false)} onConfirm={submitDisposal} title="Request Disposal" loading={submitting} confirmLabel="Request">
        <div className="space-y-4">
          <Field label="Asset"><select className={inputClass} value={disposalForm.asset_id || ''} onChange={e => setDisposalForm({ ...disposalForm, asset_id: e.target.value })}>
            <option value="">Select…</option>
            {assets.filter(a => a.status !== 'Disposed' && a.status !== 'Retired').map(a => <option key={a.id} value={a.id}>{a.asset_name}</option>)}
          </select></Field>
          <Field label="Disposal Method"><select className={inputClass} value={disposalForm.disposal_method || 'Scrap'} onChange={e => setDisposalForm({ ...disposalForm, disposal_method: e.target.value as any })}>
            {['Sale', 'Auction', 'Scrap', 'Donation', 'Return to Supplier', 'Recycling', 'Destruction', 'Trade-in'].map(m => <option key={m} value={m}>{m}</option>)}
          </select></Field>
          <Field label="Condition Assessment"><textarea className={inputClass} rows={2} value={disposalForm.condition_assessment || ''} onChange={e => setDisposalForm({ ...disposalForm, condition_assessment: e.target.value || null })} /></Field>
          <Field label="Estimated Disposal Value"><input type="number" className={inputClass} value={disposalForm.disposal_value ?? 0} onChange={e => setDisposalForm({ ...disposalForm, disposal_value: Number(e.target.value) })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={disposalForm.notes || ''} onChange={e => setDisposalForm({ ...disposalForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showDocumentForm} onClose={() => setShowDocumentForm(false)} onConfirm={submitDocument} title="Add Document" loading={submitting} confirmLabel="Save">
        <div className="space-y-4">
          <Field label="Document Type">
            <select className={inputClass} value={documentForm.document_type || 'Other'} onChange={e => setDocumentForm({ ...documentForm, document_type: e.target.value as any })}>
              {['Purchase Document', 'Delivery Note', 'Inspection Record', 'Damage Photo', 'Asset Photo', 'Warranty Document', 'Insurance Document', 'Count Sheet', 'Transfer Document', 'Custody Acknowledgement', 'Disposal Evidence', 'Calibration Certificate', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="File Name"><input className={inputClass} value={documentForm.file_name || ''} onChange={e => setDocumentForm({ ...documentForm, file_name: e.target.value || null })} /></Field>
          <Field label="File URL"><input className={inputClass} value={documentForm.file_url || ''} onChange={e => setDocumentForm({ ...documentForm, file_url: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={documentForm.notes || ''} onChange={e => setDocumentForm({ ...documentForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showComponentForm} onClose={() => setShowComponentForm(false)} onConfirm={submitComponent} title="Link Component" loading={submitting} confirmLabel="Link">
        <div className="space-y-4">
          <Field label="Child Asset">
            <select className={inputClass} value={componentForm.child_asset_id || ''} onChange={e => setComponentForm({ ...componentForm, child_asset_id: e.target.value })}>
              <option value="">Select…</option>
              {assets.filter(a => a.id !== selectedAsset?.id).map(a => <option key={a.id} value={a.id}>{a.asset_name} · {a.asset_number}</option>)}
            </select>
          </Field>
          <Field label="Relationship"><input className={inputClass} value={componentForm.relationship || ''} onChange={e => setComponentForm({ ...componentForm, relationship: e.target.value })} /></Field>
          <Field label="Component Name"><input className={inputClass} value={componentForm.component_name || ''} onChange={e => setComponentForm({ ...componentForm, component_name: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showAssetDetail} onClose={() => setShowAssetDetail(false)} title={selectedAsset ? `Asset: ${selectedAsset.asset_name}` : 'Asset Detail'} size="xl" confirmLabel="Close" onConfirm={() => setShowAssetDetail(false)}>
        {selectedAsset && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div><span className="text-xs uppercase text-slate-500">Number</span><p className="font-medium">{selectedAsset.asset_number}</p></div>
              <div><span className="text-xs uppercase text-slate-500">Tag</span><p className="font-medium">{selectedAsset.asset_tag || '—'}</p></div>
              <div><span className="text-xs uppercase text-slate-500">Serial</span><p className="font-medium">{selectedAsset.serial_number || '—'}</p></div>
              <div><span className="text-xs uppercase text-slate-500">Status</span><Badge tone={assetStatusTone(selectedAsset.status)}>{selectedAsset.status}</Badge></div>
              <div><span className="text-xs uppercase text-slate-500">Condition</span><Badge tone={conditionTone(selectedAsset.condition)}>{selectedAsset.condition}</Badge></div>
              <div><span className="text-xs uppercase text-slate-500">Value</span><p className="font-medium">{currencyFmt(selectedAsset.acquisition_cost)}</p></div>
              <div className="col-span-2 sm:col-span-3"><span className="text-xs uppercase text-slate-500">Location</span><p className="font-medium">{selectedAsset.location || '—'}{selectedAsset.location_detail ? ` · ${selectedAsset.location_detail}` : ''}</p></div>
              <div className="col-span-2 sm:col-span-3"><span className="text-xs uppercase text-slate-500">Notes</span><p className="text-slate-600 dark:text-slate-400">{selectedAsset.notes || '—'}</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openAssignmentForm(selectedAsset)} className={button.secondary}><Briefcase className="w-4 h-4" /> Assign</button>
              <button onClick={() => openTransferForm(selectedAsset)} className={button.secondary}><ArrowRightLeft className="w-4 h-4" /> Transfer</button>
              <button onClick={() => openWarrantyForm(selectedAsset)} className={button.secondary}><ShieldCheck className="w-4 h-4" /> Warranty</button>
              <button onClick={() => openInsuranceForm(selectedAsset)} className={button.secondary}><AlertOctagon className="w-4 h-4" /> Insurance</button>
              <button onClick={() => openDocumentForm(selectedAsset)} className={button.secondary}><FileText className="w-4 h-4" /> Document</button>
              <button onClick={() => openComponentForm(selectedAsset)} className={button.secondary}><Boxes className="w-4 h-4" /> Component</button>
            </div>
            <InventoryTable
              title="Documents"
              rows={documents}
              rowKey={d => d.id}
              emptyMessage="No documents."
              columns={[
                { key: 'type', header: 'Type', render: d => <Badge tone="neutral">{d.document_type}</Badge> },
                { key: 'name', header: 'Name', render: d => <span className="text-sm">{d.file_name || '—'}</span> },
                { key: 'ops', header: '', widthClass: 'md:w-16', align: 'right', render: d => <IconButton onClick={() => removeDocument(d.id)} title="Delete"><Trash2 className="w-4 h-4" /></IconButton> },
              ]}
            />
          </div>
        )}
      </ModalSystem>

      {/* Warranty Claim Modal */}
      <ModalSystem isOpen={showWarrantyClaimForm} onClose={() => setShowWarrantyClaimForm(false)} onConfirm={submitWarrantyClaim} title={warrantyClaimForm.id ? 'Edit Warranty Claim' : 'New Warranty Claim'} loading={submitting} confirmLabel="Save" size="md">
        <div className="space-y-4">
          <Field label="Asset *">
            <select className={inputClass} value={warrantyClaimForm.asset_id || ''} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, asset_id: e.target.value })}>
              <option value="">Select…</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} · {a.asset_number}</option>)}
            </select>
          </Field>
          <Field label="Warranty (optional)"><select className={inputClass} value={warrantyClaimForm.warranty_id || ''} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, warranty_id: e.target.value || null })}><option value="">None…</option>{warranties.map(w => <option key={w.id} value={w.id}>{w.warranty_number || w.id}</option>)}</select></Field>
          <Field label="Claim Date"><input type="date" className={inputClass} value={warrantyClaimForm.claim_date || ''} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, claim_date: e.target.value })} /></Field>
          <Field label="Issue Description"><textarea className={inputClass} rows={2} value={warrantyClaimForm.issue_description || ''} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, issue_description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Estimated Cost"><input type="number" className={inputClass} value={warrantyClaimForm.estimated_cost ?? 0} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, estimated_cost: Number(e.target.value) })} /></Field>
            <Field label="Status"><select className={inputClass} value={warrantyClaimForm.status || 'Open'} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, status: e.target.value })}>{['Open','In Progress','Resolved - Repaired','Resolved - Replaced','Rejected','Closed'].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={warrantyClaimForm.notes || ''} onChange={e => setWarrantyClaimForm({ ...warrantyClaimForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      {/* Insurance Claim Modal */}
      <ModalSystem isOpen={showInsuranceClaimForm} onClose={() => setShowInsuranceClaimForm(false)} onConfirm={submitInsuranceClaim} title={insuranceClaimForm.id ? 'Edit Insurance Claim' : 'New Insurance Claim'} loading={submitting} confirmLabel="Save" size="md">
        <div className="space-y-4">
          <Field label="Asset *">
            <select className={inputClass} value={insuranceClaimForm.asset_id || ''} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, asset_id: e.target.value })}>
              <option value="">Select…</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} · {a.asset_number}</option>)}
            </select>
          </Field>
          <Field label="Insurance (optional)"><select className={inputClass} value={insuranceClaimForm.insurance_id || ''} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, insurance_id: e.target.value || null })}><option value="">None…</option>{insurance.map(i => <option key={i.id} value={i.id}>{i.policy_number || i.id}</option>)}</select></Field>
          <Field label="Incident Date"><input type="date" className={inputClass} value={insuranceClaimForm.incident_date || ''} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, incident_date: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputClass} rows={2} value={insuranceClaimForm.description || ''} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Claim Amount"><input type="number" className={inputClass} value={insuranceClaimForm.claim_amount ?? 0} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, claim_amount: Number(e.target.value) })} /></Field>
            <Field label="Status"><select className={inputClass} value={insuranceClaimForm.status || 'Open'} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, status: e.target.value })}>{['Open','Under Review','Approved','Paid','Rejected','Closed'].map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={insuranceClaimForm.notes || ''} onChange={e => setInsuranceClaimForm({ ...insuranceClaimForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      {/* Retirement Modal */}
      <ModalSystem isOpen={showRetireForm} onClose={() => setShowRetireForm(false)} onConfirm={submitRetirement} title="Retire Asset" loading={submitting} confirmLabel="Retire" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-amber-600 dark:text-amber-400">Retirement writes off the full net book value via a journal entry. This cannot be undone.</p>
          <Field label="Reason"><textarea className={inputClass} rows={2} value={retireForm.reason} onChange={e => setRetireForm({ ...retireForm, reason: e.target.value })} placeholder="e.g. End of useful life, irreparable" /></Field>
          <Field label="Reference (optional)"><input className={inputClass} value={retireForm.reference} onChange={e => setRetireForm({ ...retireForm, reference: e.target.value })} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};


export default FixedAssetsModule;
