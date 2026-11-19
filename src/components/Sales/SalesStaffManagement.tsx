import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useERP } from '../../context/ERPContext';
import {
  Users, IdCard, CalendarDays, GraduationCap, Gauge,
  Plus, Pencil, Trash2, Search, RefreshCw,
  Loader2, CalendarCheck, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { ModalSystem } from '../Shared/ModalSystem';
import { button, layout, type StatusTone } from '../FrontOffice/brandTheme';
import {
  fetchSalesStaff, createSalesStaff, updateSalesStaff, deleteSalesStaff,
  fetchSalesStaffEmployees,
  fetchSalesStaffAttendance, createSalesStaffAttendance, updateSalesStaffAttendance, deleteSalesStaffAttendance,
  fetchSalesStaffTraining, createSalesStaffTraining, updateSalesStaffTraining, deleteSalesStaffTraining,
  fetchSalesStaffProductivity, createSalesStaffProductivity, updateSalesStaffProductivity, deleteSalesStaffProductivity,
  fetchSalesStaffShiftReqs, updateSalesStaffShiftReq,
  fetchSalesStaffStaffingReqs, updateSalesStaffStaffingReq,
  type SalesStaff, type SalesStaffAttendance, type SalesStaffTraining, type SalesStaffProductivity,
  type SalesStaffShiftReq, type SalesStaffStaffingReq,
} from '../../services/salesService';

type SubTab = 'assignments' | 'attendance' | 'shifts' | 'staffing' | 'training' | 'productivity';
type Shift = 'Morning' | 'Evening' | 'Night';
type Role = 'Sales Manager' | 'Sales Executive' | 'Account Manager' | 'Business Development' | 'Sales Coordinator';

const ROLES: Role[] = ['Sales Manager', 'Sales Executive', 'Account Manager', 'Business Development', 'Sales Coordinator'];
const SHIFTS: Shift[] = ['Morning', 'Evening', 'Night'];
const TERRITORIES = ['Local Market', 'Corporate', 'Travel Agents', 'Government', 'Online', 'International'];
const STATUSES = ['Active Duty', 'Off Duty', 'On Leave', 'Training', 'Suspended'];
const ATTENDANCE_STATUSES = ['Present', 'Late', 'Absent', 'On Leave', 'Sick', 'Day Off'];
const TRAIN_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'];

const SUB_TABS: { id: SubTab; label: string; icon: any }[] = [
  { id: 'assignments', label: 'Staff Assignment', icon: IdCard },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'shifts', label: 'Shift Requirements', icon: CalendarDays },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'productivity', label: 'Productivity', icon: Gauge },
];

const ROLE_TONE: Record<string, StatusTone> = {
  'Sales Manager': 'success',
  'Sales Executive': 'accent',
  'Account Manager': 'info',
  'Business Development': 'warning',
  'Sales Coordinator': 'neutral',
};

const STATUS_TONE: Record<string, StatusTone> = {
  'Active Duty': 'success',
  'Off Duty': 'neutral',
  'On Leave': 'warning',
  'Training': 'info',
  'Suspended': 'danger',
};

const ATT_STATUS_TONE: Record<string, StatusTone> = {
  Present: 'success', Late: 'warning', Absent: 'danger', 'On Leave': 'info', Sick: 'neutral', 'Day Off': 'neutral',
};

const TRAIN_TONE: Record<string, StatusTone> = {
  'Not Started': 'info', 'In Progress': 'warning', Completed: 'success', Overdue: 'danger',
};

const fmt = (n: number) => (n ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0');
const fmt2 = (n: number) => Number(n).toFixed(2);

type ColumnAlign = 'left' | 'center' | 'right';

interface Column<T> {
  key: string;
  label: string;
  align?: ColumnAlign;
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number;
  render?: (row: T, index: number) => React.ReactNode;
}

function StaffDataTable<T extends Record<string, any>>({
  columns,
  data,
  filterable = false,
  filterPlaceholder = 'Search...',
  sortable = false,
  emptyMessage = 'No records found',
}: {
  columns: Column<T>[];
  data: T[];
  filterable?: boolean;
  filterPlaceholder?: string;
  sortable?: boolean;
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    if (!filterable || !filter.trim()) return data;
    const q = filter.toLowerCase();
    return data.filter(row =>
      columns.some(col => {
        const val = col.render ? undefined : row[col.key];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(q);
      })
    );
  }, [data, filter, filterable, columns]);

  const sorted = useMemo(() => {
    if (!sortable || !sortKey) return filtered;
    const col = columns.find(c => c.key === sortKey);
    if (!col) return filtered;
    const accessor = col.sortAccessor || ((row: T) => row[sortKey]);
    return [...filtered].sort((a, b) => {
      const aVal = accessor(a);
      const bVal = accessor(b);
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
  }, [filtered, sortKey, sortDir, sortable, columns]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const alignClass: Record<ColumnAlign, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

  return (
    <div>
      {filterable && (
        <div className="relative max-w-xs mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={filterPlaceholder}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:border-indigo-500"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
            <tr>
              {columns.map(col => {
                const isSortable = sortable && col.sortable !== false;
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => isSortable && handleSort(col.key)}
                    className={[`px-6 py-3 font-medium ${alignClass[col.align || 'left']}`, isSortable ? 'cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300' : ''].join(' ')}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isSortable && (
                        active ? (sortDir === 'asc' ? <ChevronUp size={12} className="text-indigo-500" /> : <ChevronDown size={12} className="text-indigo-500" />) : <ChevronsUpDown size={12} className="text-slate-300 dark:text-slate-600" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-6 py-8 text-center text-slate-400">{emptyMessage}</td></tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  {columns.map(col => (
                    <td key={col.key} className={`px-6 py-3 ${alignClass[col.align || 'left']} text-slate-600 dark:text-slate-400`}>
                      {col.render ? col.render(row, i) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SalesStaffManagement() {
  const { currentPropertyId, addNotification } = useERP();

  const [subTab, setSubTab] = useState<SubTab>('assignments');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [staff, setStaff] = useState<SalesStaff[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<SalesStaffAttendance[]>([]);
  const [training, setTraining] = useState<SalesStaffTraining[]>([]);
  const [productivity, setProductivity] = useState<SalesStaffProductivity[]>([]);
  const [shiftReqs, setShiftReqs] = useState<SalesStaffShiftReq[]>([]);
  const [staffingReqs, setStaffingReqs] = useState<SalesStaffStaffingReq[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState<SubTab | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Assignment form
  const [assignForm, setAssignForm] = useState({
    employeeId: '', name: '', email: '', phone: '', role: 'Sales Executive' as Role, shift: 'Morning' as Shift,
    territory: 'Local Market', status: 'Active Duty', workload: 0, salesTarget: 0, ytdRevenue: 0, linkMode: 'new' as 'new' | 'existing',
  });
  const [attForm, setAttForm] = useState({ staffId: '', attendanceDate: new Date().toISOString().split('T')[0], status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
  const [trainForm, setTrainForm] = useState({ staffId: '', course: '', dueDate: '', status: 'Not Started' });
  const [prodForm, setProdForm] = useState({ staffId: '', period: 'MTD', callsMade: 0, meetings: 0, dealsClosed: 0, revenue: 0 });
  const [countForm, setCountForm] = useState({ requiredCount: 0, assignedCount: 0 });

  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: `${s.name} · ${s.role}` })), [staff]);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, a, t, p, sr, st, e] = await Promise.all([
        fetchSalesStaff(),
        fetchSalesStaffAttendance(),
        fetchSalesStaffTraining(),
        fetchSalesStaffProductivity(),
        fetchSalesStaffShiftReqs(),
        fetchSalesStaffStaffingReqs(),
        currentPropertyId ? fetchSalesStaffEmployees(currentPropertyId).catch(() => []) : Promise.resolve([]),
      ]);
      setStaff(s);
      setAttendance(a);
      setTraining(t);
      setProductivity(p);
      setShiftReqs(sr);
      setStaffingReqs(st);
      setEmployees(e);
    } catch (e: any) {
      addNotification(e.message || 'Failed to load staff data', 'warning', 'Sales');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [addNotification, currentPropertyId]);

  useEffect(() => { setLoading(true); loadAll(); }, [loadAll]);

  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.status === 'Active Duty').length,
    onLeave: staff.filter(s => s.status === 'On Leave').length,
    revenue: staff.reduce((sum, s) => sum + Number(s.ytd_revenue || 0), 0),
    workload: staff.length ? staff.reduce((sum, s) => sum + Number(s.workload || 0), 0) / staff.length : 0,
  }), [staff]);

  const filteredStaff = staff;

  const openModal = (kind: SubTab, row?: any) => {
    setModalKind(kind);
    setEditing(row || null);
    if (kind === 'assignments') {
      setAssignForm(row ? {
        employeeId: row.employee_id || '', name: row.name, email: row.email || '', phone: row.phone || '', role: row.role as Role,
        shift: row.shift as Shift, territory: row.territory, status: row.status, workload: Number(row.workload || 0),
        salesTarget: Number(row.sales_target || 0), ytdRevenue: Number(row.ytd_revenue || 0), linkMode: row.employee_id ? 'existing' : 'new',
      } : { employeeId: '', name: '', email: '', phone: '', role: 'Sales Executive', shift: 'Morning', territory: 'Local Market', status: 'Active Duty', workload: 0, salesTarget: 0, ytdRevenue: 0, linkMode: 'new' });
    } else if (kind === 'attendance') {
      setAttForm(row ? {
        staffId: row.staff_id, attendanceDate: row.attendance_date, status: row.status, checkIn: row.check_in ? new Date(row.check_in).toISOString().slice(0, 16) : '',
        checkOut: row.check_out ? new Date(row.check_out).toISOString().slice(0, 16) : '', hoursWorked: Number(row.hours_worked || 0), overtimeHours: Number(row.overtime_hours || 0), notes: row.notes || '',
      } : { staffId: '', attendanceDate: new Date().toISOString().split('T')[0], status: 'Present', checkIn: '', checkOut: '', hoursWorked: 0, overtimeHours: 0, notes: '' });
    } else if (kind === 'training') {
      setTrainForm(row ? { staffId: row.staff_id, course: row.course, dueDate: row.due_date || '', status: row.status } : { staffId: '', course: '', dueDate: '', status: 'Not Started' });
    } else if (kind === 'productivity') {
      setProdForm(row ? { staffId: row.staff_id, period: row.period, callsMade: row.calls_made, meetings: row.meetings, dealsClosed: row.deals_closed, revenue: Number(row.revenue || 0) } : { staffId: '', period: 'MTD', callsMade: 0, meetings: 0, dealsClosed: 0, revenue: 0 });
    } else if (kind === 'shifts' || kind === 'staffing') {
      setCountForm(row ? { requiredCount: row.required_count, assignedCount: row.assigned_count } : { requiredCount: 0, assignedCount: 0 });
    }
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setModalKind(null); setEditing(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (modalKind === 'assignments') {
        const payload = {
          employeeId: assignForm.linkMode === 'existing' ? assignForm.employeeId : null,
          name: assignForm.name, email: assignForm.email || null, phone: assignForm.phone || null,
          role: assignForm.role, shift: assignForm.shift, territory: assignForm.territory,
          status: assignForm.status, workload: assignForm.workload, salesTarget: assignForm.salesTarget,
          ytdRevenue: assignForm.ytdRevenue, propertyId: currentPropertyId,
        };
        if (editing) await updateSalesStaff(editing.id, payload);
        else await createSalesStaff(payload);
        addNotification(`Staff ${editing ? 'updated' : 'added'}`, 'success', 'Sales');
      } else if (modalKind === 'attendance') {
        const payload = { staffId: attForm.staffId, attendanceDate: attForm.attendanceDate, status: attForm.status, checkIn: attForm.checkIn || null, checkOut: attForm.checkOut || null, hoursWorked: attForm.hoursWorked, overtimeHours: attForm.overtimeHours, notes: attForm.notes || null };
        if (editing) await updateSalesStaffAttendance(editing.id, payload);
        else await createSalesStaffAttendance(payload);
        addNotification('Attendance saved', 'success', 'Sales');
      } else if (modalKind === 'training') {
        const payload = { staffId: trainForm.staffId, course: trainForm.course, dueDate: trainForm.dueDate || null, status: trainForm.status };
        if (editing) await updateSalesStaffTraining(editing.id, payload);
        else await createSalesStaffTraining(payload);
        addNotification('Training record saved', 'success', 'Sales');
      } else if (modalKind === 'productivity') {
        const payload = { staffId: prodForm.staffId, period: prodForm.period, callsMade: prodForm.callsMade, meetings: prodForm.meetings, dealsClosed: prodForm.dealsClosed, revenue: prodForm.revenue };
        if (editing) await updateSalesStaffProductivity(editing.id, payload);
        else await createSalesStaffProductivity(payload);
        addNotification('Productivity record saved', 'success', 'Sales');
      } else if (modalKind === 'shifts') {
        await updateSalesStaffShiftReq(editing.id, { requiredCount: countForm.requiredCount, assignedCount: countForm.assignedCount });
        addNotification('Shift requirement updated', 'success', 'Sales');
      } else if (modalKind === 'staffing') {
        await updateSalesStaffStaffingReq(editing.id, { requiredCount: countForm.requiredCount, assignedCount: countForm.assignedCount });
        addNotification('Staffing requirement updated', 'success', 'Sales');
      }
      closeModal();
      loadAll();
    } catch (e: any) {
      addNotification(e.message || 'Save failed', 'warning', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kind: SubTab, id: string, label?: string) => {
    if (!confirm(`Delete ${label || 'record'}?`)) return;
    try {
      if (kind === 'assignments') await deleteSalesStaff(id);
      else if (kind === 'attendance') await deleteSalesStaffAttendance(id);
      else if (kind === 'training') await deleteSalesStaffTraining(id);
      else if (kind === 'productivity') await deleteSalesStaffProductivity(id);
      addNotification('Deleted', 'info', 'Sales');
      loadAll();
    } catch (e: any) { addNotification(e.message || 'Delete failed', 'warning', 'Sales'); }
  };

  const onSelectEmployee = (empId: string) => {
    const emp = employees.find(e => e.id === empId);
    if (emp) setAssignForm(prev => ({ ...prev, employeeId: empId, name: emp.name, email: emp.email || '', phone: emp.phone || '' }));
  };

  const actionButtons = (kind: SubTab, row: any, label?: string) => (
    <div className="flex gap-2 justify-end">
      <button onClick={() => openModal(kind, row)} className={button.ghost}><Pencil className="w-4 h-4" /></button>
      <button onClick={() => handleDelete(kind, row.id, label)} className={button.ghost}><Trash2 className="w-4 h-4 text-rose-600" /></button>
    </div>
  );

  const staffColumns: Column<SalesStaff>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'role', label: 'Role', render: s => <Badge tone={ROLE_TONE[s.role] || 'accent'}>{s.role}</Badge> },
    { key: 'shift', label: 'Shift' },
    { key: 'territory', label: 'Territory' },
    { key: 'status', label: 'Status', render: s => <Badge tone={STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge> },
    { key: 'workload', label: 'Workload %', align: 'right', render: s => `${s.workload}%` },
    { key: 'sales_target', label: 'Target', align: 'right', render: s => `$${fmt(Number(s.sales_target))}` },
    { key: 'ytd_revenue', label: 'YTD Revenue', align: 'right', render: s => `$${fmt(Number(s.ytd_revenue))}` },
    { key: 'actions', label: '', align: 'right', render: s => actionButtons('assignments', s, s.name) },
  ];

  const attColumns: Column<SalesStaffAttendance>[] = [
    { key: 'staff', label: 'Staff', render: a => a.sales_staff ? `${a.sales_staff.name} · ${a.sales_staff.role}` : a.staff_id },
    { key: 'attendance_date', label: 'Date' },
    { key: 'status', label: 'Status', render: a => <Badge tone={ATT_STATUS_TONE[a.status] || 'neutral'}>{a.status}</Badge> },
    { key: 'check_in', label: 'Check In', render: a => a.check_in ? new Date(a.check_in).toLocaleString() : '—' },
    { key: 'check_out', label: 'Check Out', render: a => a.check_out ? new Date(a.check_out).toLocaleString() : '—' },
    { key: 'hours_worked', label: 'Hours', align: 'right' },
    { key: 'overtime_hours', label: 'OT', align: 'right' },
    { key: 'actions', label: '', align: 'right', render: a => actionButtons('attendance', a) },
  ];

  const trainColumns: Column<SalesStaffTraining>[] = [
    { key: 'staff', label: 'Staff', render: t => t.sales_staff ? `${t.sales_staff.name} · ${t.sales_staff.role}` : t.staff_id },
    { key: 'course', label: 'Course' },
    { key: 'due_date', label: 'Due Date', render: t => t.due_date || '—' },
    { key: 'status', label: 'Status', render: t => <Badge tone={TRAIN_TONE[t.status] || 'neutral'}>{t.status}</Badge> },
    { key: 'actions', label: '', align: 'right', render: t => actionButtons('training', t) },
  ];

  const prodColumns: Column<SalesStaffProductivity>[] = [
    { key: 'staff', label: 'Staff', render: p => p.sales_staff ? `${p.sales_staff.name} · ${p.sales_staff.role}` : p.staff_id },
    { key: 'period', label: 'Period' },
    { key: 'calls_made', label: 'Calls', align: 'right' },
    { key: 'meetings', label: 'Meetings', align: 'right' },
    { key: 'deals_closed', label: 'Deals', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right', render: p => `$${fmt(Number(p.revenue))}` },
    { key: 'actions', label: '', align: 'right', render: p => actionButtons('productivity', p) },
  ];

  const shiftColumns: Column<SalesStaffShiftReq>[] = [
    { key: 'role', label: 'Role' },
    { key: 'shift', label: 'Shift' },
    { key: 'required_count', label: 'Required', align: 'right' },
    { key: 'assigned_count', label: 'Assigned', align: 'right' },
    { key: 'gap', label: 'Gap', align: 'right', render: r => <span className={r.assigned_count >= r.required_count ? 'text-emerald-600' : 'text-rose-600'}>{r.assigned_count - r.required_count}</span> },
    { key: 'actions', label: '', align: 'right', render: r => <button onClick={() => openModal('shifts', r)} className={button.ghost}><Pencil className="w-4 h-4" /></button> },
  ];

  const staffingColumns: Column<SalesStaffStaffingReq>[] = [
    { key: 'territory', label: 'Territory' },
    { key: 'role', label: 'Role' },
    { key: 'required_count', label: 'Required', align: 'right' },
    { key: 'assigned_count', label: 'Assigned', align: 'right' },
    { key: 'gap', label: 'Gap', align: 'right', render: r => <span className={r.assigned_count >= r.required_count ? 'text-emerald-600' : 'text-rose-600'}>{r.assigned_count - r.required_count}</span> },
    { key: 'actions', label: '', align: 'right', render: r => <button onClick={() => openModal('staffing', r)} className={button.ghost}><Pencil className="w-4 h-4" /></button> },
  ];

  const renderTab = () => {
    if (loading) return <div className="px-6 py-10 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…</div>;
    switch (subTab) {
      case 'assignments': return (
        <SectionCard title="Sales Staff Assignments" subtitle={`${filteredStaff.length} staff member(s)`} icon={IdCard} tone="accent" actions={<button onClick={() => openModal('assignments')} className={button.primary}><Plus className="w-4 h-4" /> Add Staff</button>}>
          <StaffDataTable columns={staffColumns} data={filteredStaff} sortable filterable filterPlaceholder="Search staff..." />
        </SectionCard>
      );
      case 'attendance': return (
        <SectionCard title="Attendance" subtitle={`${attendance.length} record(s)`} icon={CalendarCheck} tone="info" actions={<button onClick={() => openModal('attendance')} className={button.primary}><Plus className="w-4 h-4" /> Check In</button>}>
          <StaffDataTable columns={attColumns} data={attendance} sortable />
        </SectionCard>
      );
      case 'shifts': return (
        <SectionCard title="Shift Requirements" icon={CalendarDays} tone="warning">
          <StaffDataTable columns={shiftColumns} data={shiftReqs} sortable />
        </SectionCard>
      );
      case 'staffing': return (
        <SectionCard title="Staffing Requirements" icon={Users} tone="accent">
          <StaffDataTable columns={staffingColumns} data={staffingReqs} sortable />
        </SectionCard>
      );
      case 'training': return (
        <SectionCard title="Training" subtitle={`${training.length} course(s)`} icon={GraduationCap} tone="info" actions={<button onClick={() => openModal('training')} className={button.primary}><Plus className="w-4 h-4" /> Add Course</button>}>
          <StaffDataTable columns={trainColumns} data={training} sortable />
        </SectionCard>
      );
      case 'productivity': return (
        <SectionCard title="Productivity" subtitle={`${productivity.length} record(s)`} icon={Gauge} tone="success" actions={<button onClick={() => openModal('productivity')} className={button.primary}><Plus className="w-4 h-4" /> Add Record</button>}>
          <StaffDataTable columns={prodColumns} data={productivity} sortable />
        </SectionCard>
      );
      default: return null;
    }
  };

  const renderModal = () => {
    if (!modalOpen || !modalKind) return null;
    const isEdit = !!editing;
    const inputCls = 'w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-1 focus:ring-indigo-500';
    const labelCls = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5';
    const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
      <label className="block"><span className={labelCls}>{label}</span>{children}</label>
    );

    if (modalKind === 'assignments') return (
      <div className="space-y-4">
        <Field label="Link to HR Employee">
          <select value={assignForm.employeeId} onChange={e => { onSelectEmployee(e.target.value); setAssignForm(prev => ({ ...prev, linkMode: e.target.value ? 'existing' : 'new' })); }} className={inputCls}>
            <option value="">New / Manual</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.department} · {e.position}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input value={assignForm.name} onChange={e => setAssignForm({ ...assignForm, name: e.target.value, linkMode: 'new' })} className={inputCls} /></Field>
          <Field label="Email"><input value={assignForm.email} onChange={e => setAssignForm({ ...assignForm, email: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Phone"><input value={assignForm.phone} onChange={e => setAssignForm({ ...assignForm, phone: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role"><select value={assignForm.role} onChange={e => setAssignForm({ ...assignForm, role: e.target.value as Role })} className={inputCls}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
          <Field label="Shift"><select value={assignForm.shift} onChange={e => setAssignForm({ ...assignForm, shift: e.target.value as Shift })} className={inputCls}>{SHIFTS.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Territory"><select value={assignForm.territory} onChange={e => setAssignForm({ ...assignForm, territory: e.target.value })} className={inputCls}>{TERRITORIES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
          <Field label="Status"><select value={assignForm.status} onChange={e => setAssignForm({ ...assignForm, status: e.target.value })} className={inputCls}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Workload %"><input type="number" value={assignForm.workload} onChange={e => setAssignForm({ ...assignForm, workload: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Sales Target"><input type="number" value={assignForm.salesTarget} onChange={e => setAssignForm({ ...assignForm, salesTarget: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="YTD Revenue"><input type="number" value={assignForm.ytdRevenue} onChange={e => setAssignForm({ ...assignForm, ytdRevenue: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
      </div>
    );

    if (modalKind === 'attendance') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={attForm.staffId} onChange={e => setAttForm({ ...attForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={attForm.attendanceDate} onChange={e => setAttForm({ ...attForm, attendanceDate: e.target.value })} className={inputCls} /></Field>
        <Field label="Status"><select value={attForm.status} onChange={e => setAttForm({ ...attForm, status: e.target.value })} className={inputCls}>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Check In"><input type="datetime-local" value={attForm.checkIn} onChange={e => setAttForm({ ...attForm, checkIn: e.target.value })} className={inputCls} /></Field>
          <Field label="Check Out"><input type="datetime-local" value={attForm.checkOut} onChange={e => setAttForm({ ...attForm, checkOut: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hours Worked"><input type="number" value={attForm.hoursWorked} onChange={e => setAttForm({ ...attForm, hoursWorked: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Overtime Hours"><input type="number" value={attForm.overtimeHours} onChange={e => setAttForm({ ...attForm, overtimeHours: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
        <Field label="Notes"><input value={attForm.notes} onChange={e => setAttForm({ ...attForm, notes: e.target.value })} className={inputCls} /></Field>
      </div>
    );

    if (modalKind === 'training') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={trainForm.staffId} onChange={e => setTrainForm({ ...trainForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Course"><input value={trainForm.course} onChange={e => setTrainForm({ ...trainForm, course: e.target.value })} className={inputCls} /></Field>
        <Field label="Due Date"><input type="date" value={trainForm.dueDate} onChange={e => setTrainForm({ ...trainForm, dueDate: e.target.value })} className={inputCls} /></Field>
        <Field label="Status"><select value={trainForm.status} onChange={e => setTrainForm({ ...trainForm, status: e.target.value })} className={inputCls}>{TRAIN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
      </div>
    );

    if (modalKind === 'productivity') return (
      <div className="space-y-4">
        <Field label="Staff"><select value={prodForm.staffId} onChange={e => setProdForm({ ...prodForm, staffId: e.target.value })} className={inputCls}><option value="">Select staff</option>{staffOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Period"><input value={prodForm.period} onChange={e => setProdForm({ ...prodForm, period: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Calls Made"><input type="number" value={prodForm.callsMade} onChange={e => setProdForm({ ...prodForm, callsMade: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Meetings"><input type="number" value={prodForm.meetings} onChange={e => setProdForm({ ...prodForm, meetings: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Deals Closed"><input type="number" value={prodForm.dealsClosed} onChange={e => setProdForm({ ...prodForm, dealsClosed: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Revenue"><input type="number" value={prodForm.revenue} onChange={e => setProdForm({ ...prodForm, revenue: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
      </div>
    );

    if (modalKind === 'shifts' || modalKind === 'staffing') return (
      <div className="space-y-4">
        <Field label="Required Count"><input type="number" value={countForm.requiredCount} onChange={e => setCountForm({ ...countForm, requiredCount: Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="Assigned Count"><input type="number" value={countForm.assignedCount} onChange={e => setCountForm({ ...countForm, assignedCount: Number(e.target.value) })} className={inputCls} /></Field>
      </div>
    );
    return null;
  };

  return (
    <div className={['accent-sales', layout.sectionStack].join(' ')}>
      <PageHeader
        title="Sales Staff Management"
        subtitle="Manage sales team assignments, attendance, shifts, staffing, training and productivity — linked to HR."
        icon={Users}
        actions={
          <button onClick={loadAll} disabled={refreshing} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw className={refreshing ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} /> Refresh
          </button>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Total Staff" value={stats.total} icon={Users} tone="accent" />
        <StatCard title="Active Duty" value={stats.active} icon={IdCard} tone="success" />
        <StatCard title="On Leave" value={stats.onLeave} icon={CalendarDays} tone="warning" />
        <StatCard title="YTD Revenue" value={`$${fmt(stats.revenue)}`} icon={Gauge} tone="info" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition',
                active ? 'bg-[var(--color-accent-operations)] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {renderTab()}

      <ModalSystem
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit' : 'Add'}
        subtitle={modalKind ? `${modalKind.charAt(0).toUpperCase() + modalKind.slice(1)} record` : ''}
        variant="form"
        loading={saving}
        showFooter
        cancelLabel="Cancel"
        confirmLabel={editing ? 'Save Changes' : 'Create'}
        onConfirm={handleSave}
      >
        {renderModal()}
      </ModalSystem>
    </div>
  );
}
