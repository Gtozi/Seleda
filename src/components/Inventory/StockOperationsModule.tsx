/**
 * Stock Operations — /erp/inventory/stock-operations
 * Consolidated: Requisitions + Issues + Transfers + Receiving in one module.
 *
 * DB-integrated via /api/uinv-portal/issues + /api/uinv-portal/transfers + /api/uinv-portal/grns.
 * - Requisitions: department requests (source='Requisition') — approve, reject, fulfill (partial)
 * - Issues: direct department issues (source='Direct') — create from scratch or from a requisition
 * - Transfers: inter-store transfers
 * - Receiving: Goods Receiving Notes — receive, inspect, accept, put away
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight, Plus, Search, Clock, Loader2, ServerCrash, MoreVertical,
  CheckCircle2, XCircle, ArrowRight, Package, Trash2, ClipboardList, Truck, Eye, Link2,
  Filter, X, ChevronDown, Undo2,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import InventoryTable, { IdentityCell, TagPill, OpsCell, IconButton } from './InventoryTable';
import { useERP } from '../../context/ERPContext';
import {
  fetchIssues, createIssue, updateIssue, type UinvIssue, type UinvStockBalance,
  fetchTransfers, createTransfer, updateTransfer, type UinvTransfer,
  fetchReceipts as fetchGRNs, createReceipt as createGRN, updateReceipt as updateGRN, type UinvGoodsReceipt as UinvGRN,
  fetchStores, fetchItems, fetchStock, type UinvStore, type UinvItem,
} from '../../services/inventoryService';
import { filterItemsForDepartment } from '../../config/departmentCategories';
import { BorrowsTab } from './OperationalEnhancementsModule';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

const selectClass = inputClass;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

/** All 17 ERP departments — the `department` field on uinv_issues. */
const DEPARTMENTS = [
  'Front Office', 'Housekeeping', 'Food & Beverage', 'Engineering', 'Inventory',
  'Finance', 'Human Resources', 'Security', 'Executive', 'Admin', 'Procurement',
  'Operations', 'Sales', 'Transportation', 'Concierge', 'Spa & Wellness',
  'Banquet & Events',
] as const;

const PRIORITIES = ['Normal', 'High', 'Urgent'] as const;

type Tab = 'issues' | 'transfers' | 'receiving' | 'borrows';

// ── GRN constants ──
const GRN_STATUS_FLOW = ['Draft', 'Inspecting', 'Accepted', 'Put Away', 'Rejected'] as const;
type GRNStatus = typeof GRN_STATUS_FLOW[number];
const GRN_NEXT_ACTIONS: Record<GRNStatus, string[]> = {
  'Draft': ['Start Inspection'],
  'Inspecting': ['Accept', 'Reject'],
  'Accepted': ['Put Away'],
  'Put Away': [],
  'Rejected': [],
};
const GRN_STATUS_TONE: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'neutral' | 'accent'> = {
  'Draft': 'neutral',
  'Inspecting': 'warning',
  'Accepted': 'success',
  'Put Away': 'accent',
  'Rejected': 'danger',
};

interface GRNLineDraft {
  itemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  deliveredQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unitCost: number;
  batchNumber?: string;
  expiryDate?: string;
}

const emptyGRNForm = () => ({
  purchase_order: '', supplier: '', store_id: '', receiving_date: new Date().toISOString().slice(0, 10),
  vehicle_reference: '', notes: '', lines: [] as GRNLineDraft[],
});

function statusToneFor(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'Pending': return 'warning';
    case 'Approved': return 'info';
    case 'Partially Issued': return 'info';
    case 'Issued':
    case 'Completed': return 'success';
    case 'Rejected':
    case 'Cancelled': return 'danger';
    default: return 'neutral';
  }
}

interface IssueLineDraft {
  itemId: string;
  itemName: string;
  unit: string;
  unitCost: number;
  requestedQty: number;
}

interface TransferLineDraft {
  itemId: string;
  itemName: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

const MAIN_STORE_ID = 'UINV-ST-MAIN';

const emptyIssueForm = () => ({
  department: '' as string,
  storeId: MAIN_STORE_ID as string,
  requester: '' as string,
  priority: 'Normal' as string,
  requiredDate: new Date().toISOString().slice(0, 10),
  costCenter: '' as string,
  purpose: '' as string,
  notes: '' as string,
  lines: [] as IssueLineDraft[],
});

const emptyTransferForm = () => ({
  fromStoreId: '' as string,
  toStoreId: '' as string,
  priority: 'Normal' as string,
  reason: '' as string,
  notes: '' as string,
  lines: [] as TransferLineDraft[],
});

interface StockOperationsModuleProps {
  initialTab?: 'receiving' | 'issues-returns' | 'transfers' | 'stock-operations' | 'borrows';
}

const StockOperationsModule: React.FC<StockOperationsModuleProps> = ({ initialTab }) => {
  const { currentPropertyId, addNotification } = useERP();
  const startTab: Tab =
    initialTab === 'receiving' ? 'receiving' :
    initialTab === 'transfers' ? 'transfers' :
    initialTab === 'borrows' ? 'borrows' :
    'issues';
  const [tab, setTab] = useState<Tab>(startTab);
  const [issues, setIssues] = useState<UinvIssue[]>([]);
  const [transfers, setTransfers] = useState<UinvTransfer[]>([]);
  const [grns, setGrns] = useState<UinvGRN[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState<'All' | 'Requisition' | 'Direct'>('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  // Notify wrapper for the BorrowsTab sub-component
  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    addNotification?.(msg, type, 'Inventory');
  }, [addNotification]);
  const [issueForm, setIssueForm] = useState(emptyIssueForm());
  const [transferForm, setTransferForm] = useState(emptyTransferForm());
  const [grnForm, setGrnForm] = useState<any>(emptyGRNForm());
  const [linkedRequisitionId, setLinkedRequisitionId] = useState<string | null>(null);

  // Fulfill modal state
  const [fulfillIssue, setFulfillIssue] = useState<UinvIssue | null>(null);
  const [fulfillQty, setFulfillQty] = useState<Record<string, number>>({});
  const [stockMap, setStockMap] = useState<Record<string, UinvStockBalance[]>>({});

  // Detail modal state
  const [detailIssue, setDetailIssue] = useState<UinvIssue | null>(null);
  const [detailGRN, setDetailGRN] = useState<UinvGRN | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, t, g, s, it] = await Promise.all([
        fetchIssues({ propertyId: currentPropertyId || undefined }),
        fetchTransfers({ propertyId: currentPropertyId || undefined }),
        fetchGRNs({ propertyId: currentPropertyId || undefined }),
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }),
        fetchItems({ propertyId: currentPropertyId || undefined, active: 'true' }),
      ]);
      setIssues(i);
      setTransfers(t);
      setGrns(g);
      setStores(s);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || 'Failed to load stock operations');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s to pick up new requisitions from departments
  useEffect(() => {
    const interval = setInterval(() => load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Split issues by source
  const requisitions = useMemo(() => issues.filter(i => i.source === 'Requisition'), [issues]);
  const directIssues = useMemo(() => issues.filter(i => i.source !== 'Requisition'), [issues]);

  // Items allowed for the currently selected department in the issue form
  // (only items whose category matches the department can be issued to it)
  const allowedIssueItems = useMemo(
    () => issueForm.department ? filterItemsForDepartment(items, issueForm.department) : items,
    [items, issueForm.department],
  );

  // Lookup: requisition_id → requisition issue (for displaying linked requisition numbers on direct issues)
  const requisitionById = useMemo(() => {
    const map: Record<string, UinvIssue> = {};
    for (const r of requisitions) map[r.id] = r;
    return map;
  }, [requisitions]);

  // Lookup: requisition_id → array of direct issues linked to it
  const issuesByRequisitionId = useMemo(() => {
    const map: Record<string, UinvIssue[]> = {};
    for (const iss of directIssues) {
      if (iss.requisition_id) {
        if (!map[iss.requisition_id]) map[iss.requisition_id] = [];
        map[iss.requisition_id].push(iss);
      }
    }
    return map;
  }, [directIssues]);

  const currentList = tab === 'issues' ? issues : tab === 'transfers' ? transfers : grns;
  const statuses = useMemo(() => Array.from(new Set(currentList.map((x: any) => tab === 'transfers' ? x.status : tab === 'receiving' ? x.status : x.approval_status))), [currentList, tab]);

  // ── Flattened rows for issues tab: one row per item, requisition + issue side by side ──
  const flattenedIssueRows = useMemo(() => {
    if (tab !== 'issues') return [];
    const rows: any[] = [];
    const seenIssueIds = new Set<string>();

    // Process requisitions — pair with linked direct issues
    for (const req of requisitions) {
      const linkedIssues = issuesByRequisitionId[req.id] || [];
      linkedIssues.forEach(iss => seenIssueIds.add(iss.id));

      for (const line of (req.lines || [])) {
        // Find matching line in linked issue by itemId
        let matchedIssue: any = undefined;
        let matchedLine: any = undefined;
        for (const iss of linkedIssues) {
          const ml = (iss.lines || []).find((l: any) => l.itemId === line.itemId);
          if (ml) { matchedIssue = iss; matchedLine = ml; break; }
        }
        rows.push({
          rowId: `${req.id}-${line.itemId || line.itemName}`,
          requisition: req,
          issue: matchedIssue,
          parent: req,
          parentType: 'Requisition',
          itemName: line.itemName,
          requestedQty: Number(line.requestedQty || line.quantity || 0),
          approvedQty: Number(Math.max(line.approvedQty || 0, matchedLine?.approvedQty || 0)),
          issuedQty: Number(Math.max(line.issuedQty || 0, matchedLine?.issuedQty || 0)),
          unit: line.unit,
          unitCost: Number(line.cost || matchedLine?.cost || 0),
          department: req.department,
          requester: req.requester,
          status: req.approval_status,
          priority: req.priority,
          storeName: req.store?.store_name,
          requiredDate: req.required_date,
        });
      }
    }

    // Process standalone direct issues (not linked to any requisition)
    for (const iss of directIssues) {
      if (seenIssueIds.has(iss.id)) continue;
      for (const line of (iss.lines || [])) {
        rows.push({
          rowId: `${iss.id}-${line.itemId || line.itemName}`,
          requisition: undefined,
          issue: iss,
          parent: iss,
          parentType: 'Direct',
          itemName: line.itemName,
          requestedQty: Number(line.requestedQty || line.quantity || 0),
          approvedQty: Number(line.approvedQty || 0),
          issuedQty: Number(line.issuedQty || 0),
          unit: line.unit,
          unitCost: Number(line.cost || 0),
          department: iss.department,
          requester: iss.requester,
          status: iss.approval_status,
          priority: iss.priority,
          storeName: iss.store?.store_name,
          requiredDate: iss.required_date,
        });
      }
    }

    return rows;
  }, [tab, requisitions, directIssues, issuesByRequisitionId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === 'issues') {
      // Filter flattened per-item rows
      return flattenedIssueRows.filter((x: any) => {
        const matchesStatus = statusFilter === 'All' || x.status === statusFilter;
        const matchesSource = sourceFilter === 'All' || x.parentType === sourceFilter;
        const reqNum = x.requisition?.issue_number || '';
        const issNum = x.issue?.issue_number || '';
        const matchesSearch = !q || reqNum.toLowerCase().includes(q) || issNum.toLowerCase().includes(q) || (x.department || '').toLowerCase().includes(q) || (x.requester || '').toLowerCase().includes(q) || (x.itemName || '').toLowerCase().includes(q);
        return matchesStatus && matchesSource && matchesSearch;
      });
    }
    return currentList.filter((x: any) => {
      const xStatus = tab === 'transfers' || tab === 'receiving' ? x.status : x.approval_status;
      const matchesStatus = statusFilter === 'All' || xStatus === statusFilter;
      const num = tab === 'transfers' ? x.transfer_number : tab === 'receiving' ? x.grn_number : x.issue_number;
      const subText = tab === 'transfers' ? `${x.from_store?.store_name || ''} → ${x.to_store?.store_name || ''}` : tab === 'receiving' ? x.supplier : x.department;
      const matchesSearch = !q || (num || '').toLowerCase().includes(q) || (subText || '').toLowerCase().includes(q) || (x.requester || '').toLowerCase().includes(q) || (x.purchase_order || '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [currentList, flattenedIssueRows, search, statusFilter, sourceFilter, tab]);

  const counts = useMemo(() => ({
    pendingRequisitions: requisitions.filter(i => i.approval_status === 'Pending').length,
    activeRequisitions: requisitions.filter(i => i.approval_status === 'Approved' || i.approval_status === 'Partially Issued').length,
    pendingIssues: directIssues.filter(i => i.approval_status === 'Draft' || i.approval_status === 'Pending' || i.approval_status === 'Approved').length,
    pendingTransfers: transfers.filter(t => t.status === 'Draft' || t.status === 'In Transit').length,
    pendingGRNs: grns.filter(g => g.status === 'Draft' || g.status === 'Inspecting').length,
  }), [requisitions, directIssues, transfers, grns]);

  // ── Requisition actions ──
  const approveRequisition = async (id: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      const updated = await updateIssue(id, { approval_status: 'Approved' });
      setIssues(prev => prev.map(i => (i.id === id ? updated : i)));
      addNotification('Requisition approved.', 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to approve', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const rejectRequisition = async (id: string) => {
    setActingOn(id); setMenuOpen(null);
    try {
      const updated = await updateIssue(id, { approval_status: 'Rejected' });
      setIssues(prev => prev.map(i => (i.id === id ? updated : i)));
      addNotification('Requisition rejected.', 'warning', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to reject', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const openFulfill = async (issue: UinvIssue) => {
    setMenuOpen(null);
    setFulfillIssue(issue);
    setFulfillQty({});
    const stockByItem: Record<string, UinvStockBalance[]> = {};
    for (const line of issue.lines || []) {
      if (!line.itemId) continue;
      try {
        // Fetch stock from the Main Warehouse (the central gate)
        const stock = await fetchStock({ propertyId: currentPropertyId || undefined, storeId: MAIN_STORE_ID, itemId: line.itemId });
        stockByItem[line.itemId] = stock;
      } catch { stockByItem[line.itemId] = []; }
    }
    setStockMap(stockByItem);
    const initQty: Record<string, number> = {};
    for (const line of issue.lines || []) {
      const requested = line.requestedQty || 0;
      const alreadyIssued = line.issuedQty || 0;
      initQty[line.itemId] = Math.max(0, requested - alreadyIssued);
    }
    setFulfillQty(initQty);
  };

  const submitFulfill = async () => {
    if (!fulfillIssue) return;
    setSubmitting(true);
    try {
      const issueLines = (fulfillIssue.lines || []).map(line => ({
        ...line,
        issuedQty: fulfillQty[line.itemId] ?? 0,
        approvedQty: line.approvedQty || line.requestedQty || 0,
      }));
      const updated = await updateIssue(fulfillIssue.id, {
        approval_status: 'Issued',
        lines: issueLines,
      });
      setIssues(prev => prev.map(i => (i.id === fulfillIssue.id ? updated : i)));
      const isPartial = updated.approval_status === 'Partially Issued';
      addNotification(
        `Requisition ${fulfillIssue.issue_number} ${isPartial ? 'partially ' : ''}issued.${isPartial ? ' Remaining items can be fulfilled later.' : ''}`,
        'success', 'Inventory'
      );
      setFulfillIssue(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to issue requisition', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  // ── Issue form helpers ──
  /** Requisitions that can be linked to a new issue (Approved or Partially Issued). */
  const availableRequisitions = useMemo(() =>
    requisitions.filter(i => i.approval_status === 'Approved' || i.approval_status === 'Partially Issued'),
    [requisitions]);

  /** Load issue form fields from a selected requisition. */
  const loadFromRequisition = (reqId: string) => {
    const req = issues.find(i => i.id === reqId);
    if (!req) { setLinkedRequisitionId(null); return; }
    setLinkedRequisitionId(reqId);
    setIssueForm({
      department: req.department,
      storeId: MAIN_STORE_ID,
      requester: req.requester || '',
      priority: req.priority,
      requiredDate: req.required_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      costCenter: req.cost_center || '',
      purpose: req.purpose ? `${req.purpose} (from ${req.issue_number})` : '',
      notes: req.notes || '',
      lines: (req.lines || []).map(l => ({
        itemId: l.itemId,
        itemName: l.itemName,
        unit: l.unit,
        unitCost: l.cost || 0,
        requestedQty: Math.max(0, (l.requestedQty || 0) - (l.issuedQty || 0)),
      })),
    });
  };

  const addIssueLine = () => {
    const firstItem = items[0];
    setIssueForm(f => ({
      ...f,
      lines: [...f.lines, {
        itemId: firstItem?.id || '',
        itemName: firstItem?.item_name || '',
        unit: firstItem?.unit_of_measure || 'pcs',
        unitCost: Number(firstItem?.last_cost || 0),
        requestedQty: 0,
      }],
    }));
  };
  const updateIssueLine = (idx: number, patch: Partial<IssueLineDraft>) => {
    setIssueForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  };
  const removeIssueLine = (idx: number) => {
    setIssueForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  };
  const onIssueItemChange = (idx: number, itemId: string) => {
    const it = items.find(x => x.id === itemId);
    updateIssueLine(idx, {
      itemId,
      itemName: it?.item_name || '',
      unit: it?.unit_of_measure || 'pcs',
      unitCost: Number(it?.last_cost || 0),
    });
  };

  const submitIssue = async () => {
    if (!issueForm.department || !issueForm.storeId || issueForm.lines.length === 0) {
      addNotification('Department, store, and at least one line item are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createIssue({
        property_id: currentPropertyId,
        department: issueForm.department,
        store_id: issueForm.storeId,
        requester: issueForm.requester || undefined,
        priority: issueForm.priority,
        required_date: issueForm.requiredDate || undefined,
        cost_center: issueForm.costCenter || undefined,
        purpose: issueForm.purpose || undefined,
        notes: issueForm.notes || undefined,
        lines: issueForm.lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unit: l.unit,
          unitCost: l.unitCost,
          requestedQty: Number(l.requestedQty),
          approvedQty: 0,
          issuedQty: 0,
        })),
        source: 'Direct',
        requisition_id: linkedRequisitionId || undefined,
      });
      setIssues(prev => [created, ...prev]);
      addNotification(`Issue ${created.issue_number} created${linkedRequisitionId ? ' from requisition' : ''}.`, 'success', 'Inventory');
      setShowForm(false);
      setIssueForm(emptyIssueForm());
      setLinkedRequisitionId(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create issue', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  // ── Transfer form helpers ──
  const addTransferLine = () => {
    const firstItem = items[0];
    setTransferForm(f => ({
      ...f,
      lines: [...f.lines, {
        itemId: firstItem?.id || '',
        itemName: firstItem?.item_name || '',
        unit: firstItem?.unit_of_measure || 'pcs',
        unitCost: Number(firstItem?.last_cost || 0),
        quantity: 0,
      }],
    }));
  };
  const updateTransferLine = (idx: number, patch: Partial<TransferLineDraft>) => {
    setTransferForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  };
  const removeTransferLine = (idx: number) => {
    setTransferForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  };
  const onTransferItemChange = (idx: number, itemId: string) => {
    const it = items.find(x => x.id === itemId);
    updateTransferLine(idx, {
      itemId,
      itemName: it?.item_name || '',
      unit: it?.unit_of_measure || 'pcs',
      unitCost: Number(it?.last_cost || 0),
    });
  };

  const submitTransfer = async () => {
    if (!transferForm.fromStoreId || !transferForm.toStoreId) {
      addNotification('From and To stores are required.', 'warning', 'Inventory');
      return;
    }
    if (transferForm.fromStoreId === transferForm.toStoreId) {
      addNotification('From and To stores must differ.', 'warning', 'Inventory');
      return;
    }
    if (transferForm.lines.length === 0) {
      addNotification('At least one line item is required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const transferValue = transferForm.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
      const created = await createTransfer({
        property_id: currentPropertyId,
        from_store_id: transferForm.fromStoreId,
        to_store_id: transferForm.toStoreId,
        priority: transferForm.priority,
        reason: transferForm.reason || undefined,
        notes: transferForm.notes || undefined,
        transfer_value: transferValue,
        lines: transferForm.lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unit: l.unit,
          unitCost: l.unitCost,
          quantity: Number(l.quantity),
        })),
      });
      setTransfers(prev => [created, ...prev]);
      if ((created as any)._twoLeg) {
        const leg2 = (created as any)._leg2;
        addNotification(`Two-leg transfer created: ${created.transfer_number} (Dept→Central) + ${leg2?.transfer_number} (Central→Dept). Leg 2 auto-completes when Leg 1 is received.`, 'success', 'Inventory');
      } else {
        addNotification(`Transfer ${created.transfer_number} created.`, 'success', 'Inventory');
      }
      setShowForm(false);
      setTransferForm(emptyTransferForm());
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create transfer', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  // ── GRN form helpers ──
  const addGRNLine = () => {
    const firstItem = items[0];
    setGrnForm((f: any) => ({
      ...f,
      lines: [...f.lines, {
        itemId: firstItem?.id || '',
        itemName: firstItem?.item_name || '',
        unit: firstItem?.unit_of_measure || 'pcs',
        orderedQty: 0, deliveredQty: 0, acceptedQty: 0, rejectedQty: 0,
        unitCost: Number(firstItem?.last_cost || 0),
      }],
    }));
  };
  const updateGRNLine = (idx: number, patch: Partial<GRNLineDraft>) => {
    setGrnForm((f: any) => ({ ...f, lines: f.lines.map((l: GRNLineDraft, i: number) => i === idx ? { ...l, ...patch } : l) }));
  };
  const removeGRNLine = (idx: number) => {
    setGrnForm((f: any) => ({ ...f, lines: f.lines.filter((_: any, i: number) => i !== idx) }));
  };
  const onGRNItemChange = (idx: number, itemId: string) => {
    const it = items.find(x => x.id === itemId);
    updateGRNLine(idx, {
      itemId,
      itemName: it?.item_name || '',
      unit: it?.unit_of_measure || 'pcs',
      unitCost: Number(it?.last_cost || 0),
    });
  };

  const submitGRN = async () => {
    if (!grnForm.supplier.trim() || !grnForm.store_id) {
      addNotification('Supplier and store are required.', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const totalValue = (grnForm.lines as GRNLineDraft[]).reduce((s, l) => s + Number(l.acceptedQty) * Number(l.unitCost), 0);
      const created = await createGRN({
        ...grnForm,
        property_id: currentPropertyId,
        storeId: grnForm.store_id,
        receivingDate: grnForm.receiving_date,
        total_value: totalValue,
        lines: (grnForm.lines as GRNLineDraft[]).map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unit: l.unit,
          orderedQty: Number(l.orderedQty),
          deliveredQty: Number(l.deliveredQty),
          acceptedQty: Number(l.acceptedQty),
          rejectedQty: Number(l.rejectedQty),
          unitCost: Number(l.unitCost),
          batchNumber: l.batchNumber || undefined,
          expiryDate: l.expiryDate || undefined,
        })),
      });
      setGrns(prev => [created, ...prev]);
      addNotification(`GRN ${created.grn_number} created.`, 'success', 'Inventory');
      setShowForm(false);
      setGrnForm(emptyGRNForm());
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create GRN', 'error', 'Inventory');
    } finally { setSubmitting(false); }
  };

  const advanceGRN = async (g: UinvGRN, action: string) => {
    setActingOn(g.id); setMenuOpen(null);
    const next: Record<string, GRNStatus> = {
      'Start Inspection': 'Inspecting', 'Accept': 'Accepted', 'Reject': 'Rejected', 'Put Away': 'Put Away',
    };
    const newStatus = next[action];
    if (!newStatus) return;
    try {
      const updated = await updateGRN(g.id, { status: newStatus });
      setGrns(prev => prev.map(x => (x.id === g.id ? updated : x)));
      addNotification(`GRN ${g.grn_number} → ${newStatus}.`, 'success', 'Inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update GRN', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const advance = async (x: any, action: string) => {
    setActingOn(x.id); setMenuOpen(null);
    const transitions: Record<string, string> = {
      'Approve': 'Approved', 'Issue': 'Issued', 'Complete': 'Completed',
      'Ship': 'In Transit', 'Receive': 'Received', 'Cancel': 'Cancelled',
    };
    const newStatus = transitions[action];
    if (!newStatus) return;
    try {
      if (tab === 'transfers') {
        const updated = await updateTransfer(x.id, { status: newStatus });
        setTransfers(prev => prev.map(t => (t.id === x.id ? updated : t)));
        addNotification(`Transfer ${x.transfer_number} → ${newStatus}.`, 'success', 'Inventory');
      } else {
        const updated = await updateIssue(x.id, { approval_status: newStatus });
        setIssues(prev => prev.map(i => (i.id === x.id ? updated : i)));
        addNotification(`${x.source === 'Requisition' ? 'Requisition' : 'Issue'} ${x.issue_number} → ${newStatus}.`, 'success', 'Inventory');
      }
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update', 'error', 'Inventory');
    } finally { setActingOn(null); }
  };

  const ACTIONS: Record<string, string[]> = {
    'Draft': ['Approve'],
    'Pending': ['Approve'],
    'Approved': ['Issue', 'Cancel'],
    'Partially Issued': ['Issue', 'Cancel'],
    'Issued': ['Complete'],
    'In Transit': ['Receive'],
    'Received': [],
    'Completed': [],
    'Cancelled': [],
    'Rejected': [],
  };

  const tabLabel = tab === 'issues' ? 'Issue / Requisition' : tab === 'transfers' ? 'Transfer' : 'GRN';
  const tabIcon = tab === 'issues' ? <ClipboardList size={20} /> : tab === 'transfers' ? <ArrowRight size={20} /> : <Truck size={20} />;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Stock Operations"
        subtitle="Issues & requisitions, inter-store transfers, and goods receiving — unified in one place."
        icon={ArrowLeftRight}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            {tab !== 'borrows' && (
              <button onClick={() => { setShowForm(true); setLinkedRequisitionId(null); setIssueForm(emptyIssueForm()); setTransferForm(emptyTransferForm()); setGrnForm(emptyGRNForm()); }} className={button.primary}><Plus className="w-4 h-4" /> New {tab === 'issues' ? 'Direct Issue' : tabLabel}</button>
            )}
          </div>
        }
      />

      {tab !== 'borrows' && (
      <div className={layout.kpiGrid}>
        <StatCard title="Pending Requisitions" value={counts.pendingRequisitions} icon={ClipboardList} tone="warning" />
        <StatCard title="Active Requisitions" value={counts.activeRequisitions} icon={Truck} tone="info" />
        <StatCard title="Pending Transfers" value={counts.pendingTransfers} icon={ArrowRight} tone="warning" />
        <StatCard title="Pending GRNs" value={counts.pendingGRNs} icon={Truck} tone="warning" />
      </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* ── Tab switcher with icons ── */}
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            <button onClick={() => { setTab('issues'); setStatusFilter('All'); setSourceFilter('All'); }}
              className={['flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all', tab === 'issues' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300'].join(' ')}>
              <ClipboardList className="w-3.5 h-3.5" />
              Issues & Requisitions
              <span className={['ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold', tab === 'issues' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'].join(' ')}>{issues.length}</span>
            </button>
            <button onClick={() => { setTab('transfers'); setStatusFilter('All'); }}
              className={['flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all', tab === 'transfers' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300'].join(' ')}>
              <ArrowRight className="w-3.5 h-3.5" />
              Transfers
              <span className={['ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold', tab === 'transfers' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'].join(' ')}>{transfers.length}</span>
            </button>
            <button onClick={() => { setTab('receiving'); setStatusFilter('All'); }}
              className={['flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all', tab === 'receiving' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300'].join(' ')}>
              <Truck className="w-3.5 h-3.5" />
              Receiving
              <span className={['ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold', tab === 'receiving' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'].join(' ')}>{grns.length}</span>
            </button>
            <button onClick={() => { setTab('borrows'); setStatusFilter('All'); }}
              className={['flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all', tab === 'borrows' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300'].join(' ')}>
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Borrows
            </button>
          </div>

          {/* ── Filters row (hidden for borrows — BorrowsTab has its own) ── */}
          {tab !== 'borrows' && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Source filter (issues tab only) */}
            {tab === 'issues' && (
              <div className="relative">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)}
                  className="pl-8 pr-7 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white appearance-none cursor-pointer hover:border-gray-300 dark:hover:border-slate-600 transition-colors">
                  <option value="All">All Sources</option>
                  <option value="Requisition">Requisitions</option>
                  <option value="Direct">Direct Issues</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            )}

            {/* Status filter */}
            <div className="relative">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="pl-3 pr-7 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white appearance-none cursor-pointer hover:border-gray-300 dark:hover:border-slate-600 transition-colors">
                <option value="All">All Status</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>

            {/* Search */}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Search number, dept, item…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-3.5 h-3.5 text-slate-400" />
                </button>
              )}
            </div>

            {/* Clear all filters */}
            {(statusFilter !== 'All' || sourceFilter !== 'All' || search) && (
              <button onClick={() => { setStatusFilter('All'); setSourceFilter('All'); setSearch(''); }}
                className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
          )}
        </div>

        {/* ── Active filter summary + result count ── */}
        {tab !== 'borrows' && (statusFilter !== 'All' || sourceFilter !== 'All' || search) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700/50">
            <span className="text-xs text-slate-400 font-medium">Showing</span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{filtered.length}</span>
            <span className="text-xs text-slate-400">of {currentList.length} {tabLabel.toLowerCase()}s</span>
            {sourceFilter !== 'All' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                {sourceFilter === 'Requisition' ? 'Requisitions only' : 'Direct Issues only'}
              </span>
            )}
            {statusFilter !== 'All' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                Status: {statusFilter}
              </span>
            )}
            {search && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                "{search}"
              </span>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Borrows tab (inter-departmental loans) ── */}
      {tab === 'borrows' && (
        <BorrowsTab stores={stores} items={items} propertyId={currentPropertyId} notify={notify} />
      )}

      {/* ── Issues / Transfers / Receiving tabs ── */}
      {tab !== 'borrows' && (
      <InventoryTable
        columns={tab === 'issues' ? [
          // ════════════════════════════════════════════════════════════
          // ISSUES TAB — flattened: one row per item, REQ ↔ ISS side by side
          // ════════════════════════════════════════════════════════════
          // ── Col 1: Requisition ──
          {
            key: 'requisition',
            header: 'Requisition',
            widthClass: 'md:w-44 shrink-0',
            render: (x: any) => {
              const req = x.requisition;
              if (!req) return <span className="text-xs text-slate-400">—</span>;
              const tone = statusToneFor(req.approval_status);
              return (
                <IdentityCell
                  icon={<ClipboardList size={16} />}
                  soft={statusTone[tone as keyof typeof statusTone].soft}
                  text={statusTone[tone as keyof typeof statusTone].text}
                  name={req.issue_number || '—'}
                  code={`${req.department || ''}${req.requester ? ' · ' + req.requester : ''}`}
                />
              );
            },
          },
          // ── Col 2: Issue ──
          {
            key: 'issue',
            header: 'Issue',
            widthClass: 'md:w-44 shrink-0',
            render: (x: any) => {
              const iss = x.issue;
              if (!iss) return <span className="text-xs text-slate-400">—</span>;
              const tone = statusToneFor(iss.approval_status);
              return (
                <IdentityCell
                  icon={<Package size={16} />}
                  soft={statusTone[tone as keyof typeof statusTone].soft}
                  text={statusTone[tone as keyof typeof statusTone].text}
                  name={iss.issue_number || '—'}
                  code={iss.approval_status || ''}
                />
              );
            },
          },
          // ── Col 3: Item ──
          {
            key: 'item',
            header: 'Item',
            render: (x: any) => (
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block max-w-[200px]">{x.itemName || '—'}</span>
            ),
          },
          // ── Col 4: Requested ──
          {
            key: 'requested',
            header: 'Requested',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => (
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{x.requestedQty}</span>
            ),
          },
          // ── Col 5: Issued ──
          {
            key: 'issued',
            header: 'Issued',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const isFull = x.issuedQty > 0 && x.issuedQty >= x.requestedQty;
              const isPartial = x.issuedQty > 0 && x.issuedQty < x.requestedQty;
              return (
                <span className={`text-sm font-bold tabular-nums ${isFull ? 'text-emerald-600' : isPartial ? 'text-amber-600' : 'text-slate-400'}`}>
                  {x.issuedQty}
                </span>
              );
            },
          },
          // ── Col 6: Remaining ──
          {
            key: 'remaining',
            header: 'Remaining',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const remaining = Math.max(0, x.requestedQty - x.issuedQty);
              return remaining > 0
                ? <span className="text-sm font-bold text-amber-600 tabular-nums">{remaining}</span>
                : <span className="text-sm text-emerald-600">✓</span>;
            },
          },
          // ── Col 7: Unit ──
          {
            key: 'unit',
            header: 'Unit',
            widthClass: 'md:w-20 shrink-0',
            render: (x: any) => <span className="text-xs text-slate-500">{x.unit || '—'}</span>,
          },
          // ── Col 8: Store ──
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-32 shrink-0',
            render: (x: any) => <span className="text-xs text-slate-600 dark:text-slate-400 truncate block max-w-[120px]">{x.storeName || '—'}</span>,
          },
          // ── Col 9: Date ──
          {
            key: 'date',
            header: 'Required',
            widthClass: 'md:w-28 shrink-0',
            render: (x: any) => <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{x.requiredDate?.slice(0, 10) || '—'}</span>,
          },
          // ── Col 10: Priority ──
          {
            key: 'priority',
            header: 'Priority',
            widthClass: 'md:w-24 shrink-0',
            render: (x: any) => (
              <Badge tone={x.priority === 'Urgent' ? 'danger' : x.priority === 'High' ? 'warning' : 'neutral'}>{x.priority || 'Normal'}</Badge>
            ),
          },
          // ── Col 11: Status ──
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => {
              const tone = statusToneFor(x.status);
              return (
                <div className="flex items-center gap-1.5">
                  <Badge tone={tone as any} variant="solid">{x.status}</Badge>
                  {x.status === 'Partially Issued' && <Badge tone="info" variant="soft">Partial</Badge>}
                </div>
              );
            },
          },
          // ── Col 12: Ops ──
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (x: any) => {
              const p = x.parent;
              const xStatus = x.status;
              const isRequisition = x.parentType === 'Requisition';
              // Requisitions: approve/reject when Pending
              const canApprove = isRequisition && xStatus === 'Pending';
              const canReject = isRequisition && xStatus === 'Pending';
              // Direct issues: approve when Draft or Pending (no rejection — direct issues are inventory-created)
              const canApproveDirect = !isRequisition && (xStatus === 'Draft' || xStatus === 'Pending');
              // Both: fulfill when Approved or Partially Issued
              const canFulfill = xStatus === 'Approved' || xStatus === 'Partially Issued';
              // Both: cancel when not yet issued
              const canCancel = xStatus === 'Approved' || xStatus === 'Partially Issued' || xStatus === 'Pending' || xStatus === 'Draft';
              const hasActions = canApprove || canReject || canApproveDirect || canFulfill || canCancel;
              return (
                <OpsCell>
                  <IconButton onClick={() => setDetailIssue(p)} title="View details">
                    <ArrowRight className="w-4 h-4" />
                  </IconButton>
                  {hasActions && (
                    <div className="relative">
                      <IconButton onClick={() => setMenuOpen(menuOpen === x.rowId ? null : x.rowId)} title="Actions">
                        <MoreVertical size={18} />
                      </IconButton>
                      {menuOpen === x.rowId && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                          {canApprove && (
                            <button onClick={() => approveRequisition(p.id)} disabled={actingOn === p.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />} Approve
                            </button>
                          )}
                          {canReject && (
                            <button onClick={() => rejectRequisition(p.id)} disabled={actingOn === p.id}
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                              <XCircle className="w-4 h-4" /> Reject
                            </button>
                          )}
                          {canApproveDirect && (
                            <button onClick={() => approveRequisition(p.id)} disabled={actingOn === p.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />} Approve
                            </button>
                          )}
                          {canFulfill && (
                            <button onClick={() => openFulfill(p)} disabled={actingOn === p.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              <Truck className="w-4 h-4 text-blue-600" /> {xStatus === 'Partially Issued' ? 'Continue Fulfilling' : 'Issue / Fulfill'}
                            </button>
                          )}
                          {canCancel && (
                            <button onClick={() => { setActingOn(p.id); updateIssue(p.id, { approval_status: 'Cancelled' }).then(u => { setIssues(prev => prev.map(i => i.id === p.id ? u : i)); setActingOn(null); setMenuOpen(null); addNotification(`${isRequisition ? 'Requisition' : 'Issue'} ${p.issue_number} cancelled.`, 'warning', 'Inventory'); }).catch(() => { setActingOn(null); setMenuOpen(null); }); }} disabled={actingOn === p.id}
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel
                            </button>
                          )}
                          <button onClick={() => setDetailIssue(p)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                            <Package className="w-4 h-4" /> View Details
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </OpsCell>
              );
            },
          },
        ] : [
          // ════════════════════════════════════════════════════════════
          // TRANSFERS / RECEIVING TABS — original row-per-record layout
          // ════════════════════════════════════════════════════════════
          // ── Col 1: Number + type code ──
          {
            key: 'identity',
            header: tabLabel,
            widthClass: 'md:w-48 shrink-0',
            render: (x: any) => {
              const num = tab === 'transfers' ? x.transfer_number : x.grn_number;
              const xStatus = tab === 'transfers' || tab === 'receiving' ? x.status : x.approval_status;
              const tone = tab === 'receiving' ? (GRN_STATUS_TONE[xStatus] || 'neutral') : statusToneFor(xStatus);
              const typeCode = tab === 'transfers' ? 'TRF' : 'GRN';
              return (
                <IdentityCell
                  icon={tabIcon}
                  soft={statusTone[tone as keyof typeof statusTone].soft}
                  text={statusTone[tone as keyof typeof statusTone].text}
                  name={num || '—'}
                  code={typeCode}
                />
              );
            },
          },
          // ── Col 2: Route / Supplier ──
          {
            key: 'party',
            header: tab === 'transfers' ? 'Route' : 'Supplier',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => {
              if (tab === 'transfers') {
                const isTwoLeg = x.leg === 2 || (x.via_store_id && x.via_store_id === MAIN_STORE_ID && x.from_store_id !== MAIN_STORE_ID && x.to_store_id !== MAIN_STORE_ID);
                return (
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[130px]">{x.from_store?.store_name || '—'}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1"><ArrowRight className="w-3 h-3" />{x.to_store?.store_name || '—'}</p>
                    {isTwoLeg && (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        LEG {x.leg || 1} · VIA CENTRAL
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[130px]">{x.supplier || '—'}</p>
                  {x.purchase_order && <p className="text-[10px] text-slate-400">PO: {x.purchase_order}</p>}
                </div>
              );
            },
          },
          // ── Col 3: Items ──
          {
            key: 'items',
            header: 'Items',
            render: (x: any) => {
              const lines = x.lines || [];
              const names = lines.map((l: any) => l.itemName).filter(Boolean);
              if (names.length === 0) return <span className="text-xs text-slate-400">—</span>;
              return <p className="text-sm text-slate-700 dark:text-slate-200 truncate max-w-[200px]">{names.join(', ')}</p>;
            },
          },
          // ── Col 4b: Qty (transfers) ──
          ...(tab === 'transfers' ? [{
            key: 'qty',
            header: 'Qty',
            widthClass: 'md:w-20 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const total = (x.lines || []).reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0);
              return <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{total}</span>;
            },
          }] : []),
          // ── Col 4c: Delivered / Accepted (receiving) ──
          ...(tab === 'receiving' ? [{
            key: 'delivered',
            header: 'Delivered',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const total = (x.lines || []).reduce((s: number, l: any) => s + (Number(l.deliveredQty) || 0), 0);
              return <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{total}</span>;
            },
          }] : []),
          ...(tab === 'receiving' ? [{
            key: 'accepted',
            header: 'Accepted',
            widthClass: 'md:w-24 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const totalAccepted = (x.lines || []).reduce((s: number, l: any) => s + (Number(l.acceptedQty) || 0), 0);
              const totalDelivered = (x.lines || []).reduce((s: number, l: any) => s + (Number(l.deliveredQty) || 0), 0);
              const isPartial = totalAccepted > 0 && totalAccepted < totalDelivered;
              const isFull = totalAccepted > 0 && totalAccepted >= totalDelivered;
              return (
                <span className={`text-sm font-bold tabular-nums ${isFull ? 'text-emerald-600' : isPartial ? 'text-amber-600' : 'text-slate-400'}`}>
                  {totalAccepted}
                </span>
              );
            },
          }] : []),
          // ── Col 5: Value ──
          {
            key: 'value',
            header: 'Value',
            widthClass: 'md:w-28 shrink-0',
            align: 'right' as const,
            render: (x: any) => {
              const val = tab === 'transfers' ? x.transfer_value : x.total_value;
              return <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{val != null ? `$${Number(val).toFixed(2)}` : '—'}</span>;
            },
          },
          // ── Col 6: Store (receiving only) ──
          ...(tab === 'receiving' ? [{
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => (
              <span className="text-xs text-slate-600 dark:text-slate-400 truncate block max-w-[130px]">{x.store?.store_name || '—'}</span>
            ),
          }] : []),
          // ── Col 7: Date ──
          {
            key: 'date',
            header: tab === 'transfers' ? 'Date' : 'Received',
            widthClass: 'md:w-28 shrink-0',
            render: (x: any) => {
              const dateVal = tab === 'receiving' ? x.receiving_date : (x.required_date || x.created_at?.slice(0, 10));
              return <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{dateVal || '—'}</span>;
            },
          },
          // ── Col 8: Priority ──
          {
            key: 'priority',
            header: 'Priority',
            widthClass: 'md:w-24 shrink-0',
            render: (x: any) => (
              <Badge tone={x.priority === 'Urgent' ? 'danger' : x.priority === 'High' ? 'warning' : 'neutral'}>{x.priority || 'Normal'}</Badge>
            ),
          },
          // ── Col 9: Status ──
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-36 shrink-0',
            render: (x: any) => {
              const xStatus = x.status;
              const tone = tab === 'receiving' ? (GRN_STATUS_TONE[xStatus] || 'neutral') : statusToneFor(xStatus);
              return (
                <div className="flex items-center gap-1.5">
                  <Badge tone={tone as any} variant="solid">{xStatus}</Badge>
                  {xStatus === 'Partially Issued' && <Badge tone="info" variant="soft">Partial</Badge>}
                </div>
              );
            },
          },
          // ── Col 10: Ops ──
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (x: any) => {
              const xStatus = x.status;
              const actions = ACTIONS[xStatus] || [];
              const grnActions = tab === 'receiving' ? (GRN_NEXT_ACTIONS[xStatus as GRNStatus] || []) : [];
              const hasActions = actions.length > 0 || grnActions.length > 0;
              return (
                <OpsCell>
                  <IconButton onClick={() => tab === 'receiving' ? setDetailGRN(x) : setDetailIssue(x)} title="View details">
                    {tab === 'receiving' ? <Eye className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </IconButton>
                  {hasActions && (
                    <div className="relative">
                      <IconButton onClick={() => setMenuOpen(menuOpen === x.id ? null : x.id)} title="Actions">
                        <MoreVertical size={18} />
                      </IconButton>
                      {menuOpen === x.id && (
                        <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1">
                          {tab === 'receiving' && grnActions.map(a => (
                            <button key={a} onClick={() => advanceGRN(x, a)} disabled={actingOn === x.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === x.id ? <Loader2 className="w-4 h-4 animate-spin" /> : a === 'Reject' ? <XCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4" />} {a}
                            </button>
                          ))}
                          {tab === 'transfers' && actions.map(a => (
                            <button key={a} onClick={() => advance(x, a)} disabled={actingOn === x.id}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50">
                              {actingOn === x.id ? <Loader2 className="w-4 h-4 animate-spin" /> : a === 'Cancel' ? <XCircle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4" />} {a}
                            </button>
                          ))}
                          <button onClick={() => tab === 'receiving' ? setDetailGRN(x) : setDetailIssue(x)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2">
                            <Package className="w-4 h-4" /> View Details
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </OpsCell>
              );
            },
          },
        ]}
        rows={filtered}
        rowKey={(x: any) => x.rowId || x.id}
        loading={loading}
        loadingMessage="Loading…"
        error={error}
        onRetry={load}
        emptyMessage={currentList.length === 0 ? `No ${tabLabel.toLowerCase()}s yet.` : `No ${tabLabel.toLowerCase()}s match the filter.`}
        canExpand={tab !== 'issues' ? ((x: any) => (x.lines || []).length > 1) : undefined}
        renderExpanded={tab !== 'issues' ? ((x: any) => {
          const lines = x.lines || [];
          const isTransfer = tab === 'transfers';
          const isReceiving = tab === 'receiving';
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Item</th>
                    {isTransfer && <th className="px-4 py-3 font-medium text-right">Qty</th>}
                    {isReceiving && <th className="px-4 py-3 font-medium text-right">Ordered</th>}
                    {isReceiving && <th className="px-4 py-3 font-medium text-right">Delivered</th>}
                    {isReceiving && <th className="px-4 py-3 font-medium text-right">Accepted</th>}
                    {isReceiving && <th className="px-4 py-3 font-medium text-right">Rejected</th>}
                    <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium text-right">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {lines.map((line: any, idx: number) => {
                    const requested = Number(line.requestedQty || line.quantity || 0);
                    const unitCost = Number(line.cost || line.unitCost || 0);
                    const qtyForTotal = isTransfer ? requested : Number(line.acceptedQty || 0);
                    const total = qtyForTotal * unitCost;
                    return (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{line.itemName || '—'}</td>
                        {isTransfer && <td className="px-4 py-3 text-right tabular-nums">{requested}</td>}
                        {isReceiving && <td className="px-4 py-3 text-right tabular-nums">{Number(line.orderedQty || 0)}</td>}
                        {isReceiving && <td className="px-4 py-3 text-right tabular-nums">{Number(line.deliveredQty || 0)}</td>}
                        {isReceiving && <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-medium">{Number(line.acceptedQty || 0)}</td>}
                        {isReceiving && <td className="px-4 py-3 text-right tabular-nums text-red-500">{Number(line.rejectedQty || 0)}</td>}
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">${unitCost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">${total.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{line.unit || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }) : undefined}
      />
      )}

      {/* ── Detail Modal ── */}
      <ModalSystem isOpen={!!detailIssue} onClose={() => setDetailIssue(null)} variant="detail" size="lg"
        title={detailIssue?.issue_number || detailIssue?.transfer_number || 'Detail'}
        subtitle={detailIssue ? `${detailIssue.department || ''} · ${detailIssue.approval_status || detailIssue.status}` : ''}>
        {detailIssue && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><p className="text-[10px] uppercase font-black text-slate-400">Department</p><p className="text-sm font-bold">{detailIssue.department || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Requester</p><p className="text-sm font-bold">{detailIssue.requester || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Store</p><p className="text-sm font-bold">{detailIssue.store?.store_name || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Priority</p><p className="text-sm font-bold">{detailIssue.priority || 'Normal'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Required Date</p><p className="text-sm font-bold">{detailIssue.required_date?.slice(0, 10) || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Status</p><Badge tone={statusToneFor(detailIssue.approval_status || detailIssue.status)} variant="solid">{detailIssue.approval_status || detailIssue.status}</Badge></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Approved By</p><p className="text-sm font-bold">{detailIssue.approved_by || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Issued By</p><p className="text-sm font-bold">{detailIssue.issued_by || '—'}</p></div>
            </div>
            {/* Linked requisition / issue relationship */}
            {detailIssue.source !== 'Requisition' && detailIssue.requisition_id && (() => {
              const req = requisitionById[detailIssue.requisition_id];
              return req ? (
                <div className="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase font-black text-indigo-400">Linked Requisition</p>
                    <button onClick={() => setDetailIssue(req)} className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:underline">
                      {req.issue_number}
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">· {req.department} · {req.approval_status}</span>
                  </div>
                </div>
              ) : null;
            })()}
            {detailIssue.source === 'Requisition' && (issuesByRequisitionId[detailIssue.id] || []).length > 0 && (
              <div className="px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <p className="text-[10px] uppercase font-black text-indigo-400">Linked Issues ({(issuesByRequisitionId[detailIssue.id] || []).length})</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(issuesByRequisitionId[detailIssue.id] || []).map(iss => (
                    <button key={iss.id} onClick={() => setDetailIssue(iss)}
                      className="text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                      {iss.issue_number}
                      <span className="text-[10px] font-normal text-slate-400">· {iss.approval_status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {detailIssue.purpose && <div><p className="text-[10px] uppercase font-black text-slate-400">Purpose</p><p className="text-sm">{detailIssue.purpose}</p></div>}
            <div>
              <p className="text-[10px] uppercase font-black text-slate-400 mb-2">Items</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium text-right">Requested</th>
                      <th className="px-4 py-3 font-medium text-right">Approved</th>
                      <th className="px-4 py-3 font-medium text-right">Issued</th>
                      <th className="px-4 py-3 font-medium text-right">Remaining</th>
                      <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Total Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {(detailIssue.lines || []).map((line, idx) => {
                      const requested = line.requestedQty || line.quantity || 0;
                      const issued = line.issuedQty || 0;
                      const remaining = Math.max(0, requested - issued);
                      const unitCost = line.cost || line.unitCost || 0;
                      const totalCost = issued * unitCost;
                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{line.itemName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{requested || '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">{line.approvedQty || '—'}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-medium">{issued}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{remaining > 0 ? <span className="text-amber-600 font-medium">{remaining}</span> : <span className="text-emerald-600">✓</span>}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">${unitCost.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">${totalCost.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{line.unit}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {detailIssue.notes && <div><p className="text-[10px] uppercase font-black text-slate-400">Notes</p><p className="text-sm">{detailIssue.notes}</p></div>}
          </div>
        )}
      </ModalSystem>

      {/* ── Fulfill / Issue Modal (partial fulfillment) ── */}
      <ModalSystem isOpen={!!fulfillIssue} onClose={() => setFulfillIssue(null)} variant="form" size="lg"
        title={`Issue: ${fulfillIssue?.issue_number || ''}`}
        subtitle={`Issue items to ${fulfillIssue?.department || ''}. Partial quantities are supported.`}
        confirmLabel="Issue Items" onConfirm={submitFulfill} loading={submitting} confirmColor="emerald">
        {fulfillIssue && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter the quantity to issue <strong>now</strong>. Remaining items can be fulfilled later. The backend accumulates issued quantities across multiple partial issues.</p>
            {(fulfillIssue.lines || []).map((line, idx) => {
              const stock = stockMap[line.itemId] || [];
              const requested = line.requestedQty || 0;
              const alreadyIssued = line.issuedQty || 0;
              const remaining = Math.max(0, requested - alreadyIssued);
              const issueNow = fulfillQty[line.itemId] ?? 0;
              const newRemaining = Math.max(0, remaining - issueNow);
              const isFullyIssued = alreadyIssued >= requested;
              return (
                <div key={idx} className={`p-3 border rounded-xl space-y-2 ${isFullyIssued ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-bold">{line.itemName}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                        <span>Requested: <strong className="text-slate-700 dark:text-slate-300">{requested}</strong> {line.unit}</span>
                        <span>Already issued: <strong className="text-emerald-600">{alreadyIssued}</strong> {line.unit}</span>
                        <span>Remaining: <strong className={remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}>{remaining}</strong> {line.unit}</span>
                      </div>
                    </div>
                    {isFullyIssued ? (
                      <Badge tone="success" variant="solid">Fully Issued</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] uppercase font-black text-slate-400">Issue Now</label>
                        <input type="number" min="0" max={remaining}
                          value={fulfillQty[line.itemId] ?? 0}
                          onChange={e => setFulfillQty(prev => ({ ...prev, [line.itemId]: Math.min(remaining, Math.max(0, +e.target.value)) }))}
                          className="w-20 px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-center" />
                      </div>
                    )}
                  </div>
                  {issueNow > 0 && newRemaining > 0 && (
                    <p className="text-[11px] text-amber-600 font-medium">After this issue: {newRemaining} {line.unit} will remain to be fulfilled later.</p>
                  )}
                  {issueNow > 0 && newRemaining === 0 && !isFullyIssued && (
                    <p className="text-[11px] text-emerald-600 font-medium">This item will be fully issued after this transaction.</p>
                  )}
                  {stock.length > 0 && !isFullyIssued && (
                    <div className="flex flex-wrap gap-1.5">
                      {stock.slice(0, 4).map((s, si) => (
                        <TagPill key={si}>{s.store?.store_name || '—'}: {s.on_hand} {line.unit}</TagPill>
                      ))}
                    </div>
                  )}
                  {stock.length === 0 && !isFullyIssued && (
                    <p className="text-xs text-amber-600">No stock available for this item.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ModalSystem>

      {/* ── New Issue / Transfer / GRN modal ── */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="lg"
        title={tab === 'issues' ? 'New Department Issue' : tab === 'transfers' ? 'New Store Transfer' : 'New Goods Receiving Note'}
        confirmLabel={tab === 'receiving' ? 'Create GRN' : 'Create'}
        onConfirm={tab === 'issues' ? submitIssue : tab === 'transfers' ? submitTransfer : submitGRN}
        loading={submitting} confirmColor="emerald">
        {tab === 'receiving' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Supplier Name *"><input className={inputClass} value={grnForm.supplier} onChange={e => setGrnForm({ ...grnForm, supplier: e.target.value })} /></Field>
              <Field label="Store *">
                <select className={inputClass} value={grnForm.store_id} onChange={e => setGrnForm({ ...grnForm, store_id: e.target.value })}>
                  <option value="">Select store…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                </select>
              </Field>
              <Field label="PO Reference"><input className={inputClass} value={grnForm.purchase_order} onChange={e => setGrnForm({ ...grnForm, purchase_order: e.target.value })} /></Field>
              <Field label="Received Date"><input type="date" className={inputClass} value={grnForm.receiving_date} onChange={e => setGrnForm({ ...grnForm, receiving_date: e.target.value })} /></Field>
              <Field label="Vehicle Reference"><input className={inputClass} value={grnForm.vehicle_reference} onChange={e => setGrnForm({ ...grnForm, vehicle_reference: e.target.value })} /></Field>
              <Field label="Notes"><input className={inputClass} value={grnForm.notes} onChange={e => setGrnForm({ ...grnForm, notes: e.target.value })} /></Field>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Received Lines</span>
                <button onClick={addGRNLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add item</button>
              </div>
              {(grnForm.lines || []).length === 0 && <p className="text-xs text-gray-400 py-2">No items added yet.</p>}
              <div className="space-y-2">
                {(grnForm.lines || []).map((l: GRNLineDraft, idx: number) => (
                  <div key={idx} className="border border-gray-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-9">
                        <select className={inputClass} value={l.itemId} onChange={e => onGRNItemChange(idx, e.target.value)}>
                          <option value="">Select item…</option>
                          {items.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
                        </select>
                      </div>
                      <div className="col-span-2 text-xs text-gray-500">{l.unit} · ${l.unitCost.toFixed(2)}</div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => removeGRNLine(idx)} className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4 text-red-500" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Field label="Ordered"><input type="number" min={0} className={inputClass} value={l.orderedQty} onChange={e => updateGRNLine(idx, { orderedQty: +e.target.value })} /></Field>
                      <Field label="Delivered"><input type="number" min={0} className={inputClass} value={l.deliveredQty} onChange={e => updateGRNLine(idx, { deliveredQty: +e.target.value })} /></Field>
                      <Field label="Accepted"><input type="number" min={0} className={inputClass} value={l.acceptedQty} onChange={e => updateGRNLine(idx, { acceptedQty: +e.target.value })} /></Field>
                      <Field label="Rejected"><input type="number" min={0} className={inputClass} value={l.rejectedQty} onChange={e => updateGRNLine(idx, { rejectedQty: +e.target.value })} /></Field>
                      <Field label="Unit Cost"><input type="number" step="0.01" className={inputClass} value={l.unitCost} onChange={e => updateGRNLine(idx, { unitCost: +e.target.value })} /></Field>
                      <Field label="Batch #"><input className={inputClass} value={l.batchNumber || ''} onChange={e => updateGRNLine(idx, { batchNumber: e.target.value })} /></Field>
                      <Field label="Expiry Date"><input type="date" className={inputClass} value={l.expiryDate || ''} onChange={e => updateGRNLine(idx, { expiryDate: e.target.value })} /></Field>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : tab === 'issues' ? (
          <div className="space-y-4">
            {/* Link to requisition — always visible */}
            <Field label="Requisition Order (optional)">
              {availableRequisitions.length > 0 ? (
                <select
                  className={selectClass}
                  value={linkedRequisitionId || ''}
                  onChange={e => {
                    if (e.target.value) { loadFromRequisition(e.target.value); }
                    else { setLinkedRequisitionId(null); setIssueForm(emptyIssueForm()); }
                  }}
                >
                  <option value="">— Create from scratch —</option>
                  {availableRequisitions.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.issue_number} · {r.department} · {r.approval_status} · {(r.lines || []).length} items
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2.5 text-xs text-slate-400 border border-dashed border-gray-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  No approved requisitions available to link. Create a requisition from the Requisitions tab first, then approve it to link here.
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-1">Selecting a requisition auto-fills the form with remaining quantities. The issue will be linked back to the requisition via <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">requisition_id</code>.</p>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Department *">
                <select className={selectClass} value={issueForm.department} onChange={e => setIssueForm({ ...issueForm, department: e.target.value })}>
                  <option value="">Select department…</option>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Source Store (Main Warehouse) *">
                <select className={selectClass} value={issueForm.storeId} onChange={e => setIssueForm({ ...issueForm, storeId: e.target.value })}>
                  <option value="">Select store…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}{s.store_type === 'Main' ? ' (Main Gate)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Requester"><input className={inputClass} value={issueForm.requester} onChange={e => setIssueForm({ ...issueForm, requester: e.target.value })} /></Field>
              <Field label="Priority">
                <select className={selectClass} value={issueForm.priority} onChange={e => setIssueForm({ ...issueForm, priority: e.target.value })}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Required Date"><input type="date" className={inputClass} value={issueForm.requiredDate} onChange={e => setIssueForm({ ...issueForm, requiredDate: e.target.value })} /></Field>
              <Field label="Cost Center"><input className={inputClass} value={issueForm.costCenter} onChange={e => setIssueForm({ ...issueForm, costCenter: e.target.value })} /></Field>
              <Field label="Purpose"><input className={inputClass} value={issueForm.purpose} onChange={e => setIssueForm({ ...issueForm, purpose: e.target.value })} /></Field>
              <Field label="Notes"><input className={inputClass} value={issueForm.notes} onChange={e => setIssueForm({ ...issueForm, notes: e.target.value })} /></Field>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Line Items</span>
                <button onClick={addIssueLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add item</button>
              </div>
              {issueForm.lines.length === 0 && <p className="text-xs text-gray-400 py-2">No items added yet.</p>}
              <div className="space-y-2">
                {issueForm.lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6">
                      <select className={selectClass} value={l.itemId} onChange={e => onIssueItemChange(idx, e.target.value)}>
                        <option value="">Select item…</option>
                        {allowedIssueItems.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input type="number" min={0} placeholder="Qty" className={inputClass} value={l.requestedQty} onChange={e => updateIssueLine(idx, { requestedQty: +e.target.value })} />
                    </div>
                    <div className="col-span-2 text-xs text-gray-500">{l.unit} · ${l.unitCost.toFixed(2)}</div>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeIssueLine(idx)} className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="From Store *">
                <select className={selectClass} value={transferForm.fromStoreId} onChange={e => setTransferForm({ ...transferForm, fromStoreId: e.target.value })}>
                  <option value="">Select store…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                </select>
              </Field>
              <Field label="To Store *">
                <select className={selectClass} value={transferForm.toStoreId} onChange={e => setTransferForm({ ...transferForm, toStoreId: e.target.value })}>
                  <option value="">Select store…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className={selectClass} value={transferForm.priority} onChange={e => setTransferForm({ ...transferForm, priority: e.target.value })}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Reason"><input className={inputClass} value={transferForm.reason} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value })} /></Field>
              <Field label="Notes"><input className={inputClass} value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} /></Field>
            </div>

            {/* Two-leg routing notice */}
            {transferForm.fromStoreId && transferForm.toStoreId
              && transferForm.fromStoreId !== MAIN_STORE_ID
              && transferForm.toStoreId !== MAIN_STORE_ID
              && transferForm.fromStoreId !== transferForm.toStoreId && (
              <div className="px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <ArrowLeftRight className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong>Two-leg transfer via Central:</strong> This department-to-department transfer will be automatically routed through Central Warehouse (Main Warehouse).
                  <div className="mt-1 text-xs">
                    Leg 1: {stores.find(s => s.id === transferForm.fromStoreId)?.store_name || 'Dept A'} → Central Warehouse<br/>
                    Leg 2: Central Warehouse → {stores.find(s => s.id === transferForm.toStoreId)?.store_name || 'Dept B'} (auto-completed when Leg 1 is received)
                  </div>
                </div>
              </div>
            )}

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Line Items</span>
                <button onClick={addTransferLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add item</button>
              </div>
              {transferForm.lines.length === 0 && <p className="text-xs text-gray-400 py-2">No items added yet.</p>}
              <div className="space-y-2">
                {transferForm.lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6">
                      <select className={selectClass} value={l.itemId} onChange={e => onTransferItemChange(idx, e.target.value)}>
                        <option value="">Select item…</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input type="number" min={0} placeholder="Qty" className={inputClass} value={l.quantity} onChange={e => updateTransferLine(idx, { quantity: +e.target.value })} />
                    </div>
                    <div className="col-span-2 text-xs text-gray-500">{l.unit} · ${l.unitCost.toFixed(2)}</div>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeTransferLine(idx)} className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ModalSystem>

      {/* ── GRN Detail Modal ── */}
      <ModalSystem isOpen={!!detailGRN} onClose={() => setDetailGRN(null)} variant="form" size="lg"
        title={detailGRN?.grn_number || 'GRN Detail'} subtitle={detailGRN?.supplier} confirmLabel="Close" onConfirm={() => setDetailGRN(null)} confirmColor="neutral">
        {detailGRN && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-500">Status:</span> <Badge tone={GRN_STATUS_TONE[detailGRN.status] || 'neutral'} variant="solid">{detailGRN.status}</Badge></div>
              <div><span className="text-gray-500">Received:</span> {detailGRN.receiving_date}</div>
              <div><span className="text-gray-500">PO Ref:</span> {detailGRN.purchase_order || '—'}</div>
              <div><span className="text-gray-500">Vehicle:</span> {detailGRN.vehicle_reference || '—'}</div>
              {detailGRN.total_value != null && <div><span className="text-gray-500">Total Value:</span> ${detailGRN.total_value.toFixed(2)}</div>}
            </div>
            {detailGRN.notes && <div><span className="text-gray-500">Notes:</span> {detailGRN.notes}</div>}
            {detailGRN.lines && detailGRN.lines.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr><th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium text-right">Ordered</th><th className="px-4 py-3 font-medium text-right">Delivered</th><th className="px-4 py-3 font-medium text-right">Accepted</th><th className="px-4 py-3 font-medium text-right">Rejected</th><th className="px-4 py-3 font-medium text-right">Cost</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {detailGRN.lines.map((l: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"><td className="px-4 py-3 text-slate-700 dark:text-slate-200">{l.itemName || l.itemId}</td><td className="px-4 py-3 text-right">{l.orderedQty}</td><td className="px-4 py-3 text-right">{l.deliveredQty}</td><td className="px-4 py-3 text-right text-emerald-600">{l.acceptedQty}</td><td className="px-4 py-3 text-right text-red-500">{l.rejectedQty}</td><td className="px-4 py-3 text-right">${l.unitCost}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </ModalSystem>


    </div>
  );
};

export default StockOperationsModule;
