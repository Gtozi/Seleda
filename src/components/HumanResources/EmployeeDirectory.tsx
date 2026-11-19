/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Employee Directory — HR > Employees module.
 *
 * DB-integrated via /api/hr-portal/employees/* routes. Replaces the
 * hardcoded placeholder employee list with live records from the
 * employees table (property-scoped).
 *
 * UI follows the F&B / Housekeeping portal pattern: StatCard KPIs,
 * PageHeader, SectionCard, Badge, ModalSystem, brandTheme.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Users,
  Search,
  Plus,
  Pencil,
  Trash2,
  Mail,
  Phone,
  ShieldCheck,
  Download,
  LayoutGrid,
  List,
  RefreshCw,
  Loader2,
  ServerCrash,
  UserCheck,
  CalendarDays,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, statusTone, type StatusTone } from '../FrontOffice/brandTheme';

// ── Types ────────────────────────────────────────────────────────────────
type ViewMode = 'grid' | 'list';

interface Employee {
  id: string;
  employee_number: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  status: string;
  hire_date: string | null;
  salary: number | null;
  gender: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  employment_type: string | null;
  avatar_initials: string | null;
  property_id: string | null;
}

interface Stats {
  totalEmployees: number;
  activeEmployees: number;
  onLeave: number;
  departments: number;
}

const STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success',
  'On Leave': 'info',
  Inactive: 'neutral',
  Terminated: 'danger',
};

const EMPLOYMENT_TONE: Record<string, StatusTone> = {
  'Full-time': 'accent',
  'Part-time': 'info',
  Contract: 'warning',
};

const DEPARTMENTS_FALLBACK = ['Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering'];

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

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// ── Component ────────────────────────────────────────────────────────────
const EmployeeDirectory = () => {
  const { currentPropertyId, addNotification } = useERP();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEmpType, setFilterEmpType] = useState('all');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<string[]>(DEPARTMENTS_FALLBACK);
  const [stats, setStats] = useState<Stats>({ totalEmployees: 0, activeEmployees: 0, onLeave: 0, departments: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [empModal, setEmpModal] = useState<{ mode: 'create' | 'edit'; emp: Employee | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [profileTarget, setProfileTarget] = useState<Employee | null>(null);

  const emptyForm = {
    name: '', employeeNumber: '', email: '', phone: '', department: '', position: '',
    status: 'Active', hireDate: '', salary: 0, gender: '', dateOfBirth: '',
    nationality: '', employmentType: 'Full-time',
  };
  const [form, setForm] = useState({ ...emptyForm });

  // ── Fetchers ──────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    if (!currentPropertyId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (filterDept !== 'all') params.set('department', filterDept);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterEmpType !== 'all') params.set('employmentType', filterEmpType);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/hr-portal/employees/${currentPropertyId}${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load employees (${res.status})`);
      const data = (await res.json()) as { employees: Employee[] };
      setEmployees(data.employees || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load employees');
      addNotification('Failed to load employees', 'warning', 'HR');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, search, filterDept, filterStatus, filterEmpType, addNotification]);

  const fetchStats = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/employees/statistics/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const fetchDepartments = useCallback(async () => {
    if (!currentPropertyId) return;
    try {
      const res = await fetch(`/api/hr-portal/employees/meta/departments/${currentPropertyId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { departments: string[] };
        if (data.departments && data.departments.length > 0) setDepartments(data.departments);
      }
    } catch { /* non-fatal */ }
  }, [currentPropertyId]);

  const refreshAll = useCallback(() => {
    fetchEmployees();
    fetchStats();
    fetchDepartments();
  }, [fetchEmployees, fetchStats, fetchDepartments]);

  useEffect(() => {
    if (currentPropertyId) {
      refreshAll();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPropertyId]);

  // Re-fetch when filters/search change (debounced via effect).
  useEffect(() => {
    if (!currentPropertyId) return;
    const t = setTimeout(() => fetchEmployees(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterDept, filterStatus, filterEmpType, currentPropertyId]);

  // ── CRUD ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({ ...emptyForm });
    setEmpModal({ mode: 'create', emp: null });
  };

  const openEdit = (emp: Employee) => {
    setForm({
      name: emp.name,
      employeeNumber: emp.employee_number || '',
      email: emp.email || '',
      phone: emp.phone || '',
      department: emp.department || '',
      position: emp.position || '',
      status: emp.status,
      hireDate: emp.hire_date || '',
      salary: Number(emp.salary) || 0,
      gender: emp.gender || '',
      dateOfBirth: emp.date_of_birth || '',
      nationality: emp.nationality || '',
      employmentType: emp.employment_type || 'Full-time',
    });
    setEmpModal({ mode: 'edit', emp });
  };

  const saveEmployee = async () => {
    if (!currentPropertyId || !form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        propertyId: currentPropertyId,
        name: form.name.trim(),
        employeeNumber: form.employeeNumber.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department: form.department.trim() || null,
        position: form.position.trim() || null,
        status: form.status,
        hireDate: form.hireDate || null,
        salary: form.salary,
        gender: form.gender || null,
        dateOfBirth: form.dateOfBirth || null,
        nationality: form.nationality.trim() || null,
        employmentType: form.employmentType,
      };
      const res = await fetch('/api/hr-portal/employees', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Employee added', 'success', 'HR');
      setEmpModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to add employee', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const updateEmployee = async () => {
    if (!empModal?.emp) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        employeeNumber: form.employeeNumber.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department: form.department.trim() || null,
        position: form.position.trim() || null,
        status: form.status,
        hireDate: form.hireDate || null,
        salary: form.salary,
        gender: form.gender || null,
        dateOfBirth: form.dateOfBirth || null,
        nationality: form.nationality.trim() || null,
        employmentType: form.employmentType,
      };
      const res = await fetch(`/api/hr-portal/employees/${empModal.emp.id}`, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Employee updated', 'success', 'HR');
      setEmpModal(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update employee', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-portal/employees/${deleteTarget.id}?hard=true`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      addNotification('Employee removed', 'success', 'HR');
      setDeleteTarget(null);
      refreshAll();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to remove employee', 'danger', 'HR');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (employees.length === 0) return;
    const headers = ['Employee #', 'Name', 'Email', 'Phone', 'Department', 'Position', 'Status', 'Hire Date', 'Employment Type', 'Nationality'];
    const rows = employees.map((e) => [
      e.employee_number || e.id,
      e.name,
      e.email || '',
      e.phone || '',
      e.department || '',
      e.position || '',
      e.status,
      e.hire_date || '',
      e.employment_type || '',
      e.nationality || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!currentPropertyId) {
    return (
      <div className={layout.sectionStack}>
        <PageHeader title="Employee Directory" subtitle="Manage your property's workforce" icon={Users} />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a property to view its employees.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={layout.sectionStack}>
      {/* Header */}
      <PageHeader
        title="Employee Directory"
        subtitle="Manage your property's workforce"
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} className={button.ghost} title="Refresh">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={exportCsv} className={button.secondary} title="Export CSV">
              <Download className="w-4 h-4" /> Export
            </button>
            <button onClick={openCreate} className={button.primary}>
              <Plus className="w-4 h-4" /> Add Employee
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className={layout.kpiGrid}>
        <StatCard title="Total Employees" value={stats.totalEmployees} icon={Users} tone="accent" />
        <StatCard title="Active" value={stats.activeEmployees} icon={UserCheck} tone="success" />
        <StatCard title="On Leave" value={stats.onLeave} icon={CalendarDays} tone="info" />
        <StatCard title="Departments" value={stats.departments} icon={Building2} tone="neutral" />
      </div>

      {/* Filters + view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search by name, position, dept..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs w-64 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />
          </div>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="On Leave">On Leave</option>
            <option value="Inactive">Inactive</option>
            <option value="Terminated">Terminated</option>
          </select>
          <select
            value={filterEmpType}
            onChange={(e) => setFilterEmpType(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Types</option>
            <option value="Full-time">Full-time</option>
            <option value="Part-time">Part-time</option>
            <option value="Contract">Contract</option>
          </select>
        </div>

        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg transition ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg transition ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400'}`}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
          <ServerCrash className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Grid view */}
      {viewMode === 'grid' && (
        loading ? (
          <SectionCard><LoadingRow /></SectionCard>
        ) : employees.length === 0 ? (
          <SectionCard>
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Users className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No employees found. Click "Add Employee" to create one.</p>
            </div>
          </SectionCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {employees.map((emp) => (
              <div
                key={emp.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm group hover:border-indigo-200 transition-all"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-100 dark:border-slate-800 text-xl font-semibold text-slate-400 ring-4 ring-slate-50/50 dark:ring-slate-800/30">
                    {emp.avatar_initials || initials(emp.name)}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(emp)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(emp)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase">{emp.department || 'Unassigned'}</span>
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5 leading-tight">{emp.name}</h4>
                  <p className="text-sm font-medium text-slate-500 mt-1">{emp.position || '—'}</p>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-50 dark:border-slate-800 space-y-4">
                  <div className="flex items-center gap-3 text-slate-500">
                    <Mail size={14} className="text-slate-400" />
                    <span className="text-xs font-medium truncate">{emp.email || '—'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-500">
                    <Phone size={14} className="text-slate-400" />
                    <span className="text-xs font-medium">{emp.phone || '—'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-500">
                    <ShieldCheck size={14} className="text-slate-400" />
                    <span className="text-xs font-medium uppercase text-indigo-600/70">{emp.id} • {emp.employee_number || '—'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <Badge tone={STATUS_TONE[emp.status] ?? 'neutral'}>{emp.status}</Badge>
                  {emp.employment_type && <Badge tone={EMPLOYMENT_TONE[emp.employment_type] ?? 'neutral'}>{emp.employment_type}</Badge>}
                </div>

                <button
                  onClick={() => setProfileTarget(emp)}
                  className="w-full mt-6 py-2.5 bg-slate-50 dark:bg-slate-950/40 rounded-lg text-xs font-medium uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-slate-950 transition-all"
                >
                  View Full Profile
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <SectionCard pad="none">
          {loading ? (
            <LoadingRow />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-950/20">
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase">Employee</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase">Position</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase">Department</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase">Hire Date</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase text-center">Status</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-400 uppercase text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-400">No employees found.</td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-xs font-semibold">
                              {emp.avatar_initials || initials(emp.name)}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-black text-slate-900 dark:text-white">{emp.name}</span>
                              <span className="text-[9px] font-bold text-slate-400">{emp.employee_number || emp.id}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-500">{emp.position || '—'}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 text-[9px] font-black uppercase tracking-tight">
                            {emp.department || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-400">{emp.hire_date || '—'}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center">
                            <Badge tone={STATUS_TONE[emp.status] ?? 'neutral'}>{emp.status}</Badge>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => openEdit(emp)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                              title="Edit"
                            >
                              <Pencil size={14} className="text-slate-400" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(emp)}
                              className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition"
                              title="Remove"
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

      {/* ── Create/Edit modal ───────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!empModal}
        onClose={() => setEmpModal(null)}
        onConfirm={empModal?.mode === 'create' ? saveEmployee : updateEmployee}
        title={empModal?.mode === 'create' ? 'Add Employee' : 'Edit Employee'}
        variant="form"
        size="lg"
        confirmLabel={saving ? 'Saving…' : 'Save'}
        confirmColor="indigo"
        loading={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Full Name">
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Sarah Johnson" />
            </Field>
          </div>
          <Field label="Employee Number">
            <input className={inputCls} value={form.employeeNumber} onChange={(e) => setForm((f) => ({ ...f, employeeNumber: e.target.value }))} placeholder="e.g. H-1024" />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Inactive">Inactive</option>
              <option value="Terminated">Terminated</option>
            </select>
          </Field>
          <Field label="Email">
            <input className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@hotel.com" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+1 555 0100" />
          </Field>
          <Field label="Department">
            <select className={inputCls} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Position">
            <input className={inputCls} value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder="e.g. Front Office Manager" />
          </Field>
          <Field label="Hire Date">
            <input type="date" className={inputCls} value={form.hireDate} onChange={(e) => setForm((f) => ({ ...f, hireDate: e.target.value }))} />
          </Field>
          <Field label="Salary (annual)">
            <input type="number" min={0} className={inputCls} value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: Number(e.target.value) }))} />
          </Field>
          <Field label="Gender">
            <select className={inputCls} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
              <option value="">— Select —</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Date of Birth">
            <input type="date" className={inputCls} value={form.dateOfBirth} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} />
          </Field>
          <Field label="Nationality">
            <input className={inputCls} value={form.nationality} onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))} placeholder="e.g. American" />
          </Field>
          <Field label="Employment Type">
            <select className={inputCls} value={form.employmentType} onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}>
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
            </select>
          </Field>
        </div>
      </ModalSystem>

      {/* ── Delete confirm modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Remove Employee"
        variant="confirm"
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        confirmColor="rose"
        loading={saving}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Permanently remove <span className="font-bold">{deleteTarget?.name}</span> ({deleteTarget?.employee_number || deleteTarget?.id})? This action cannot be undone.
        </p>
      </ModalSystem>

      {/* ── Profile detail modal ─────────────────────────────────────────── */}
      <ModalSystem
        isOpen={!!profileTarget}
        onClose={() => setProfileTarget(null)}
        title="Employee Profile"
        variant="info"
        size="lg"
        showFooter={false}
      >
        {profileTarget && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-xl font-semibold text-slate-500">
                {profileTarget.avatar_initials || initials(profileTarget.name)}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{profileTarget.name}</h3>
                <p className="text-sm text-slate-500">{profileTarget.position || '—'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone={STATUS_TONE[profileTarget.status] ?? 'neutral'}>{profileTarget.status}</Badge>
                  {profileTarget.employment_type && <Badge tone={EMPLOYMENT_TONE[profileTarget.employment_type] ?? 'neutral'}>{profileTarget.employment_type}</Badge>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Employee #</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.employee_number || profileTarget.id}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Department</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.department || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Email</p>
                <p className="text-slate-700 dark:text-slate-200 truncate">{profileTarget.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Phone</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.phone || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Hire Date</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.hire_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Salary</p>
                <p className="text-slate-700 dark:text-slate-200">${Number(profileTarget.salary || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Gender</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.gender || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Date of Birth</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.date_of_birth || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Nationality</p>
                <p className="text-slate-700 dark:text-slate-200">{profileTarget.nationality || '—'}</p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => { setProfileTarget(null); openEdit(profileTarget); }} className={`flex-1 ${button.primary}`}>
                <Pencil size={14} /> Edit
              </button>
              <button onClick={() => setProfileTarget(null)} className={`flex-1 ${button.secondary}`}>
                Close
              </button>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default EmployeeDirectory;
