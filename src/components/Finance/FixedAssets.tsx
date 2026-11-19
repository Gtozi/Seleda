import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Plus,
  Search,
  Calculator,
  TrendingDown,
  TrendingUp,
  Building2,
  DollarSign,
  Edit,
  Trash2,
  ArrowRight,
  ArrowRightLeft,
  ClipboardCheck,
  ShieldCheck,
  FileText,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ServerCrash,
  MoreVertical,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchFixedAssets,
  createFixedAsset,
  updateFixedAsset,
  deleteFixedAsset,
  calculateDepreciation,
  generateDepreciationSchedule,
  disposeAsset,
  fetchDepreciationSchedule,
  fetchAssetTransfers,
  createAssetTransfer,
  updateAssetTransfer,
  deleteAssetTransfer,
  fetchAssetRevaluations,
  createAssetRevaluation,
  updateAssetRevaluation,
  deleteAssetRevaluation,
  fetchAssetVerifications,
  createAssetVerification,
  updateAssetVerification,
  deleteAssetVerification,
  fetchAssetWarranties,
  createAssetWarranty,
  deleteAssetWarranty,
  type FixedAsset,
  type DepreciationSchedule,
  type AssetTransfer,
  type AssetRevaluation,
  type AssetVerification,
  type AssetWarranty,
} from '../../services/fixedAssetsService';

type FixedAssetTab = 'register' | 'depreciation' | 'disposal' | 'transfers' | 'revaluation' | 'verification' | 'warranty';

const TABS: { id: FixedAssetTab; label: string }[] = [
  { id: 'register', label: 'Asset Register' },
  { id: 'depreciation', label: 'Depreciation' },
  { id: 'disposal', label: 'Disposal' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'revaluation', label: 'Revaluation' },
  { id: 'verification', label: 'Verification' },
  { id: 'warranty', label: 'Warranty' },
];

const ASSET_CATEGORIES = ['Buildings', 'Furniture', 'Equipment', 'Vehicles', 'Computers', 'Kitchen Equipment', 'Laundry Equipment', 'Other'];
const ASSET_STATUSES = ['Active', 'Under Maintenance', 'Disposal Pending', 'Disposed', 'Written Off'];
const DISPOSAL_REASONS = ['Sold', 'Obsolete', 'Damaged', 'Lost', 'Other'];
const VERIFICATION_CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'Damaged'];
const DEPRECIATION_METHODS = ['Straight Line', 'Double Declining Balance', 'Sum of Years Digits'];
const DEPARTMENTS = ['Front Office', 'F&B Division', 'Housekeeping', 'Engineering', 'IT Dept', 'Finance Dept', 'Security', 'Executive Office', 'Banquet Hall'];

const ASSET_STATUS_TONE: Record<string, StatusTone> = {
  'Active': 'success',
  'Under Maintenance': 'warning',
  'Disposal Pending': 'info',
  'Disposed': 'neutral',
  'Written Off': 'danger',
};

const TRANSFER_STATUS_TONE: Record<string, StatusTone> = {
  'Pending': 'warning',
  'Approved': 'info',
  'Completed': 'success',
  'Rejected': 'danger',
  'Cancelled': 'neutral',
};

const REVAL_STATUS_TONE: Record<string, StatusTone> = {
  'Pending': 'warning',
  'Approved': 'success',
  'Rejected': 'danger',
};

const VERIF_STATUS_TONE: Record<string, StatusTone> = {
  'Pending': 'warning',
  'Verified': 'success',
  'Discrepancy': 'danger',
};

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

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).slice(0, 10);
}

function warrantyStatus(endDate: string | null | undefined): { label: string; tone: StatusTone } {
  if (!endDate) return { label: 'Active', tone: 'success' };
  const end = new Date(endDate).getTime();
  const now = Date.now();
  if (end < now) return { label: 'Expired', tone: 'danger' };
  if (end < now + 90 * 24 * 60 * 60 * 1000) return { label: 'Expiring Soon', tone: 'warning' };
  return { label: 'Active', tone: 'success' };
}

interface ActionMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: LucideIcon;
}

function ActionMenu({ open, onToggle, id, items, busy }: { open: boolean; onToggle: (id: string | null) => void; id: string; items: ActionMenuItem[]; busy?: boolean }) {
  return (
    <div className="relative">
      <button onClick={() => onToggle(open ? null : id)} disabled={busy} className={button.ghost + ' disabled:opacity-50'}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.onClick}
                className={[
                  'w-full text-left px-3 py-2 text-xs font-medium transition',
                  item.danger
                    ? 'text-[var(--color-danger)] hover:bg-red-50 dark:hover:bg-red-900/20'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {Icon && <Icon className="w-3.5 h-3.5 inline mr-1" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const FixedAssets: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [activeTab, setActiveTab] = useState<FixedAssetTab>('register');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [transfers, setTransfers] = useState<AssetTransfer[]>([]);
  const [revaluations, setRevaluations] = useState<AssetRevaluation[]>([]);
  const [verifications, setVerifications] = useState<AssetVerification[]>([]);
  const [warranties, setWarranties] = useState<AssetWarranty[]>([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [schedule, setSchedule] = useState<DepreciationSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [depAction, setDepAction] = useState(false);

  const [showNewAsset, setShowNewAsset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newAssetForm, setNewAssetForm] = useState({
    assetCode: '',
    assetName: '',
    assetCategory: '',
    description: '',
    location: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    purchaseCost: '',
    salvageValue: '',
    usefulLifeYears: '5',
    depreciationMethod: 'Straight Line',
  });

  const [editAsset, setEditAsset] = useState<FixedAsset | null>(null);
  const [editForm, setEditForm] = useState({
    assetName: '',
    assetCategory: '',
    description: '',
    location: '',
    purchaseCost: '',
    salvageValue: '',
    usefulLifeYears: '',
    depreciationMethod: 'Straight Line',
    status: 'Active',
  });

  const [disposalForm, setDisposalForm] = useState({
    assetId: '',
    disposalDate: new Date().toISOString().split('T')[0],
    proceeds: '',
    costs: '',
    reason: 'Sold',
  });

  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({
    assetId: '',
    fromDepartment: '',
    toDepartment: '',
    fromLocation: '',
    toLocation: '',
    transferDate: new Date().toISOString().split('T')[0],
    reason: '',
  });

  const [showRevalForm, setShowRevalForm] = useState(false);
  const [revalForm, setRevalForm] = useState({
    assetId: '',
    revaluationDate: new Date().toISOString().split('T')[0],
    originalValue: '',
    revaluedValue: '',
    reason: '',
  });

  const [showVerifForm, setShowVerifForm] = useState(false);
  const [verifForm, setVerifForm] = useState({
    assetId: '',
    verificationDate: new Date().toISOString().split('T')[0],
    location: '',
    verifiedBy: '',
    condition: 'Good',
    notes: '',
  });

  const [showWarrantyForm, setShowWarrantyForm] = useState(false);
  const [warrantyForm, setWarrantyForm] = useState({
    assetId: '',
    provider: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    coverage: '',
    contact: '',
  });

  // ── Load ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetData, transferData, revalData, verifData, warrantyData] = await Promise.all([
        fetchFixedAssets(undefined, undefined, currentPropertyId || undefined),
        fetchAssetTransfers(currentPropertyId || undefined),
        fetchAssetRevaluations(currentPropertyId || undefined),
        fetchAssetVerifications(currentPropertyId || undefined),
        fetchAssetWarranties(currentPropertyId || undefined),
      ]);
      setAssets(assetData);
      setTransfers(transferData);
      setRevaluations(revalData);
      setVerifications(verifData);
      setWarranties(warrantyData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load fixed assets');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const loadSchedule = useCallback(async (assetId: string) => {
    if (!assetId) { setSchedule([]); return; }
    setScheduleLoading(true);
    try {
      setSchedule(await fetchDepreciationSchedule(assetId));
    } catch (e: any) {
      addNotification(e?.message || 'Failed to load depreciation schedule', 'warning', 'Finance');
    } finally {
      setScheduleLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    if (activeTab === 'depreciation') loadSchedule(selectedAssetId);
  }, [activeTab, selectedAssetId, loadSchedule]);

  const refreshAssets = useCallback(async () => {
    try {
      setAssets(await fetchFixedAssets(undefined, undefined, currentPropertyId || undefined));
    } catch { /* keep current list on background refresh failure */ }
  }, [currentPropertyId]);

  // ── Navigation helpers ────────────────────────────────────────────────
  const openAssetInDepreciation = (assetId: string) => {
    setSelectedAssetId(assetId);
    setActiveTab('depreciation');
    setMenuOpen(null);
  };

  const openAssetInDisposal = (assetId: string) => {
    setDisposalForm(f => ({ ...f, assetId }));
    setActiveTab('disposal');
    setMenuOpen(null);
  };

  // ── Asset CRUD ────────────────────────────────────────────────────────
  const submitCreateAsset = async () => {
    if (!newAssetForm.assetCode.trim() || !newAssetForm.assetName.trim() || !newAssetForm.assetCategory || !newAssetForm.purchaseDate || !newAssetForm.purchaseCost || !newAssetForm.usefulLifeYears) {
      addNotification('Asset code, name, category, purchase date, cost and useful life are required.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createFixedAsset({
        asset_code: newAssetForm.assetCode.trim(),
        asset_name: newAssetForm.assetName.trim(),
        asset_category: newAssetForm.assetCategory,
        description: newAssetForm.description.trim() || undefined,
        location: newAssetForm.location.trim() || undefined,
        purchase_date: newAssetForm.purchaseDate,
        purchase_cost: Number(newAssetForm.purchaseCost),
        salvage_value: Number(newAssetForm.salvageValue) || 0,
        useful_life_years: Number(newAssetForm.usefulLifeYears),
        depreciation_method: newAssetForm.depreciationMethod,
        property_id: currentPropertyId,
      });
      setAssets(prev => [created, ...prev]);
      addNotification(`Asset ${created.asset_code} registered.`, 'success', 'Finance');
      setShowNewAsset(false);
      setNewAssetForm({
        assetCode: '', assetName: '', assetCategory: '', description: '', location: '',
        purchaseDate: new Date().toISOString().split('T')[0],
        purchaseCost: '', salvageValue: '', usefulLifeYears: '5', depreciationMethod: 'Straight Line',
      });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create asset', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditAsset = (asset: FixedAsset) => {
    setEditAsset(asset);
    setEditForm({
      assetName: asset.asset_name,
      assetCategory: asset.asset_category,
      description: asset.description || '',
      location: asset.location || '',
      purchaseCost: String(asset.purchase_cost),
      salvageValue: String(asset.salvage_value),
      usefulLifeYears: String(asset.useful_life_years),
      depreciationMethod: asset.depreciation_method,
      status: asset.status,
    });
    setMenuOpen(null);
  };

  const submitEditAsset = async () => {
    if (!editAsset || !editForm.assetName.trim()) return;
    setSubmitting(true);
    try {
      const updated = await updateFixedAsset(editAsset.id, {
        assetName: editForm.assetName.trim(),
        assetCategory: editForm.assetCategory,
        description: editForm.description.trim() || null,
        location: editForm.location.trim() || null,
        purchaseCost: Number(editForm.purchaseCost),
        salvageValue: Number(editForm.salvageValue) || 0,
        usefulLifeYears: Number(editForm.usefulLifeYears),
        depreciationMethod: editForm.depreciationMethod,
        status: editForm.status,
      });
      setAssets(prev => prev.map(a => (a.id === updated.id ? updated : a)));
      addNotification(`Asset ${updated.asset_code} updated.`, 'success', 'Finance');
      setEditAsset(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update asset', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const doDeleteAsset = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteFixedAsset(id);
      setAssets(prev => prev.filter(a => a.id !== id));
      addNotification('Asset deleted.', 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete asset', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Depreciation ──────────────────────────────────────────────────────
  const runDepreciation = async () => {
    if (!selectedAssetId) return;
    setDepAction(true);
    try {
      await calculateDepreciation(selectedAssetId, fiscalYear);
      await Promise.all([refreshAssets(), loadSchedule(selectedAssetId)]);
      addNotification(`Depreciation posted for FY ${fiscalYear}.`, 'success', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to run depreciation', 'warning', 'Finance');
    } finally {
      setDepAction(false);
    }
  };

  const doGenerateSchedule = async () => {
    if (!selectedAssetId) return;
    setDepAction(true);
    try {
      const result = await generateDepreciationSchedule(selectedAssetId);
      await Promise.all([refreshAssets(), loadSchedule(selectedAssetId)]);
      addNotification(result.message || 'Schedule generated.', 'success', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to generate schedule', 'warning', 'Finance');
    } finally {
      setDepAction(false);
    }
  };

  // ── Disposal ──────────────────────────────────────────────────────────
  const submitDisposal = async () => {
    if (!disposalForm.assetId || !disposalForm.disposalDate) {
      addNotification('Select an asset and a disposal date first.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      await disposeAsset(disposalForm.assetId, disposalForm.disposalDate, Number(disposalForm.proceeds) || 0, Number(disposalForm.costs) || 0, disposalForm.reason);
      await refreshAssets();
      addNotification('Asset disposal processed.', 'success', 'Finance');
      setDisposalForm({ assetId: '', disposalDate: new Date().toISOString().split('T')[0], proceeds: '', costs: '', reason: 'Sold' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to dispose asset', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Transfers ─────────────────────────────────────────────────────────
  const submitTransfer = async () => {
    if (!transferForm.assetId || !transferForm.toDepartment.trim()) {
      addNotification('Asset and destination department are required.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetTransfer({
        assetId: transferForm.assetId,
        fromDepartment: transferForm.fromDepartment.trim() || undefined,
        toDepartment: transferForm.toDepartment.trim(),
        fromLocation: transferForm.fromLocation.trim() || undefined,
        toLocation: transferForm.toLocation.trim() || undefined,
        transferDate: transferForm.transferDate,
        reason: transferForm.reason.trim() || undefined,
        propertyId: currentPropertyId,
      });
      setTransfers(await fetchAssetTransfers(currentPropertyId || undefined));
      addNotification('Asset transfer logged.', 'success', 'Finance');
      setShowTransferForm(false);
      setTransferForm({ assetId: '', fromDepartment: '', toDepartment: '', fromLocation: '', toLocation: '', transferDate: new Date().toISOString().split('T')[0], reason: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log transfer', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeTransferStatus = async (id: string, status: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      const updated = await updateAssetTransfer(id, { status });
      if (status === 'Completed' && updated.to_location) {
        await updateFixedAsset(updated.asset_id, { location: updated.to_location });
        await refreshAssets();
      }
      setTransfers(await fetchAssetTransfers(currentPropertyId || undefined));
      addNotification(`Transfer marked ${status}.`, 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update transfer', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const doDeleteTransfer = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAssetTransfer(id);
      setTransfers(prev => prev.filter(t => t.id !== id));
      addNotification('Transfer deleted.', 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete transfer', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Revaluations ──────────────────────────────────────────────────────
  const submitRevaluation = async () => {
    if (!revalForm.assetId || !revalForm.revaluedValue) {
      addNotification('Asset and revalued amount are required.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetRevaluation({
        assetId: revalForm.assetId,
        revaluationDate: revalForm.revaluationDate,
        originalValue: Number(revalForm.originalValue) || 0,
        revaluedValue: Number(revalForm.revaluedValue),
        reason: revalForm.reason.trim() || undefined,
        propertyId: currentPropertyId,
      });
      setRevaluations(await fetchAssetRevaluations(currentPropertyId || undefined));
      addNotification('Revaluation logged.', 'success', 'Finance');
      setShowRevalForm(false);
      setRevalForm({ assetId: '', revaluationDate: new Date().toISOString().split('T')[0], originalValue: '', revaluedValue: '', reason: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log revaluation', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeRevalStatus = async (id: string, status: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updateAssetRevaluation(id, { status });
      setRevaluations(await fetchAssetRevaluations(currentPropertyId || undefined));
      addNotification(`Revaluation ${status}.`, 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update revaluation', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const doDeleteRevaluation = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAssetRevaluation(id);
      setRevaluations(prev => prev.filter(r => r.id !== id));
      addNotification('Revaluation deleted.', 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete revaluation', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Verifications ─────────────────────────────────────────────────────
  const submitVerification = async () => {
    if (!verifForm.assetId) {
      addNotification('Select an asset to verify.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetVerification({
        assetId: verifForm.assetId,
        verificationDate: verifForm.verificationDate,
        location: verifForm.location.trim() || undefined,
        verifiedBy: verifForm.verifiedBy.trim() || undefined,
        condition: verifForm.condition,
        notes: verifForm.notes.trim() || undefined,
        propertyId: currentPropertyId,
      });
      setVerifications(await fetchAssetVerifications(currentPropertyId || undefined));
      addNotification('Verification logged.', 'success', 'Finance');
      setShowVerifForm(false);
      setVerifForm({ assetId: '', verificationDate: new Date().toISOString().split('T')[0], location: '', verifiedBy: '', condition: 'Good', notes: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to log verification', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const changeVerifStatus = async (id: string, status: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await updateAssetVerification(id, { status });
      setVerifications(await fetchAssetVerifications(currentPropertyId || undefined));
      addNotification(`Verification ${status}.`, 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update verification', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  const doDeleteVerification = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAssetVerification(id);
      setVerifications(prev => prev.filter(v => v.id !== id));
      addNotification('Verification deleted.', 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete verification', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Warranties ────────────────────────────────────────────────────────
  const submitWarranty = async () => {
    if (!warrantyForm.assetId || !warrantyForm.provider.trim()) {
      addNotification('Asset and provider are required.', 'warning', 'Finance');
      return;
    }
    setSubmitting(true);
    try {
      await createAssetWarranty({
        assetId: warrantyForm.assetId,
        provider: warrantyForm.provider.trim(),
        startDate: warrantyForm.startDate,
        endDate: warrantyForm.endDate || undefined,
        coverage: warrantyForm.coverage.trim() || undefined,
        contact: warrantyForm.contact.trim() || undefined,
        propertyId: currentPropertyId,
      });
      setWarranties(await fetchAssetWarranties(currentPropertyId || undefined));
      addNotification('Warranty added.', 'success', 'Finance');
      setShowWarrantyForm(false);
      setWarrantyForm({ assetId: '', provider: '', startDate: new Date().toISOString().split('T')[0], endDate: '', coverage: '', contact: '' });
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add warranty', 'warning', 'Finance');
    } finally {
      setSubmitting(false);
    }
  };

  const doDeleteWarranty = async (id: string) => {
    setActingOn(id);
    setMenuOpen(null);
    try {
      await deleteAssetWarranty(id);
      setWarranties(prev => prev.filter(w => w.id !== id));
      addNotification('Warranty deleted.', 'task', 'Finance');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to delete warranty', 'warning', 'Finance');
    } finally {
      setActingOn(null);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const filteredAssets = useMemo(
    () => assets.filter(a => {
      const matchesCategory = categoryFilter === 'All' || a.asset_category === categoryFilter;
      const matchesStatus = statusFilter === 'All' || a.status === statusFilter;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        a.asset_code.toLowerCase().includes(q) ||
        a.asset_name.toLowerCase().includes(q) ||
        a.asset_category.toLowerCase().includes(q) ||
        (a.location || '').toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q);
      return matchesCategory && matchesStatus && matchesSearch;
    }),
    [assets, categoryFilter, statusFilter, search]
  );

  const totals = useMemo(() => ({
    count: assets.length,
    purchaseCost: assets.reduce((s, a) => s + a.purchase_cost, 0),
    accumulatedDepreciation: assets.reduce((s, a) => s + a.accumulated_depreciation, 0),
    netBookValue: assets.reduce((s, a) => s + a.net_book_value, 0),
    disposed: assets.filter(a => a.status === 'Disposed').length,
  }), [assets]);

  const annualDepreciationEstimate = useMemo(
    () =>
      assets
        .filter(a => a.status === 'Active')
        .reduce((s, a) => s + (a.useful_life_years > 0 ? (a.purchase_cost - a.salvage_value) / a.useful_life_years : 0), 0),
    [assets]
  );

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2014 }, (_, i) => current - i);
  }, []);

  const selectedAsset = assets.find(a => a.id === selectedAssetId) || null;
  const disposalAsset = assets.find(a => a.id === disposalForm.assetId) || null;
  const disposalGain = disposalAsset
    ? Number(disposalForm.proceeds || 0) - Number(disposalForm.costs || 0) - disposalAsset.net_book_value
    : 0;

  const renderRegister = () => (
    <div className={layout.sectionStack}>
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Search code, name, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
          <div className="flex items-center gap-3">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={inputClass + ' w-44'}>
              <option value="All">All Categories</option>
              {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputClass + ' w-44'}>
              <option value="All">All Statuses</option>
              {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setShowNewAsset(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Asset
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard pad="none">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">
            {assets.length === 0 ? 'No assets registered. Click Add Asset to create one.' : 'No assets match the filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Asset Code</th>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                  <th className="px-6 py-3 font-medium">Acquired</th>
                  <th className="px-6 py-3 font-medium text-right">Cost</th>
                  <th className="px-6 py-3 font-medium text-right">Book Value</th>
                  <th className="px-6 py-3 font-medium text-right">Accum. Dep.</th>
                  <th className="px-6 py-3 font-medium text-center">Status</th>
                  <th className="px-6 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {filteredAssets.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400"><span className="text-xs font-mono">{a.asset_code}</span></td>
                    <td className="px-6 py-3">
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-gray-900 dark:text-white block truncate">{a.asset_name}</span>
                        {a.location && <span className="text-xs text-gray-500 block truncate">{a.location}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3"><Badge tone="neutral">{a.asset_category}</Badge></td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{fmtDate(a.purchase_date)}</td>
                    <td className="px-6 py-3 text-right text-slate-900 dark:text-white font-mono tabular-nums">{fmtMoney(a.purchase_cost)}</td>
                    <td className="px-6 py-3 text-right text-slate-900 dark:text-white font-mono tabular-nums">{fmtMoney(a.net_book_value)}</td>
                    <td className="px-6 py-3 text-right text-[var(--color-warning)] font-mono tabular-nums">{fmtMoney(a.accumulated_depreciation)}</td>
                    <td className="px-6 py-3 text-center"><Badge tone={ASSET_STATUS_TONE[a.status] || 'neutral'}>{a.status}</Badge></td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex justify-center">
                        <ActionMenu
                          id={a.id}
                          open={menuOpen === a.id}
                          onToggle={setMenuOpen}
                          busy={actingOn === a.id}
                          items={[
                            { label: 'View Depreciation', icon: Calculator, onClick: () => openAssetInDepreciation(a.id) },
                            { label: 'Edit Asset', icon: Edit, onClick: () => openEditAsset(a) },
                            ...(a.status !== 'Disposed'
                              ? [{ label: 'Dispose Asset', icon: DollarSign, onClick: () => openAssetInDisposal(a.id) }]
                              : []),
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => doDeleteAsset(a.id) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderDepreciation = () => (
    <div className={layout.sectionStack}>
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedAssetId}
              onChange={e => setSelectedAssetId(e.target.value)}
              className={inputClass + ' w-72'}
            >
              <option value="">— Select an asset —</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>
              ))}
            </select>
            <select
              value={fiscalYear}
              onChange={e => setFiscalYear(Number(e.target.value))}
              className={inputClass + ' w-28'}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runDepreciation} disabled={!selectedAssetId || depAction} className={button.secondary + ' disabled:opacity-50'}>
              {depAction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              Run Depreciation
            </button>
            <button onClick={doGenerateSchedule} disabled={!selectedAssetId || depAction} className={button.primary + ' disabled:opacity-50'}>
              <FileText className="w-4 h-4" /> Generate Full Schedule
            </button>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard
          title="Depreciation Schedule"
          subtitle={selectedAsset ? `${selectedAsset.asset_code} — ${selectedAsset.asset_name} · ${selectedAsset.depreciation_method}` : 'Select an asset to view its schedule'}
          icon={Calculator}
        >
          {scheduleLoading && (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading schedule…
            </div>
          )}
          {!scheduleLoading && !selectedAssetId && (
            <div className="p-8 text-center text-sm text-gray-500">Select an asset to view its depreciation schedule.</div>
          )}
          {!scheduleLoading && selectedAssetId && schedule.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No depreciation posted yet. Run depreciation or generate the full schedule.
            </div>
          )}
          {!scheduleLoading && schedule.map(item => (
            <div key={item.id} className="p-4 bg-slate-50 dark:bg-slate-900/40">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold text-gray-900 dark:text-white">FY {item.fiscal_year}</span>
                <span className="text-xs font-medium text-gray-500">{fmtMoney(item.depreciation_amount)} expense</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Beginning</span>
                  <span className="text-sm font-mono tabular-nums text-gray-900 dark:text-white">{fmtMoney(item.accumulated_depreciation - item.depreciation_amount)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Depreciation</span>
                  <span className="text-sm font-mono tabular-nums text-[var(--color-warning)]">{fmtMoney(item.depreciation_amount)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Ending</span>
                  <span className="text-sm font-mono tabular-nums text-gray-900 dark:text-white">{fmtMoney(item.net_book_value)}</span>
                </div>
              </div>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Depreciation Summary" icon={TrendingDown}>
          <div className="space-y-4 p-6">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Total Accumulated Depreciation</span>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{fmtMoney(totals.accumulatedDepreciation)}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Estimated Annual Depreciation (Active Assets)</span>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{fmtMoney(annualDepreciationEstimate)}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Net Book Value (All Assets)</span>
              <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{fmtMoney(totals.netBookValue)}</p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );

  const renderDisposal = () => (
    <div className={layout.sectionStack}>
      <SectionCard title="Asset Disposal" subtitle="Dispose of an asset and compute the gain/loss against book value." icon={DollarSign}>
        {assets.filter(a => a.status !== 'Disposed' && a.status !== 'Written Off').length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No assets available for disposal.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
              <Field label="Select Asset to Dispose">
                <select
                  value={disposalForm.assetId}
                  onChange={e => setDisposalForm(f => ({ ...f, assetId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">— Select an asset —</option>
                  {assets.filter(a => a.status !== 'Disposed' && a.status !== 'Written Off').map(a => (
                    <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Disposal Date">
                <input
                  type="date"
                  value={disposalForm.disposalDate}
                  onChange={e => setDisposalForm(f => ({ ...f, disposalDate: e.target.value }))}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-6 pb-6">
              <Field label="Sale Proceeds ($)">
                <input
                  type="number"
                  min="0"
                  value={disposalForm.proceeds}
                  onChange={e => setDisposalForm(f => ({ ...f, proceeds: e.target.value }))}
                  placeholder="0.00"
                  className={inputClass}
                />
              </Field>
              <Field label="Disposal Costs ($)">
                <input
                  type="number"
                  min="0"
                  value={disposalForm.costs}
                  onChange={e => setDisposalForm(f => ({ ...f, costs: e.target.value }))}
                  placeholder="0.00"
                  className={inputClass}
                />
              </Field>
              <Field label="Reason for Disposal">
                <select
                  value={disposalForm.reason}
                  onChange={e => setDisposalForm(f => ({ ...f, reason: e.target.value }))}
                  className={inputClass}
                >
                  {DISPOSAL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            </div>

            <div className="mx-6 mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Gain/Loss Calculation</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Current Book Value</span>
                  <span className="text-sm font-mono tabular-nums text-gray-900 dark:text-white">{fmtMoney(disposalAsset?.net_book_value ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Sale Proceeds</span>
                  <span className="text-sm font-mono tabular-nums text-[var(--color-success)]">{fmtMoney(Number(disposalForm.proceeds || 0))}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Disposal Costs</span>
                  <span className="text-sm font-mono tabular-nums text-[var(--color-danger)]">{fmtMoney(Number(disposalForm.costs || 0))}</span>
                </div>
                <div className="border-t border-gray-200 dark:border-slate-700 pt-2 flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-900 dark:text-white uppercase">Net Gain/Loss</span>
                  <span className={`text-base font-mono font-bold tabular-nums ${disposalGain >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                    {disposalGain >= 0 ? '+' : ''}{fmtMoney(disposalGain)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button onClick={submitDisposal} disabled={submitting} className={button.primary + ' flex-1 disabled:opacity-50'}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                Process Disposal
              </button>
              <button
                onClick={() => setDisposalForm({ assetId: '', disposalDate: new Date().toISOString().split('T')[0], proceeds: '', costs: '', reason: 'Sold' })}
                className={button.secondary + ' flex-1'}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Recent Disposals" subtitle="Assets removed from the register." icon={Trash2}>
        {assets.filter(a => a.status === 'Disposed').length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No disposals recorded yet.</div>
        ) : (
          assets.filter(a => a.status === 'Disposed').map(asset => (
            <div key={asset.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{asset.asset_name}</p>
                <p className="text-xs text-gray-500">{asset.asset_code} · disposed {fmtDate(asset.disposal_date)}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-sm text-gray-500 tabular-nums">{fmtMoney(asset.disposal_value ?? 0)} proceeds</span>
                <span className={`text-sm font-mono font-bold tabular-nums ${(asset.disposal_value ?? 0) - asset.net_book_value >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {(asset.disposal_value ?? 0) - asset.net_book_value >= 0 ? '+' : ''}
                  {fmtMoney((asset.disposal_value ?? 0) - asset.net_book_value)}
                </span>
              </div>
            </div>
          ))
        )}
      </SectionCard>
    </div>
  );

  const renderTransfers = () => (
    <div className={layout.sectionStack}>
      <SectionCard
        title="Asset Transfers"
        subtitle="Move assets between departments and locations."
        icon={ArrowRightLeft}
        actions={
          <button onClick={() => setShowTransferForm(true)} className={button.primary}>
            <Plus className="w-4 h-4" /> New Transfer
          </button>
        }
        pad="none"
      >
        {transfers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">No transfers logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Asset</th>
                  <th className="px-6 py-3 font-medium">From</th>
                  <th className="px-6 py-3 font-medium">To</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium text-center">Status</th>
                  <th className="px-6 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {transfers.map(t => {
                  const assetLabel = t.fixed_assets ? `${t.fixed_assets.asset_code} — ${t.fixed_assets.asset_name}` : t.transfer_number || t.asset_id;
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 text-sm font-bold text-gray-900 dark:text-white">{assetLabel}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.from_department || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{t.to_department || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{fmtDate(t.transfer_date)}</td>
                      <td className="px-6 py-3 text-center"><Badge tone={TRANSFER_STATUS_TONE[t.status] || 'neutral'}>{t.status}</Badge></td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex justify-center">
                          <ActionMenu
                            id={t.id}
                            open={menuOpen === t.id}
                            onToggle={setMenuOpen}
                            busy={actingOn === t.id}
                            items={[
                              ...(t.status === 'Pending'
                                ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => changeTransferStatus(t.id, 'Approved') }]
                                : []),
                              ...(t.status === 'Approved'
                                ? [{ label: 'Mark Completed', icon: CheckCircle2, onClick: () => changeTransferStatus(t.id, 'Completed') }]
                                : []),
                              ...(t.status === 'Pending'
                                ? [{ label: 'Reject', icon: Trash2, onClick: () => changeTransferStatus(t.id, 'Rejected') }]
                                : []),
                              { label: 'Delete', icon: Trash2, danger: true, onClick: () => doDeleteTransfer(t.id) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderRevaluation = () => (
    <div className={layout.sectionStack}>
      <SectionCard
        title="Asset Revaluation"
        subtitle="Adjust asset carrying values to fair market value."
        icon={TrendingUp}
        actions={
          <button onClick={() => setShowRevalForm(true)} className={button.primary}>
            <Plus className="w-4 h-4" /> New Revaluation
          </button>
        }
        pad="md"
      >
        {revaluations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No revaluations logged yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {revaluations.map(r => {
              const change = r.change_percent ?? 0;
              const assetLabel = r.fixed_assets ? `${r.fixed_assets.asset_code} — ${r.fixed_assets.asset_name}` : r.revaluation_number || r.asset_id;
              return (
                <div key={r.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{assetLabel}</p>
                    <Badge tone={REVAL_STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                  </div>
                  <p className="text-xs text-gray-400 uppercase mb-3">{fmtDate(r.revaluation_date)}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Original</p>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 tabular-nums">{fmtMoney(r.original_value)}</p>
                    </div>
                    <div className="text-center">
                      <ArrowRight className="w-4 h-4 text-gray-300" />
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Revalued</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{fmtMoney(r.revalued_value)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-sm font-bold inline-flex items-center gap-1 ${change >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                      {change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                    </span>
                    <ActionMenu
                      id={r.id}
                      open={menuOpen === r.id}
                      onToggle={setMenuOpen}
                      busy={actingOn === r.id}
                      items={[
                        ...(r.status === 'Pending'
                          ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => changeRevalStatus(r.id, 'Approved') }]
                          : []),
                        ...(r.status === 'Pending'
                          ? [{ label: 'Reject', icon: Trash2, onClick: () => changeRevalStatus(r.id, 'Rejected') }]
                          : []),
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => doDeleteRevaluation(r.id) },
                      ]}
                    />
                  </div>
                  {r.reason && <p className="mt-2 text-xs text-gray-500 line-clamp-2">{r.reason}</p>}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderVerification = () => (
    <div className={layout.sectionStack}>
      <SectionCard
        title="Asset Verification"
        subtitle="Periodic physical verification of registered assets."
        icon={ClipboardCheck}
        actions={
          <button onClick={() => setShowVerifForm(true)} className={button.primary}>
            <Plus className="w-4 h-4" /> New Verification
          </button>
        }
        pad="none"
      >
        {verifications.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">No verifications logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Asset</th>
                  <th className="px-6 py-3 font-medium">Location</th>
                  <th className="px-6 py-3 font-medium">Verified By</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Condition</th>
                  <th className="px-6 py-3 font-medium text-center">Status</th>
                  <th className="px-6 py-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {verifications.map(v => {
                  const assetLabel = v.fixed_assets ? `${v.fixed_assets.asset_code} — ${v.fixed_assets.asset_name}` : v.verification_number || v.asset_id;
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-6 py-3 text-sm font-bold text-gray-900 dark:text-white">{assetLabel}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{v.location || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{v.verified_by || '—'}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{fmtDate(v.verification_date)}</td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{v.condition || '—'}</td>
                      <td className="px-6 py-3 text-center"><Badge tone={VERIF_STATUS_TONE[v.status] || 'neutral'}>{v.status}</Badge></td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex justify-center">
                          <ActionMenu
                            id={v.id}
                            open={menuOpen === v.id}
                            onToggle={setMenuOpen}
                            busy={actingOn === v.id}
                            items={[
                              ...(v.status === 'Pending'
                                ? [{ label: 'Mark Verified', icon: CheckCircle2, onClick: () => changeVerifStatus(v.id, 'Verified') }]
                                : []),
                              ...(v.status === 'Pending'
                                ? [{ label: 'Mark Discrepancy', icon: Trash2, onClick: () => changeVerifStatus(v.id, 'Discrepancy') }]
                                : []),
                              { label: 'Delete', icon: Trash2, danger: true, onClick: () => doDeleteVerification(v.id) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const renderWarranty = () => (
    <div className={layout.sectionStack}>
      <SectionCard
        title="Asset Warranties"
        subtitle="Warranty coverage for registered assets. Status is derived from the end date."
        icon={ShieldCheck}
        actions={
          <button onClick={() => setShowWarrantyForm(true)} className={button.primary}>
            <Plus className="w-4 h-4" /> Add Warranty
          </button>
        }
        pad="md"
      >
        {warranties.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No warranties recorded yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {warranties.map(w => {
              const ws = warrantyStatus(w.end_date);
              const assetLabel = w.fixed_assets ? `${w.fixed_assets.asset_code} — ${w.fixed_assets.asset_name}` : w.warranty_number || w.asset_id;
              return (
                <div key={w.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{assetLabel}</p>
                    <Badge tone={ws.tone}>{ws.label}</Badge>
                  </div>
                  <p className="text-xs text-gray-400 uppercase mb-2">Provider: {w.provider}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Start: {fmtDate(w.start_date)}</span>
                    <span>End: {w.end_date ? fmtDate(w.end_date) : '—'}</span>
                  </div>
                  {w.coverage && <p className="mt-2 text-xs text-gray-500 line-clamp-2">{w.coverage}</p>}
                  <div className="mt-3 flex justify-end">
                    <ActionMenu
                      id={w.id}
                      open={menuOpen === w.id}
                      onToggle={setMenuOpen}
                      busy={actingOn === w.id}
                      items={[
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => doDeleteWarranty(w.id) },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register, depreciation, disposal, transfers, revaluation, verification and warranties."
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button onClick={() => setShowNewAsset(true)} className={button.primary}>
              <Plus className="w-4 h-4" /> New Asset
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Assets" value={totals.count} caption={fmtMoney(totals.purchaseCost)} icon={Building2} tone="accent" />
        <StatCard title="Accumulated Depreciation" value={fmtMoney(totals.accumulatedDepreciation)} caption="Lifetime" icon={TrendingDown} tone="warning" />
        <StatCard title="Net Book Value" value={fmtMoney(totals.netBookValue)} caption="Current value" icon={DollarSign} tone="success" />
        <StatCard title="Annual Depreciation (Est.)" value={fmtMoney(annualDepreciationEstimate)} caption="Active assets" icon={Calculator} tone="info" />
      </div>

      {/* Tab bar */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={[
              'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
              activeTab === t.id
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading && (
        <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading fixed assets…
        </div>
      )}

      {!loading && (
        <>
          {activeTab === 'register' && renderRegister()}
          {activeTab === 'depreciation' && renderDepreciation()}
          {activeTab === 'disposal' && renderDisposal()}
          {activeTab === 'transfers' && renderTransfers()}
          {activeTab === 'revaluation' && renderRevaluation()}
          {activeTab === 'verification' && renderVerification()}
          {activeTab === 'warranty' && renderWarranty()}
        </>
      )}

      {/* New Asset modal */}
      <ModalSystem
        isOpen={showNewAsset}
        onClose={() => (submitting ? undefined : setShowNewAsset(false))}
        title="New Fixed Asset"
        subtitle="Register a new asset for depreciation tracking."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Create Asset'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitCreateAsset}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset Code *">
              <input
                type="text"
                value={newAssetForm.assetCode}
                onChange={e => setNewAssetForm(f => ({ ...f, assetCode: e.target.value }))}
                className={inputClass}
                placeholder="FA-013"
              />
            </Field>
            <Field label="Asset Name *">
              <input
                type="text"
                value={newAssetForm.assetName}
                onChange={e => setNewAssetForm(f => ({ ...f, assetName: e.target.value }))}
                className={inputClass}
                placeholder="Main Building"
              />
            </Field>
            <Field label="Category *">
              <select
                value={newAssetForm.assetCategory}
                onChange={e => setNewAssetForm(f => ({ ...f, assetCategory: e.target.value }))}
                className={inputClass}
              >
                <option value="">Select category</option>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                type="text"
                value={newAssetForm.location}
                onChange={e => setNewAssetForm(f => ({ ...f, location: e.target.value }))}
                className={inputClass}
                placeholder="Main Building, Floor 1"
              />
            </Field>
            <Field label="Purchase Date *">
              <input
                type="date"
                value={newAssetForm.purchaseDate}
                onChange={e => setNewAssetForm(f => ({ ...f, purchaseDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Purchase Cost ($) *">
              <input
                type="number"
                min="0"
                value={newAssetForm.purchaseCost}
                onChange={e => setNewAssetForm(f => ({ ...f, purchaseCost: e.target.value }))}
                className={inputClass}
                placeholder="0.00"
              />
            </Field>
            <Field label="Salvage Value ($)">
              <input
                type="number"
                min="0"
                value={newAssetForm.salvageValue}
                onChange={e => setNewAssetForm(f => ({ ...f, salvageValue: e.target.value }))}
                className={inputClass}
                placeholder="0.00"
              />
            </Field>
            <Field label="Useful Life (Years) *">
              <input
                type="number"
                min="1"
                value={newAssetForm.usefulLifeYears}
                onChange={e => setNewAssetForm(f => ({ ...f, usefulLifeYears: e.target.value }))}
                className={inputClass}
                placeholder="5"
              />
            </Field>
            <Field label="Depreciation Method">
              <select
                value={newAssetForm.depreciationMethod}
                onChange={e => setNewAssetForm(f => ({ ...f, depreciationMethod: e.target.value }))}
                className={inputClass}
              >
                {DEPRECIATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={newAssetForm.description}
              onChange={e => setNewAssetForm(f => ({ ...f, description: e.target.value }))}
              className={inputClass}
              rows={2}
              placeholder="Asset description…"
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Edit Asset modal */}
      <ModalSystem
        isOpen={!!editAsset}
        onClose={() => (submitting ? undefined : setEditAsset(null))}
        title="Edit Fixed Asset"
        subtitle={editAsset ? `${editAsset.asset_code} — ${editAsset.asset_name}` : undefined}
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Saving…' : 'Save Changes'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitEditAsset}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset Name *">
              <input
                type="text"
                value={editForm.assetName}
                onChange={e => setEditForm(f => ({ ...f, assetName: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Category">
              <select
                value={editForm.assetCategory}
                onChange={e => setEditForm(f => ({ ...f, assetCategory: e.target.value }))}
                className={inputClass}
              >
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input
                type="text"
                value={editForm.location}
                onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Status">
              <select
                value={editForm.status}
                onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                className={inputClass}
              >
                {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Purchase Cost ($)">
              <input
                type="number"
                min="0"
                value={editForm.purchaseCost}
                onChange={e => setEditForm(f => ({ ...f, purchaseCost: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Salvage Value ($)">
              <input
                type="number"
                min="0"
                value={editForm.salvageValue}
                onChange={e => setEditForm(f => ({ ...f, salvageValue: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Useful Life (Years)">
              <input
                type="number"
                min="1"
                value={editForm.usefulLifeYears}
                onChange={e => setEditForm(f => ({ ...f, usefulLifeYears: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Depreciation Method">
              <select
                value={editForm.depreciationMethod}
                onChange={e => setEditForm(f => ({ ...f, depreciationMethod: e.target.value }))}
                className={inputClass}
              >
                {DEPRECIATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={editForm.description}
              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              className={inputClass}
              rows={2}
            />
          </Field>
        </div>
      </ModalSystem>

      {/* New Transfer modal */}
      <ModalSystem
        isOpen={showTransferForm}
        onClose={() => (submitting ? undefined : setShowTransferForm(false))}
        title="New Asset Transfer"
        subtitle="Move an asset between departments or locations."
        variant="form"
        size="lg"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Log Transfer'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitTransfer}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset *">
              <select
                value={transferForm.assetId}
                onChange={e => {
                  const id = e.target.value;
                  const asset = assets.find(a => a.id === id);
                  setTransferForm(f => ({
                    ...f,
                    assetId: id,
                    fromLocation: asset?.location || f.fromLocation,
                  }));
                }}
                className={inputClass}
              >
                <option value="">— Select an asset —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>)}
              </select>
            </Field>
            <Field label="Transfer Date">
              <input
                type="date"
                value={transferForm.transferDate}
                onChange={e => setTransferForm(f => ({ ...f, transferDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="From Department">
              <select
                value={transferForm.fromDepartment}
                onChange={e => setTransferForm(f => ({ ...f, fromDepartment: e.target.value }))}
                className={inputClass}
              >
                <option value="">— None —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="To Department *">
              <select
                value={transferForm.toDepartment}
                onChange={e => setTransferForm(f => ({ ...f, toDepartment: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Select department —</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="From Location">
              <input
                type="text"
                value={transferForm.fromLocation}
                onChange={e => setTransferForm(f => ({ ...f, fromLocation: e.target.value }))}
                className={inputClass}
                placeholder="Optional"
              />
            </Field>
            <Field label="To Location">
              <input
                type="text"
                value={transferForm.toLocation}
                onChange={e => setTransferForm(f => ({ ...f, toLocation: e.target.value }))}
                className={inputClass}
                placeholder="Optional"
              />
            </Field>
          </div>
          <Field label="Reason">
            <textarea
              value={transferForm.reason}
              onChange={e => setTransferForm(f => ({ ...f, reason: e.target.value }))}
              className={inputClass}
              rows={2}
              placeholder="Why is this asset being transferred?"
            />
          </Field>
        </div>
      </ModalSystem>

      {/* New Revaluation modal */}
      <ModalSystem
        isOpen={showRevalForm}
        onClose={() => (submitting ? undefined : setShowRevalForm(false))}
        title="New Asset Revaluation"
        subtitle="Adjust an asset's carrying value to fair market value."
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Log Revaluation'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitRevaluation}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset *">
              <select
                value={revalForm.assetId}
                onChange={e => {
                  const id = e.target.value;
                  const asset = assets.find(a => a.id === id);
                  setRevalForm(f => ({
                    ...f,
                    assetId: id,
                    originalValue: asset ? String(asset.purchase_cost) : f.originalValue,
                  }));
                }}
                className={inputClass}
              >
                <option value="">— Select an asset —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>)}
              </select>
            </Field>
            <Field label="Revaluation Date">
              <input
                type="date"
                value={revalForm.revaluationDate}
                onChange={e => setRevalForm(f => ({ ...f, revaluationDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Original Value ($)">
              <input
                type="number"
                min="0"
                value={revalForm.originalValue}
                onChange={e => setRevalForm(f => ({ ...f, originalValue: e.target.value }))}
                className={inputClass}
                placeholder="Auto-filled from asset cost"
              />
            </Field>
            <Field label="Revalued Value ($) *">
              <input
                type="number"
                min="0"
                value={revalForm.revaluedValue}
                onChange={e => setRevalForm(f => ({ ...f, revaluedValue: e.target.value }))}
                className={inputClass}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Reason">
            <textarea
              value={revalForm.reason}
              onChange={e => setRevalForm(f => ({ ...f, reason: e.target.value }))}
              className={inputClass}
              rows={2}
              placeholder="e.g. Independent market valuation"
            />
          </Field>
        </div>
      </ModalSystem>

      {/* New Verification modal */}
      <ModalSystem
        isOpen={showVerifForm}
        onClose={() => (submitting ? undefined : setShowVerifForm(false))}
        title="New Asset Verification"
        subtitle="Record a physical verification of an asset."
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Log Verification'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitVerification}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset *">
              <select
                value={verifForm.assetId}
                onChange={e => {
                  const id = e.target.value;
                  const asset = assets.find(a => a.id === id);
                  setVerifForm(f => ({
                    ...f,
                    assetId: id,
                    location: asset?.location || f.location,
                  }));
                }}
                className={inputClass}
              >
                <option value="">— Select an asset —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>)}
              </select>
            </Field>
            <Field label="Verification Date">
              <input
                type="date"
                value={verifForm.verificationDate}
                onChange={e => setVerifForm(f => ({ ...f, verificationDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Location">
              <input
                type="text"
                value={verifForm.location}
                onChange={e => setVerifForm(f => ({ ...f, location: e.target.value }))}
                className={inputClass}
                placeholder="Where the asset was found"
              />
            </Field>
            <Field label="Verified By">
              <input
                type="text"
                value={verifForm.verifiedBy}
                onChange={e => setVerifForm(f => ({ ...f, verifiedBy: e.target.value }))}
                className={inputClass}
                placeholder="e.g. James B."
              />
            </Field>
            <Field label="Condition">
              <select
                value={verifForm.condition}
                onChange={e => setVerifForm(f => ({ ...f, condition: e.target.value }))}
                className={inputClass}
              >
                {VERIFICATION_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={verifForm.notes}
              onChange={e => setVerifForm(f => ({ ...f, notes: e.target.value }))}
              className={inputClass}
              rows={2}
              placeholder="Optional observations"
            />
          </Field>
        </div>
      </ModalSystem>

      {/* Add Warranty modal */}
      <ModalSystem
        isOpen={showWarrantyForm}
        onClose={() => (submitting ? undefined : setShowWarrantyForm(false))}
        title="Add Asset Warranty"
        subtitle="Record warranty coverage for an asset."
        variant="form"
        size="md"
        loading={submitting}
        confirmLabel={submitting ? 'Submitting…' : 'Add Warranty'}
        cancelLabel="Cancel"
        confirmColor="indigo"
        onConfirm={submitWarranty}
        showFooter
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Asset *">
              <select
                value={warrantyForm.assetId}
                onChange={e => setWarrantyForm(f => ({ ...f, assetId: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Select an asset —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} — {a.asset_name}</option>)}
              </select>
            </Field>
            <Field label="Provider *">
              <input
                type="text"
                value={warrantyForm.provider}
                onChange={e => setWarrantyForm(f => ({ ...f, provider: e.target.value }))}
                className={inputClass}
                placeholder="e.g. Dell Technologies"
              />
            </Field>
            <Field label="Start Date">
              <input
                type="date"
                value={warrantyForm.startDate}
                onChange={e => setWarrantyForm(f => ({ ...f, startDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="End Date">
              <input
                type="date"
                value={warrantyForm.endDate}
                onChange={e => setWarrantyForm(f => ({ ...f, endDate: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Coverage">
              <input
                type="text"
                value={warrantyForm.coverage}
                onChange={e => setWarrantyForm(f => ({ ...f, coverage: e.target.value }))}
                className={inputClass}
                placeholder="e.g. Parts & Labour"
              />
            </Field>
            <Field label="Contact">
              <input
                type="text"
                value={warrantyForm.contact}
                onChange={e => setWarrantyForm(f => ({ ...f, contact: e.target.value }))}
                className={inputClass}
                placeholder="Provider contact"
              />
            </Field>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default FixedAssets;
