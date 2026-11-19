/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * F&B Quality & Compliance module — F&B Portal.
 * Owns Temperature Logs, HACCP Checks, Allergen Controls, Expiry Items,
 * Service Standards, Cleaning Checklists, and Compliance Audits.
 *
 * All data is persisted to the database via the /api/fb/quality-compliance/*
 * routes (see src/server/routes/fbQualityCompliance.routes.ts).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardCheck,
  ShieldCheck,
  Thermometer,
  Droplets,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Search,
  Plus,
  CalendarDays,
  Activity,
  RefreshCw,
  X,
  Pencil,
  Trash2,
  Bug,
  Loader2,
  Check,
  ListChecks,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';

type SubTab = 'daily-ops' | 'food-safety' | 'quality' | 'checklists' | 'audits';
type ResourceType =
  | 'temperature-logs' | 'haccp-checks' | 'allergen-controls' | 'expiry-items'
  | 'service-standards' | 'cleaning-checklists' | 'audits';

interface Outlet { id: string; name: string; type: string; }

interface TemperatureLog {
  id: string; outlet_id: string | null; location: string;
  type: 'fridge' | 'freezer' | 'hot-holding' | 'ambient';
  temperature: number; target_min: number; target_max: number;
  status: 'safe' | 'warning' | 'critical';
  logged_by: string | null; logged_at: string; notes?: string | null;
  outlets?: { name: string } | null;
}

interface HACCPCheck {
  id: string; outlet_id: string | null; checkpoint: string;
  category: 'receiving' | 'storage' | 'preparation' | 'cooking' | 'cooling' | 'serving';
  status: 'pass' | 'fail' | 'corrected';
  notes: string | null; checked_by: string | null; checked_at: string;
  outlets?: { name: string } | null;
}

interface AllergenControl {
  id: string; outlet_id: string | null; item: string; allergen: string;
  control_measure: string | null; last_verified: string | null;
  status: 'verified' | 'needs-review' | 'non-compliant';
  outlets?: { name: string } | null;
}

interface ExpiryItem {
  id: string; outlet_id: string | null; item: string; batch: string | null;
  expiry_date: string; quantity: number; unit: string;
  status: 'safe' | 'expiring-soon' | 'expired';
  outlets?: { name: string } | null;
}

interface ServiceStandard {
  id: string; outlet_id: string | null; standard: string;
  category: 'grooming' | 'presentation' | 'greeting' | 'upselling' | 'plate-presentation';
  score: number; max_score: number; last_audited: string | null; auditor: string | null;
  outlets?: { name: string } | null;
}

interface CleaningChecklist {
  id: string; outlet_id: string | null; area: string; task: string;
  checklist_type: 'cleaning' | 'opening' | 'closing' | 'daily-ops' | 'safety' | 'equipment' | 'other';
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  status: 'pending' | 'in-progress' | 'completed' | 'overdue';
  assigned_to: string | null; due_date: string | null; completed_at: string | null;
  outlets?: { name: string } | null;
}

interface ComplianceAudit {
  id: string; outlet_id: string | null; title: string;
  type: 'internal' | 'external' | 'health-inspection' | 'self-assessment';
  status: 'scheduled' | 'in-progress' | 'completed' | 'failed';
  score: number | null; max_score: number; auditor: string | null;
  audit_date: string | null; findings: string | null;
  outlets?: { name: string } | null;
}

const SUB_TABS: { id: SubTab; label: string; icon: typeof ClipboardCheck }[] = [
  { id: 'daily-ops', label: 'Daily Operations', icon: ClipboardCheck },
  { id: 'food-safety', label: 'Food Safety', icon: ShieldCheck },
  { id: 'quality', label: 'Quality Assurance', icon: CheckCircle2 },
  { id: 'checklists', label: 'Checklists', icon: FileText },
  { id: 'audits', label: 'Audits', icon: Activity },
];

const TEMP_TYPES = ['fridge', 'freezer', 'hot-holding', 'ambient'] as const;
const TEMP_STATUS = ['safe', 'warning', 'critical'] as const;
const HACCP_CATEGORIES = ['receiving', 'storage', 'preparation', 'cooking', 'cooling', 'serving'] as const;
const HACCP_STATUS = ['pass', 'fail', 'corrected'] as const;
const ALLERGEN_STATUS = ['verified', 'needs-review', 'non-compliant'] as const;
const EXPIRY_STATUS = ['safe', 'expiring-soon', 'expired'] as const;
const STD_CATEGORIES = ['grooming', 'presentation', 'greeting', 'upselling', 'plate-presentation'] as const;
const CLEAN_FREQ = ['hourly', 'daily', 'weekly', 'monthly'] as const;
const CLEAN_STATUS = ['pending', 'in-progress', 'completed', 'overdue'] as const;
const CHECKLIST_TYPES = ['cleaning', 'opening', 'closing', 'daily-ops', 'safety', 'equipment', 'other'] as const;
const AUDIT_TYPES = ['internal', 'external', 'health-inspection', 'self-assessment'] as const;
const AUDIT_STATUS = ['scheduled', 'in-progress', 'completed', 'failed'] as const;

// ── Checklist templates ─────────────────────────────────────────────
// Predefined industry-standard checklists. Loading a template fills the
// bulk-create modal with default tasks (per-row area/task/assignee) and
// shared type/frequency. The user can edit before saving.
interface ChecklistTemplateTask {
  area: string;
  task: string;
  assigned_to?: string;
}
interface ChecklistTemplate {
  id: string;
  label: string;
  checklist_type: CleaningChecklist['checklist_type'];
  frequency: CleaningChecklist['frequency'];
  tasks: ChecklistTemplateTask[];
}
const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    id: 'opening',
    label: 'Outlet Opening',
    checklist_type: 'opening',
    frequency: 'daily',
    tasks: [
      { area: 'Kitchen', task: 'Equipment inspection and startup', assigned_to: '' },
      { area: 'Kitchen', task: 'Refrigeration temperature verification', assigned_to: '' },
      { area: 'Prep Stations', task: 'Sanitize work surfaces and cutting boards', assigned_to: '' },
      { area: 'Front of House', task: 'Dining area setup and station prep', assigned_to: '' },
      { area: 'Front of House', task: 'Check cleanliness of tables, chairs, and condiments', assigned_to: '' },
      { area: 'Storage', task: 'Verify stock levels for opening service', assigned_to: '' },
    ],
  },
  {
    id: 'closing',
    label: 'Outlet Closing',
    checklist_type: 'closing',
    frequency: 'daily',
    tasks: [
      { area: 'Kitchen', task: 'Equipment shutdown and cleaning', assigned_to: '' },
      { area: 'Kitchen', task: 'Label and store all prepped items', assigned_to: '' },
      { area: 'Front of House', task: 'Waste disposal and area reset', assigned_to: '' },
      { area: 'Front of House', task: 'Cash-up and secure point of sale', assigned_to: '' },
      { area: 'Storage', task: 'Lock all storage and refrigeration units', assigned_to: '' },
      { area: 'Floors', task: 'Sweep and mop all floor areas', assigned_to: '' },
    ],
  },
  {
    id: 'daily-cleaning',
    label: 'Daily Cleaning',
    checklist_type: 'cleaning',
    frequency: 'daily',
    tasks: [
      { area: 'Prep Stations', task: 'Sanitize work surfaces', assigned_to: '' },
      { area: 'Kitchen Floor', task: 'Sweep and mop', assigned_to: '' },
      { area: 'Service Counter', task: 'Wipe down and sanitize', assigned_to: '' },
      { area: 'Handwash Stations', task: 'Refill soap and paper towels', assigned_to: '' },
      { area: 'Restrooms', task: 'Clean and restock supplies', assigned_to: '' },
    ],
  },
  {
    id: 'weekly-deep-clean',
    label: 'Weekly Deep Clean',
    checklist_type: 'cleaning',
    frequency: 'weekly',
    tasks: [
      { area: 'Walk-in Fridge', task: 'Deep clean and organize', assigned_to: '' },
      { area: 'Walk-in Freezer', task: 'Defrost and sanitize', assigned_to: '' },
      { area: 'Glasswasher', task: 'Clean and descale', assigned_to: '' },
      { area: 'Extraction Hood', task: 'Filter degrease and inspect', assigned_to: '' },
      { area: 'Dry Storage', task: 'Inventory audit and shelf cleaning', assigned_to: '' },
    ],
  },
  {
    id: 'safety',
    label: 'Safety Check',
    checklist_type: 'safety',
    frequency: 'weekly',
    tasks: [
      { area: 'All Areas', task: 'Fire extinguisher inspection', assigned_to: '' },
      { area: 'All Areas', task: 'First aid kit stock check', assigned_to: '' },
      { area: 'Kitchen', task: 'Chemical storage and labeling review', assigned_to: '' },
      { area: 'Exits', task: 'Emergency exits and lighting check', assigned_to: '' },
    ],
  },
  {
    id: 'equipment',
    label: 'Equipment Inspection',
    checklist_type: 'equipment',
    frequency: 'weekly',
    tasks: [
      { area: 'Kitchen', task: 'Refrigeration unit inspection', assigned_to: '' },
      { area: 'Kitchen', task: 'Oven and range calibration check', assigned_to: '' },
      { area: 'Bar', task: 'Glasswasher and ice machine inspection', assigned_to: '' },
      { area: 'Kitchen', task: 'Dishwasher temperature and pressure check', assigned_to: '' },
    ],
  },
];

const API = '/api/fb/quality-compliance';

export default function OperationsCompliance() {
  const { addNotification } = useERP();
  const [subTab, setSubTab] = useState<SubTab>('food-safety');
  const [searchTerm, setSearchTerm] = useState('');
  const [checklistTypeFilter, setChecklistTypeFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [showChecklistBulkModal, setShowChecklistBulkModal] = useState(false);
  const [newRecordResource, setNewRecordResource] = useState<ResourceType | null>(null);
  const [showNewRecordMenu, setShowNewRecordMenu] = useState(false);
  const [editing, setEditing] = useState<{ resource: ResourceType; row: any } | null>(null);
  const [saving, setSaving] = useState(false);

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [temperatureLogs, setTemperatureLogs] = useState<TemperatureLog[]>([]);
  const [haccpChecks, setHaccpChecks] = useState<HACCPCheck[]>([]);
  const [allergenControls, setAllergenControls] = useState<AllergenControl[]>([]);
  const [expiryItems, setExpiryItems] = useState<ExpiryItem[]>([]);
  const [serviceStandards, setServiceStandards] = useState<ServiceStandard[]>([]);
  const [cleaningChecklists, setCleaningChecklists] = useState<CleaningChecklist[]>([]);
  const [audits, setAudits] = useState<ComplianceAudit[]>([]);

  const [loadingOutlets, setLoadingOutlets] = useState(true);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // ── API helper ───────────────────────────────────────────────────
  const apiCall = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    return r.status === 204 ? null : r.json();
  };

  const fetchOutlets = useCallback(async () => {
    setLoadingOutlets(true);
    try {
      const r = await fetch(`${API}/outlets`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setOutlets(await r.json());
    } catch { /* ignore */ } finally { setLoadingOutlets(false); }
  }, []);

  const fetchResource = useCallback(async (resource: ResourceType, setter: (a: any[]) => void) => {
    setLoading(s => ({ ...s, [resource]: true }));
    try {
      const r = await fetch(`${API}/${resource}`, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) setter(await r.json());
      else addNotification(`Failed to load ${resource}`, 'warning', 'F&B');
    } catch {
      addNotification(`Failed to load ${resource}`, 'warning', 'F&B');
    } finally {
      setLoading(s => ({ ...s, [resource]: false }));
    }
  }, [addNotification]);

  const fetchTemp = useCallback(() => fetchResource('temperature-logs', setTemperatureLogs), [fetchResource]);
  const fetchHaccp = useCallback(() => fetchResource('haccp-checks', setHaccpChecks), [fetchResource]);
  const fetchAllergen = useCallback(() => fetchResource('allergen-controls', setAllergenControls), [fetchResource]);
  const fetchExpiry = useCallback(() => fetchResource('expiry-items', setExpiryItems), [fetchResource]);
  const fetchStandards = useCallback(() => fetchResource('service-standards', setServiceStandards), [fetchResource]);
  const fetchCleaning = useCallback(() => fetchResource('cleaning-checklists', setCleaningChecklists), [fetchResource]);
  const fetchAudits = useCallback(() => fetchResource('audits', setAudits), [fetchResource]);

  useEffect(() => { fetchOutlets(); }, [fetchOutlets]);

  // Load data for active sub-tab
  useEffect(() => {
    if (subTab === 'food-safety') { fetchTemp(); fetchHaccp(); fetchAllergen(); fetchExpiry(); }
    if (subTab === 'quality') { fetchStandards(); }
    if (subTab === 'checklists') { fetchCleaning(); }
    if (subTab === 'audits') { fetchAudits(); }
  }, [subTab, fetchTemp, fetchHaccp, fetchAllergen, fetchExpiry, fetchStandards, fetchCleaning, fetchAudits]);

  const refreshAll = useCallback(() => {
    fetchOutlets();
    fetchTemp(); fetchHaccp(); fetchAllergen(); fetchExpiry();
    fetchStandards(); fetchCleaning(); fetchAudits();
    addNotification('Compliance data refreshed', 'info', 'F&B');
  }, [fetchOutlets, fetchTemp, fetchHaccp, fetchAllergen, fetchExpiry, fetchStandards, fetchCleaning, fetchAudits, addNotification]);

  // ── CRUD ─────────────────────────────────────────────────────────
  const handleSave = async (resource: ResourceType, payload: any, id?: string) => {
    setSaving(true);
    try {
      await apiCall(id ? 'PUT' : 'POST', `/${resource}${id ? `/${id}` : ''}`, payload);
      addNotification(`${resource} ${id ? 'updated' : 'created'}`, 'success', 'F&B');
      setShowModal(false); setEditing(null); setNewRecordResource(null);
      if (resource === 'temperature-logs') fetchTemp();
      if (resource === 'haccp-checks') fetchHaccp();
      if (resource === 'allergen-controls') fetchAllergen();
      if (resource === 'expiry-items') fetchExpiry();
      if (resource === 'service-standards') fetchStandards();
      if (resource === 'cleaning-checklists') fetchCleaning();
      if (resource === 'audits') fetchAudits();
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'danger', 'F&B');
    } finally { setSaving(false); }
  };

  const handleDelete = async (resource: ResourceType, id: string) => {
    if (!confirm('Delete this record?')) return;
    setSaving(true);
    try {
      await apiCall('DELETE', `/${resource}/${id}`);
      addNotification(`${resource} deleted`, 'info', 'F&B');
      if (resource === 'temperature-logs') setTemperatureLogs(a => a.filter(x => x.id !== id));
      if (resource === 'haccp-checks') setHaccpChecks(a => a.filter(x => x.id !== id));
      if (resource === 'allergen-controls') setAllergenControls(a => a.filter(x => x.id !== id));
      if (resource === 'expiry-items') setExpiryItems(a => a.filter(x => x.id !== id));
      if (resource === 'service-standards') setServiceStandards(a => a.filter(x => x.id !== id));
      if (resource === 'cleaning-checklists') setCleaningChecklists(a => a.filter(x => x.id !== id));
      if (resource === 'audits') setAudits(a => a.filter(x => x.id !== id));
    } catch (e: any) {
      addNotification(e.message || 'Delete failed', 'danger', 'F&B');
    } finally { setSaving(false); }
  };

  // ── Bulk create checklists (multi-task / multi-outlet) ───────────
  const handleBulkCreateChecklists = async (items: any[]) => {
    if (items.length === 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/cleaning-checklists/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Bulk create failed (${r.status})`);
      }
      const created: CleaningChecklist[] = await r.json();
      setCleaningChecklists(prev => [...created, ...prev]);
      addNotification(`${created.length} checklist task(s) created`, 'success', 'F&B');
      setShowChecklistBulkModal(false);
    } catch (e: any) {
      addNotification(e.message || 'Bulk create failed', 'danger', 'F&B');
    } finally { setSaving(false); }
  };

  // ── Inline toggle complete ────────────────────────────────────────
  const handleToggleComplete = async (id: string) => {
    // Optimistic: find current row
    const prev = cleaningChecklists.find(c => c.id === id);
    if (!prev) return;
    const willComplete = prev.status !== 'completed';
    const optimistic: CleaningChecklist = willComplete
      ? { ...prev, status: 'completed', completed_at: new Date().toISOString() }
      : { ...prev, status: 'pending', completed_at: null };
    setCleaningChecklists(list => list.map(c => c.id === id ? optimistic : c));
    try {
      const r = await fetch(`${API}/cleaning-checklists/${id}/toggle-complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Toggle failed (${r.status})`);
      }
      const updated: CleaningChecklist = await r.json();
      setCleaningChecklists(list => list.map(c => c.id === id ? updated : c));
    } catch (e: any) {
      // Revert on failure
      setCleaningChecklists(list => list.map(c => c.id === id ? prev : c));
      addNotification(e.message || 'Toggle failed', 'danger', 'F&B');
    }
  };

  // ── Derived stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const completed = cleaningChecklists.filter(c => c.status === 'completed').length;
    const total = cleaningChecklists.length;
    const haccpCount = haccpChecks.length;
    const avgScore = serviceStandards.length > 0
      ? Math.round(serviceStandards.reduce((s, x) => s + (x.score / x.max_score) * 100, 0) / serviceStandards.length)
      : 0;
    const pending = cleaningChecklists.filter(c => c.status === 'overdue' || c.status === 'pending').length
      + expiryItems.filter(e => e.status === 'expired' || e.status === 'expiring-soon').length;
    return {
      checklists: total > 0 ? `${completed}/${total}` : '0/0',
      haccp: haccpCount,
      compliance: `${avgScore}%`,
      pending,
    };
  }, [cleaningChecklists, haccpChecks, serviceStandards, expiryItems]);

  // ── Filters ──────────────────────────────────────────────────────
  const q = searchTerm.toLowerCase();
  const fTemp = temperatureLogs.filter(l =>
    (l.outlets?.name || '').toLowerCase().includes(q) || l.location.toLowerCase().includes(q));
  const fHaccp = haccpChecks.filter(c =>
    (c.outlets?.name || '').toLowerCase().includes(q) || c.checkpoint.toLowerCase().includes(q));
  const fAllergen = allergenControls.filter(a =>
    (a.outlets?.name || '').toLowerCase().includes(q) || a.item.toLowerCase().includes(q));
  const fExpiry = expiryItems.filter(e =>
    (e.outlets?.name || '').toLowerCase().includes(q) || e.item.toLowerCase().includes(q));
  const fStandards = serviceStandards.filter(s =>
    (s.outlets?.name || '').toLowerCase().includes(q) || s.standard.toLowerCase().includes(q));
  const fCleaning = cleaningChecklists.filter(c =>
    (checklistTypeFilter === 'all' || c.checklist_type === checklistTypeFilter) &&
    ((c.outlets?.name || '').toLowerCase().includes(q) || c.area.toLowerCase().includes(q) || c.task.toLowerCase().includes(q)));
  const fAudits = audits.filter(a =>
    (a.outlets?.name || '').toLowerCase().includes(q) || a.title.toLowerCase().includes(q));

  // "New Record" options per sub-tab
  const NEW_RECORD_OPTIONS: Record<SubTab, { resource: ResourceType; label: string }[]> = {
    'food-safety': [
      { resource: 'temperature-logs', label: 'Temperature Log' },
      { resource: 'haccp-checks', label: 'HACCP Check' },
      { resource: 'allergen-controls', label: 'Allergen Control' },
      { resource: 'expiry-items', label: 'Expiry Item' },
    ],
    'quality': [{ resource: 'service-standards', label: 'Service Standard' }],
    'checklists': [{ resource: 'cleaning-checklists', label: 'Checklist' }],
    'audits': [{ resource: 'audits', label: 'Compliance Audit' }],
    'daily-ops': [],
  };
  const currentNewOptions = NEW_RECORD_OPTIONS[subTab] || [];

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className={['accent-fb', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Quality & Compliance"
        subtitle="Food safety, hygiene, temperature logs, HACCP checks, cleaning checklists, allergen controls, expiry controls, and service standards"
        icon={ShieldCheck}
        actions={
          <>
            <button onClick={refreshAll} className={button.secondary} disabled={saving}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            {currentNewOptions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowNewRecordMenu(v => !v)}
                  className={button.primary}
                  disabled={saving}
                >
                  <Plus className="w-4 h-4" /> New Record
                </button>
                {showNewRecordMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowNewRecordMenu(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1">
                      {currentNewOptions.map(opt => (
                        <button
                          key={opt.resource}
                          onClick={() => {
                            if (opt.resource === 'cleaning-checklists') {
                              // Multi-task / template / multi-outlet bulk modal
                              setEditing(null);
                              setShowChecklistBulkModal(true);
                            } else {
                              setNewRecordResource(opt.resource);
                              setEditing(null);
                              setShowModal(true);
                            }
                            setShowNewRecordMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Checklists Completed" value={stats.checklists} icon={CheckCircle2} tone="success" />
        <StatCard title="HACCP Logs" value={stats.haccp} icon={Thermometer} tone="warning" />
        <StatCard title="Compliance Score" value={stats.compliance} icon={ShieldCheck} tone="info" />
        <StatCard title="Pending Actions" value={stats.pending} icon={AlertTriangle} tone="danger" />
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setSubTab(tab.id); setSearchTerm(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              subTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-[var(--color-accent-operations)] shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
      </div>

      <div className="space-y-6">
        {subTab === 'food-safety' && (
          <>
            {/* Temperature Logs */}
            <SectionCard title="Temperature Logs" subtitle="Monitor fridge, freezer, and hot-holding temperatures">
              {loading['temperature-logs'] ? <LoadingRow /> : (
                <DataTable
                  headers={['Outlet', 'Location', 'Type', 'Temp', 'Range', 'Status', 'Logged By', 'Time', '']}
                  rows={fTemp.map(log => [
                    log.outlets?.name || '—',
                    log.location,
                    <Badge tone="neutral">{log.type}</Badge>,
                    <span className="font-medium text-slate-900 dark:text-white">{log.temperature}°C</span>,
                    `${log.target_min}°C - ${log.target_max}°C`,
                    <Badge tone={log.status === 'safe' ? 'success' : log.status === 'warning' ? 'warning' : 'danger'}>{log.status}</Badge>,
                    log.logged_by || '—',
                    fmtDateTime(log.logged_at),
                    <RowActions onEdit={() => { setEditing({ resource: 'temperature-logs', row: log }); setShowModal(true); }} onDelete={() => handleDelete('temperature-logs', log.id)} />,
                  ])}
                  empty={fTemp.length === 0}
                  emptyColSpan={9}
                />
              )}
            </SectionCard>

            {/* HACCP Checks */}
            <SectionCard title="HACCP Checks" subtitle="Critical control point monitoring">
              {loading['haccp-checks'] ? <LoadingRow /> : (
                <DataTable
                  headers={['Outlet', 'Checkpoint', 'Category', 'Status', 'Notes', 'Checked By', 'Time', '']}
                  rows={fHaccp.map(check => [
                    check.outlets?.name || '—',
                    <span className="font-medium text-slate-900 dark:text-white">{check.checkpoint}</span>,
                    <Badge tone="neutral">{check.category}</Badge>,
                    <Badge tone={check.status === 'pass' ? 'success' : check.status === 'corrected' ? 'warning' : 'danger'}>{check.status}</Badge>,
                    check.notes || '—',
                    check.checked_by || '—',
                    fmtDateTime(check.checked_at),
                    <RowActions onEdit={() => { setEditing({ resource: 'haccp-checks', row: check }); setShowModal(true); }} onDelete={() => handleDelete('haccp-checks', check.id)} />,
                  ])}
                  empty={fHaccp.length === 0}
                  emptyColSpan={8}
                />
              )}
            </SectionCard>

            {/* Allergen Controls */}
            <SectionCard title="Allergen Controls" subtitle="Allergen management and labeling">
              {loading['allergen-controls'] ? <LoadingRow /> : (
                <DataTable
                  headers={['Outlet', 'Item', 'Allergen', 'Control Measure', 'Last Verified', 'Status', '']}
                  rows={fAllergen.map(control => [
                    control.outlets?.name || '—',
                    <span className="font-medium text-slate-900 dark:text-white">{control.item}</span>,
                    <Badge tone="danger"><Bug className="w-3 h-3 inline mr-1" />{control.allergen}</Badge>,
                    control.control_measure || '—',
                    control.last_verified || '—',
                    <Badge tone={control.status === 'verified' ? 'success' : control.status === 'needs-review' ? 'warning' : 'danger'}>{control.status}</Badge>,
                    <RowActions onEdit={() => { setEditing({ resource: 'allergen-controls', row: control }); setShowModal(true); }} onDelete={() => handleDelete('allergen-controls', control.id)} />,
                  ])}
                  empty={fAllergen.length === 0}
                  emptyColSpan={7}
                />
              )}
            </SectionCard>

            {/* Expiry Controls */}
            <SectionCard title="Expiry Controls" subtitle="Track ingredient expiry dates">
              {loading['expiry-items'] ? <LoadingRow /> : (
                <DataTable
                  headers={['Outlet', 'Item', 'Batch', 'Expiry Date', 'Quantity', 'Status', '']}
                  rows={fExpiry.map(item => [
                    item.outlets?.name || '—',
                    <span className="font-medium text-slate-900 dark:text-white">{item.item}</span>,
                    item.batch || '—',
                    item.expiry_date,
                    `${item.quantity} ${item.unit}`,
                    <Badge tone={item.status === 'safe' ? 'success' : item.status === 'expiring-soon' ? 'warning' : 'danger'}>{item.status}</Badge>,
                    <RowActions onEdit={() => { setEditing({ resource: 'expiry-items', row: item }); setShowModal(true); }} onDelete={() => handleDelete('expiry-items', item.id)} />,
                  ])}
                  empty={fExpiry.length === 0}
                  emptyColSpan={7}
                />
              )}
            </SectionCard>
          </>
        )}

        {subTab === 'quality' && (
          <>
            <SectionCard title="Service Standards" subtitle="Monitor service quality and compliance">
              {loading['service-standards'] ? <LoadingRow /> : (
                <DataTable
                  headers={['Outlet', 'Standard', 'Category', 'Score', 'Last Audited', 'Auditor', '']}
                  rows={fStandards.map(s => [
                    s.outlets?.name || '—',
                    <span className="font-medium text-slate-900 dark:text-white">{s.standard}</span>,
                    <Badge tone="neutral">{s.category}</Badge>,
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.score >= 90 ? 'bg-green-500' : s.score >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${(s.score / s.max_score) * 100}%` }} />
                      </div>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{s.score}/{s.max_score}</span>
                    </div>,
                    s.last_audited || '—',
                    s.auditor || '—',
                    <RowActions onEdit={() => { setEditing({ resource: 'service-standards', row: s }); setShowModal(true); }} onDelete={() => handleDelete('service-standards', s.id)} />,
                  ])}
                  empty={fStandards.length === 0}
                  emptyColSpan={7}
                />
              )}
            </SectionCard>

            {/* Hygiene Standards — derived summary from service standards in hygiene-related categories */}
            <SectionCard title="Hygiene Standards" subtitle="Staff hygiene and sanitation compliance (derived from service standards)">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <HygieneCard icon={Droplets} label="Hand Hygiene" standards={serviceStandards.filter(s => s.category === 'grooming')} />
                <HygieneCard icon={CheckCircle2} label="Equipment Sanitization" standards={serviceStandards.filter(s => s.category === 'plate-presentation')} />
                <HygieneCard icon={ShieldCheck} label="PPE Compliance" standards={serviceStandards.filter(s => s.category === 'presentation')} />
              </div>
            </SectionCard>
          </>
        )}

        {subTab === 'checklists' && (
          <SectionCard
            title="Checklists"
            subtitle="Cleaning, opening, closing, safety, equipment, and other operational checklists"
            actions={
              <select
                value={checklistTypeFilter}
                onChange={e => setChecklistTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                <option value="all">All types</option>
                {CHECKLIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            }
          >
            {loading['cleaning-checklists'] ? <LoadingRow /> : (
              <DataTable
                headers={['', 'Outlet', 'Area', 'Task', 'Type', 'Frequency', 'Assigned To', 'Due Date', 'Status', '']}
                rows={fCleaning.map(c => [
                  <button
                    onClick={() => handleToggleComplete(c.id)}
                    title={c.status === 'completed' ? 'Mark pending' : 'Mark completed'}
                    className={`inline-flex items-center justify-center w-5 h-5 rounded border ${
                      c.status === 'completed'
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-slate-300 dark:border-slate-600 text-transparent hover:border-green-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>,
                  c.outlets?.name || '—',
                  c.area,
                  <span className="font-medium text-slate-900 dark:text-white">{c.task}</span>,
                  <Badge tone={typeTone(c.checklist_type)}>{c.checklist_type}</Badge>,
                  <Badge tone="neutral">{c.frequency}</Badge>,
                  c.assigned_to || '—',
                  fmtDateTime(c.due_date),
                  <Badge tone={c.status === 'completed' ? 'success' : c.status === 'in-progress' ? 'warning' : c.status === 'overdue' ? 'danger' : 'neutral'}>{c.status}</Badge>,
                  <RowActions onEdit={() => { setEditing({ resource: 'cleaning-checklists', row: c }); setShowModal(true); }} onDelete={() => handleDelete('cleaning-checklists', c.id)} />,
                ])}
                empty={fCleaning.length === 0}
                emptyColSpan={10}
              />
            )}
          </SectionCard>
        )}

        {subTab === 'daily-ops' && (
          <SectionCard title="Daily Operations" subtitle="Opening, closing, and other daily operational checklists">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DailyOpsCard
                icon={CalendarDays}
                tone="green"
                title="Outlet Opening Checklist"
                items={cleaningChecklists.filter(c => c.checklist_type === 'opening')}
              />
              <DailyOpsCard
                icon={Clock}
                tone="amber"
                title="Outlet Closing Checklist"
                items={cleaningChecklists.filter(c => c.checklist_type === 'closing')}
              />
              <DailyOpsCard
                icon={ClipboardCheck}
                tone="green"
                title="Daily Operations Checklist"
                items={cleaningChecklists.filter(c => c.checklist_type === 'daily-ops')}
              />
              <DailyOpsCard
                icon={ShieldCheck}
                tone="amber"
                title="Safety & Equipment Checklists"
                items={cleaningChecklists.filter(c => c.checklist_type === 'safety' || c.checklist_type === 'equipment')}
              />
            </div>
          </SectionCard>
        )}

        {subTab === 'audits' && (
          <SectionCard title="Audits & Inspections" subtitle="Internal audits, compliance reviews, and inspection reports">
            {loading['audits'] ? <LoadingRow /> : (
              <DataTable
                headers={['Outlet', 'Title', 'Type', 'Status', 'Score', 'Auditor', 'Audit Date', 'Findings', '']}
                rows={fAudits.map(a => [
                  a.outlets?.name || '—',
                  <span className="font-medium text-slate-900 dark:text-white">{a.title}</span>,
                  <Badge tone="neutral">{a.type}</Badge>,
                  <Badge tone={a.status === 'completed' ? 'success' : a.status === 'in-progress' ? 'warning' : a.status === 'failed' ? 'danger' : 'info'}>{a.status}</Badge>,
                  a.score != null ? `${a.score}/${a.max_score}` : `—/${a.max_score}`,
                  a.auditor || '—',
                  a.audit_date || '—',
                  <span className="text-xs text-slate-500 max-w-xs truncate block">{a.findings || '—'}</span>,
                  <RowActions onEdit={() => { setEditing({ resource: 'audits', row: a }); setShowModal(true); }} onDelete={() => handleDelete('audits', a.id)} />,
                ])}
                empty={fAudits.length === 0}
                emptyColSpan={9}
              />
            )}
          </SectionCard>
        )}
      </div>

      {showModal && (
        <ComplianceModal
          resource={editing?.resource || newRecordResource || 'temperature-logs'}
          editing={editing}
          outlets={outlets}
          loadingOutlets={loadingOutlets}
          saving={saving}
          onClose={() => { setShowModal(false); setEditing(null); setNewRecordResource(null); }}
          onSave={handleSave}
        />
      )}

      {showChecklistBulkModal && (
        <ChecklistBulkModal
          outlets={outlets}
          loadingOutlets={loadingOutlets}
          saving={saving}
          onClose={() => setShowChecklistBulkModal(false)}
          onCreate={handleBulkCreateChecklists}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────
function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="inline-flex gap-2">
      <button onClick={onEdit} className="p-1 text-slate-400 hover:text-[var(--color-accent-operations)]"><Pencil className="w-4 h-4" /></button>
      <button onClick={onDelete} className="p-1 text-slate-400 hover:text-[var(--color-danger)]"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

function DataTable({ headers, rows, empty, emptyColSpan }: {
  headers: string[];
  rows: any[][];
  empty: boolean;
  emptyColSpan: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              {row.map((cell, ci) => <td key={ci} className="px-4 py-3 text-slate-600 dark:text-slate-400">{cell}</td>)}
            </tr>
          ))}
          {empty && (
            <tr><td colSpan={emptyColSpan} className="px-4 py-8 text-center text-slate-400">No records found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HygieneCard({ icon: Icon, label, standards }: { icon: any; label: string; standards: ServiceStandard[] }) {
  const avg = standards.length > 0
    ? Math.round(standards.reduce((s, x) => s + (x.score / x.max_score) * 100, 0) / standards.length)
    : 0;
  const tone = avg >= 90 ? 'green' : avg >= 75 ? 'amber' : 'red';
  return (
    <div className={`bg-${tone}-50 dark:bg-${tone}-900/20 rounded-lg p-4 border border-${tone}-200 dark:border-${tone}-800`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 text-${tone}-600 dark:text-${tone}-400`} />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{avg}% compliance</p>
      <p className="text-xs text-slate-500 mt-1">{standards.length} standard(s) tracked</p>
    </div>
  );
}

function DailyOpsCard({ icon: Icon, tone, title, items }: {
  icon: any; tone: 'green' | 'amber'; title: string; items: CleaningChecklist[];
}) {
  const toneCls = tone === 'green'
    ? 'text-green-600 dark:text-green-400'
    : 'text-amber-600 dark:text-amber-400';
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
        <Icon className={`w-4 h-4 ${toneCls}`} />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">No tasks.</p>
      ) : (
        <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
          {items.map(c => (
            <li key={c.id} className="flex items-center gap-2">
              <CheckCircle2 className={`w-3 h-3 ${c.status === 'completed' ? 'text-green-500' : 'text-slate-300'}`} />
              <span>{c.area}: {c.task}</span>
              <span className="ml-auto text-slate-400">{c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────
function ComplianceModal({
  resource, editing, outlets, loadingOutlets, saving, onClose, onSave,
}: {
  resource: ResourceType;
  editing: { resource: ResourceType; row: any } | null;
  outlets: Outlet[];
  loadingOutlets: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (resource: ResourceType, payload: any, id?: string) => void;
}) {
  const row = editing?.row;
  const isEdit = !!row;
  const [outletId, setOutletId] = useState<string>(row?.outlet_id || '');

  // Temperature log
  const [location, setLocation] = useState(row?.location || '');
  const [type, setType] = useState<string>(row?.type || 'fridge');
  const [temperature, setTemperature] = useState<number>(row?.temperature ?? 4);
  const [targetMin, setTargetMin] = useState<number>(row?.target_min ?? 1);
  const [targetMax, setTargetMax] = useState<number>(row?.target_max ?? 4);
  const [tempStatus, setTempStatus] = useState<string>(row?.status || 'safe');
  const [loggedBy, setLoggedBy] = useState<string>(row?.logged_by || '');

  // HACCP
  const [checkpoint, setCheckpoint] = useState(row?.checkpoint || '');
  const [haccpCategory, setHaccpCategory] = useState<string>(row?.category || 'receiving');
  const [haccpStatus, setHaccpStatus] = useState<string>(row?.status || 'pass');
  const [haccpNotes, setHaccpNotes] = useState<string>(row?.notes || '');
  const [checkedBy, setCheckedBy] = useState<string>(row?.checked_by || '');

  // Allergen
  const [item, setItem] = useState(row?.item || '');
  const [allergen, setAllergen] = useState<string>(row?.allergen || '');
  const [controlMeasure, setControlMeasure] = useState<string>(row?.control_measure || '');
  const [lastVerified, setLastVerified] = useState<string>(row?.last_verified || '');
  const [allergenStatus, setAllergenStatus] = useState<string>(row?.status || 'verified');

  // Expiry
  const [batch, setBatch] = useState<string>(row?.batch || '');
  const [expiryDate, setExpiryDate] = useState<string>(row?.expiry_date || '');
  const [quantity, setQuantity] = useState<number>(row?.quantity ?? 0);
  const [unit, setUnit] = useState<string>(row?.unit || 'kg');
  const [expiryStatus, setExpiryStatus] = useState<string>(row?.status || 'safe');

  // Service standard
  const [standard, setStandard] = useState(row?.standard || '');
  const [stdCategory, setStdCategory] = useState<string>(row?.category || 'grooming');
  const [score, setScore] = useState<number>(row?.score ?? 0);
  const [maxScore, setMaxScore] = useState<number>(row?.max_score ?? 100);
  const [lastAudited, setLastAudited] = useState<string>(row?.last_audited || '');
  const [auditor, setAuditor] = useState<string>(row?.auditor || '');

  // Cleaning
  const [area, setArea] = useState(row?.area || '');
  const [task, setTask] = useState(row?.task || '');
  const [checklistType, setChecklistType] = useState<string>(row?.checklist_type || 'cleaning');
  const [frequency, setFrequency] = useState<string>(row?.frequency || 'daily');
  const [cleanStatus, setCleanStatus] = useState<string>(row?.status || 'pending');
  const [assignedTo, setAssignedTo] = useState<string>(row?.assigned_to || '');
  const [dueDate, setDueDate] = useState<string>(row?.due_date?.slice(0, 16) || '');

  // Audit
  const [auditTitle, setAuditTitle] = useState(row?.title || '');
  const [auditType, setAuditType] = useState<string>(row?.type || 'internal');
  const [auditStatus, setAuditStatus] = useState<string>(row?.status || 'scheduled');
  const [auditScore, setAuditScore] = useState<string>(row?.score != null ? String(row.score) : '');
  const [auditMaxScore, setAuditMaxScore] = useState<number>(row?.max_score ?? 100);
  const [auditAuditor, setAuditAuditor] = useState<string>(row?.auditor || '');
  const [auditDate, setAuditDate] = useState<string>(row?.audit_date || '');
  const [findings, setFindings] = useState<string>(row?.findings || '');

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  const submit = () => {
    let payload: any = { outlet_id: outletId || null };
    if (resource === 'temperature-logs') {
      if (!location) return alert('Location is required');
      payload = { outlet_id: outletId || null, location, type, temperature, target_min: targetMin, target_max: targetMax, status: tempStatus, logged_by: loggedBy || null };
    } else if (resource === 'haccp-checks') {
      if (!checkpoint) return alert('Checkpoint is required');
      payload = { outlet_id: outletId || null, checkpoint, category: haccpCategory, status: haccpStatus, notes: haccpNotes || null, checked_by: checkedBy || null };
    } else if (resource === 'allergen-controls') {
      if (!item || !allergen) return alert('Item and allergen are required');
      payload = { outlet_id: outletId || null, item, allergen, control_measure: controlMeasure || null, last_verified: lastVerified || null, status: allergenStatus };
    } else if (resource === 'expiry-items') {
      if (!item || !expiryDate) return alert('Item and expiry date are required');
      payload = { outlet_id: outletId || null, item, batch: batch || null, expiry_date: expiryDate, quantity, unit, status: expiryStatus };
    } else if (resource === 'service-standards') {
      if (!standard) return alert('Standard is required');
      payload = { outlet_id: outletId || null, standard, category: stdCategory, score, max_score: maxScore, last_audited: lastAudited || null, auditor: auditor || null };
    } else if (resource === 'cleaning-checklists') {
      if (!area || !task) return alert('Area and task are required');
      payload = { outlet_id: outletId || null, area, task, checklist_type: checklistType, frequency, status: cleanStatus, assigned_to: assignedTo || null, due_date: dueDate ? new Date(dueDate).toISOString() : null };
    } else if (resource === 'audits') {
      if (!auditTitle) return alert('Title is required');
      payload = { outlet_id: outletId || null, title: auditTitle, type: auditType, status: auditStatus, score: auditScore === '' ? null : Number(auditScore), max_score: auditMaxScore, auditor: auditAuditor || null, audit_date: auditDate || null, findings: findings || null };
    }
    onSave(resource, payload, isEdit ? row.id : undefined);
  };

  const titleMap: Record<ResourceType, string> = {
    'temperature-logs': 'Temperature Log',
    'haccp-checks': 'HACCP Check',
    'allergen-controls': 'Allergen Control',
    'expiry-items': 'Expiry Item',
    'service-standards': 'Service Standard',
    'cleaning-checklists': 'Checklist',
    'audits': 'Compliance Audit',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit' : 'New'} {titleMap[resource]}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {/* Outlet picker — all resources */}
          <div>
            <label className={labelCls}>Outlet</label>
            {loadingOutlets ? (
              <div className="text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading outlets…</div>
            ) : (
              <select className={inputCls} value={outletId} onChange={e => setOutletId(e.target.value)}>
                <option value="">— None —</option>
                {outlets.map(o => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
              </select>
            )}
          </div>

          {resource === 'temperature-logs' && (
            <>
              <div><label className={labelCls}>Location</label><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Walk-in Fridge 1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Type</label><select className={inputCls} value={type} onChange={e => setType(e.target.value)}>{TEMP_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={tempStatus} onChange={e => setTempStatus(e.target.value)}>{TEMP_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Temp °C</label><input type="number" step="0.1" className={inputCls} value={temperature} onChange={e => setTemperature(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Min °C</label><input type="number" step="0.1" className={inputCls} value={targetMin} onChange={e => setTargetMin(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Max °C</label><input type="number" step="0.1" className={inputCls} value={targetMax} onChange={e => setTargetMax(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Logged By</label><input className={inputCls} value={loggedBy} onChange={e => setLoggedBy(e.target.value)} /></div>
            </>
          )}

          {resource === 'haccp-checks' && (
            <>
              <div><label className={labelCls}>Checkpoint</label><input className={inputCls} value={checkpoint} onChange={e => setCheckpoint(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Category</label><select className={inputCls} value={haccpCategory} onChange={e => setHaccpCategory(e.target.value)}>{HACCP_CATEGORIES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={haccpStatus} onChange={e => setHaccpStatus(e.target.value)}>{HACCP_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div><label className={labelCls}>Notes</label><textarea className={inputCls} value={haccpNotes} onChange={e => setHaccpNotes(e.target.value)} rows={2} /></div>
              <div><label className={labelCls}>Checked By</label><input className={inputCls} value={checkedBy} onChange={e => setCheckedBy(e.target.value)} /></div>
            </>
          )}

          {resource === 'allergen-controls' && (
            <>
              <div><label className={labelCls}>Item</label><input className={inputCls} value={item} onChange={e => setItem(e.target.value)} /></div>
              <div><label className={labelCls}>Allergen</label><input className={inputCls} value={allergen} onChange={e => setAllergen(e.target.value)} placeholder="e.g. Fish, Gluten" /></div>
              <div><label className={labelCls}>Control Measure</label><textarea className={inputCls} value={controlMeasure} onChange={e => setControlMeasure(e.target.value)} rows={2} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Last Verified</label><input type="date" className={inputCls} value={lastVerified} onChange={e => setLastVerified(e.target.value)} /></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={allergenStatus} onChange={e => setAllergenStatus(e.target.value)}>{ALLERGEN_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
            </>
          )}

          {resource === 'expiry-items' && (
            <>
              <div><label className={labelCls}>Item</label><input className={inputCls} value={item} onChange={e => setItem(e.target.value)} /></div>
              <div><label className={labelCls}>Batch</label><input className={inputCls} value={batch} onChange={e => setBatch(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Expiry Date</label><input type="date" className={inputCls} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={expiryStatus} onChange={e => setExpiryStatus(e.target.value)}>{EXPIRY_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Quantity</label><input type="number" step="0.01" className={inputCls} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Unit</label><input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} /></div>
              </div>
            </>
          )}

          {resource === 'service-standards' && (
            <>
              <div><label className={labelCls}>Standard</label><input className={inputCls} value={standard} onChange={e => setStandard(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Category</label><select className={inputCls} value={stdCategory} onChange={e => setStdCategory(e.target.value)}>{STD_CATEGORIES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className={labelCls}>Last Audited</label><input type="date" className={inputCls} value={lastAudited} onChange={e => setLastAudited(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Score</label><input type="number" className={inputCls} value={score} onChange={e => setScore(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Max Score</label><input type="number" className={inputCls} value={maxScore} onChange={e => setMaxScore(Number(e.target.value))} /></div>
              </div>
              <div><label className={labelCls}>Auditor</label><input className={inputCls} value={auditor} onChange={e => setAuditor(e.target.value)} /></div>
            </>
          )}

          {resource === 'cleaning-checklists' && (
            <>
              <div><label className={labelCls}>Checklist Type</label>
                <select className={inputCls} value={checklistType} onChange={e => setChecklistType(e.target.value)}>
                  {CHECKLIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Area</label><input className={inputCls} value={area} onChange={e => setArea(e.target.value)} /></div>
              <div><label className={labelCls}>Task</label><input className={inputCls} value={task} onChange={e => setTask(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Frequency</label><select className={inputCls} value={frequency} onChange={e => setFrequency(e.target.value)}>{CLEAN_FREQ.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={cleanStatus} onChange={e => setCleanStatus(e.target.value)}>{CLEAN_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div><label className={labelCls}>Assigned To</label><input className={inputCls} value={assignedTo} onChange={e => setAssignedTo(e.target.value)} /></div>
              <div><label className={labelCls}>Due Date</label><input type="datetime-local" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            </>
          )}

          {resource === 'audits' && (
            <>
              <div><label className={labelCls}>Title</label><input className={inputCls} value={auditTitle} onChange={e => setAuditTitle(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Type</label><select className={inputCls} value={auditType} onChange={e => setAuditType(e.target.value)}>{AUDIT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                <div><label className={labelCls}>Status</label><select className={inputCls} value={auditStatus} onChange={e => setAuditStatus(e.target.value)}>{AUDIT_STATUS.map(t => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Score</label><input type="number" className={inputCls} value={auditScore} onChange={e => setAuditScore(e.target.value)} placeholder="—" /></div>
                <div><label className={labelCls}>Max</label><input type="number" className={inputCls} value={auditMaxScore} onChange={e => setAuditMaxScore(Number(e.target.value))} /></div>
                <div><label className={labelCls}>Audit Date</label><input type="date" className={inputCls} value={auditDate} onChange={e => setAuditDate(e.target.value)} /></div>
              </div>
              <div><label className={labelCls}>Auditor</label><input className={inputCls} value={auditAuditor} onChange={e => setAuditAuditor(e.target.value)} /></div>
              <div><label className={labelCls}>Findings</label><textarea className={inputCls} value={findings} onChange={e => setFindings(e.target.value)} rows={3} /></div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={submit} disabled={saving} className={button.primary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : null}
              {isEdit ? 'Save' : 'Create'}
            </button>
            <button onClick={onClose} className={button.secondary} disabled={saving}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Checklist bulk-create modal ─────────────────────────────────────
// Multi-task creation with template loading and multi-outlet application.
// Builds an array of fb_cleaning_checklists rows and POSTs to /bulk.
interface BulkTaskRow { area: string; task: string; assigned_to: string; }

function ChecklistBulkModal({
  outlets, loadingOutlets, saving, onClose, onCreate,
}: {
  outlets: Outlet[];
  loadingOutlets: boolean;
  saving: boolean;
  onClose: () => void;
  onCreate: (items: any[]) => void;
}) {
  // Shared fields
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [checklistType, setChecklistType] = useState<string>('cleaning');
  const [frequency, setFrequency] = useState<string>('daily');
  const [dueDate, setDueDate] = useState<string>('');
  const [status, setStatus] = useState<string>('pending');
  // Per-task rows
  const [rows, setRows] = useState<BulkTaskRow[]>([
    { area: '', task: '', assigned_to: '' },
  ]);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-gray-900 dark:text-white';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  const toggleOutlet = (id: string) => {
    setOutletIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const updateRow = (idx: number, field: keyof BulkTaskRow, value: string) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };
  const addRow = () => setRows(prev => [...prev, { area: '', task: '', assigned_to: '' }]);
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));

  const applyTemplate = (tpl: ChecklistTemplate) => {
    setChecklistType(tpl.checklist_type);
    setFrequency(tpl.frequency);
    setRows(tpl.tasks.map(t => ({ area: t.area, task: t.task, assigned_to: t.assigned_to || '' })));
    setTemplateMenuOpen(false);
  };

  const submit = () => {
    if (outletIds.length === 0) return alert('Select at least one outlet');
    const validRows = rows.filter(r => r.area.trim() && r.task.trim());
    if (validRows.length === 0) return alert('Add at least one task with area and task');
    const dueIso = dueDate ? new Date(dueDate).toISOString() : null;
    const items: any[] = [];
    for (const oid of outletIds) {
      for (const r of validRows) {
        items.push({
          outlet_id: oid,
          area: r.area.trim(),
          task: r.task.trim(),
          checklist_type: checklistType,
          frequency,
          status,
          assigned_to: r.assigned_to.trim() || null,
          due_date: dueIso,
        });
      }
    }
    onCreate(items);
  };

  const totalItems = outletIds.length * rows.filter(r => r.area.trim() && r.task.trim()).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-2xl border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">New Checklist</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Template loader */}
          <div className="relative">
            <label className={labelCls}>Load Template (optional)</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setTemplateMenuOpen(v => !v)}
                className={button.secondary}
              >
                <ListChecks className="w-4 h-4" /> Choose template
              </button>
              {templateMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTemplateMenuOpen(false)} />
                  <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                    {CHECKLIST_TEMPLATES.map(tpl => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <div className="font-medium">{tpl.label}</div>
                        <div className="text-xs text-slate-400">{tpl.tasks.length} tasks · {tpl.checklist_type} · {tpl.frequency}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span className="ml-3 text-xs text-slate-400">Fills tasks + type + frequency; edit before saving.</span>
            </div>
          </div>

          {/* Outlets (multi-select) */}
          <div>
            <label className={labelCls}>Outlets <span className="text-xs text-slate-400">(select one or more — checklist applies to each)</span></label>
            {loadingOutlets ? (
              <div className="text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading outlets…</div>
            ) : outlets.length === 0 ? (
              <div className="text-sm text-slate-400">No active outlets available.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {outlets.map(o => {
                  const active = outletIds.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOutlet(o.id)}
                      className={`px-3 py-1.5 rounded-xl text-sm border smooth-transition ${
                        active
                          ? 'bg-[var(--color-accent-operations)] text-white border-[var(--color-accent-operations)]'
                          : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:border-[var(--color-accent-operations)]'
                      }`}
                    >
                      {o.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Shared type / frequency / status / due date */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={labelCls}>Type</label>
              <select className={inputCls} value={checklistType} onChange={e => setChecklistType(e.target.value)}>
                {CHECKLIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Frequency</label>
              <select className={inputCls} value={frequency} onChange={e => setFrequency(e.target.value)}>
                {CLEAN_FREQ.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Status</label>
              <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
                {CLEAN_STATUS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Due Date</label>
              <input type="datetime-local" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Task rows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Tasks</label>
              <button type="button" onClick={addRow} className="text-sm text-[var(--color-accent-operations)] hover:underline inline-flex items-center gap-1">
                <Plus className="w-4 h-4" /> Add task
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className={inputCls + ' col-span-4'}
                    placeholder="Area"
                    value={r.area}
                    onChange={e => updateRow(idx, 'area', e.target.value)}
                  />
                  <input
                    className={inputCls + ' col-span-5'}
                    placeholder="Task"
                    value={r.task}
                    onChange={e => updateRow(idx, 'task', e.target.value)}
                  />
                  <input
                    className={inputCls + ' col-span-2'}
                    placeholder="Assignee"
                    value={r.assigned_to}
                    onChange={e => updateRow(idx, 'assigned_to', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => rows.length > 1 ? removeRow(idx) : null}
                    disabled={rows.length === 1}
                    className="col-span-1 p-2 text-slate-400 hover:text-[var(--color-danger)] disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Remove task"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
            <span className="text-xs text-slate-500">
              {totalItems > 0
                ? `${totalItems} checklist row${totalItems === 1 ? '' : 's'} will be created`
                : 'Fill at least one task and select an outlet'}
            </span>
            <div className="flex gap-3">
              <button onClick={onClose} className={button.secondary} disabled={saving}>Cancel</button>
              <button onClick={submit} disabled={saving || totalItems === 0} className={button.primary}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : null}
                Create {totalItems > 0 ? `(${totalItems})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────
function typeTone(t: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (t === 'opening') return 'success';
  if (t === 'closing') return 'warning';
  if (t === 'safety') return 'danger';
  if (t === 'equipment') return 'info';
  return 'neutral';
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
