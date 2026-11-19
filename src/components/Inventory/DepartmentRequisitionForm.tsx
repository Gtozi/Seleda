/**
 * Department Requisition Form — embedded in department portals.
 *
 * Lets any department:
 *   - Create a requisition (request items from inventory stores)
 *   - Track their own requisitions and their status
 *   - View details of a requisition
 *
 * Uses the unified uinv_issues system as the single source of truth.
 * The inventory portal fulfills these requisitions from /erp/inventory/requisitions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList, Plus, Clock, Loader2, ServerCrash, ChevronRight, Package,
  Bell, BellRing,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchIssues, createIssue, fetchItems, fetchStores,
  type UinvIssue, type UinvItem, type UinvStore,
} from '../../services/inventoryService';
import { filterItemsForDepartment } from '../../config/departmentCategories';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

interface DeptNotification {
  id: string;
  department: string;
  issue_id: string | null;
  issue_number: string | null;
  notification_type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

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

interface Props {
  /** The department name (must match the `department` field on uinv_issues). */
  department: string;
  hideStats?: boolean;
  hideHeader?: boolean;
  /** Increment to trigger a refresh from parent */
  refreshTrigger?: number;
  /** Increment to open the New Requisition form from parent */
  newRequisitionTrigger?: number;
}

const DepartmentRequisitionForm: React.FC<Props> = ({ department, hideStats, hideHeader, refreshTrigger, newRequisitionTrigger }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [issues, setIssues] = useState<UinvIssue[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detailIssue, setDetailIssue] = useState<UinvIssue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notifications, setNotifications] = useState<DeptNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const prevIssueStatuses = useRef<Record<string, string>>({});

  // Form state
  const [formLines, setFormLines] = useState<{ itemId: string; itemName: string; quantity: number; unit: string }[]>([]);
  const [formPriority, setFormPriority] = useState('Normal');
  const [formPurpose, setFormPurpose] = useState('');
  const [formRequiredDate, setFormRequiredDate] = useState('');
  const [formRequester, setFormRequester] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issueData, itemData, storeData] = await Promise.all([
        fetchIssues({ propertyId: currentPropertyId || undefined, department }),
        fetchItems({ propertyId: currentPropertyId || undefined }).catch(() => [] as UinvItem[]),
        fetchStores({ propertyId: currentPropertyId || undefined }).catch(() => [] as UinvStore[]),
      ]);

      // Detect status changes since last load and surface local toasts
      const newStatusMap: Record<string, string> = {};
      issueData.forEach((iss) => {
        newStatusMap[iss.id] = iss.approval_status || '';
        const prev = prevIssueStatuses.current[iss.id];
        if (prev && prev !== iss.approval_status) {
          const msg = `Requisition ${iss.issue_number} status changed: ${prev} → ${iss.approval_status}`;
          const type = iss.approval_status === 'Rejected' || iss.approval_status === 'Cancelled' ? 'warning' : 'success';
          addNotification(msg, type as any, department as any);
        }
      });
      prevIssueStatuses.current = newStatusMap;

      setIssues(issueData);
      setItems(itemData);
      setStores(storeData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, department, addNotification]);

  useEffect(() => { load(); }, [load]);

  // External trigger: refresh
  useEffect(() => { if (refreshTrigger && refreshTrigger > 0) load(); }, [refreshTrigger]);

  // Fetch unread notifications for this department
  const loadNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams({ department, unreadOnly: 'true' });
      if (currentPropertyId) params.set('propertyId', currentPropertyId);
      const res = await fetch(`/api/uinv-portal/notifications?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data || []);
      }
    } catch { /* ignore */ }
  }, [department, currentPropertyId]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  // Auto-refresh every 30 seconds to pick up status changes from Inventory
  useEffect(() => {
    const interval = setInterval(() => {
      load();
      loadNotifications();
    }, 30000);
    return () => clearInterval(interval);
  }, [load, loadNotifications]);

  const markAllRead = useCallback(async () => {
    try {
      await fetch('/api/uinv-portal/notifications/read-all', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department, propertyId: currentPropertyId }),
      });
      setNotifications([]);
    } catch { /* ignore */ }
  }, [department, currentPropertyId]);

  const unreadCount = notifications.length;

  // Only items whose category matches this department can be requested
  const allowedItems = useMemo(() => filterItemsForDepartment(items, department), [items, department]);

  const counts = {
    total: issues.length,
    pending: issues.filter(i => i.approval_status === 'Pending').length,
    approved: issues.filter(i => i.approval_status === 'Approved').length,
    issued: issues.filter(i => i.approval_status === 'Issued').length,
  };

  const openCreateForm = () => {
    setFormLines([{ itemId: '', itemName: '', quantity: 1, unit: 'PCS' }]);
    setFormPriority('Normal');
    setFormPurpose('');
    setFormRequiredDate(new Date().toISOString().split('T')[0]);
    setFormRequester('');
    setShowForm(true);
  };

  // External trigger: new requisition
  useEffect(() => { if (newRequisitionTrigger && newRequisitionTrigger > 0) openCreateForm(); }, [newRequisitionTrigger]);

  const addLine = () => {
    setFormLines(prev => [...prev, { itemId: '', itemName: '', quantity: 1, unit: 'PCS' }]);
  };

  const removeLine = (idx: number) => {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: string, value: any) => {
    setFormLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'itemId') {
        const item = items.find(it => it.id === value);
        return { ...l, itemId: value, itemName: item?.item_name || '', unit: item?.unit_of_measure || 'PCS' };
      }
      return { ...l, [field]: value };
    }));
  };

  const submitRequisition = async () => {
    const validLines = formLines.filter(l => l.itemId && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('Please add at least one item with a valid quantity', 'warning', department as any);
      return;
    }
    if (!formRequester.trim()) {
      addNotification('Please enter a requester name', 'warning', department as any);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createIssue({
        property_id: currentPropertyId || null,
        department,
        requester: formRequester,
        store_id: null,
        required_date: formRequiredDate || null,
        priority: formPriority,
        purpose: formPurpose || `${department} replenishment request`,
        lines: validLines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          requestedQty: l.quantity,
          approvedQty: 0,
          issuedQty: 0,
          unit: l.unit,
        })),
        approval_status: 'Pending',
        source: 'Requisition',
      });
      addNotification(`${department} requisition ${created.issue_number} created. The inventory team will review it.`, 'success', department as any);
      setShowForm(false);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create requisition', 'error', department as any);
    } finally {
      setSubmitting(false);
    }
  };

  // Find the store for this department (for display)
  const deptStore = useMemo(() => stores.find(s => s.department === department), [stores, department]);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      {!hideHeader && (
      <PageHeader
        title={`${department} Replenishment & Requisition`}
        subtitle={`Request stock replenishment from Central Inventory or submit purchase requisitions. The inventory team fulfills these from /erp/inventory/stock-operations. ${deptStore ? `Default store: ${deptStore.store_name}.` : ''}`}
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => { setShowNotifPanel(v => !v); if (unreadCount > 0) markAllRead(); }}
                className={button.secondary + ' relative'}
                title={`${unreadCount} unread notification(s)`}
              >
                {unreadCount > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifPanel && notifications.length > 0 && (
                <div className="absolute right-0 top-full mt-2 w-80 max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-50">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-slate-700 text-xs font-bold uppercase text-slate-400">
                    Inventory Updates
                  </div>
                  {notifications.map(n => (
                    <div key={n.id} className="px-3 py-2 border-b border-gray-50 dark:border-slate-700/50 text-sm">
                      <p className="font-medium text-slate-700 dark:text-slate-200">{n.notification_type}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button onClick={openCreateForm} className={button.primary}>
              <Plus className="w-4 h-4" /> New Requisition
            </button>
          </div>
        }
      />
      )}

      {!hideStats && (
      <div className={layout.kpiGrid}>
        <StatCard title="My Requisitions" value={counts.total} icon={ClipboardList} tone="accent" />
        <StatCard title="Pending" value={counts.pending} icon={Clock} tone="warning" />
        <StatCard title="Approved" value={counts.approved} icon={Package} tone="info" />
        <StatCard title="Issued" value={counts.issued} icon={Package} tone="success" />
      </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      <InventoryTable
        rows={issues}
        rowKey={(i) => i.id}
        loading={loading}
        loadingMessage="Loading requisitions…"
        error={error}
        onRetry={load}
        emptyMessage="No requisitions yet. Click 'New Requisition' to request items from inventory."
        columns={[
          {
            key: 'req',
            header: 'Requisition',
            widthClass: 'md:w-72 shrink-0',
            render: (i) => {
              const tone = statusToneFor(i.approval_status);
              return (
                <IdentityCell
                  icon={<ClipboardList size={20} />}
                  soft={statusTone[tone].soft}
                  text={statusTone[tone].text}
                  name={i.issue_number}
                  code={`${(i.lines || []).length} items · ${i.created_at?.slice(0, 10)}`}
                />
              );
            },
          },
          {
            key: 'purpose',
            header: 'Purpose',
            render: (i) => (
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-xs">{i.purpose || '—'}</p>
                <p className="text-xs text-slate-400">Requester: {i.requester || '—'}</p>
              </div>
            ),
          },
          {
            key: 'requested',
            header: 'Requested',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (i) => {
              const total = (i.lines || []).reduce((s, l) => s + (Number(l.requestedQty) || 0), 0);
              return <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">{total}</span>;
            },
          },
          {
            key: 'issued',
            header: 'Issued',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (i) => {
              const totalIssued = (i.lines || []).reduce((s, l) => s + (Number(l.issuedQty) || 0), 0);
              const totalRequested = (i.lines || []).reduce((s, l) => s + (Number(l.requestedQty) || 0), 0);
              const isPartial = totalIssued > 0 && totalIssued < totalRequested;
              const isFull = totalIssued > 0 && totalIssued >= totalRequested;
              return (
                <span className={`text-sm font-bold tabular-nums ${isFull ? 'text-emerald-600' : isPartial ? 'text-amber-600' : 'text-slate-400'}`}>
                  {totalIssued}
                </span>
              );
            },
          },
          {
            key: 'priority',
            header: 'Priority',
            widthClass: 'md:w-24 shrink-0',
            render: (i) => (
              <Badge tone={i.priority === 'Urgent' ? 'danger' : i.priority === 'High' ? 'warning' : 'neutral'}>
                {i.priority}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            widthClass: 'md:w-28 shrink-0',
            render: (i) => {
              const tone = statusToneFor(i.approval_status);
              return <Badge tone={tone} variant="solid">{i.approval_status}</Badge>;
            },
          },
          {
            key: 'ops',
            header: 'Ops',
            widthClass: 'md:w-16 shrink-0',
            align: 'right',
            render: (i) => (
              <OpsCell>
                <IconButton onClick={() => setDetailIssue(i)} title="View details">
                  <ChevronRight className="w-4 h-4" />
                </IconButton>
              </OpsCell>
            ),
          },
        ]}
      />

      {/* Create Requisition Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="lg"
        title="New Requisition"
        subtitle={`Request items from inventory for ${department}`}
        confirmLabel="Submit Requisition" onConfirm={submitRequisition} loading={submitting} confirmColor="emerald">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Requester *</span>
              <input className={inputClass} value={formRequester} onChange={e => setFormRequester(e.target.value)} placeholder="Your name" />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Priority</span>
              <select className={inputClass} value={formPriority} onChange={e => setFormPriority(e.target.value)}>
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Required Date</span>
              <input type="date" className={inputClass} value={formRequiredDate} onChange={e => setFormRequiredDate(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Purpose / Notes</span>
            <input className={inputClass} value={formPurpose} onChange={e => setFormPurpose(e.target.value)} placeholder="Why do you need these items?" />
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items</span>
              <button onClick={addLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add Item</button>
            </div>
            <div className="space-y-2">
              {formLines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select className={inputClass + ' flex-1'} value={line.itemId} onChange={e => updateLine(idx, 'itemId', e.target.value)}>
                    <option value="">Select item…</option>
                    {allowedItems.map(it => (
                      <option key={it.id} value={it.id}>{it.item_name} ({it.unit_of_measure})</option>
                    ))}
                  </select>
                  <input type="number" min="1" className={inputClass + ' w-24 text-center'} value={line.quantity}
                    onChange={e => updateLine(idx, 'quantity', +e.target.value)} />
                  <span className="text-xs text-slate-400 w-12">{line.unit}</span>
                  {formLines.length > 1 && (
                    <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">
                      <ChevronRight className="w-4 h-4 rotate-90" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ModalSystem>

      {/* Detail Modal */}
      <ModalSystem isOpen={!!detailIssue} onClose={() => setDetailIssue(null)} variant="info" size="lg"
        title={detailIssue?.issue_number || 'Requisition'} subtitle={`${department} · ${detailIssue?.approval_status}`}>
        {detailIssue && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><p className="text-[10px] uppercase font-black text-slate-400">Requester</p><p className="text-sm font-bold">{detailIssue.requester || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Priority</p><p className="text-sm font-bold">{detailIssue.priority}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Required Date</p><p className="text-sm font-bold">{detailIssue.required_date?.slice(0, 10) || '—'}</p></div>
              <div><p className="text-[10px] uppercase font-black text-slate-400">Status</p><Badge tone={statusToneFor(detailIssue.approval_status)} variant="solid">{detailIssue.approval_status}</Badge></div>
            </div>
            {detailIssue.purpose && <div><p className="text-[10px] uppercase font-black text-slate-400">Purpose</p><p className="text-sm">{detailIssue.purpose}</p></div>}
            <div>
              <p className="text-[10px] uppercase font-black text-slate-400 mb-2">Items</p>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 font-medium text-right">Requested</th>
                      <th className="px-4 py-3 font-medium text-right">Issued</th>
                      <th className="px-4 py-3 font-medium text-right">Remaining</th>
                      <th className="px-4 py-3 font-medium text-right">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {(detailIssue.lines || []).map((line, idx) => {
                      const remaining = Math.max(0, (line.requestedQty || 0) - (line.issuedQty || 0));
                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{line.itemName}</td>
                          <td className="px-4 py-3 text-right">{line.requestedQty}</td>
                          <td className="px-4 py-3 text-right text-emerald-600 font-medium">{line.issuedQty || 0}</td>
                          <td className="px-4 py-3 text-right">{remaining > 0 ? <span className="text-amber-600 font-medium">{remaining}</span> : <span className="text-emerald-600">✓</span>}</td>
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
    </div>
  );
};

export default DepartmentRequisitionForm;
