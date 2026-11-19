/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Organization Management — HR > Organization module.
 *
 * DB-integrated via /api/hr-portal/organization/* routes. Replaces the
 * hardcoded placeholder tree/positions with live records from
 * hr_departments, hr_teams, and hr_positions.
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, DataTable, brandTheme.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  Users,
  GitBranch,
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronRight,
  ChevronDown,
  Briefcase,
  MapPin,
  RefreshCw,
  Loader2,
  ServerCrash,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ────────────────────────────────────────────────────────────────
type Tab = 'structure' | 'positions' | 'chart';

interface Department {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  head_employee_id: string | null;
  headName: string | null;
  cost_center: string | null;
  description: string | null;
  is_active: boolean;
  headcount: number;
  teams: Team[];
}

interface Team {
  id: string;
  name: string;
  headName: string | null;
  isActive: boolean;
}

interface Position {
  id: string;
  property_id: string;
  department_id: string | null;
  title: string;
  code: string | null;
  grade: string;
  reports_to_position_id: string | null;
  reports_to_label: string | null;
  vacancies: number;
  budget: number;
  is_active: boolean;
  hr_departments?: { name: string } | null;
  parent?: { title: string } | null;
}

interface EmployeeOption {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
}

interface Stats {
  totalDepartments: number;
  totalTeams: number;
  totalPositions: number;
  vacantPositions: number;
}

const GRADES: StatusTone[] = ['neutral', 'info', 'warning', 'accent'];
const GRADE_TONE: Record<string, StatusTone> = {
  Executive: 'accent',
  'Senior Management': 'warning',
  Management: 'info',
  Staff: 'neutral',
};

// ── Auth headers ─────────────────────────────────────────────────────────
function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500 font-sans';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────
const OrganizationManagement = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [activeTab, setActiveTab] = useState<Tab>('structure');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [search, setSearch] = useState('');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [stats, setStats] = useState<Stats>({ totalDepartments: 0, totalTeams: 0, totalPositions: 0, vacantPositions: 0 });

  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [deptModal, setDeptModal] = useState<{ mode: 'create' | 'edit'; dept: Department | null } | null>(null);
  const [teamModal, setTeamModal] = useState<{ mode: 'create' | 'edit'; dept: Department | null; team: Team | null } | null>(null);
  const [posModal, setPosModal] = useState<{ mode: 'create' | 'edit'; pos: Position | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'department' | 'team' | 'position'; id: string; label: string } | null>(null);

  const [deptForm, setDeptForm] = useState({ name: '', code: '', costCenter: '', description: '', headEmployeeId: '' });
  const [teamForm, setTeamForm] = useState({ name: '', headEmployeeId: '' });
  const [posForm, setPosForm] = useState({
    title: '', code: '', grade: 'Staff', departmentId: '', reportsToPositionId: '', reportsToLabel: '',
    vacancies: 0, budget: 0,
  });

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Fetchers ──────────────────────────────────────────────────────────
  const fetchTree = useCallback(async () => {
    if (!currentPropertyId) { setLoadingTree(false); return; }
    setLoadingTree(true); setError(null);
    try {
      const res = await fetch(`/api/hr-portal/organization/tree/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load organization (${res.status})`);
      const data = (await res.json()) as { departments: Department[] };
      const depts = data.departments || [];
      setDepartments(depts);
      // Auto-expand all departments on first load.
      setExpandedNodes((prev) => {
        if (prev.size > 0) return prev;
        return new Set(depts.map((d) => d.id));
      });
      // Keep selected dept in sync with latest data.
      if (selectedDept) {
        const updated = depts.find((d) => d.id === selectedDept.id);
        if (updated) setSelectedDept(updated);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load organization');
      addNotification('Failed to load organization structure', 'warning', 'HR');
    } finally {
      setLoadingTree(false);
    }
  }, [currentPropertyId, addNotification, selectedDept]);

  const fetchPositions = useCallback(async () => {
    if (!currentPropertyId) { setLoadingPositions(false); return; }
    setLoadingPositions(true);
    try {
      const res = await fetch(`/api/hr-portal/organization/positions/${currentPropertyId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load positions (${res.status})`);
      const data = (await res.json()) as { positions: Position[] };
      setPositions(data.positions || []);
    } catch (e: any) {
      addNotification('Failed to load positions', 'warning', 'HR');
    } finally {
      setLoadingPositions(false);
    }
  }, [currentPropertyId, addNotification]);

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/organization/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/organization/employees/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { employees: EmployeeOption[] };
        setEmployees(data.employees || []);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refreshAll = useCallback(() => {
    fetchTree();
    fetchPositions();
    fetchStats();
  }, [fetchTree, fetchPositions, fetchStats]);

  useEffect(() => {
    if (currentPropertyId) {
      refreshAll();
      fetchEmployees();
    } else {
      setLoadingTree(false);
      setLoadingPositions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  // ── Department CRUD ───────────────────────────────────────────────────
  const openCreateDept = () => {
    setDeptForm({ name: '', code: '', costCenter: '', description: '', headEmployeeId: '' });
    setDeptModal({ mode: 'create', dept: null });
  };
  const openEditDept = (d: Department) => {
    setDeptForm({
      name: d.name,
      code: d.code || '',
      costCenter: d.cost_center || '',
      description: d.description || '',
      headEmployeeId: d.head_employee_id || '',
    });
    setDeptModal({ mode: 'edit', dept: d });
  };

  const saveDepartment = async () => {
    if (!currentPropertyId || !deptForm.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        name: deptForm.name.trim(),
        code: deptForm.code.trim() || null,
        costCenter: deptForm.costCenter.trim() || null,
        description: deptForm.description.trim() || null,
        headEmployeeId: deptForm.headEmployeeId || null,
      };
      const res = await fetch('/api/hr-portal/organization/departments', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Department created', 'success', 'HR');
      setDeptModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create department', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateDepartment = async () => {
    if (!deptModal?.dept) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/organization/departments/${deptModal.dept.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          name: deptForm.name.trim(),
          code: deptForm.code.trim() || null,
          costCenter: deptForm.costCenter.trim() || null,
          description: deptForm.description.trim() || null,
          headEmployeeId: deptForm.headEmployeeId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Department updated', 'success', 'HR');
      setDeptModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update department', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    const base = `/api/hr-portal/organization/${deleteTarget.kind}s/${deleteTarget.id}?hard=true`;
    try {
      const res = await fetch(base, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification(`${deleteTarget.kind} removed`, 'success', 'HR');
      if (deleteTarget.kind === 'department' && selectedDept?.id === deleteTarget.id) setSelectedDept(null);
      setDeleteTarget(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Team CRUD ─────────────────────────────────────────────────────────
  const openCreateTeam = (dept: Department) => {
    setTeamForm({ name: '', headEmployeeId: '' });
    setTeamModal({ mode: 'create', dept, team: null });
  };
  const openEditTeam = (dept: Department, team: Team) => {
    setTeamForm({ name: team.name, headEmployeeId: '' });
    setTeamModal({ mode: 'edit', dept, team });
  };

  const saveTeam = async () => {
    if (!teamModal?.dept || !teamForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr-portal/organization/teams', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          departmentId: teamModal.dept.id,
          name: teamForm.name.trim(),
          headEmployeeId: teamForm.headEmployeeId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Team created', 'success', 'HR');
      setTeamModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create team', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateTeam = async () => {
    if (!teamModal?.team) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/organization/teams/${teamModal.team.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          name: teamForm.name.trim(),
          headEmployeeId: teamForm.headEmployeeId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Team updated', 'success', 'HR');
      setTeamModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update team', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Position CRUD ─────────────────────────────────────────────────────
  const openCreatePos = () => {
    setPosForm({ title: '', code: '', grade: 'Staff', departmentId: '', reportsToPositionId: '', reportsToLabel: '', vacancies: 0, budget: 0 });
    setPosModal({ mode: 'create', pos: null });
  };
  const openEditPos = (p: Position) => {
    setPosForm({
      title: p.title,
      code: p.code || '',
      grade: p.grade,
      departmentId: p.department_id || '',
      reportsToPositionId: p.reports_to_position_id || '',
      reportsToLabel: p.reports_to_label || '',
      vacancies: p.vacancies,
      budget: Number(p.budget),
    });
    setPosModal({ mode: 'edit', pos: p });
  };

  const savePosition = async () => {
    if (!currentPropertyId || !posForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr-portal/organization/positions', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          propertyId: currentPropertyId,
          title: posForm.title.trim(),
          code: posForm.code.trim() || null,
          grade: posForm.grade,
          departmentId: posForm.departmentId || null,
          reportsToPositionId: posForm.reportsToPositionId || null,
          reportsToLabel: posForm.reportsToLabel.trim() || null,
          vacancies: posForm.vacancies,
          budget: posForm.budget,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Position created', 'success', 'HR');
      setPosModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create position', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updatePosition = async () => {
    if (!posModal?.pos) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/organization/positions/${posModal.pos.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({
          title: posForm.title.trim(),
          code: posForm.code.trim() || null,
          grade: posForm.grade,
          departmentId: posForm.departmentId || null,
          reportsToPositionId: posForm.reportsToPositionId || null,
          reportsToLabel: posForm.reportsToLabel.trim() || null,
          vacancies: posForm.vacancies,
          budget: posForm.budget,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Position updated', 'success', 'HR');
      setPosModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update position', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const filteredPositions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return positions;
    return positions.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.hr_departments?.name || '').toLowerCase().includes(q) ||
      p.grade.toLowerCase().includes(q)
    );
  }, [positions, search]);

  const renderTreeNode = (dept: Department, level: number = 0) => {
    const isExpanded = expandedNodes.has(dept.id);
    const isSelected = selectedDept?.id === dept.id;
    const hasTeams = dept.teams && dept.teams.length > 0;

    return (
      <div key={dept.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors group ${
            isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (hasTeams) toggleNode(dept.id);
            setSelectedDept(dept);
          }}
        >
          {hasTeams && (
            <div className="w-4 h-4 flex items-center justify-center">
              {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
            </div>
          )}
          {!hasTeams && <div className="w-4" />}

          <div className="w-6 h-6 rounded flex items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <Users size={14} />
          </div>

          <span className="text-xs font-semibold text-slate-900 dark:text-white">{dept.name}</span>

          <span className="text-xs font-medium text-slate-400 ml-auto">{dept.headcount} staff</span>

          <button
            onClick={(e) => { e.stopPropagation(); openEditDept(dept); }}
            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition opacity-0 group-hover:opacity-100"
            title="Edit department"
          >
            <Pencil size={13} className="text-slate-400" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'department', id: dept.id, label: dept.name }); }}
            className="p-1 hover:bg-rose-100 dark:hover:bg-rose-500/10 rounded transition opacity-0 group-hover:opacity-100"
            title="Delete department"
          >
            <Trash2 size={13} className="text-rose-400" />
          </button>
        </div>

        {isExpanded && hasTeams && (
          <div>
            {dept.teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center gap-2 py-2 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors group"
                style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
                onClick={() => setSelectedDept(dept)}
              >
                <div className="w-4" />
                <div className="w-6 h-6 rounded flex items-center justify-center bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  <Briefcase size={14} />
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{team.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); openEditTeam(dept, team); }}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition opacity-0 group-hover:opacity-100"
                  title="Edit team"
                >
                  <Pencil size={13} className="text-slate-400" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'team', id: team.id, label: team.name }); }}
                  className="p-1 hover:bg-rose-100 dark:hover:bg-rose-500/10 rounded transition opacity-0 group-hover:opacity-100"
                  title="Delete team"
                >
                  <Trash2 size={13} className="text-rose-400" />
                </button>
              </div>
            ))}
            <div
              className="flex items-center gap-2 py-1.5 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
              style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
              onClick={() => openCreateTeam(dept)}
            >
              <div className="w-4" />
              <Plus size={14} className="text-indigo-500" />
              <span className="text-xs font-medium text-indigo-500">Add team</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Organization Management" subtitle="Manage organizational structure, positions, and reporting lines" icon={Building2} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Building2 className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to manage its organization.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Organization Management"
        subtitle="Manage organizational structure, positions, and reporting lines"
        icon={Building2}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={openCreateDept} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Unit
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Departments" value={stats.totalDepartments} icon={Building2} tone="accent" />
        <StatCard title="Total Positions" value={stats.totalPositions} icon={Briefcase} tone="success" />
        <StatCard title="Total Teams" value={stats.totalTeams} icon={Users} tone="info" />
        <StatCard title="Vacant Positions" value={stats.vacantPositions} icon={MapPin} tone="warning" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        {([
          { id: 'structure', label: 'Structure', icon: GitBranch },
          { id: 'positions', label: 'Positions', icon: Briefcase },
          { id: 'chart', label: 'Org Chart', icon: Network },
        ] as { id: Tab; label: string; icon: LucideIcon }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
          <ServerCrash className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Structure Tab */}
      {activeTab === 'structure' && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Organization Tree */}
          <div className="lg:col-span-2">
            <SectionCard
              title="Organization Hierarchy"
              icon={GitBranch}
              tone="accent"
              actions={
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search units..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              }
            >
              <div className="p-4 max-h-[500px] overflow-y-auto">
                {loadingTree ? (
                  <LoadingRow />
                ) : departments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Building2 className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No departments yet. Click "Add Unit" to create one.</p>
                  </div>
                ) : (
                  departments
                    .filter((d) =>
                      !search.trim() ||
                      d.name.toLowerCase().includes(search.toLowerCase()) ||
                      d.teams.some((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                    )
                    .map((d) => renderTreeNode(d))
                )}
              </div>
            </SectionCard>
          </div>

          {/* Unit Details */}
          <SectionCard title="Unit Details" icon={Users} tone="info">
            <div className="p-6 space-y-6">
              {selectedDept ? (
                <>
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-100 dark:bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Users className="text-blue-600 dark:text-blue-400" size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{selectedDept.name}</h4>
                        <p className="text-xs text-slate-600 dark:text-slate-400 uppercase">Department</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Department Head</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedDept.headName || 'Unassigned'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Total Staff</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedDept.headcount}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Teams</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedDept.teams.length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Cost Center</span>
                        <span className="text-xs font-bold text-indigo-600">{selectedDept.cost_center || '—'}</span>
                      </div>
                      {selectedDept.description && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Description</span>
                          <span className="text-xs text-slate-600 dark:text-slate-400">{selectedDept.description}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => openEditDept(selectedDept)} className={`flex-1 ${button.primary}`}>
                      <Pencil size={14} /> Edit
                    </button>
                    <button onClick={() => openCreateTeam(selectedDept)} className={`flex-1 ${button.secondary}`}>
                      <Plus size={14} /> Add Team
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Users className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">Select a department to view its details.</p>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Positions Tab */}
      {activeTab === 'positions' && (
        <SectionCard
          title="Position Management"
          icon={Briefcase}
          tone="accent"
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Search positions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button onClick={openCreatePos} className={button.primary}>
                <Plus size={14} /> Add Position
              </button>
            </div>
          }
        >
          {loadingPositions ? (
            <LoadingRow />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase">Position</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase">Department</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase">Grade</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase">Reports To</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase text-center">Vacancies</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase text-right">Budget</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-400 uppercase text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredPositions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-slate-400">No positions found.</td>
                    </tr>
                  ) : (
                    filteredPositions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg flex items-center justify-center">
                              <Briefcase className="text-indigo-600 dark:text-indigo-400" size={14} />
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-slate-900 dark:text-white block">{pos.title}</span>
                              <span className="text-xs font-medium text-slate-400">{pos.code || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">{pos.hr_departments?.name || 'Executive'}</td>
                        <td className="px-6 py-4">
                          <Badge tone={GRADE_TONE[pos.grade] ?? 'neutral'}>{pos.grade}</Badge>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-500">
                          {pos.parent?.title || pos.reports_to_label || '—'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Badge tone={pos.vacancies > 0 ? 'warning' : 'success'} variant="soft">
                            {pos.vacancies}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-slate-900 dark:text-white">
                          ${Number(pos.budget).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => openEditPos(pos)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                              title="Edit"
                            >
                              <Pencil size={14} className="text-slate-400" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget({ kind: 'position', id: pos.id, label: pos.title })}
                              className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"
                              title="Delete"
                            >
                              <Trash2 size={14} className="text-rose-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Org Chart Tab */}
      {activeTab === 'chart' && (
        <SectionCard
          title="Organization Chart"
          icon={Network}
          tone="accent"
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => setExpandedNodes(new Set(departments.map((d) => d.id)))}
                className="px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-medium uppercase"
              >
                Expand All
              </button>
              <button
                onClick={() => setExpandedNodes(new Set())}
                className="px-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-medium uppercase"
              >
                Collapse All
              </button>
            </div>
          }
        >
          <div className="p-8">
            {loadingTree ? (
              <LoadingRow />
            ) : departments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Network className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No organization data to chart.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                {/* Top level: General Manager (executive positions) */}
                {(() => {
                  const exec = positions.filter((p) => p.grade === 'Executive');
                  if (exec.length === 0) return null;
                  return (
                    <>
                      <div className="bg-indigo-600 text-white p-4 rounded-xl text-center min-w-[200px]">
                        <div className="w-12 h-12 bg-white/20 rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-semibold">
                          {exec[0].title.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <h4 className="text-sm font-semibold">{exec[0].title}</h4>
                        <p className="text-xs opacity-80">Executive</p>
                      </div>
                      <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                    </>
                  );
                })()}

                {/* Department heads / senior management positions grouped by department */}
                <div className="flex flex-wrap gap-6 justify-center">
                  {departments.map((dept) => {
                    const headPos = positions.find((p) => p.department_id === dept.id && p.grade === 'Senior Management');
                    const colorMap: Record<string, string> = {
                      'Front Office': 'bg-blue-500',
                      'Housekeeping': 'bg-purple-500',
                      'Food & Beverage': 'bg-emerald-500',
                      Engineering: 'bg-amber-500',
                    };
                    const color = colorMap[dept.name] || 'bg-slate-500';
                    const label = headPos?.title || `${dept.name} Lead`;
                    return (
                      <div key={dept.id} className={`${color} text-white p-3 rounded-xl text-center min-w-[160px]`}>
                        <div className="w-10 h-10 bg-white/20 rounded-full mx-auto mb-2 flex items-center justify-center text-sm font-semibold">
                          {label.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </div>
                        <h5 className="text-xs font-semibold leading-tight">{label}</h5>
                        <p className="text-xs opacity-80">{dept.name}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Department modal ─────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deptModal}
        onClose={() => setDeptModal(null)}
        onConfirm={deptModal?.mode === 'create' ? saveDepartment : updateDepartment}
        title={deptModal?.mode === 'create' ? 'Add Department' : 'Edit Department'}
        variant="form"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Name">
              <input className={inputCls} value={deptForm.name} onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Front Office" />
            </Field>
          </div>
          <Field label="Code">
            <input className={inputCls} value={deptForm.code} onChange={(e) => setDeptForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. FO" />
          </Field>
          <Field label="Cost Center">
            <input className={inputCls} value={deptForm.costCenter} onChange={(e) => setDeptForm((f) => ({ ...f, costCenter: e.target.value }))} placeholder="e.g. CC-FO-001" />
          </Field>
          <div className="col-span-2">
            <Field label="Department Head">
              <select className={inputCls} value={deptForm.headEmployeeId} onChange={(e) => setDeptForm((f) => ({ ...f, headEmployeeId: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Description">
              <textarea className={inputCls} rows={2} value={deptForm.description} onChange={(e) => setDeptForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Team modal ───────────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!teamModal}
        onClose={() => setTeamModal(null)}
        onConfirm={teamModal?.mode === 'create' ? saveTeam : updateTeam}
        title={teamModal?.mode === 'create' ? `Add Team to ${teamModal?.dept?.name || ''}` : 'Edit Team'}
        variant="form"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Team Name">
              <input className={inputCls} value={teamForm.name} onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Reception" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Team Lead">
              <select className={inputCls} value={teamForm.headEmployeeId} onChange={(e) => setTeamForm((f) => ({ ...f, headEmployeeId: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} — {emp.position || 'Staff'}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </ModalSystem>

      {/* ── Position modal ───────────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!posModal}
        onClose={() => setPosModal(null)}
        onConfirm={posModal?.mode === 'create' ? savePosition : updatePosition}
        title={posModal?.mode === 'create' ? 'Add Position' : 'Edit Position'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Title">
              <input className={inputCls} value={posForm.title} onChange={(e) => setPosForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Front Office Manager" />
            </Field>
          </div>
          <Field label="Code">
            <input className={inputCls} value={posForm.code} onChange={(e) => setPosForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. POS-002" />
          </Field>
          <Field label="Grade">
            <select className={inputCls} value={posForm.grade} onChange={(e) => setPosForm((f) => ({ ...f, grade: e.target.value }))}>
              {['Executive', 'Senior Management', 'Management', 'Staff'].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <select className={inputCls} value={posForm.departmentId} onChange={(e) => setPosForm((f) => ({ ...f, departmentId: e.target.value }))}>
              <option value="">— Executive / Unassigned —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Reports To">
            <select className={inputCls} value={posForm.reportsToPositionId} onChange={(e) => setPosForm((f) => ({ ...f, reportsToPositionId: e.target.value }))}>
              <option value="">— None (use label) —</option>
              {positions.filter((p) => p.id !== posModal?.pos?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Reports To (label)">
            <input className={inputCls} value={posForm.reportsToLabel} onChange={(e) => setPosForm((f) => ({ ...f, reportsToLabel: e.target.value }))} placeholder="e.g. Board" />
          </Field>
          <Field label="Vacancies">
            <input type="number" min={0} className={inputCls} value={posForm.vacancies} onChange={(e) => setPosForm((f) => ({ ...f, vacancies: Number(e.target.value) }))} />
          </Field>
          <Field label="Budget (annual)">
            <input type="number" min={0} className={inputCls} value={posForm.budget} onChange={(e) => setPosForm((f) => ({ ...f, budget: Number(e.target.value) }))} />
          </Field>
        </div>
      </ModalSystem>

      {/* ── Delete confirm modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Remove ${deleteTarget?.kind || ''}`}
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Permanently remove <span className="font-bold">{deleteTarget?.label}</span>? This action cannot be undone.
        </p>
      </ModalSystem>
    </div>
  );
};

export default OrganizationManagement;
