/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Housekeeping Configuration module — docs/Housekeeping Portal new.md §24.
 * Setup sections:
 *   - Property Setup (Buildings, Floors, Zones, Public Areas)
 *   - Room Status Setup (Status Codes, Cleaning Priorities, Inspection Rules)
 *   - Task Setup (Task Types, Service Levels, Cleaning Standards, Estimated Times)
 *   - Staff Setup (Teams, Shifts, Skills, Certifications)
 *   - Docs & SOPs (Standard Operating Procedures, Task Checklists)
 * Property Setup and section configs are persisted to hk_property_setup /
 * hk_config (migration 320).
 */

import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import {
  Settings, ClipboardList, Gauge, ClipboardCheck,
  Clock, Users, CalendarClock, Award, BadgeCheck, Plus, Edit, Trash2, CheckCircle2,
  FileText, ListChecks, Eye, RotateCcw, ChevronDown, ChevronRight, Upload,
  FlaskConical, Loader2, AlertTriangle, Building2, MapPin, Layers as LayersIcon, Save,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout } from '../FrontOffice/brandTheme';
import { useHKDocs, getChecklistForType, ALL_TASK_TYPES, type SOP, type TaskTypeKey } from '../../config/hkDocs';
import { useERP } from '../../context/ERPContext';

type Section = 'property' | 'room-status' | 'task' | 'staff' | 'docs' | 'consumption';

interface StatusCode { code: string; label: string; color: string; }
interface CleaningPriority { id: string; label: string; weight: number; }
interface InspectionRule { id: string; name: string; threshold: number; }
interface TaskType { id: string; name: string; category: 'Automatic' | 'Manual'; estMinutes: number; }
interface ServiceLevel { id: string; name: string; sla: string; }
interface CleaningStandard { id: string; name: string; steps: number; }
interface Team { id: string; name: string; members: number; }
interface Shift { id: string; name: string; start: string; end: string; }
interface Skill { id: string; name: string; }
interface Certification { id: string; name: string; validMonths: number; }

interface PropertyEntity {
  id: string;
  entity_type: 'building' | 'floor' | 'zone' | 'public_area';
  name: string;
  parent_id: string | null;
  sort_order: number;
}

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'property', label: 'Property Setup', icon: Building2 },
  { id: 'room-status', label: 'Room Status Setup', icon: ClipboardList },
  { id: 'task', label: 'Task Setup', icon: ClipboardCheck },
  { id: 'staff', label: 'Staff Setup', icon: Users },
  { id: 'docs', label: 'Docs & SOPs', icon: FileText },
  { id: 'consumption', label: 'Consumption Profiles', icon: FlaskConical },
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printSOP(sop: SOP) {
  if (typeof window === 'undefined') return;
  const stepsHtml = sop.steps.map((s, i) => `<li><span class="num">${i + 1}</span><span>${escapeHtml(s)}</span></li>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(sop.title)}</title><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { border-bottom: 2px solid #1e293b; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-size: 16px; font-weight: 800; }
  .id { font-size: 12px; color: #64748b; float: right; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .desc { font-size: 13px; color: #475569; margin-bottom: 16px; }
  .cat { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #e0e7ff; color: #3730a3; margin-bottom: 12px; }
  ol { list-style: none; padding: 0; margin: 0; }
  ol li { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  .num { width: 24px; height: 24px; border-radius: 8px; background: #1e293b; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .sign { margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 8px; font-size: 11px; color: #64748b; }
  .footer { margin-top: 20px; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print { body { margin: 12mm; } ol { page-break-inside: avoid; } }
  </style></head><body>
  <header><span class="brand">SELEDA ERP — Housekeeping SOP</span><span class="id">${escapeHtml(sop.id)}</span></header>
  <span class="cat">${escapeHtml(sop.category)}</span>
  <h1>${escapeHtml(sop.title)}</h1>
  <p class="desc">${escapeHtml(sop.description)}</p>
  <ol>${stepsHtml}</ol>
  <div class="sign">Supervisor Signature / Date</div>
  <div class="footer">Generated ${new Date().toLocaleString()} · SELEDA ERP Housekeeping SOP</div>
  <script>window.onload=function(){window.focus();window.print();window.onafterprint=function(){window.close();};};</script>
  </body></html>`;
  const w = window.open('', '_blank', 'width=820,height=720');
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

export default function ConfigurationModule() {
  const [section, setSection] = useState<Section>('room-status');
  const { currentPropertyId, addNotification } = useERP();

  // ── Property Setup state ─────────────────────────────────────────────
  const [propEntities, setPropEntities] = useState<PropertyEntity[]>([]);
  const [propLoading, setPropLoading] = useState(false);
  const [propSaving, setPropSaving] = useState(false);
  const [propDeleting, setPropDeleting] = useState<string | null>(null);
  const [propForm, setPropForm] = useState({ entityType: 'public_area' as PropertyEntity['entity_type'], name: '' });

  // ── Config persistence (room_status, task, staff sections) ───────────
  const [configSaving, setConfigSaving] = useState(false);

  // ── Generic config-row edit modal ────────────────────────────────────
  // Supports editing any ConfigRow entity (task type, service level, etc.)
  interface EditField { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[]; }
  interface EditState {
    open: boolean;
    title: string;
    fields: EditField[];
    values: Record<string, any>;
    onSave: (values: Record<string, any>) => void;
  }
  const [editState, setEditState] = useState<EditState>({
    open: false, title: '', fields: [], values: {}, onSave: () => {},
  });

  const openEditModal = (title: string, fields: EditField[], currentValues: Record<string, any>, onSave: (values: Record<string, any>) => void) => {
    setEditState({ open: true, title, fields, values: { ...currentValues }, onSave });
  };

  const saveEditModal = () => {
    editState.onSave(editState.values);
    setEditState(s => ({ ...s, open: false }));
  };

  // Room Status Setup state
  const [statusCodes, setStatusCodes] = useState<StatusCode[]>([
    { code: 'VC', label: 'Vacant Clean', color: 'bg-emerald-500' },
    { code: 'VD', label: 'Vacant Dirty', color: 'bg-amber-500' },
    { code: 'OC', label: 'Occupied Clean', color: 'bg-indigo-500' },
    { code: 'OD', label: 'Occupied Dirty', color: 'bg-rose-500' },
    { code: 'IN', label: 'Inspected', color: 'bg-purple-500' },
    { code: 'OOO', label: 'Out of Order', color: 'bg-zinc-700' },
  ]);
  const [priorities, setPriorities] = useState<CleaningPriority[]>([
    { id: 'P-1', label: 'Critical', weight: 100 },
    { id: 'P-2', label: 'High', weight: 75 },
    { id: 'P-3', label: 'Medium', weight: 50 },
    { id: 'P-4', label: 'Low', weight: 25 },
  ]);
  const [inspectionRules, setInspectionRules] = useState<InspectionRule[]>([
    { id: 'IR-1', name: 'Pass threshold', threshold: 90 },
    { id: 'IR-2', name: 'Rework threshold', threshold: 70 },
  ]);

  // Task Setup state — seeded with all 13 doc-defined task types (§6).
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([
    { id: 'TT-1', name: 'Checkout Cleaning', category: 'Automatic', estMinutes: 30 },
    { id: 'TT-2', name: 'Stayover Service', category: 'Automatic', estMinutes: 20 },
    { id: 'TT-3', name: 'VIP Preparation', category: 'Automatic', estMinutes: 45 },
    { id: 'TT-4', name: 'Turndown Service', category: 'Automatic', estMinutes: 15 },
    { id: 'TT-5', name: 'Early Arrival Preparation', category: 'Automatic', estMinutes: 25 },
    { id: 'TT-6', name: 'Deep Cleaning', category: 'Automatic', estMinutes: 90 },
    { id: 'TT-7', name: 'Preventive Cleaning', category: 'Automatic', estMinutes: 60 },
    { id: 'TT-8', name: 'Public Area Cleaning', category: 'Automatic', estMinutes: 30 },
    { id: 'TT-9', name: 'Special Cleaning', category: 'Manual', estMinutes: 25 },
    { id: 'TT-10', name: 'Emergency Cleaning', category: 'Manual', estMinutes: 15 },
    { id: 'TT-11', name: 'Biohazard Cleaning', category: 'Manual', estMinutes: 60 },
    { id: 'TT-12', name: 'Room Refresh', category: 'Manual', estMinutes: 10 },
    { id: 'TT-13', name: 'Guest Complaint Follow-up', category: 'Manual', estMinutes: 20 },
  ]);
  // Service Levels — all 5 doc-defined levels (§7).
  const [serviceLevels, setServiceLevels] = useState<ServiceLevel[]>([
    { id: 'SL-1', name: 'Full Service', sla: '30 min' },
    { id: 'SL-2', name: 'Stayover Service', sla: '20 min' },
    { id: 'SL-3', name: 'Express Service', sla: '15 min' },
    { id: 'SL-4', name: 'Eco Service', sla: '40 min' },
    { id: 'SL-5', name: 'Turndown Service', sla: '15 min' },
  ]);
  const [standards, setStandards] = useState<CleaningStandard[]>([
    { id: 'CS-1', name: 'Standard Room Clean', steps: 8 },
    { id: 'CS-2', name: 'Turndown Service', steps: 6 },
  ]);

  // Staff Setup state
  const [teams, setTeams] = useState<Team[]>([
    { id: 'T-1', name: 'Floor Team A', members: 6 },
    { id: 'T-2', name: 'Floor Team B', members: 5 },
  ]);
  const [shifts, setShifts] = useState<Shift[]>([
    { id: 'S-1', name: 'Morning', start: '06:00', end: '14:00' },
    { id: 'S-2', name: 'Evening', start: '14:00', end: '22:00' },
    { id: 'S-3', name: 'Night', start: '22:00', end: '06:00' },
  ]);
  const [skills, setSkills] = useState<Skill[]>([
    { id: 'SK-1', name: 'Room Cleaning' },
    { id: 'SK-2', name: 'Inspection' },
    { id: 'SK-3', name: 'Linen Handling' },
  ]);
  const [certifications, setCertifications] = useState<Certification[]>([
    { id: 'C-1', name: 'Chemical Safety', validMonths: 12 },
    { id: 'C-2', name: 'Biohazard Handling', validMonths: 24 },
  ]);

  // Docs & SOPs state
  const { docs, update: updateDocs, reset: resetDocs } = useHKDocs();
  const [docsTab, setDocsTab] = useState<'sops' | 'checklists'>('sops');
  const [expandedSop, setExpandedSop] = useState<string | null>(null);
  const [viewSop, setViewSop] = useState<SOP | null>(null);
  const [editingChecklist, setEditingChecklist] = useState<TaskTypeKey | null>(null);
  const [checklistDraft, setChecklistDraft] = useState<string[]>([]);

  // SOP create/edit modal state
  const [sopModalOpen, setSopModalOpen] = useState(false);
  const [sopEditing, setSopEditing] = useState<SOP | null>(null);
  const [sopDraft, setSopDraft] = useState<{ title: string; category: SOP['category']; description: string; steps: string[] }>({
    title: '', category: 'Cleaning', description: '', steps: [''],
  });
  const sopFileRef = useRef<HTMLInputElement>(null);
  const checklistFileRef = useRef<HTMLInputElement>(null);

  // ── Consumption Profiles state ───────────────────────────────────────
  interface ConsumptionProfile {
    id: string;
    propertyId: string | null;
    taskType: string;
    subtype: string | null;
    itemName: string;
    itemCategory: string;
    quantity: number;
  }
  const [profiles, setProfiles] = useState<ConsumptionProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState<ConsumptionProfile | null>(null);
  // Multi-line draft: shared taskType + subtype at top, then a list of
  // line items so the user can add several consumed items in one save.
  interface ProfileLine {
    itemName: string;
    itemCategory: string;
    quantity: number;
  }
  const [profileDraft, setProfileDraft] = useState<{
    taskType: string;
    subtype: string;
    lines: ProfileLine[];
  }>({ taskType: 'Checkout Cleaning', subtype: '', lines: [{ itemName: '', itemCategory: 'cleaning_supplies', quantity: 1 }] });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileDeleting, setProfileDeleting] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const TASK_TYPE_OPTIONS = [
    'Checkout Cleaning', 'Stayover Service', 'VIP Preparation', 'Turndown Service',
    'Early Arrival Preparation', 'Deep Cleaning', 'Preventive Cleaning', 'Public Area Cleaning',
    'Special Cleaning', 'Emergency Cleaning', 'Biohazard Cleaning', 'Room Refresh',
    'Guest Complaint Follow-up',
  ];
  const CATEGORY_OPTIONS: { value: string; label: string }[] = [
    { value: 'cleaning_supplies', label: 'Cleaning Supplies' },
    { value: 'linens', label: 'Linens' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'amenities', label: 'Amenities' },
    { value: 'other', label: 'Other' },
  ];

  const authHeaders = (json = false): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  };

  const fetchProfiles = useCallback(async () => {
    if (!currentPropertyId) return;
    setProfilesLoading(true);
    try {
      const res = await fetch(`/api/hk-portal/task-consumption-profiles/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setProfiles(json.profiles || []);
      }
    } catch { /* non-fatal */ } finally {
      setProfilesLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { if (section === 'consumption') fetchProfiles(); }, [section, fetchProfiles]);

  // ── Property Setup fetch / save ──────────────────────────────────────
  const fetchPropEntities = useCallback(async () => {
    if (!currentPropertyId) return;
    setPropLoading(true);
    try {
      const res = await fetch(`/api/hk-portal/property-setup/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setPropEntities(json.entities || []);
      }
    } catch { /* non-fatal */ } finally {
      setPropLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { if (section === 'property') fetchPropEntities(); }, [section, fetchPropEntities]);

  const addPropEntity = async () => {
    if (!currentPropertyId || !propForm.name.trim()) return;
    setPropSaving(true);
    try {
      const res = await fetch('/api/hk-portal/property-setup', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ propertyId: currentPropertyId, entityType: propForm.entityType, name: propForm.name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`${propForm.entityType.replace('_', ' ')} added`, 'success', 'Housekeeping');
      setPropForm({ entityType: 'public_area', name: '' });
      fetchPropEntities();
    } catch (err: any) {
      addNotification(err.message || 'Failed to add entity', 'warning', 'Housekeeping');
    } finally {
      setPropSaving(false);
    }
  };

  const deletePropEntity = async (id: string) => {
    setPropDeleting(id);
    try {
      const res = await fetch(`/api/hk-portal/property-setup/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Entity deleted', 'info', 'Housekeeping');
      fetchPropEntities();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete', 'warning', 'Housekeeping');
    } finally {
      setPropDeleting(null);
    }
  };

  // ── Config section persistence (room_status / task / staff) ──────────
  const saveConfigSection = async (sectionName: 'room_status' | 'task' | 'staff', data: any) => {
    if (!currentPropertyId) return;
    setConfigSaving(true);
    try {
      const res = await fetch(`/api/hk-portal/config/${currentPropertyId}/${sectionName}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`${sectionName.replace('_', ' ')} config saved`, 'success', 'Housekeeping');
    } catch (err: any) {
      addNotification(err.message || 'Failed to save config', 'warning', 'Housekeeping');
    } finally {
      setConfigSaving(false);
    }
  };

  // Load config sections on mount (non-fatal if they fail — seed defaults remain).
  useEffect(() => {
    if (!currentPropertyId) return;
    (async () => {
      for (const sec of ['room_status', 'task', 'staff'] as const) {
        try {
          const res = await fetch(`/api/hk-portal/config/${currentPropertyId}/${sec}`, { headers: authHeaders() });
          if (!res.ok) continue;
          const data = await res.json();
          if (!data || Object.keys(data).length === 0) continue;
          // Hydrate state from saved config.
          if (sec === 'room_status') {
            if (data.statusCodes) setStatusCodes(data.statusCodes);
            if (data.priorities) setPriorities(data.priorities);
            if (data.inspectionRules) setInspectionRules(data.inspectionRules);
          } else if (sec === 'task') {
            if (data.taskTypes) setTaskTypes(data.taskTypes);
            if (data.serviceLevels) setServiceLevels(data.serviceLevels);
            if (data.standards) setStandards(data.standards);
          } else if (sec === 'staff') {
            if (data.teams) setTeams(data.teams);
            if (data.shifts) setShifts(data.shifts);
            if (data.skills) setSkills(data.skills);
            if (data.certifications) setCertifications(data.certifications);
          }
        } catch { /* non-fatal — keep seed defaults */ }
      }
    })();
  }, [currentPropertyId]);

  // Group profiles by taskType, preserving the TASK_TYPE_OPTIONS order.
  const groupedProfiles = useMemo(() => {
    const groups: { taskType: string; profiles: ConsumptionProfile[] }[] = [];
    const seen = new Set<string>();
    // First, add groups in canonical task type order.
    for (const tt of TASK_TYPE_OPTIONS) {
      const items = profiles.filter(p => p.taskType === tt);
      if (items.length > 0) { groups.push({ taskType: tt, profiles: items }); seen.add(tt); }
    }
    // Then, add any custom task types not in the canonical list.
    for (const p of profiles) {
      if (!seen.has(p.taskType)) {
        seen.add(p.taskType);
        groups.push({ taskType: p.taskType, profiles: profiles.filter(x => x.taskType === p.taskType) });
      }
    }
    return groups;
  }, [profiles]);

  const toggleGroup = (taskType: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(taskType) ? n.delete(taskType) : n.add(taskType); return n; });

  const openCreateProfile = () => {
    setProfileEditing(null);
    setProfileDraft({
      taskType: 'Checkout Cleaning',
      subtype: '',
      lines: [{ itemName: '', itemCategory: 'cleaning_supplies', quantity: 1 }],
    });
    setProfileModalOpen(true);
  };

  const openEditProfile = (p: ConsumptionProfile) => {
    setProfileEditing(p);
    setProfileDraft({
      taskType: p.taskType,
      subtype: p.subtype || '',
      lines: [{ itemName: p.itemName, itemCategory: p.itemCategory, quantity: p.quantity }],
    });
    setProfileModalOpen(true);
  };

  const addLine = () => setProfileDraft(d => ({ ...d, lines: [...d.lines, { itemName: '', itemCategory: 'cleaning_supplies', quantity: 1 }] }));
  const removeLine = (idx: number) => setProfileDraft(d => ({ ...d, lines: d.lines.length <= 1 ? d.lines : d.lines.filter((_, i) => i !== idx) }));
  const updateLine = (idx: number, patch: Partial<ProfileLine>) => setProfileDraft(d => ({ ...d, lines: d.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  const saveProfile = async () => {
    if (!currentPropertyId) return;
    // Validate all lines.
    const validLines = profileDraft.lines.filter(l => l.itemName.trim() && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('Add at least one item with a name and quantity > 0', 'warning', 'Housekeeping');
      return;
    }
    setProfileSaving(true);
    try {
      if (profileEditing) {
        // Single-item edit — update the one profile.
        const line = validLines[0];
        const body = {
          taskType: profileDraft.taskType,
          subtype: profileDraft.subtype.trim() || null,
          itemName: line.itemName.trim(),
          itemCategory: line.itemCategory,
          quantity: line.quantity,
        };
        const res = await fetch(`/api/hk-portal/task-consumption-profiles/${profileEditing.id}`, {
          method: 'PUT', headers: authHeaders(true), body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed (${res.status})`);
        }
        addNotification('Consumption profile updated', 'success', 'Housekeeping');
      } else {
        // Batch create — send all lines in one request.
        const body = {
          propertyId: currentPropertyId,
          taskType: profileDraft.taskType,
          subtype: profileDraft.subtype.trim() || null,
          items: validLines.map(l => ({
            itemName: l.itemName.trim(),
            itemCategory: l.itemCategory,
            quantity: l.quantity,
          })),
        };
        const res = await fetch('/api/hk-portal/task-consumption-profiles/batch', {
          method: 'POST', headers: authHeaders(true), body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed (${res.status})`);
        }
        const result = await res.json();
        addNotification(`${result.created || validLines.length} consumption profile${(result.created || validLines.length) !== 1 ? 's' : ''} created`, 'success', 'Housekeeping');
      }
      setProfileModalOpen(false);
      fetchProfiles();
    } catch (err: any) {
      addNotification(err.message || 'Failed to save profile', 'warning', 'Housekeeping');
    } finally {
      setProfileSaving(false);
    }
  };

  const deleteProfile = async (id: string) => {
    setProfileDeleting(id);
    try {
      const res = await fetch(`/api/hk-portal/task-consumption-profiles/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Consumption profile deleted', 'info', 'Housekeeping');
      fetchProfiles();
    } catch (err: any) {
      addNotification(err.message || 'Failed to delete profile', 'warning', 'Housekeeping');
    } finally {
      setProfileDeleting(null);
    }
  };

  // New checklist modal state
  const [newChecklistOpen, setNewChecklistOpen] = useState(false);
  const [newChecklistType, setNewChecklistType] = useState('');
  const [newChecklistItems, setNewChecklistItems] = useState<string[]>(['']);

  const remove = <T,>(list: T[], setList: Dispatch<SetStateAction<T[]>>, idx: number) =>
    setList(list.filter((_, i) => i !== idx));

  // ── SOP create / edit / upload helpers ───────────────────────────────
  const openCreateSop = () => {
    setSopEditing(null);
    setSopDraft({ title: '', category: 'Cleaning', description: '', steps: [''] });
    setSopModalOpen(true);
  };

  const openEditSop = (sop: SOP) => {
    setSopEditing(sop);
    setSopDraft({ title: sop.title, category: sop.category, description: sop.description, steps: [...sop.steps] });
    setSopModalOpen(true);
  };

  const saveSop = () => {
    const title = sopDraft.title.trim();
    const steps = sopDraft.steps.map(s => s.trim()).filter(Boolean);
    if (!title || steps.length === 0) return;
    if (sopEditing) {
      updateDocs({
        ...docs,
        sops: docs.sops.map(s => s.id === sopEditing.id ? { ...s, ...sopDraft, steps, updatedAt: new Date().toISOString().slice(0, 10) } : s),
      });
    } else {
      const newSop: SOP = {
        id: `SOP-${String(Date.now()).slice(-6)}`,
        title, category: sopDraft.category, description: sopDraft.description.trim(),
        steps, updatedAt: new Date().toISOString().slice(0, 10),
      };
      updateDocs({ ...docs, sops: [...docs.sops, newSop] });
    }
    setSopModalOpen(false);
  };

  const handleSopUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (parsed.title && Array.isArray(parsed.steps)) {
            setSopEditing(null);
            setSopDraft({
              title: String(parsed.title),
              category: (parsed.category as SOP['category']) || 'General',
              description: String(parsed.description || ''),
              steps: parsed.steps.map((s: any) => String(s)),
            });
            setSopModalOpen(true);
          }
        } else {
          // Plain text: first line = title, rest = steps (one per line)
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            setSopEditing(null);
            setSopDraft({ title: lines[0], category: 'General', description: '', steps: lines.slice(1) });
            setSopModalOpen(true);
          }
        }
      } catch { /* ignore parse errors */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleChecklistUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        let taskType: string | null = null;
        let items: string[] = [];
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          taskType = parsed.taskType || parsed.task_type || null;
          items = Array.isArray(parsed.items) ? parsed.items.map((s: any) => String(s)) : [];
        } else {
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            taskType = lines[0];
            items = lines.slice(1);
          }
        }
        if (items.length === 0) return;
        const existing = docs.checklists.find(c => c.taskType === taskType);
        if (existing) {
          updateDocs({
            ...docs,
            checklists: docs.checklists.map(c => c.taskType === taskType ? { ...c, items } : c),
          });
        } else if (taskType) {
          updateDocs({
            ...docs,
            checklists: [...docs.checklists, { taskType: taskType as TaskTypeKey, items }],
          });
        }
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const openNewChecklist = () => {
    setNewChecklistType('');
    setNewChecklistItems(['']);
    setNewChecklistOpen(true);
  };

  const saveNewChecklist = () => {
    const taskType = newChecklistType.trim();
    const items = newChecklistItems.map(s => s.trim()).filter(Boolean);
    if (!taskType || items.length === 0) return;
    const existing = docs.checklists.find(c => c.taskType === taskType);
    if (existing) {
      updateDocs({
        ...docs,
        checklists: docs.checklists.map(c => c.taskType === taskType ? { ...c, items } : c),
      });
    } else {
      updateDocs({
        ...docs,
        checklists: [...docs.checklists, { taskType: taskType as TaskTypeKey, items }],
      });
    }
    setNewChecklistOpen(false);
  };

  const ConfigRow = ({ title, sub, onRemove, onEdit }: { title: string; sub?: string; onRemove: () => void; onEdit?: () => void }) => (
    <div className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-slate-700">
      <div>
        <p className="text-sm font-bold text-gray-900 dark:text-white">{title}</p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
      <div className="flex gap-1.5">
        {onEdit && <button onClick={onEdit} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-[var(--color-accent-operations)] rounded-lg transition" title="Edit"><Edit className="w-3 h-3" /></button>}
        <button onClick={onRemove} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-rose-600 rounded-lg transition" title="Delete"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  );

  const AddButton = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className={button.ghost + ' text-xs'}><Plus className="w-3.5 h-3.5" /> Add</button>
  );

  const renderSectionCard = (title: string, icon: LucideIcon, children: ReactNode, onAdd?: () => void) => (
    <SectionCard title={title} icon={icon} tone="accent" pad="md" actions={onAdd ? <AddButton onClick={onAdd} /> : undefined}>
      <div className="space-y-2">{children}</div>
    </SectionCard>
  );

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Configuration"
        subtitle="Property, room status, task & staff setup"
        icon={Settings}
      />

      {/* Section tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 overflow-x-auto">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap ${section === s.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {s.label}
            </button>
          );
        })}
      </div>

      {section === 'property' && (
        <div className="space-y-4">
          <SectionCard title="Property Setup" subtitle="Buildings, floors, zones & public areas (docs §24)" icon={Building2} tone="accent" pad="md"
            actions={
              <div className="flex items-center gap-2">
                <select value={propForm.entityType} onChange={e => setPropForm(f => ({ ...f, entityType: e.target.value as PropertyEntity['entity_type'] }))} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
                  <option value="building">Building</option>
                  <option value="floor">Floor</option>
                  <option value="zone">Zone</option>
                  <option value="public_area">Public Area</option>
                </select>
                <input placeholder="Name…" value={propForm.name} onChange={e => setPropForm(f => ({ ...f, name: e.target.value }))} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-40" />
                <button onClick={addPropEntity} disabled={propSaving || !propForm.name.trim()} className={button.primary + ' text-xs disabled:opacity-50'}>
                  {propSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                </button>
              </div>
            }
          >
            {propLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : propEntities.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500"><Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />No property setup entities yet.</div>
            ) : (
              <div className="space-y-4">
                {(['building', 'floor', 'zone', 'public_area'] as const).map(et => {
                  const items = propEntities.filter(e => e.entity_type === et);
                  if (items.length === 0) return null;
                  const Icon = et === 'building' ? Building2 : et === 'floor' ? LayersIcon : et === 'zone' ? MapPin : ClipboardList;
                  return (
                    <div key={et}>
                      <h4 className="text-xs font-bold uppercase text-gray-500 mb-2 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {et.replace('_', ' ')}s ({items.length})</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {items.map(e => (
                          <div key={e.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-slate-700">
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{e.name}</span>
                            <button onClick={() => deletePropEntity(e.id)} disabled={propDeleting === e.id} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-rose-600 rounded-lg transition disabled:opacity-50">
                              {propDeleting === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {section === 'room-status' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SectionCard title="Status Codes" icon={ClipboardList} tone="accent" pad="md">
              <div className="space-y-2">
                {statusCodes.map(s => (
                  <div key={s.code} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-slate-700">
                    <span className={`w-8 h-8 rounded-lg ${s.color} text-white text-xs font-bold flex items-center justify-center`}>{s.code}</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{s.label}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
            {renderSectionCard('Cleaning Priorities', Gauge, priorities.map((p, i) => <ConfigRow key={p.id} title={p.label} sub={`Weight ${p.weight}`} onRemove={() => remove(priorities, setPriorities, i)} onEdit={() => openEditModal('Edit Priority', [{ key: 'label', label: 'Label', type: 'text' }, { key: 'weight', label: 'Weight', type: 'number' }], { label: p.label, weight: p.weight }, (v) => setPriorities(prev => prev.map((x, idx) => idx === i ? { ...x, label: v.label, weight: Number(v.weight) } : x)))} />), () => setPriorities(p => [...p, { id: `P-${p.length + 1}`, label: 'New', weight: 10 }]))}
            {renderSectionCard('Inspection Rules', ClipboardCheck, inspectionRules.map((r, i) => <ConfigRow key={r.id} title={r.name} sub={`Threshold ${r.threshold}%`} onRemove={() => remove(inspectionRules, setInspectionRules, i)} onEdit={() => openEditModal('Edit Inspection Rule', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'threshold', label: 'Threshold (%)', type: 'number' }], { name: r.name, threshold: r.threshold }, (v) => setInspectionRules(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, threshold: Number(v.threshold) } : x)))} />), () => setInspectionRules(r => [...r, { id: `IR-${r.length + 1}`, name: 'New Rule', threshold: 80 }]))}
          </div>
          <div className="flex justify-end">
            <button onClick={() => saveConfigSection('room_status', { statusCodes, priorities, inspectionRules })} disabled={configSaving} className={button.primary + ' text-xs disabled:opacity-50'}>
              {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Room Status Config
            </button>
          </div>
        </div>
      )}

      {section === 'task' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {renderSectionCard('Task Types', ClipboardList, taskTypes.map((t, i) => <ConfigRow key={t.id} title={t.name} sub={`${t.category} · ${t.estMinutes} min`} onRemove={() => remove(taskTypes, setTaskTypes, i)} onEdit={() => openEditModal('Edit Task Type', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'category', label: 'Category', type: 'select', options: ['Automatic', 'Manual'] }, { key: 'estMinutes', label: 'Est. Minutes', type: 'number' }], { name: t.name, category: t.category, estMinutes: t.estMinutes }, (v) => setTaskTypes(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, category: v.category, estMinutes: Number(v.estMinutes) } : x)))} />), () => setTaskTypes(t => [...t, { id: `TT-${t.length + 1}`, name: 'New Task', category: 'Manual', estMinutes: 20 }]))}
            {renderSectionCard('Service Levels', Gauge, serviceLevels.map((s, i) => <ConfigRow key={s.id} title={s.name} sub={`SLA ${s.sla}`} onRemove={() => remove(serviceLevels, setServiceLevels, i)} onEdit={() => openEditModal('Edit Service Level', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'sla', label: 'SLA', type: 'text' }], { name: s.name, sla: s.sla }, (v) => setServiceLevels(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, sla: v.sla } : x)))} />), () => setServiceLevels(s => [...s, { id: `SL-${s.length + 1}`, name: 'New Level', sla: '20 min' }]))}
            {renderSectionCard('Cleaning Standards', ClipboardCheck, standards.map((s, i) => <ConfigRow key={s.id} title={s.name} sub={`${s.steps} steps`} onRemove={() => remove(standards, setStandards, i)} onEdit={() => openEditModal('Edit Cleaning Standard', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'steps', label: 'Steps', type: 'number' }], { name: s.name, steps: s.steps }, (v) => setStandards(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, steps: Number(v.steps) } : x)))} />), () => setStandards(s => [...s, { id: `CS-${s.length + 1}`, name: 'New Standard', steps: 5 }]))}
            <SectionCard title="Estimated Times" icon={Clock} tone="accent" pad="md">
              <div className="space-y-2">
                {taskTypes.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-slate-700">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{t.name}</span>
                    <Badge tone="info">{t.estMinutes} min</Badge>
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Checklist-Derived Standards" subtitle="Step counts from actual task checklists (Docs & SOPs tab)" icon={ListChecks} tone="accent" pad="md">
              <div className="space-y-2">
                {ALL_TASK_TYPES.map(tt => {
                  const items = getChecklistForType(docs, tt);
                  return (
                    <div key={tt} className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-slate-700">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{tt}</span>
                      <Badge tone={items.length >= 8 ? 'success' : items.length >= 5 ? 'info' : 'neutral'}>{items.length} steps</Badge>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
          <div className="flex justify-end">
            <button onClick={() => saveConfigSection('task', { taskTypes, serviceLevels, standards })} disabled={configSaving} className={button.primary + ' text-xs disabled:opacity-50'}>
              {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Task Config
            </button>
          </div>
        </div>
      )}

      {section === 'staff' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {renderSectionCard('Teams', Users, teams.map((t, i) => <ConfigRow key={t.id} title={t.name} sub={`${t.members} members`} onRemove={() => remove(teams, setTeams, i)} onEdit={() => openEditModal('Edit Team', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'members', label: 'Members', type: 'number' }], { name: t.name, members: t.members }, (v) => setTeams(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, members: Number(v.members) } : x)))} />), () => setTeams(t => [...t, { id: `T-${t.length + 1}`, name: 'New Team', members: 1 }]))}
            {renderSectionCard('Shifts', CalendarClock, shifts.map((s, i) => <ConfigRow key={s.id} title={s.name} sub={`${s.start} – ${s.end}`} onRemove={() => remove(shifts, setShifts, i)} onEdit={() => openEditModal('Edit Shift', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'start', label: 'Start', type: 'text' }, { key: 'end', label: 'End', type: 'text' }], { name: s.name, start: s.start, end: s.end }, (v) => setShifts(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, start: v.start, end: v.end } : x)))} />), () => setShifts(s => [...s, { id: `S-${s.length + 1}`, name: 'New Shift', start: '00:00', end: '08:00' }]))}
            {renderSectionCard('Skills', Award, skills.map((s, i) => <ConfigRow key={s.id} title={s.name} onRemove={() => remove(skills, setSkills, i)} onEdit={() => openEditModal('Edit Skill', [{ key: 'name', label: 'Name', type: 'text' }], { name: s.name }, (v) => setSkills(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name } : x)))} />), () => setSkills(s => [...s, { id: `SK-${s.length + 1}`, name: 'New Skill' }]))}
            {renderSectionCard('Certifications', BadgeCheck, certifications.map((c, i) => <ConfigRow key={c.id} title={c.name} sub={`Valid ${c.validMonths} months`} onRemove={() => remove(certifications, setCertifications, i)} onEdit={() => openEditModal('Edit Certification', [{ key: 'name', label: 'Name', type: 'text' }, { key: 'validMonths', label: 'Valid (months)', type: 'number' }], { name: c.name, validMonths: c.validMonths }, (v) => setCertifications(prev => prev.map((x, idx) => idx === i ? { ...x, name: v.name, validMonths: Number(v.validMonths) } : x)))} />), () => setCertifications(c => [...c, { id: `C-${c.length + 1}`, name: 'New Cert', validMonths: 12 }]))}
          </div>
          <div className="flex justify-end">
            <button onClick={() => saveConfigSection('staff', { teams, shifts, skills, certifications })} disabled={configSaving} className={button.primary + ' text-xs disabled:opacity-50'}>
              {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Staff Config
            </button>
          </div>
        </div>
      )}

      {section === 'docs' && (
        <div className="space-y-4">
          {/* Docs sub-tabs */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
              <button onClick={() => setDocsTab('sops')} className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${docsTab === 'sops' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <FileText className="w-3.5 h-3.5" /> SOPs ({docs.sops.length})
              </button>
              <button onClick={() => setDocsTab('checklists')} className={`px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${docsTab === 'checklists' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <ListChecks className="w-3.5 h-3.5" /> Checklists ({docs.checklists.length})
              </button>
            </div>
            <button onClick={resetDocs} className={button.ghost + ' text-xs'} title="Reset to defaults">
              <RotateCcw className="w-3.5 h-3.5" /> Reset Defaults
            </button>
          </div>

          {/* SOPs tab */}
          {docsTab === 'sops' && (
            <SectionCard title="Standard Operating Procedures" icon={FileText} tone="accent" pad="md"
              actions={
                <div className="flex items-center gap-2">
                  <input ref={sopFileRef} type="file" accept=".json,.txt" onChange={handleSopUpload} className="hidden" />
                  <button onClick={() => sopFileRef.current?.click()} className={button.ghost + ' text-xs'} title="Upload SOP from .json or .txt">
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  <button onClick={openCreateSop} className={button.primary + ' text-xs'}>
                    <Plus className="w-3.5 h-3.5" /> New SOP
                  </button>
                </div>
              }
            >
              <div className="space-y-2">
                {docs.sops.map(sop => {
                  const isOpen = expandedSop === sop.id;
                  return (
                    <div key={sop.id} className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                      <div role="button" tabIndex={0} onClick={() => setExpandedSop(isOpen ? null : sop.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedSop(isOpen ? null : sop.id); } }} className="w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition cursor-pointer">
                        <div className="flex items-center gap-3 min-w-0 text-left">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{sop.title}</p>
                            <p className="text-xs text-gray-500 truncate">{sop.id} · {sop.category} · {sop.steps.length} steps · Updated {sop.updatedAt}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); setViewSop(sop); }} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-[var(--color-accent-operations)] rounded-lg transition" title="View / Print">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); openEditSop(sop); }} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-[var(--color-accent-operations)] rounded-lg transition" title="Edit">
                            <Edit className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); updateDocs({ ...docs, sops: docs.sops.filter(s => s.id !== sop.id) }); }} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-rose-600 rounded-lg transition" title="Delete">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-slate-700">
                          <p className="text-xs text-gray-500 mb-3 mt-2">{sop.description}</p>
                          <ol className="space-y-1.5">
                            {sop.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                                <span className="w-5 h-5 shrink-0 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  );
                })}
                {docs.sops.length === 0 && (
                  <div className="p-8 text-center text-sm text-gray-500">
                    <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No SOPs yet. Create or upload one to get started.
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Checklists tab */}
          {docsTab === 'checklists' && (
            <SectionCard title="Task Checklists" icon={ListChecks} tone="accent" pad="md"
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 hidden sm:inline">Integrated into Task print sheets</span>
                  <input ref={checklistFileRef} type="file" accept=".json,.txt" onChange={handleChecklistUpload} className="hidden" />
                  <button onClick={() => checklistFileRef.current?.click()} className={button.ghost + ' text-xs'} title="Upload checklist from .json or .txt">
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  <button onClick={openNewChecklist} className={button.primary + ' text-xs'}>
                    <Plus className="w-3.5 h-3.5" /> New Checklist
                  </button>
                </div>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...new Set([...ALL_TASK_TYPES, ...docs.checklists.map(c => c.taskType)])].map(tt => {
                  const items = getChecklistForType(docs, tt);
                  const isCustom = !ALL_TASK_TYPES.includes(tt as TaskTypeKey);
                  return (
                    <div key={tt} className={`rounded-xl border p-4 transition ${isCustom ? 'border-[var(--color-accent-operations)]/30 bg-[var(--color-accent-operations)]/5' : 'border-gray-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/40'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">{tt}</h4>
                        <div className="flex items-center gap-1.5">
                          {isCustom && <Badge tone="accent">Custom</Badge>}
                          <Badge tone="info">{items.length}</Badge>
                        </div>
                      </div>
                      <ul className="space-y-1 mb-3">
                        {items.slice(0, 4).map((item, i) => (
                          <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3 text-[var(--color-accent-operations)]/50 shrink-0" /> {item}
                          </li>
                        ))}
                        {items.length > 4 && <li className="text-xs text-gray-400 italic">+{items.length - 4} more…</li>}
                      </ul>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingChecklist(tt as TaskTypeKey); setChecklistDraft([...items]); }} className={button.ghost + ' text-xs flex-1'}>
                          <Edit className="w-3 h-3" /> Edit
                        </button>
                        {isCustom && (
                          <button onClick={() => updateDocs({ ...docs, checklists: docs.checklists.filter(c => c.taskType !== tt) })} className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition shrink-0" title="Delete checklist">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {section === 'consumption' && (
        <div className="space-y-4">
          <SectionCard
            title="Task Consumption Profiles"
            subtitle="Maps each task type to the inventory items consumed when that task is completed. Property-specific profiles override system defaults."
            icon={FlaskConical}
            tone="accent"
            pad="md"
            actions={
              <button onClick={openCreateProfile} className={button.primary + ' text-xs'}>
                <Plus className="w-3.5 h-3.5" /> Add Profile
              </button>
            }
          >
            {profilesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                <FlaskConical className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                No consumption profiles found.
              </div>
            ) : (
              <div className="space-y-2">
                {groupedProfiles.map(group => {
                  const isCollapsed = collapsedGroups.has(group.taskType);
                  const propCount = group.profiles.filter(p => p.propertyId).length;
                  const defaultCount = group.profiles.length - propCount;
                  return (
                    <div key={group.taskType} className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                      {/* Group header */}
                      <button
                        onClick={() => toggleGroup(group.taskType)}
                        className="w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition"
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          {isCollapsed
                            ? <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                          <span className="text-sm font-bold text-gray-900 dark:text-white">{group.taskType}</span>
                          <Badge tone="info">{group.profiles.length} {group.profiles.length === 1 ? 'item' : 'items'}</Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {propCount > 0 && <Badge tone="accent">{propCount} property</Badge>}
                          {defaultCount > 0 && <Badge tone="neutral">{defaultCount} default</Badge>}
                        </div>
                      </button>
                      {/* Group items */}
                      {!isCollapsed && (
                        <div className="border-t border-gray-100 dark:border-slate-700/50">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 text-[10px] font-bold uppercase text-gray-400">
                                  <th className="text-left py-1.5 px-3">Subtype</th>
                                  <th className="text-left py-1.5 px-3">Item</th>
                                  <th className="text-left py-1.5 px-3">Category</th>
                                  <th className="text-right py-1.5 px-3">Qty</th>
                                  <th className="text-center py-1.5 px-3">Scope</th>
                                  <th className="text-right py-1.5 px-3">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/30">
                                {group.profiles.map(p => (
                                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition">
                                    <td className="py-2 px-3 text-gray-500">{p.subtype || <span className="text-gray-300">—</span>}</td>
                                    <td className="py-2 px-3 text-gray-700 dark:text-gray-300 font-medium">{p.itemName}</td>
                                    <td className="py-2 px-3">
                                      <Badge tone="info">{CATEGORY_OPTIONS.find(c => c.value === p.itemCategory)?.label || p.itemCategory}</Badge>
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono font-bold text-gray-700 dark:text-gray-200">{p.quantity}</td>
                                    <td className="py-2 px-3 text-center">
                                      {p.propertyId
                                        ? <Badge tone="accent">Property</Badge>
                                        : <Badge tone="neutral">Default</Badge>
                                      }
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <button onClick={() => openEditProfile(p)} className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-[var(--color-accent-operations)] rounded-lg transition" title="Edit">
                                          <Edit className="w-3 h-3" />
                                        </button>
                                        {p.propertyId && (
                                          <button
                                            onClick={() => deleteProfile(p.id)}
                                            disabled={profileDeleting === p.id}
                                            className="p-1.5 bg-slate-50 dark:bg-slate-900/40 text-gray-400 hover:text-rose-600 rounded-lg transition disabled:opacity-50"
                                            title="Delete"
                                          >
                                            {profileDeleting === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
              When a task is completed, the backend reads these profiles and posts <strong>consumption transactions</strong> to the central inventory for each line.
              System defaults (marked "Default") apply to all properties. Create a property-specific profile with the same task type to override the default quantity or item.
              System defaults cannot be deleted — only overridden.
            </p>
          </div>
        </div>
      )}

      {/* SOP View Modal */}
      <ModalSystem
        isOpen={!!viewSop}
        onClose={() => setViewSop(null)}
        title={viewSop?.title}
        subtitle={`${viewSop?.id} · ${viewSop?.category} · ${viewSop?.steps.length} steps`}
        variant="info"
        size="lg"
        showFooter={false}
      >
        {viewSop && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">{viewSop.description}</p>
            <ol className="space-y-2">
              {viewSop.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-800 dark:text-gray-200">
                  <span className="w-6 h-6 shrink-0 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="flex justify-end pt-2">
              <button onClick={() => printSOP(viewSop)} className={button.secondary}>
                <FileText className="w-4 h-4" /> Print SOP
              </button>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* Checklist Edit Modal */}
      <ModalSystem
        isOpen={!!editingChecklist}
        onClose={() => setEditingChecklist(null)}
        onConfirm={() => {
          if (!editingChecklist) return;
          const cleaned = checklistDraft.map(s => s.trim()).filter(Boolean);
          updateDocs({
            ...docs,
            checklists: docs.checklists.map(c => c.taskType === editingChecklist ? { ...c, items: cleaned } : c),
          });
          setEditingChecklist(null);
        }}
        title={`Edit Checklist — ${editingChecklist}`}
        subtitle="Items appear on printed task sheets for this task type"
        variant="form"
        size="lg"
        confirmLabel="Save Checklist"
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-3">
          {checklistDraft.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <input
                value={item}
                onChange={e => setChecklistDraft(prev => prev.map((s, idx) => idx === i ? e.target.value : s))}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                placeholder="Checklist item"
              />
              <button onClick={() => setChecklistDraft(prev => prev.filter((_, idx) => idx !== i))} disabled={checklistDraft.length <= 1} className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button onClick={() => setChecklistDraft(prev => [...prev, ''])} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition text-sm font-medium`}>
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </ModalSystem>

      {/* SOP Create / Edit Modal */}
      <ModalSystem
        isOpen={sopModalOpen}
        onClose={() => setSopModalOpen(false)}
        onConfirm={saveSop}
        title={sopEditing ? `Edit SOP — ${sopEditing.id}` : 'New Standard Operating Procedure'}
        subtitle={sopEditing ? 'Update the procedure steps' : 'Create a new SOP with step-by-step instructions'}
        variant="form"
        size="lg"
        confirmLabel={sopEditing ? 'Save Changes' : 'Create SOP'}
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Title</label>
              <input value={sopDraft.title} onChange={e => setSopDraft(d => ({ ...d, title: e.target.value }))} placeholder="e.g. Pool Area Cleaning Procedure" className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Category</label>
              <select value={sopDraft.category} onChange={e => setSopDraft(d => ({ ...d, category: e.target.value as SOP['category'] }))} className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none">
                {(['Cleaning', 'Safety', 'Inspection', 'Guest Service', 'Linen', 'General'] as const).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase text-gray-500">Description</label>
            <input value={sopDraft.description} onChange={e => setSopDraft(d => ({ ...d, description: e.target.value }))} placeholder="Brief summary of when and why this SOP is used" className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-gray-500">Steps</label>
              <span className="text-xs text-gray-400">{sopDraft.steps.filter(s => s.trim()).length} steps</span>
            </div>
            <div className="space-y-2">
              {sopDraft.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <input value={step} onChange={e => setSopDraft(d => ({ ...d, steps: d.steps.map((s, idx) => idx === i ? e.target.value : s) }))} placeholder={`Step ${i + 1}`} className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none" />
                  <button onClick={() => setSopDraft(d => ({ ...d, steps: d.steps.length <= 1 ? d.steps : d.steps.filter((_, idx) => idx !== i) }))} disabled={sopDraft.steps.length <= 1} className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setSopDraft(d => ({ ...d, steps: [...d.steps, ''] }))} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition text-sm font-medium`}>
              <Plus className="w-4 h-4" /> Add Step
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* New Checklist Modal */}
      <ModalSystem
        isOpen={newChecklistOpen}
        onClose={() => setNewChecklistOpen(false)}
        onConfirm={saveNewChecklist}
        title="New Checklist"
        subtitle="Create a checklist for a new or existing task type"
        variant="form"
        size="lg"
        confirmLabel="Create Checklist"
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase text-gray-500">Task Type</label>
            <input
              value={newChecklistType}
              onChange={e => setNewChecklistType(e.target.value)}
              placeholder="e.g. Window Cleaning, Carpet Shampoo, Custom Task"
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
            />
            <p className="text-xs text-gray-400">Enter a new task type name or match an existing one to override it</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-gray-500">Checklist Items</label>
              <span className="text-xs text-gray-400">{newChecklistItems.filter(s => s.trim()).length} items</span>
            </div>
            <div className="space-y-2">
              {newChecklistItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <input
                    value={item}
                    onChange={e => setNewChecklistItems(prev => prev.map((s, idx) => idx === i ? e.target.value : s))}
                    placeholder={`Checklist item ${i + 1}`}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                  />
                  <button onClick={() => setNewChecklistItems(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))} disabled={newChecklistItems.length <= 1} className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setNewChecklistItems(prev => [...prev, ''])} className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition text-sm font-medium`}>
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
        </div>
      </ModalSystem>

      {/* Consumption Profile Create / Edit Modal */}
      <ModalSystem
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onConfirm={saveProfile}
        title={profileEditing ? `Edit Profile — ${profileEditing.id}` : 'New Consumption Profile'}
        subtitle="Define which inventory items are consumed when a task of this type is completed"
        variant="form"
        size="lg"
        loading={profileSaving}
        confirmLabel={profileEditing ? 'Save Changes' : `Create ${profileDraft.lines.filter(l => l.itemName.trim() && l.quantity > 0).length || ''} Profile${profileDraft.lines.filter(l => l.itemName.trim() && l.quantity > 0).length !== 1 ? 's' : ''}`}
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-4">
          {/* Shared header: task type + subtype apply to all lines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Task Type</label>
              <select
                value={profileDraft.taskType}
                onChange={e => setProfileDraft(d => ({ ...d, taskType: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
              >
                {TASK_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">Subtype (optional)</label>
              <input
                value={profileDraft.subtype}
                onChange={e => setProfileDraft(d => ({ ...d, subtype: e.target.value }))}
                placeholder="e.g. Carpet Shampoo, Window Cleaning"
                className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
              />
              <p className="text-xs text-gray-400">Leave empty to apply to all subtypes</p>
            </div>
          </div>

          {/* Line items — each is one consumed inventory item */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-gray-500">
                Consumed Items {!profileEditing && <span className="text-gray-400 font-normal">({profileDraft.lines.length} lines)</span>}
              </label>
            </div>

            {/* Column headers (desktop only) */}
            <div className="hidden sm:grid grid-cols-[1fr_140px_90px_36px] gap-2 px-1">
              <span className="text-[10px] font-bold uppercase text-gray-400">Item Name</span>
              <span className="text-[10px] font-bold uppercase text-gray-400">Category</span>
              <span className="text-[10px] font-bold uppercase text-gray-400 text-right">Qty</span>
              <span />
            </div>

            <div className="space-y-2">
              {profileDraft.lines.map((line, i) => (
                <div key={i} className="flex flex-col sm:grid sm:grid-cols-[1fr_140px_90px_36px] gap-2">
                  <input
                    value={line.itemName}
                    onChange={e => updateLine(i, { itemName: e.target.value })}
                    placeholder="e.g. Bathroom Cleaner"
                    className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                  />
                  <select
                    value={line.itemCategory}
                    onChange={e => updateLine(i, { itemCategory: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                  >
                    {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={line.quantity}
                    onChange={e => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                    className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none font-mono text-right"
                  />
                  <button
                    onClick={() => removeLine(i)}
                    disabled={profileDraft.lines.length <= 1}
                    className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                    title="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add line button — hidden in edit mode (single-item edit) */}
            {!profileEditing && (
              <button
                onClick={addLine}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 hover:border-[var(--color-accent-operations)] hover:text-[var(--color-accent-operations)] transition text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> Add Another Item
              </button>
            )}

            <p className="text-xs text-gray-400">
              {profileEditing
                ? 'Editing a single profile. Item name must match the Inventory tab (case-insensitive).'
                : 'All items share the same task type and subtype. Each item name must match the Inventory tab (case-insensitive).'}
            </p>
          </div>
        </div>
      </ModalSystem>

      {/* Generic Config-Row Edit Modal */}
      <ModalSystem
        isOpen={editState.open}
        onClose={() => setEditState(s => ({ ...s, open: false }))}
        onConfirm={saveEditModal}
        title={editState.title}
        variant="form"
        size="md"
        confirmLabel="Save"
        cancelLabel="Cancel"
        confirmColor="indigo"
      >
        <div className="space-y-3">
          {editState.fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase text-gray-500">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={editState.values[f.key] ?? ''}
                  onChange={e => setEditState(s => ({ ...s, values: { ...s.values, [f.key]: e.target.value } }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                >
                  {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={editState.values[f.key] ?? ''}
                  onChange={e => setEditState(s => ({ ...s, values: { ...s.values, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value } }))}
                  className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none"
                />
              )}
            </div>
          ))}
        </div>
      </ModalSystem>

      <div className="bg-[var(--color-accent-operations)]/5 border border-[var(--color-accent-operations)]/20 rounded-xl p-4 flex items-start gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-[var(--color-accent-operations)] mt-0.5 shrink-0" />
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
          Configuration changes are audit-logged and propagated to the relevant modules (Room Status, Task Management, Room Attendant Management) in real time.
        </p>
      </div>
    </div>
  );
}
