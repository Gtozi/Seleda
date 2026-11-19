/**
 * Physical Resources — /erp/inventory/equipment-tools, linen, uniforms, returnables, loanables
 *
 * DB-backed:
 *   - Tools & Equipment (uinv_tools, uinv_tool_assignments, uinv_tool_calibrations)
 *   - Linen Management (uinv_linen, uinv_linen_movements)
 *   - Uniforms (uinv_uniforms, uinv_uniform_assignments)
 *   - Returnables (uinv_returnables, uinv_returnable_movements)
 *   - Loanables (uinv_loanable_items, uinv_loan_transactions)
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Wrench, Shirt, Repeat, PackageOpen, HardHat, Plus, Search, Clock, Loader2, ServerCrash,
  MoreVertical, RotateCcw, AlertTriangle, Tag,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchTools, createTool, updateTool, deleteTool, type UinvTool,
  fetchToolAssignments, createToolAssignment, updateToolAssignment, deleteToolAssignment, type UinvToolAssignment,
  fetchToolCalibrations, createToolCalibration, deleteToolCalibration, type UinvToolCalibration,
  fetchLinen, createLinen, updateLinen, deleteLinen, type UinvLinenItem,
  fetchLinenMovements, createLinenMovement, type UinvLinenMovement,
  fetchUniforms, createUniform, updateUniform, deleteUniform, type UinvUniformItem,
  fetchUniformAssignments, createUniformAssignment, updateUniformAssignment, deleteUniformAssignment, type UinvUniformAssignment,
  fetchReturnables, createReturnable, updateReturnable, deleteReturnable, type UinvReturnableItem,
  fetchReturnableMovements, createReturnableMovement, type UinvReturnableMovement,
  fetchLoanableItems, createLoanableItem, updateLoanableItem, deleteLoanableItem, type UinvLoanableItem,
  fetchLoanTransactions, createLoanTransaction, updateLoanTransaction, deleteLoanTransaction, type UinvLoanTransaction,
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
  { id: 'equipment-tools', label: 'Tools & Equipment', icon: Wrench },
  { id: 'linen', label: 'Linen', icon: PackageOpen },
  { id: 'uniforms', label: 'Uniforms', icon: Shirt },
  { id: 'returnables', label: 'Returnables', icon: Repeat },
  { id: 'loanables', label: 'Loanables', icon: HardHat },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const tabIconTone: Record<SubTab, string> = {
  'equipment-tools': 'text-blue-600',
  linen: 'text-teal-600',
  uniforms: 'text-amber-600',
  returnables: 'text-indigo-600',
  loanables: 'text-rose-600',
};

function statusToneFor(status: string): Tone {
  if (['In Stock', 'Available', 'Active', 'Good', 'New', 'Excellent', 'Pass', 'Issued'].includes(status)) return 'success';
  if (['Pending', 'In Calibration', 'Laundry Out', 'Fair', 'Adjusted', 'Received'].includes(status)) return 'warning';
  if (['Out of Service', 'Damaged', 'Poor', 'Fail', 'Lost', 'Overdue', 'Retired', 'Rejected'].includes(status)) return 'danger';
  if (['Returned', 'Replaced'].includes(status)) return 'info';
  return 'neutral';
}

function toolAssignmentAction(current: UinvToolAssignment) {
  const actions: { label: string; status: UinvToolAssignment['status'] }[] = [
    { label: 'Return', status: 'Returned' },
    { label: 'Mark Overdue', status: 'Overdue' },
    { label: 'Mark Lost', status: 'Lost' },
  ];
  return actions.filter(a => a.status !== current.status);
}

function uniformAssignmentAction(current: UinvUniformAssignment) {
  const actions: { label: string; status: UinvUniformAssignment['status'] }[] = [
    { label: 'Return', status: 'Returned' },
    { label: 'Replace', status: 'Replaced' },
    { label: 'Retire', status: 'Retired' },
  ];
  return actions.filter(a => a.status !== current.status);
}

function loanTransactionAction(current: UinvLoanTransaction) {
  const actions: { label: string; status: UinvLoanTransaction['status'] }[] = [
    { label: 'Return', status: 'Returned' },
    { label: 'Mark Overdue', status: 'Overdue' },
    { label: 'Mark Lost', status: 'Lost' },
  ];
  return actions.filter(a => a.status !== current.status);
}

const empty = (o: any) => Object.keys(o).filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '').length === 0;

const PhysicalResourcesModule: React.FC<{ initialTab?: SubTab; subTabBar?: React.ReactNode }> = ({ initialTab = 'equipment-tools', subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [sub, setSub] = useState<SubTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tools, setTools] = useState<UinvTool[]>([]);
  const [toolAssignments, setToolAssignments] = useState<UinvToolAssignment[]>([]);
  const [toolCalibrations, setToolCalibrations] = useState<UinvToolCalibration[]>([]);
  const [linen, setLinen] = useState<UinvLinenItem[]>([]);
  const [linenMovements, setLinenMovements] = useState<UinvLinenMovement[]>([]);
  const [uniforms, setUniforms] = useState<UinvUniformItem[]>([]);
  const [uniformAssignments, setUniformAssignments] = useState<UinvUniformAssignment[]>([]);
  const [returnables, setReturnables] = useState<UinvReturnableItem[]>([]);
  const [returnableMovements, setReturnableMovements] = useState<UinvReturnableMovement[]>([]);
  const [loanables, setLoanables] = useState<UinvLoanableItem[]>([]);
  const [loans, setLoans] = useState<UinvLoanTransaction[]>([]);

  // Forms
  const [showToolForm, setShowToolForm] = useState(false);
  const [toolForm, setToolForm] = useState<Partial<UinvTool>>({});
  const [showToolAssignForm, setShowToolAssignForm] = useState(false);
  const [toolAssignForm, setToolAssignForm] = useState<Partial<UinvToolAssignment>>({});
  const [showToolCalibForm, setShowToolCalibForm] = useState(false);
  const [toolCalibForm, setToolCalibForm] = useState<Partial<UinvToolCalibration>>({});
  const [showLinenForm, setShowLinenForm] = useState(false);
  const [linenForm, setLinenForm] = useState<Partial<UinvLinenItem>>({});
  const [showLinenMoveForm, setShowLinenMoveForm] = useState(false);
  const [linenMoveForm, setLinenMoveForm] = useState<Partial<UinvLinenMovement>>({});
  const [showUniformForm, setShowUniformForm] = useState(false);
  const [uniformForm, setUniformForm] = useState<Partial<UinvUniformItem>>({});
  const [showUniformAssignForm, setShowUniformAssignForm] = useState(false);
  const [uniformAssignForm, setUniformAssignForm] = useState<Partial<UinvUniformAssignment>>({});
  const [showReturnableForm, setShowReturnableForm] = useState(false);
  const [returnableForm, setReturnableForm] = useState<Partial<UinvReturnableItem>>({});
  const [showReturnableMoveForm, setShowReturnableMoveForm] = useState(false);
  const [returnableMoveForm, setReturnableMoveForm] = useState<Partial<UinvReturnableMovement>>({});
  const [showLoanableForm, setShowLoanableForm] = useState(false);
  const [loanableForm, setLoanableForm] = useState<Partial<UinvLoanableItem>>({});
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanForm, setLoanForm] = useState<Partial<UinvLoanTransaction>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propertyId = currentPropertyId || undefined;
      const [t, ta, tc, l, lm, u, ua, r, rm, lo, ls] = await Promise.all([
        fetchTools({ propertyId }),
        fetchToolAssignments({ propertyId }),
        fetchToolCalibrations({}),
        fetchLinen({ propertyId }),
        fetchLinenMovements({}),
        fetchUniforms({ propertyId }),
        fetchUniformAssignments({ propertyId }),
        fetchReturnables({ propertyId }),
        fetchReturnableMovements({}),
        fetchLoanableItems({ propertyId }),
        fetchLoanTransactions({ propertyId }),
      ]);
      setTools(t);
      setToolAssignments(ta);
      setToolCalibrations(tc);
      setLinen(l);
      setLinenMovements(lm);
      setUniforms(u);
      setUniformAssignments(ua);
      setReturnables(r);
      setReturnableMovements(rm);
      setLoanables(lo);
      setLoans(ls);
    } catch (e: any) {
      setError(e?.message || 'Failed to load physical resources');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const toolName = (id?: string | null) => tools.find(t => t.id === id)?.tool_name || id || '—';
  const linenName = (id?: string | null) => linen.find(i => i.id === id)?.item_name || id || '—';
  const uniformName = (id?: string | null) => uniforms.find(i => i.id === id)?.item_name || id || '—';
  const returnableName = (id?: string | null) => returnables.find(i => i.id === id)?.item_name || id || '—';
  const loanableName = (id?: string | null) => loanables.find(i => i.id === id)?.item_name || id || '—';

  const matchSearch = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());

  const kpis = useMemo(() => ({
    toolsOut: toolAssignments.filter(a => a.status === 'Active').length,
    calibrationDue: tools.filter(t => t.calibration_required && t.next_calibration_date && new Date(t.next_calibration_date) <= new Date()).length,
    linenParShort: linen.filter(i => i.store_quantity + i.department_quantity < i.par_level).length,
    uniformShort: uniforms.filter(i => i.stock_quantity < i.par_level).length,
    returnablesOut: returnables.reduce((a, r) => a + (r.quantity_out || 0), 0),
    loansActive: loans.filter(l => l.status === 'Active' || l.status === 'Overdue').length,
  }), [toolAssignments, tools, linen, uniforms, returnables, loans]);

  const actionBtn = (label: string, onClick: () => void, color = '') => (
    <button onClick={onClick} className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 ${color}`}>{label}</button>
  );

  const menu = (id: string, children: ReactNode) => (
    <div className="relative">
      <IconButton title="Actions" onClick={() => setMenuOpen(menuOpen === id ? null : id)}><MoreVertical className="w-4 h-4" /></IconButton>
      {menuOpen === id && (
        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1" onMouseLeave={() => setMenuOpen(null)}>
          {children}
        </div>
      )}
    </div>
  );

  // ── Tools ──
  const openToolForm = () => { setToolForm({ property_id: currentPropertyId, calibration_required: false, criticality: 'Normal', condition: 'New', status: 'In Stock' }); setShowToolForm(true); };
  const submitTool = async () => {
    if (!toolForm.tool_name) return addNotification('Tool name is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createTool({ ...toolForm, property_id: currentPropertyId }); addNotification('Tool created.', 'success', 'Inventory'); setShowToolForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create tool', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeTool = async (id: string) => { setActingOn(id); try { await deleteTool(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openToolAssign = () => { setToolAssignForm({ property_id: currentPropertyId, issue_date: new Date().toISOString().slice(0, 10), condition_at_issue: 'Good', status: 'Active' }); setShowToolAssignForm(true); };
  const submitToolAssign = async () => {
    if (!toolAssignForm.tool_id || !toolAssignForm.employee) return addNotification('Tool and employee are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createToolAssignment({ ...toolAssignForm, property_id: currentPropertyId }); addNotification('Assignment created.', 'success', 'Inventory'); setShowToolAssignForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to assign tool', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const updateToolAssignStatus = async (a: UinvToolAssignment, status: UinvToolAssignment['status']) => {
    setActingOn(a.id);
    try {
      await updateToolAssignment(a.id, { status, return_date: status === 'Returned' ? new Date().toISOString() : undefined });
      addNotification(`Assignment → ${status}`, 'success', 'Inventory');
      load();
    } catch (e: any) { addNotification(e?.message || 'Update failed', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  const openToolCalib = () => { setToolCalibForm({ property_id: currentPropertyId, calibration_date: new Date().toISOString().slice(0, 10), result: 'Pass' }); setShowToolCalibForm(true); };
  const submitToolCalib = async () => {
    if (!toolCalibForm.tool_id) return addNotification('Tool is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createToolCalibration({ ...toolCalibForm, property_id: currentPropertyId }); addNotification('Calibration recorded.', 'success', 'Inventory'); setShowToolCalibForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to record calibration', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeToolCalib = async (id: string) => { setActingOn(id); try { await deleteToolCalibration(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  // ── Linen ──
  const openLinenForm = () => { setLinenForm({ property_id: currentPropertyId, category: 'Towels', is_active: true, par_level: 10, unit_cost: 0, store_quantity: 0, department_quantity: 0, laundry_quantity: 0, clean_quantity: 0, dirty_quantity: 0, damaged_quantity: 0, lost_quantity: 0, retired_quantity: 0 }); setShowLinenForm(true); };
  const submitLinen = async () => {
    if (!linenForm.item_name) return addNotification('Item name is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createLinen({ ...linenForm, property_id: currentPropertyId }); addNotification('Linen item created.', 'success', 'Inventory'); setShowLinenForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create linen', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeLinen = async (id: string) => { setActingOn(id); try { await deleteLinen(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openLinenMove = () => { setLinenMoveForm({ property_id: currentPropertyId, movement_date: new Date().toISOString().slice(0, 10), movement_type: 'Issue', quantity: 0 }); setShowLinenMoveForm(true); };
  const submitLinenMove = async () => {
    if (!linenMoveForm.linen_id || !linenMoveForm.quantity) return addNotification('Linen and quantity are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createLinenMovement({ ...linenMoveForm, property_id: currentPropertyId }); addNotification('Linen movement recorded.', 'success', 'Inventory'); setShowLinenMoveForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to record movement', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Uniforms ──
  const openUniformForm = () => { setUniformForm({ property_id: currentPropertyId, is_active: true, par_level: 10, unit_cost: 0, stock_quantity: 0, issued_quantity: 0 }); setShowUniformForm(true); };
  const submitUniform = async () => {
    if (!uniformForm.item_name) return addNotification('Item name is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createUniform({ ...uniformForm, property_id: currentPropertyId }); addNotification('Uniform item created.', 'success', 'Inventory'); setShowUniformForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create uniform', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeUniform = async (id: string) => { setActingOn(id); try { await deleteUniform(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openUniformAssign = () => { setUniformAssignForm({ property_id: currentPropertyId, issue_date: new Date().toISOString().slice(0, 10), condition: 'New', status: 'Issued', quantity: 1 }); setShowUniformAssignForm(true); };
  const submitUniformAssign = async () => {
    if (!uniformAssignForm.uniform_id || !uniformAssignForm.employee) return addNotification('Uniform and employee are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createUniformAssignment({ ...uniformAssignForm, property_id: currentPropertyId }); addNotification('Uniform assigned.', 'success', 'Inventory'); setShowUniformAssignForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to assign uniform', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const updateUniformStatus = async (a: UinvUniformAssignment, status: UinvUniformAssignment['status']) => {
    setActingOn(a.id);
    try { await updateUniformAssignment(a.id, { status, return_date: status === 'Returned' ? new Date().toISOString() : undefined }); addNotification(`Uniform → ${status}`, 'success', 'Inventory'); load(); }
    catch (e: any) { addNotification(e?.message || 'Update failed', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  // ── Returnables ──
  const openReturnableForm = () => { setReturnableForm({ property_id: currentPropertyId, owner: 'Hotel', type: 'Crate', is_active: true, quantity_on_hand: 0, quantity_out: 0, unit_cost: 0 }); setShowReturnableForm(true); };
  const submitReturnable = async () => {
    if (!returnableForm.item_name) return addNotification('Item name is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createReturnable({ ...returnableForm, property_id: currentPropertyId }); addNotification('Returnable created.', 'success', 'Inventory'); setShowReturnableForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create returnable', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeReturnable = async (id: string) => { setActingOn(id); try { await deleteReturnable(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openReturnableMove = () => { setReturnableMoveForm({ property_id: currentPropertyId, movement_date: new Date().toISOString().slice(0, 10), movement_type: 'Issue to Supplier', quantity: 0 }); setShowReturnableMoveForm(true); };
  const submitReturnableMove = async () => {
    if (!returnableMoveForm.returnable_id || !returnableMoveForm.quantity) return addNotification('Returnable and quantity are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createReturnableMovement({ ...returnableMoveForm, property_id: currentPropertyId }); addNotification('Movement recorded.', 'success', 'Inventory'); setShowReturnableMoveForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to record movement', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };

  // ── Loanables ──
  const openLoanableForm = () => { setLoanableForm({ property_id: currentPropertyId, type: 'Laptop', condition: 'New', is_active: true, total_quantity: 1, available_quantity: 1 }); setShowLoanableForm(true); };
  const submitLoanable = async () => {
    if (!loanableForm.item_name) return addNotification('Item name is required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createLoanableItem({ ...loanableForm, property_id: currentPropertyId }); addNotification('Loanable created.', 'success', 'Inventory'); setShowLoanableForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to create loanable', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const removeLoanable = async (id: string) => { setActingOn(id); try { await deleteLoanableItem(id); load(); } catch (e: any) { addNotification(e?.message || 'Delete failed', 'error', 'Inventory'); } finally { setActingOn(null); setMenuOpen(null); } };

  const openLoan = () => { setLoanForm({ property_id: currentPropertyId, issue_date: new Date().toISOString().slice(0, 10), condition_at_issue: 'New', status: 'Active' }); setShowLoanForm(true); };
  const submitLoan = async () => {
    if (!loanForm.loanable_id || !loanForm.borrower) return addNotification('Loanable and borrower are required.', 'warning', 'Inventory');
    setSubmitting(true);
    try { await createLoanTransaction({ ...loanForm, property_id: currentPropertyId }); addNotification('Loan recorded.', 'success', 'Inventory'); setShowLoanForm(false); load(); }
    catch (e: any) { addNotification(e?.message || 'Failed to record loan', 'error', 'Inventory'); }
    finally { setSubmitting(false); }
  };
  const updateLoanStatus = async (l: UinvLoanTransaction, status: UinvLoanTransaction['status']) => {
    setActingOn(l.id);
    try { await updateLoanTransaction(l.id, { status, return_date: status === 'Returned' ? new Date().toISOString() : undefined }); addNotification(`Loan → ${status}`, 'success', 'Inventory'); load(); }
    catch (e: any) { addNotification(e?.message || 'Update failed', 'error', 'Inventory'); }
    finally { setActingOn(null); setMenuOpen(null); }
  };

  const renderTabs = () => (
    <SectionCard pad="md">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
          {SUB_TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => { setSub(t.id); setSearch(''); setMenuOpen(null); }}
                className={['px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5',
                  sub === t.id ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'].join(' ')}>
                <Icon className={`w-3.5 h-3.5 ${tabIconTone[t.id]}`} /> {t.label}
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
  );

  const section = (title: string, action: ReactNode, children: ReactNode) => (
    <SectionCard title={title} className="mt-4" actions={action}>{children}</SectionCard>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Physical Resources"
        subtitle="Tools, equipment, linen, uniforms, returnables and loanable items."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {sub === 'equipment-tools' && (
              <>
                <button onClick={openToolForm} className={button.secondary}><Plus className="w-4 h-4" /> New Tool</button>
                <button onClick={openToolCalib} className={button.secondary}><Tag className="w-4 h-4" /> Calibrate</button>
                <button onClick={openToolAssign} className={button.primary}><Plus className="w-4 h-4" /> Assign</button>
              </>
            )}
            {sub === 'linen' && (
              <>
                <button onClick={openLinenForm} className={button.secondary}><Plus className="w-4 h-4" /> New Linen</button>
                <button onClick={openLinenMove} className={button.primary}><RotateCcw className="w-4 h-4" /> Move</button>
              </>
            )}
            {sub === 'uniforms' && (
              <>
                <button onClick={openUniformForm} className={button.secondary}><Plus className="w-4 h-4" /> New Uniform</button>
                <button onClick={openUniformAssign} className={button.primary}><Plus className="w-4 h-4" /> Assign</button>
              </>
            )}
            {sub === 'returnables' && (
              <>
                <button onClick={openReturnableForm} className={button.secondary}><Plus className="w-4 h-4" /> New Returnable</button>
                <button onClick={openReturnableMove} className={button.primary}><RotateCcw className="w-4 h-4" /> Move</button>
              </>
            )}
            {sub === 'loanables' && (
              <>
                <button onClick={openLoanableForm} className={button.secondary}><Plus className="w-4 h-4" /> New Loanable</button>
                <button onClick={openLoan} className={button.primary}><Plus className="w-4 h-4" /> Loan</button>
              </>
            )}
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Tools Issued" value={kpis.toolsOut} icon={Wrench} tone="info" />
        <StatCard title="Calibration Due" value={kpis.calibrationDue} icon={AlertTriangle} tone="warning" />
        <StatCard title="Linen Below PAR" value={kpis.linenParShort} icon={PackageOpen} tone="warning" />
        <StatCard title="Uniforms Below PAR" value={kpis.uniformShort} icon={Shirt} tone="warning" />
        <StatCard title="Returnables Out" value={kpis.returnablesOut} icon={Repeat} tone="info" />
        <StatCard title="Active Loans" value={kpis.loansActive} icon={HardHat} tone="info" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {renderTabs()}

      {/* ── Tools & Equipment ── */}
      {sub === 'equipment-tools' && (
        <>
          <InventoryTable
            title="Tools & Equipment"
            rows={tools.filter(t => matchSearch(t.tool_name) || matchSearch(t.tool_code))}
            rowKey={t => t.id}
            loading={loading}
            emptyMessage="No tools or equipment."
            columns={[
              { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: t => <IdentityCell icon={<Wrench size={16} />} soft={statusTone.neutral.soft} text={statusTone.neutral.text} name={t.tool_code} code={t.type} /> },
              { key: 'name', header: 'Tool', render: t => <span className="font-medium text-slate-900 dark:text-white">{t.tool_name}</span> },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={statusToneFor(t.condition)}>{t.condition}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone={statusToneFor(t.status)} variant="solid">{t.status}</Badge> },
              { key: 'criticality', header: 'Criticality', widthClass: 'md:w-28 shrink-0', render: t => <Badge tone="neutral">{t.criticality}</Badge> },
              { key: 'calibration', header: 'Calibration', widthClass: 'md:w-36 shrink-0', render: t => <span className="text-xs text-slate-500">{t.calibration_required ? t.next_calibration_date?.slice(0, 10) || 'Required' : 'Not required'}</span> },
              { key: 'custodian', header: 'Custodian', widthClass: 'md:w-32 shrink-0', render: t => <span className="text-sm text-slate-600">{t.custodian || '—'}</span> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: t => (
                <OpsCell>
                  {menu(t.id, actionBtn('Delete', () => removeTool(t.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Assignments"
            rows={toolAssignments.filter(a => matchSearch(toolName(a.tool_id)) || matchSearch(a.employee))}
            rowKey={a => a.id}
            loading={loading}
            emptyMessage="No tool assignments."
            columns={[
              { key: 'tool', header: 'Tool', render: a => <span className="font-medium text-slate-900 dark:text-white">{toolName(a.tool_id)}</span> },
              { key: 'employee', header: 'Employee', widthClass: 'md:w-40 shrink-0', render: a => <span className="text-sm text-slate-700 dark:text-slate-300">{a.employee}</span> },
              { key: 'issue', header: 'Issued', widthClass: 'md:w-32 shrink-0', render: a => <span className="text-xs text-slate-500">{a.issue_date}</span> },
              { key: 'expected', header: 'Expected Return', widthClass: 'md:w-36 shrink-0', render: a => <span className="text-xs text-slate-500">{a.expected_return_date || '—'}</span> },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: a => <Badge tone={statusToneFor(a.condition_at_issue)}>{a.condition_at_issue}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: a => <Badge tone={statusToneFor(a.status)} variant="solid">{a.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-32 shrink-0', align: 'right', render: a => (
                <OpsCell>
                  {a.status === 'Active' && <IconButton onClick={() => updateToolAssignStatus(a, 'Returned')} title="Return"><RotateCcw className="w-4 h-4" /></IconButton>}
                  {menu(a.id, <>
                    {toolAssignmentAction(a).map(act => <button key={act.status} onClick={() => updateToolAssignStatus(a, act.status)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">{act.label}</button>)}
                    <button onClick={() => deleteToolAssignment(a.id)} disabled={actingOn === a.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                    </button>
                  </>)}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Calibrations"
            rows={toolCalibrations.filter(c => matchSearch(toolName(c.tool_id)))}
            rowKey={c => c.id}
            loading={loading}
            emptyMessage="No calibration records."
            columns={[
              { key: 'tool', header: 'Tool', render: c => <span className="font-medium text-slate-900 dark:text-white">{toolName(c.tool_id)}</span> },
              { key: 'date', header: 'Date', widthClass: 'md:w-32 shrink-0', render: c => <span className="text-xs text-slate-500">{c.calibration_date}</span> },
              { key: 'result', header: 'Result', widthClass: 'md:w-24 shrink-0', render: c => <Badge tone={statusToneFor(c.result)} variant="solid">{c.result}</Badge> },
              { key: 'next', header: 'Next Due', widthClass: 'md:w-32 shrink-0', render: c => <span className="text-xs text-slate-500">{c.next_calibration_date || '—'}</span> },
              { key: 'certificate', header: 'Certificate', widthClass: 'md:w-40 shrink-0', render: c => <span className="text-xs text-slate-500">{c.certificate_ref || '—'}</span> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: c => (
                <OpsCell>
                  {menu(c.id, actionBtn('Delete', () => removeToolCalib(c.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Linen ── */}
      {sub === 'linen' && (
        <>
          <InventoryTable
            title="Linen Items"
            rows={linen.filter(i => matchSearch(i.item_name) || matchSearch(i.item_code))}
            rowKey={i => i.id}
            loading={loading}
            emptyMessage="No linen items."
            columns={[
              { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: i => <span className="text-sm text-slate-500">{i.item_code}</span> },
              { key: 'name', header: 'Item', render: i => <span className="font-medium text-slate-900 dark:text-white">{i.item_name}</span> },
              { key: 'category', header: 'Category', widthClass: 'md:w-32 shrink-0', render: i => <Badge tone="neutral">{i.category}</Badge> },
              { key: 'stock', header: 'Stock', widthClass: 'md:w-28 shrink-0', align: 'right', render: i => <span className="text-sm font-medium">{i.store_quantity + i.department_quantity}</span> },
              { key: 'laundry', header: 'Laundry', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm">{i.laundry_quantity}</span> },
              { key: 'par', header: 'PAR', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className={i.store_quantity + i.department_quantity < i.par_level ? 'text-amber-600 font-medium' : ''}>{i.par_level}</span> },
              { key: 'status', header: 'Status', widthClass: 'md:w-24 shrink-0', render: i => <Badge tone={i.is_active ? 'success' : 'neutral'} variant="solid">{i.is_active ? 'Active' : 'Inactive'}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => (
                <OpsCell>
                  {menu(i.id, actionBtn('Delete', () => removeLinen(i.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Linen Movements"
            rows={linenMovements.filter(m => matchSearch(linenName(m.linen_id)) || matchSearch(m.movement_type))}
            rowKey={m => m.id}
            loading={loading}
            emptyMessage="No linen movements."
            columns={[
              { key: 'item', header: 'Item', render: m => <span className="font-medium text-slate-900 dark:text-white">{linenName(m.linen_id)}</span> },
              { key: 'type', header: 'Type', widthClass: 'md:w-32 shrink-0', render: m => <Badge tone={statusToneFor(m.movement_type)}>{m.movement_type}</Badge> },
              { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: m => <span className="text-sm font-medium">{m.quantity}</span> },
              { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: m => <span className="text-sm text-slate-600">{m.department || '—'}</span> },
              { key: 'date', header: 'Date', widthClass: 'md:w-32 shrink-0', render: m => <span className="text-xs text-slate-500">{m.movement_date}</span> },
              { key: 'reference', header: 'Reference', widthClass: 'md:w-40 shrink-0', render: m => <span className="text-xs text-slate-500">{m.reference || '—'}</span> },
            ]}
          />
        </>
      )}

      {/* ── Uniforms ── */}
      {sub === 'uniforms' && (
        <>
          <InventoryTable
            title="Uniform Items"
            rows={uniforms.filter(i => matchSearch(i.item_name) || matchSearch(i.item_code))}
            rowKey={i => i.id}
            loading={loading}
            emptyMessage="No uniform items."
            columns={[
              { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: i => <span className="text-sm text-slate-500">{i.item_code}</span> },
              { key: 'name', header: 'Item', render: i => <span className="font-medium text-slate-900 dark:text-white">{i.item_name}</span> },
              { key: 'dept', header: 'Department', widthClass: 'md:w-40 shrink-0', render: i => <span className="text-sm text-slate-600">{i.department || '—'}</span> },
              { key: 'role', header: 'Role', widthClass: 'md:w-32 shrink-0', render: i => <span className="text-sm text-slate-500">{i.role || '—'}</span> },
              { key: 'stock', header: 'Stock', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className={i.stock_quantity < i.par_level ? 'text-amber-600 font-medium' : ''}>{i.stock_quantity}</span> },
              { key: 'issued', header: 'Issued', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm">{i.issued_quantity}</span> },
              { key: 'par', header: 'PAR', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm">{i.par_level}</span> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => (
                <OpsCell>
                  {menu(i.id, actionBtn('Delete', () => removeUniform(i.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Uniform Assignments"
            rows={uniformAssignments.filter(a => matchSearch(uniformName(a.uniform_id)) || matchSearch(a.employee))}
            rowKey={a => a.id}
            loading={loading}
            emptyMessage="No uniform assignments."
            columns={[
              { key: 'uniform', header: 'Uniform', render: a => <span className="font-medium text-slate-900 dark:text-white">{uniformName(a.uniform_id)}</span> },
              { key: 'employee', header: 'Employee', widthClass: 'md:w-40 shrink-0', render: a => <span className="text-sm text-slate-700 dark:text-slate-300">{a.employee}</span> },
              { key: 'qty', header: 'Qty', widthClass: 'md:w-20 shrink-0', align: 'right', render: a => <span className="text-sm font-medium">{a.quantity}</span> },
              { key: 'size', header: 'Size', widthClass: 'md:w-20 shrink-0', render: a => <span className="text-sm text-slate-500">{a.size || '—'}</span> },
              { key: 'issue', header: 'Issued', widthClass: 'md:w-32 shrink-0', render: a => <span className="text-xs text-slate-500">{a.issue_date}</span> },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: a => <Badge tone={statusToneFor(a.condition)}>{a.condition}</Badge> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: a => <Badge tone={statusToneFor(a.status)} variant="solid">{a.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: a => (
                <OpsCell>
                  {a.status === 'Issued' && <IconButton onClick={() => updateUniformStatus(a, 'Returned')} title="Return"><RotateCcw className="w-4 h-4" /></IconButton>}
                  {menu(a.id, <>
                    {uniformAssignmentAction(a).map(act => <button key={act.status} onClick={() => updateUniformStatus(a, act.status)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">{act.label}</button>)}
                    <button onClick={() => deleteUniformAssignment(a.id)} disabled={actingOn === a.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      {actingOn === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                    </button>
                  </>)}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Returnables ── */}
      {sub === 'returnables' && (
        <>
          <InventoryTable
            title="Returnable Items"
            rows={returnables.filter(i => matchSearch(i.item_name) || matchSearch(i.item_code))}
            rowKey={i => i.id}
            loading={loading}
            emptyMessage="No returnable items."
            columns={[
              { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: i => <span className="text-sm text-slate-500">{i.item_code}</span> },
              { key: 'name', header: 'Item', render: i => <span className="font-medium text-slate-900 dark:text-white">{i.item_name}</span> },
              { key: 'type', header: 'Type', widthClass: 'md:w-28 shrink-0', render: i => <Badge tone="neutral">{i.type}</Badge> },
              { key: 'owner', header: 'Owner', widthClass: 'md:w-32 shrink-0', render: i => <Badge tone="neutral">{i.owner}</Badge> },
              { key: 'onHand', header: 'On-Hand', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm font-medium">{i.quantity_on_hand}</span> },
              { key: 'out', header: 'Out', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm font-medium">{i.quantity_out}</span> },
              { key: 'status', header: 'Status', widthClass: 'md:w-24 shrink-0', render: i => <Badge tone={i.is_active ? 'success' : 'neutral'} variant="solid">{i.is_active ? 'Active' : 'Inactive'}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => (
                <OpsCell>
                  {menu(i.id, actionBtn('Delete', () => removeReturnable(i.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Returnable Movements"
            rows={returnableMovements.filter(m => matchSearch(returnableName(m.returnable_id)) || matchSearch(m.movement_type))}
            rowKey={m => m.id}
            loading={loading}
            emptyMessage="No returnable movements."
            columns={[
              { key: 'item', header: 'Item', render: m => <span className="font-medium text-slate-900 dark:text-white">{returnableName(m.returnable_id)}</span> },
              { key: 'type', header: 'Type', widthClass: 'md:w-40 shrink-0', render: m => <Badge tone={statusToneFor(m.movement_type)}>{m.movement_type}</Badge> },
              { key: 'qty', header: 'Qty', widthClass: 'md:w-24 shrink-0', align: 'right', render: m => <span className="text-sm font-medium">{m.quantity}</span> },
              { key: 'date', header: 'Date', widthClass: 'md:w-32 shrink-0', render: m => <span className="text-xs text-slate-500">{m.movement_date}</span> },
              { key: 'reference', header: 'Reference', widthClass: 'md:w-40 shrink-0', render: m => <span className="text-xs text-slate-500">{m.reference || '—'}</span> },
            ]}
          />
        </>
      )}

      {/* ── Loanables ── */}
      {sub === 'loanables' && (
        <>
          <InventoryTable
            title="Loanable Equipment"
            rows={loanables.filter(i => matchSearch(i.item_name) || matchSearch(i.item_code))}
            rowKey={i => i.id}
            loading={loading}
            emptyMessage="No loanable equipment."
            columns={[
              { key: 'code', header: 'Code', widthClass: 'md:w-32 shrink-0', render: i => <span className="text-sm text-slate-500">{i.item_code}</span> },
              { key: 'name', header: 'Item', render: i => <span className="font-medium text-slate-900 dark:text-white">{i.item_name}</span> },
              { key: 'type', header: 'Type', widthClass: 'md:w-32 shrink-0', render: i => <Badge tone="neutral">{i.type}</Badge> },
              { key: 'serial', header: 'Serial', widthClass: 'md:w-36 shrink-0', render: i => <span className="text-xs text-slate-500">{i.serial_number || '—'}</span> },
              { key: 'total', header: 'Total', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm font-medium">{i.total_quantity}</span> },
              { key: 'available', header: 'Available', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => <span className="text-sm font-medium">{i.available_quantity}</span> },
              { key: 'condition', header: 'Condition', widthClass: 'md:w-28 shrink-0', render: i => <Badge tone={statusToneFor(i.condition)}>{i.condition}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-24 shrink-0', align: 'right', render: i => (
                <OpsCell>
                  {menu(i.id, actionBtn('Delete', () => removeLoanable(i.id), 'text-red-600'))}
                </OpsCell>
              ) },
            ]}
          />
          <InventoryTable
            title="Loan Transactions"
            rows={loans.filter(l => matchSearch(loanableName(l.loanable_id)) || matchSearch(l.borrower))}
            rowKey={l => l.id}
            loading={loading}
            emptyMessage="No loan transactions."
            columns={[
              { key: 'number', header: 'Loan #', widthClass: 'md:w-40 shrink-0', render: l => <span className="font-medium text-slate-900 dark:text-white">{l.loan_number}</span> },
              { key: 'item', header: 'Item', render: l => <span className="text-sm text-slate-700 dark:text-slate-300">{loanableName(l.loanable_id)}</span> },
              { key: 'borrower', header: 'Borrower', widthClass: 'md:w-40 shrink-0', render: l => <span className="text-sm text-slate-700 dark:text-slate-300">{l.borrower}</span> },
              { key: 'issue', header: 'Issued', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-xs text-slate-500">{l.issue_date}</span> },
              { key: 'due', header: 'Due', widthClass: 'md:w-32 shrink-0', render: l => <span className="text-xs text-slate-500">{l.due_date || '—'}</span> },
              { key: 'status', header: 'Status', widthClass: 'md:w-28 shrink-0', render: l => <Badge tone={statusToneFor(l.status)} variant="solid">{l.status}</Badge> },
              { key: 'ops', header: 'Ops', widthClass: 'md:w-40 shrink-0', align: 'right', render: l => (
                <OpsCell>
                  {l.status === 'Active' && <IconButton onClick={() => updateLoanStatus(l, 'Returned')} title="Return"><RotateCcw className="w-4 h-4" /></IconButton>}
                  {menu(l.id, <>
                    {loanTransactionAction(l).map(act => <button key={act.status} onClick={() => updateLoanStatus(l, act.status)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">{act.label}</button>)}
                    <button onClick={() => deleteLoanTransaction(l.id)} disabled={actingOn === l.id} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      {actingOn === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                    </button>
                  </>)}
                </OpsCell>
              ) },
            ]}
          />
        </>
      )}

      {/* ── Modals ── */}
      <ModalSystem isOpen={showToolForm} onClose={() => setShowToolForm(false)} onConfirm={submitTool} title="New Tool / Equipment" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Tool Code *"><input className={inputClass} value={toolForm.tool_code || ''} onChange={e => setToolForm({ ...toolForm, tool_code: e.target.value })} /></Field>
          <Field label="Tool Name *"><input className={inputClass} value={toolForm.tool_name || ''} onChange={e => setToolForm({ ...toolForm, tool_name: e.target.value })} /></Field>
          <Field label="Type"><input className={inputClass} value={toolForm.type || ''} onChange={e => setToolForm({ ...toolForm, type: e.target.value })} /></Field>
          <Field label="Criticality"><select className={inputClass} value={toolForm.criticality || 'Normal'} onChange={e => setToolForm({ ...toolForm, criticality: e.target.value as any })}>{['Critical','High','Medium','Normal'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Condition"><select className={inputClass} value={toolForm.condition || 'New'} onChange={e => setToolForm({ ...toolForm, condition: e.target.value as any })}>{['New','Excellent','Good','Fair','Poor','Damaged','Unusable'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Requires Calibration"><input type="checkbox" checked={toolForm.calibration_required || false} onChange={e => setToolForm({ ...toolForm, calibration_required: e.target.checked })} /></Field>
          <Field label="Next Calibration Date"><input type="date" className={inputClass} value={toolForm.next_calibration_date || ''} onChange={e => setToolForm({ ...toolForm, next_calibration_date: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={toolForm.notes || ''} onChange={e => setToolForm({ ...toolForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showToolAssignForm} onClose={() => setShowToolAssignForm(false)} onConfirm={submitToolAssign} title="Assign Tool" loading={submitting} confirmLabel="Assign">
        <div className="space-y-4">
          <Field label="Tool *">
            <select className={inputClass} value={toolAssignForm.tool_id || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, tool_id: e.target.value })}>
              <option value="">Select tool…</option>
              {tools.map(t => <option key={t.id} value={t.id}>{t.tool_name}</option>)}
            </select>
          </Field>
          <Field label="Employee *"><input className={inputClass} value={toolAssignForm.employee || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, employee: e.target.value })} /></Field>
          <Field label="Department"><input className={inputClass} value={toolAssignForm.department || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, department: e.target.value || null })} /></Field>
          <Field label="Issue Date *"><input type="date" className={inputClass} value={toolAssignForm.issue_date || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, issue_date: e.target.value })} /></Field>
          <Field label="Expected Return"><input type="date" className={inputClass} value={toolAssignForm.expected_return_date || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, expected_return_date: e.target.value || null })} /></Field>
          <Field label="Condition at Issue"><select className={inputClass} value={toolAssignForm.condition_at_issue || 'Good'} onChange={e => setToolAssignForm({ ...toolAssignForm, condition_at_issue: e.target.value as any })}>{['New','Excellent','Good','Fair','Poor','Damaged','Unusable'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={toolAssignForm.notes || ''} onChange={e => setToolAssignForm({ ...toolAssignForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showToolCalibForm} onClose={() => setShowToolCalibForm(false)} onConfirm={submitToolCalib} title="Record Calibration" loading={submitting} confirmLabel="Record">
        <div className="space-y-4">
          <Field label="Tool *">
            <select className={inputClass} value={toolCalibForm.tool_id || ''} onChange={e => setToolCalibForm({ ...toolCalibForm, tool_id: e.target.value })}>
              <option value="">Select tool…</option>
              {tools.map(t => <option key={t.id} value={t.id}>{t.tool_name}</option>)}
            </select>
          </Field>
          <Field label="Calibration Date *"><input type="date" className={inputClass} value={toolCalibForm.calibration_date || ''} onChange={e => setToolCalibForm({ ...toolCalibForm, calibration_date: e.target.value })} /></Field>
          <Field label="Result"><select className={inputClass} value={toolCalibForm.result || 'Pass'} onChange={e => setToolCalibForm({ ...toolCalibForm, result: e.target.value as any })}>{['Pass','Fail','Adjusted'].map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Next Calibration"><input type="date" className={inputClass} value={toolCalibForm.next_calibration_date || ''} onChange={e => setToolCalibForm({ ...toolCalibForm, next_calibration_date: e.target.value || null })} /></Field>
          <Field label="Certificate Ref"><input className={inputClass} value={toolCalibForm.certificate_ref || ''} onChange={e => setToolCalibForm({ ...toolCalibForm, certificate_ref: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={toolCalibForm.notes || ''} onChange={e => setToolCalibForm({ ...toolCalibForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showLinenForm} onClose={() => setShowLinenForm(false)} onConfirm={submitLinen} title="New Linen Item" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item Code *"><input className={inputClass} value={linenForm.item_code || ''} onChange={e => setLinenForm({ ...linenForm, item_code: e.target.value })} /></Field>
          <Field label="Item Name *"><input className={inputClass} value={linenForm.item_name || ''} onChange={e => setLinenForm({ ...linenForm, item_name: e.target.value })} /></Field>
          <Field label="Category"><select className={inputClass} value={linenForm.category || 'Towels'} onChange={e => setLinenForm({ ...linenForm, category: e.target.value as any })}>{['Bed Sheets','Pillowcases','Duvets','Towels','Bath Mats','Table Linen','Pool Towels','Spa Linen','Kitchen Linen','Other'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="PAR Level"><input type="number" className={inputClass} value={linenForm.par_level || 0} onChange={e => setLinenForm({ ...linenForm, par_level: Number(e.target.value) })} /></Field>
          <Field label="Unit Cost"><input type="number" className={inputClass} value={linenForm.unit_cost || 0} onChange={e => setLinenForm({ ...linenForm, unit_cost: Number(e.target.value) })} /></Field>
          <Field label="Size"><input className={inputClass} value={linenForm.size || ''} onChange={e => setLinenForm({ ...linenForm, size: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={linenForm.notes || ''} onChange={e => setLinenForm({ ...linenForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showLinenMoveForm} onClose={() => setShowLinenMoveForm(false)} onConfirm={submitLinenMove} title="Record Linen Movement" loading={submitting} confirmLabel="Record">
        <div className="space-y-4">
          <Field label="Linen Item *">
            <select className={inputClass} value={linenMoveForm.linen_id || ''} onChange={e => setLinenMoveForm({ ...linenMoveForm, linen_id: e.target.value })}>
              <option value="">Select linen…</option>
              {linen.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
            </select>
          </Field>
          <Field label="Movement Type"><select className={inputClass} value={linenMoveForm.movement_type || 'Issue'} onChange={e => setLinenMoveForm({ ...linenMoveForm, movement_type: e.target.value as any })}>{['Issue','Laundry Out','Laundry Return','Damage','Loss','Retirement','Transfer','Adjustment'].map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={linenMoveForm.quantity || 0} onChange={e => setLinenMoveForm({ ...linenMoveForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Department"><input className={inputClass} value={linenMoveForm.department || ''} onChange={e => setLinenMoveForm({ ...linenMoveForm, department: e.target.value || null })} /></Field>
          <Field label="Reference"><input className={inputClass} value={linenMoveForm.reference || ''} onChange={e => setLinenMoveForm({ ...linenMoveForm, reference: e.target.value || null })} /></Field>
          <Field label="Date *"><input type="date" className={inputClass} value={linenMoveForm.movement_date || ''} onChange={e => setLinenMoveForm({ ...linenMoveForm, movement_date: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={linenMoveForm.notes || ''} onChange={e => setLinenMoveForm({ ...linenMoveForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showUniformForm} onClose={() => setShowUniformForm(false)} onConfirm={submitUniform} title="New Uniform Item" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item Code *"><input className={inputClass} value={uniformForm.item_code || ''} onChange={e => setUniformForm({ ...uniformForm, item_code: e.target.value })} /></Field>
          <Field label="Item Name *"><input className={inputClass} value={uniformForm.item_name || ''} onChange={e => setUniformForm({ ...uniformForm, item_name: e.target.value })} /></Field>
          <Field label="Department"><input className={inputClass} value={uniformForm.department || ''} onChange={e => setUniformForm({ ...uniformForm, department: e.target.value || null })} /></Field>
          <Field label="Role"><input className={inputClass} value={uniformForm.role || ''} onChange={e => setUniformForm({ ...uniformForm, role: e.target.value || null })} /></Field>
          <Field label="Size"><input className={inputClass} value={uniformForm.size || ''} onChange={e => setUniformForm({ ...uniformForm, size: e.target.value || null })} /></Field>
          <Field label="PAR Level"><input type="number" className={inputClass} value={uniformForm.par_level || 0} onChange={e => setUniformForm({ ...uniformForm, par_level: Number(e.target.value) })} /></Field>
          <Field label="Unit Cost"><input type="number" className={inputClass} value={uniformForm.unit_cost || 0} onChange={e => setUniformForm({ ...uniformForm, unit_cost: Number(e.target.value) })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={uniformForm.notes || ''} onChange={e => setUniformForm({ ...uniformForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showUniformAssignForm} onClose={() => setShowUniformAssignForm(false)} onConfirm={submitUniformAssign} title="Assign Uniform" loading={submitting} confirmLabel="Assign">
        <div className="space-y-4">
          <Field label="Uniform *">
            <select className={inputClass} value={uniformAssignForm.uniform_id || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, uniform_id: e.target.value })}>
              <option value="">Select uniform…</option>
              {uniforms.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
            </select>
          </Field>
          <Field label="Employee *"><input className={inputClass} value={uniformAssignForm.employee || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, employee: e.target.value })} /></Field>
          <Field label="Department"><input className={inputClass} value={uniformAssignForm.department || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, department: e.target.value || null })} /></Field>
          <Field label="Role"><input className={inputClass} value={uniformAssignForm.role || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, role: e.target.value || null })} /></Field>
          <Field label="Size"><input className={inputClass} value={uniformAssignForm.size || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, size: e.target.value || null })} /></Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={uniformAssignForm.quantity || 1} onChange={e => setUniformAssignForm({ ...uniformAssignForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Issue Date *"><input type="date" className={inputClass} value={uniformAssignForm.issue_date || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, issue_date: e.target.value })} /></Field>
          <Field label="Condition"><select className={inputClass} value={uniformAssignForm.condition || 'New'} onChange={e => setUniformAssignForm({ ...uniformAssignForm, condition: e.target.value as any })}>{['New','Good','Fair','Poor','Damaged','Retired'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={uniformAssignForm.notes || ''} onChange={e => setUniformAssignForm({ ...uniformAssignForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showReturnableForm} onClose={() => setShowReturnableForm(false)} onConfirm={submitReturnable} title="New Returnable Item" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item Code *"><input className={inputClass} value={returnableForm.item_code || ''} onChange={e => setReturnableForm({ ...returnableForm, item_code: e.target.value })} /></Field>
          <Field label="Item Name *"><input className={inputClass} value={returnableForm.item_name || ''} onChange={e => setReturnableForm({ ...returnableForm, item_name: e.target.value })} /></Field>
          <Field label="Owner"><select className={inputClass} value={returnableForm.owner || 'Hotel'} onChange={e => setReturnableForm({ ...returnableForm, owner: e.target.value as any })}>{['Supplier','Hotel','Guest/Third Party'].map(o => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Owner Ref"><input className={inputClass} value={returnableForm.owner_ref || ''} onChange={e => setReturnableForm({ ...returnableForm, owner_ref: e.target.value || null })} /></Field>
          <Field label="Type"><select className={inputClass} value={returnableForm.type || 'Crate'} onChange={e => setReturnableForm({ ...returnableForm, type: e.target.value as any })}>{['Container','Crate','Pallet','Keg','Other'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="On-Hand"><input type="number" className={inputClass} value={returnableForm.quantity_on_hand || 0} onChange={e => setReturnableForm({ ...returnableForm, quantity_on_hand: Number(e.target.value) })} /></Field>
          <Field label="Unit Cost"><input type="number" className={inputClass} value={returnableForm.unit_cost || 0} onChange={e => setReturnableForm({ ...returnableForm, unit_cost: Number(e.target.value) })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={returnableForm.notes || ''} onChange={e => setReturnableForm({ ...returnableForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showReturnableMoveForm} onClose={() => setShowReturnableMoveForm(false)} onConfirm={submitReturnableMove} title="Record Returnable Movement" loading={submitting} confirmLabel="Record">
        <div className="space-y-4">
          <Field label="Returnable *">
            <select className={inputClass} value={returnableMoveForm.returnable_id || ''} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, returnable_id: e.target.value })}>
              <option value="">Select returnable…</option>
              {returnables.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
            </select>
          </Field>
          <Field label="Movement Type"><select className={inputClass} value={returnableMoveForm.movement_type || 'Issue to Supplier'} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, movement_type: e.target.value as any })}>{['Receive','Issue to Supplier','Return from Supplier','Receive from Dept','Adjustment','Scrap'].map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Quantity *"><input type="number" className={inputClass} value={returnableMoveForm.quantity || 0} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, quantity: Number(e.target.value) })} /></Field>
          <Field label="Reference"><input className={inputClass} value={returnableMoveForm.reference || ''} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, reference: e.target.value || null })} /></Field>
          <Field label="Date *"><input type="date" className={inputClass} value={returnableMoveForm.movement_date || ''} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, movement_date: e.target.value })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={returnableMoveForm.notes || ''} onChange={e => setReturnableMoveForm({ ...returnableMoveForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showLoanableForm} onClose={() => setShowLoanableForm(false)} onConfirm={submitLoanable} title="New Loanable Equipment" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Item Code *"><input className={inputClass} value={loanableForm.item_code || ''} onChange={e => setLoanableForm({ ...loanableForm, item_code: e.target.value })} /></Field>
          <Field label="Item Name *"><input className={inputClass} value={loanableForm.item_name || ''} onChange={e => setLoanableForm({ ...loanableForm, item_name: e.target.value })} /></Field>
          <Field label="Type"><select className={inputClass} value={loanableForm.type || 'Laptop'} onChange={e => setLoanableForm({ ...loanableForm, type: e.target.value as any })}>{['Laptop','Projector','Radio','Event Equipment','Tool','Portable Equipment','Other'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Serial Number"><input className={inputClass} value={loanableForm.serial_number || ''} onChange={e => setLoanableForm({ ...loanableForm, serial_number: e.target.value || null })} /></Field>
          <Field label="Total Quantity"><input type="number" className={inputClass} value={loanableForm.total_quantity || 1} onChange={e => setLoanableForm({ ...loanableForm, total_quantity: Number(e.target.value) })} /></Field>
          <Field label="Condition"><select className={inputClass} value={loanableForm.condition || 'New'} onChange={e => setLoanableForm({ ...loanableForm, condition: e.target.value as any })}>{['New','Excellent','Good','Fair','Poor','Damaged','Unusable'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Custodian"><input className={inputClass} value={loanableForm.custodian || ''} onChange={e => setLoanableForm({ ...loanableForm, custodian: e.target.value || null })} /></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={loanableForm.notes || ''} onChange={e => setLoanableForm({ ...loanableForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>

      <ModalSystem isOpen={showLoanForm} onClose={() => setShowLoanForm(false)} onConfirm={submitLoan} title="New Loan" loading={submitting} confirmLabel="Create">
        <div className="space-y-4">
          <Field label="Loanable *">
            <select className={inputClass} value={loanForm.loanable_id || ''} onChange={e => setLoanForm({ ...loanForm, loanable_id: e.target.value })}>
              <option value="">Select loanable…</option>
              {loanables.map(i => <option key={i.id} value={i.id}>{i.item_name}</option>)}
            </select>
          </Field>
          <Field label="Borrower *"><input className={inputClass} value={loanForm.borrower || ''} onChange={e => setLoanForm({ ...loanForm, borrower: e.target.value })} /></Field>
          <Field label="Department"><input className={inputClass} value={loanForm.department || ''} onChange={e => setLoanForm({ ...loanForm, department: e.target.value || null })} /></Field>
          <Field label="Purpose"><input className={inputClass} value={loanForm.purpose || ''} onChange={e => setLoanForm({ ...loanForm, purpose: e.target.value || null })} /></Field>
          <Field label="Issue Date *"><input type="date" className={inputClass} value={loanForm.issue_date || ''} onChange={e => setLoanForm({ ...loanForm, issue_date: e.target.value })} /></Field>
          <Field label="Due Date"><input type="date" className={inputClass} value={loanForm.due_date || ''} onChange={e => setLoanForm({ ...loanForm, due_date: e.target.value || null })} /></Field>
          <Field label="Condition at Issue"><select className={inputClass} value={loanForm.condition_at_issue || 'New'} onChange={e => setLoanForm({ ...loanForm, condition_at_issue: e.target.value as any })}>{['New','Excellent','Good','Fair','Poor','Damaged','Unusable'].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Notes"><textarea className={inputClass} rows={2} value={loanForm.notes || ''} onChange={e => setLoanForm({ ...loanForm, notes: e.target.value || null })} /></Field>
        </div>
      </ModalSystem>
    </div>
  );
};

export default PhysicalResourcesModule;
