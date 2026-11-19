/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FolioManagementPage — the main folio management workspace (spec §6, §8).
 *
 * Route-driven integration (AGENTS.md): this component lives under
 * /erp/frontoffice/folio-billing (and /erp/finance/folio-billing) and
 * reads the selected folio, active tab, and open drawer from URL query
 * params: ?folioId=&tab=&drawer=
 *
 * Layout: FolioSidebar (left) | FolioHeader + FinancialSummary + Tabs (right)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { FolioSidebar } from './hierarchy/FolioSidebar';
import { FolioHeader } from './header/FolioHeader';
import { FinancialSummary } from './financial/FinancialSummary';
import { FolioTabBar, type TabId } from './tabs/FolioTabBar';
import { SummaryTab } from './tabs/SummaryTab';
import { TransactionsTab } from './tabs/TransactionsTab';
import { PaymentsTab } from './tabs/PaymentsTab';
import { InvoicesTab } from './tabs/InvoicesTab';
import { NotesTab, DocumentsTab, ActivityTab } from './tabs/SimpleTabs';
import { AddChargeDrawer, AddPaymentDrawer } from './operations/AddChargePaymentDrawers';
import { SplitFolioDrawer, TransferFolioDrawer } from './operations/SplitTransferDrawers';
import { ConfirmationDialog, Toast, ErrorState, LoadingState, EmptyState } from './shared/primitives';
import {
  listFoliosV2, getFolioV2, getFolioTreeV2, getFolioSummaryV2,
  getFolioTransactionsV2, reverseChargeV2, voidPaymentV2,
  closeFolioV2, reopenFolioV2, voidFolioV2, transferFolioV2,
  editFolioLineV2, voidFolioLineV2,
  type FolioV2, type FolioTreeNodeV2, type FolioSummaryV2,
  type FolioTransactionV2,
} from '../../services/folioService';

const VALID_TABS: TabId[] = ['summary', 'transactions', 'payments', 'invoices', 'notes', 'documents', 'activity'];
const VALID_DRAWERS = ['add-charge', 'add-payment', 'split', 'transfer', 'create-invoice'];

export default function FolioManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folioIdParam = searchParams.get('folioId') || undefined;
  const reservationIdParam = searchParams.get('reservationId') || undefined;
  const tabParam = (searchParams.get('tab') as TabId) || 'summary';
  const drawerParam = searchParams.get('drawer') || undefined;

  // If a reservationId is given (cross-module navigation from Check-Out etc.),
  // resolve it to the first folio for that reservation.
  const [resolvedFolioId, setResolvedFolioId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (folioIdParam) { setResolvedFolioId(folioIdParam); return; }
    if (reservationIdParam) {
      listFoliosV2({ reservationId: reservationIdParam })
        .then((folios) => {
          if (folios.length > 0) {
            setResolvedFolioId(folios[0].id);
            // Update URL to the resolved folioId so it's bookmarkable
            updateParams({ folioId: folios[0].id, reservationId: undefined });
          } else {
            setResolvedFolioId(undefined);
          }
        })
        .catch(() => setResolvedFolioId(undefined));
    } else {
      setResolvedFolioId(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folioIdParam, reservationIdParam]);

  // ── State ──────────────────────────────────────────────────
  const [allFolios, setAllFolios] = useState<FolioV2[]>([]);
  const [trees, setTrees] = useState<FolioTreeNodeV2[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);

  const [currentFolio, setCurrentFolio] = useState<FolioV2 | null>(null);
  const [summary, setSummary] = useState<FolioSummaryV2 | undefined>(undefined);
  const [transactions, setTransactions] = useState<FolioTransactionV2[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabId>(VALID_TABS.includes(tabParam) ? tabParam : 'summary');
  const [activeDrawer, setActiveDrawer] = useState<string | undefined>(VALID_DRAWERS.includes(drawerParam || '') ? drawerParam : undefined);

  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' | 'info' } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; destructive?: boolean; onConfirm: () => void } | null>(null);
  const [editLineData, setEditLineData] = useState<{ lineId: string; description: string; amount: number; lineType: string } | null>(null);

  // ── URL sync helpers ───────────────────────────────────────
  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([k, v]) => {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      });
      return next;
    });
  }, [setSearchParams]);

  const selectFolio = useCallback((id: string) => {
    updateParams({ folioId: id, tab: 'summary' });
    setSelectedLineIds(new Set());
  }, [updateParams]);

  const changeTab = useCallback((tab: TabId) => {
    updateParams({ tab });
  }, [updateParams]);

  const openDrawer = useCallback((drawer: string) => {
    updateParams({ drawer });
  }, [updateParams]);

  const closeDrawer = useCallback(() => {
    updateParams({ drawer: undefined });
  }, [updateParams]);

  // Keep local state in sync with URL params
  useEffect(() => {
    setActiveTab(VALID_TABS.includes(tabParam) ? tabParam : 'summary');
  }, [tabParam]);

  useEffect(() => {
    setActiveDrawer(VALID_DRAWERS.includes(drawerParam || '') ? drawerParam : undefined);
  }, [drawerParam]);

  // ── Load sidebar folios ────────────────────────────────────
  const loadSidebar = useCallback(async () => {
    setSidebarLoading(true);
    try {
      const folios = await listFoliosV2();
      setAllFolios(folios);
      // Build trees from root folios — any folio with no parent is a root.
      // This includes Company, Group, and standalone Master/Guest folios.
      const roots = folios.filter((f) => !f.parent_folio_id);
      const allTrees: FolioTreeNodeV2[] = [];
      for (const root of roots) {
        try {
          const tree = await getFolioTreeV2(root.id);
          allTrees.push(...tree);
        } catch { /* skip broken trees */ }
      }
      setTrees(allTrees);
    } catch (e: any) {
      console.error('Failed to load folios:', e);
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  useEffect(() => { loadSidebar(); }, [loadSidebar]);

  // ── Load folio detail when folioId changes ─────────────────
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [folio, summ, txns] = await Promise.all([
        getFolioV2(id),
        getFolioSummaryV2(id).catch(() => undefined),
        getFolioTransactionsV2(id),
      ]);
      setCurrentFolio(folio);
      setSummary(summ);
      setTransactions(txns);
    } catch (e: any) {
      setCurrentFolio(null);
      setDetailError(e.message || 'Failed to load folio');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (resolvedFolioId) loadDetail(resolvedFolioId);
    else { setCurrentFolio(null); setSummary(undefined); setTransactions([]); }
  }, [resolvedFolioId, loadDetail]);

  // ── Actions ────────────────────────────────────────────────
  const handleAction = useCallback((action: string) => {
    if (['add-charge', 'add-payment', 'split', 'transfer', 'create-invoice'].includes(action)) {
      openDrawer(action);
    } else if (action === 'close') {
      setConfirm({
        title: 'Close Folio',
        message: 'Closing this folio will prevent new transactions from being posted. You can reopen it later.',
        onConfirm: async () => {
          if (!currentFolio) return;
          try {
            await closeFolioV2(currentFolio.id);
            setConfirm(null);
            setToast({ message: 'Folio closed', tone: 'success' });
            loadDetail(currentFolio.id);
            loadSidebar();
          } catch (e: any) {
            setToast({ message: e.message || 'Failed to close folio', tone: 'danger' });
          }
        },
      });
    } else if (action === 'reopen') {
      setConfirm({
        title: 'Reopen Folio',
        message: 'Reopening will allow new transactions to be posted again.',
        onConfirm: async () => {
          if (!currentFolio) return;
          try {
            await reopenFolioV2(currentFolio.id);
            setConfirm(null);
            setToast({ message: 'Folio reopened', tone: 'success' });
            loadDetail(currentFolio.id);
          } catch (e: any) {
            setToast({ message: e.message || 'Failed to reopen folio', tone: 'danger' });
          }
        },
      });
    } else if (action === 'void') {
      setConfirm({
        title: 'Void Folio',
        message: 'Voiding permanently deactivates this folio. This action cannot be undone.',
        destructive: true,
        onConfirm: async () => {
          if (!currentFolio) return;
          try {
            await voidFolioV2(currentFolio.id, 'Manually voided');
            setConfirm(null);
            setToast({ message: 'Folio voided', tone: 'danger' });
            loadDetail(currentFolio.id);
            loadSidebar();
          } catch (e: any) {
            setToast({ message: e.message || 'Failed to void folio', tone: 'danger' });
          }
        },
      });
    } else if (action === 'edit') {
      setActiveTab('notes');
      updateParams({ tab: 'notes' });
    } else if (action === 'print') {
      window.print();
    }
  }, [currentFolio, openDrawer, loadDetail, loadSidebar, updateParams]);

  const handleReverse = useCallback((lineId: string, description: string) => {
    setConfirm({
      title: 'Reverse Charge',
      message: `Reverse "${description}"? A reversal entry will be created and the original voided.`,
      destructive: true,
      onConfirm: async () => {
        try {
          await reverseChargeV2(lineId, 'Manually reversed');
          setConfirm(null);
          setToast({ message: 'Charge reversed', tone: 'success' });
          if (resolvedFolioId) loadDetail(resolvedFolioId);
        } catch (e: any) {
          setToast({ message: e.message || 'Failed to reverse charge', tone: 'danger' });
        }
      },
    });
  }, [resolvedFolioId, loadDetail]);

  const handleEditLine = useCallback((lineId: string, description: string, amount: number, lineType: string) => {
    setEditLineData({ lineId, description, amount, lineType });
  }, []);

  const handleEditLineSubmit = useCallback(async (updates: { description: string; amount: number; lineType: string }) => {
    if (!editLineData) return;
    try {
      await editFolioLineV2(editLineData.lineId, updates);
      setEditLineData(null);
      setToast({ message: 'Charge updated', tone: 'success' });
      if (resolvedFolioId) loadDetail(resolvedFolioId);
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to edit charge', tone: 'danger' });
    }
  }, [editLineData, resolvedFolioId, loadDetail]);

  const handleVoidLine = useCallback((lineId: string, description: string) => {
    setConfirm({
      title: 'Void Charge',
      message: `Void "${description}"? The charge will be marked voided and removed from the folio balance.`,
      destructive: true,
      onConfirm: async () => {
        try {
          await voidFolioLineV2(lineId, 'Manually voided');
          setConfirm(null);
          setToast({ message: 'Charge voided', tone: 'success' });
          if (resolvedFolioId) loadDetail(resolvedFolioId);
        } catch (e: any) {
          setToast({ message: e.message || 'Failed to void charge', tone: 'danger' });
        }
      },
    });
  }, [resolvedFolioId, loadDetail]);

  const handleVoidPayment = useCallback((paymentId: string) => {
    setConfirm({
      title: 'Void Payment',
      message: 'Voiding this payment will reverse its effect on the folio balance.',
      destructive: true,
      onConfirm: async () => {
        if (!currentFolio) return;
        try {
          await voidPaymentV2(currentFolio.id, paymentId, 'Manually voided');
          setConfirm(null);
          setToast({ message: 'Payment voided', tone: 'success' });
          loadDetail(currentFolio.id);
        } catch (e: any) {
          setToast({ message: e.message || 'Failed to void payment', tone: 'danger' });
        }
      },
    });
  }, [currentFolio, loadDetail]);

  const refreshAll = useCallback(() => {
    if (resolvedFolioId) loadDetail(resolvedFolioId);
    loadSidebar();
  }, [resolvedFolioId, loadDetail, loadSidebar]);

  const onDrawerPosted = useCallback(() => {
    refreshAll();
    setToast({ message: 'Transaction posted', tone: 'success' });
  }, [refreshAll]);

  const onSplitTransferDone = useCallback(() => {
    refreshAll();
    setSelectedLineIds(new Set());
    setToast({ message: 'Operation completed', tone: 'success' });
  }, [refreshAll]);

  // ── Linked folios (parent + children) for quick move ──────
  const linkedFolios = useMemo(() => {
    if (!currentFolio) return [];
    const result: { id: string; folioType: string; label: string; direction: 'parent' | 'child' }[] = [];
    // Parent
    if (currentFolio.parent_folio_id) {
      const parent = allFolios.find((f) => f.id === currentFolio.parent_folio_id);
      if (parent) {
        result.push({
          id: parent.id,
          folioType: parent.folio_type,
          label: parent.folio_type === 'Group' ? (parent.ownerName || `Group ${parent.group_id?.slice(0, 8)}`) :
                 parent.folio_type === 'Company' ? (parent.ownerName || 'Company') :
                 parent.folio_type === 'Master' ? 'Master' : parent.folio_type,
          direction: 'parent',
        });
      }
    }
    // Children — from allFolios where parent_folio_id === currentFolio.id
    allFolios
      .filter((f) => f.parent_folio_id === currentFolio.id)
      .forEach((child) => {
        result.push({
          id: child.id,
          folioType: child.folio_type,
          label: child.folio_type === 'Guest' ? (child.reservations?.guest_name || 'Guest') :
                 child.folio_type === 'Group' ? (child.ownerName || `Group ${child.group_id?.slice(0, 8)}`) :
                 child.folio_type === 'Master' ? 'Master' : child.folio_type,
          direction: 'child',
        });
      });
    return result;
  }, [currentFolio, allFolios]);

  const handleQuickMove = useCallback(async (destFolioId: string, destLabel: string) => {
    if (!currentFolio || selectedLineIds.size === 0) return;
    setConfirm({
      title: 'Move Charges',
      message: `Move ${selectedLineIds.size} selected charge(s) to ${destLabel}?`,
      onConfirm: async () => {
        try {
          await transferFolioV2(currentFolio.id, {
            destFolioId,
            lineIds: Array.from(selectedLineIds),
            transferType: 'selected',
          });
          setConfirm(null);
          setSelectedLineIds(new Set());
          setToast({ message: `Charges moved to ${destLabel}`, tone: 'success' });
          refreshAll();
        } catch (e: any) {
          setToast({ message: e.message || 'Failed to move charges', tone: 'danger' });
        }
      },
    });
  }, [currentFolio, selectedLineIds, refreshAll]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-gray-50 dark:bg-slate-900">
      <FolioSidebar
        folios={allFolios}
        trees={trees}
        loading={sidebarLoading}
        selectedFolioId={resolvedFolioId}
        onSelect={selectFolio}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {!resolvedFolioId ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title="Folio Management"
              description="Select a folio from the hierarchy to view its transactions, payments, invoices, and activity."
              icon={Receipt}
            />
          </div>
        ) : detailLoading && !currentFolio ? (
          <LoadingState label="Loading folio…" />
        ) : detailError ? (
          <ErrorState message={detailError} onRetry={() => resolvedFolioId && loadDetail(resolvedFolioId)} />
        ) : currentFolio ? (
          <>
            <FolioHeader folio={currentFolio} onAction={handleAction} />
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-900">
              <FinancialSummary folio={currentFolio} summary={summary} />
            </div>
            <FolioTabBar activeTab={activeTab} onTabChange={changeTab} />
            <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-900">
              {activeTab === 'summary' && (
                <SummaryTab folio={currentFolio} summary={summary} onSelectLinked={selectFolio} />
              )}
              {activeTab === 'transactions' && (
                <TransactionsTab
                  folio={currentFolio}
                  transactions={transactions}
                  loading={detailLoading}
                  onAddCharge={() => openDrawer('add-charge')}
                  onReverse={handleReverse}
                  onEdit={handleEditLine}
                  onVoid={handleVoidLine}
                  selectedLineIds={selectedLineIds}
                  onSelectLine={(id: string) => setSelectedLineIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })}
                  onSelectAll={(ids: string[]) => setSelectedLineIds(new Set(ids))}
                  linkedFolios={linkedFolios}
                  onQuickMove={handleQuickMove}
                />
              )}
              {activeTab === 'payments' && (
                <PaymentsTab
                  folio={currentFolio}
                  transactions={transactions}
                  loading={detailLoading}
                  onAddPayment={() => openDrawer('add-payment')}
                  onVoidPayment={handleVoidPayment}
                />
              )}
              {activeTab === 'invoices' && (
                <InvoicesTab folio={currentFolio} onCreateInvoice={() => openDrawer('create-invoice')} />
              )}
              {activeTab === 'notes' && <NotesTab folio={currentFolio} onChanged={refreshAll} />}
              {activeTab === 'documents' && <DocumentsTab folio={currentFolio} />}
              {activeTab === 'activity' && <ActivityTab folio={currentFolio} />}
            </div>
          </>
        ) : null}
      </div>

      {/* Drawers */}
      <AddChargeDrawer open={activeDrawer === 'add-charge'} folio={currentFolio} onClose={closeDrawer} onPosted={onDrawerPosted} />
      <AddPaymentDrawer open={activeDrawer === 'add-payment'} folio={currentFolio} onClose={closeDrawer} onPosted={onDrawerPosted} />
      <SplitFolioDrawer
        open={activeDrawer === 'split'}
        folio={currentFolio}
        selectedLineIds={selectedLineIds}
        transactions={transactions}
        onClose={closeDrawer}
        onDone={onSplitTransferDone}
      />
      <TransferFolioDrawer
        open={activeDrawer === 'transfer'}
        folio={currentFolio}
        selectedLineIds={selectedLineIds}
        transactions={transactions}
        onClose={closeDrawer}
        onDone={onSplitTransferDone}
      />

      {/* Create Invoice — delegates to the legacy generate-invoice endpoint */}
      {activeDrawer === 'create-invoice' && currentFolio && (
        <CreateInvoiceInline folioId={currentFolio.id} folio={currentFolio} onClose={closeDrawer} onDone={refreshAll} />
      )}

      {/* Confirmation dialog */}
      <ConfirmationDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        destructive={confirm?.destructive}
        onConfirm={() => confirm?.onConfirm()}
        onCancel={() => setConfirm(null)}
      />

      {/* Toast */}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      {/* Edit Charge Line Modal */}
      {editLineData && (
        <EditLineModal
          initial={editLineData}
          onCancel={() => setEditLineData(null)}
          onSubmit={handleEditLineSubmit}
        />
      )}
    </div>
  );
}

// ── EditLineModal ───────────────────────────────────────────────
function EditLineModal({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: { lineId: string; description: string; amount: number; lineType: string };
  onCancel: () => void;
  onSubmit: (updates: { description: string; amount: number; lineType: string }) => void;
}) {
  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount] = useState(String(initial.amount));
  const [lineType, setLineType] = useState(initial.lineType);

  const submit = () => {
    const amt = parseFloat(amount);
    if (!description.trim() || isNaN(amt) || amt <= 0) return;
    onSubmit({ description: description.trim(), amount: amt, lineType });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Edit Charge</h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Amount</span>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Charge Type</span>
              <select
                value={lineType}
                onChange={(e) => setLineType(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100"
              >
                {['Room', 'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'SoftDrink', 'Alcohol', 'F&B', 'Minibar', 'Laundry', 'Spa', 'Telephone', 'Transfer', 'Transportation', 'Banquet', 'GiftShop', 'Extra', 'Other'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-slate-700">
          <button onClick={onCancel} className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white">Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── CreateInvoiceInline ────────────────────────────────────────
// Uses the existing /api/folios/:folioId/generate-invoice endpoint.
// Shows a preview before generating. Customer info fields are editable.
interface InvoicePreviewLine {
  id: string;
  description: string;
  lineType: string;
  quantity: number;
  amount: number;
  taxAmount: number;
}
interface InvoicePreview {
  folioType: string;
  customerName: string;
  customerTin: string | null;
  customerVatNo: string | null;
  customerAddress: string | null;
  customerEmail: string | null;
  hotelTin: string | null;
  hotelVatNo: string | null;
  lines: InvoicePreviewLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  lineCount: number;
}

interface GroupedPreviewLine {
  description: string;
  lineType: string;
  quantity: number;
  amount: number;
  taxAmount: number;
  itemCount: number;
}

function groupPreviewLines(lines: InvoicePreviewLine[]): GroupedPreviewLine[] {
  const map = new Map<string, GroupedPreviewLine>();
  for (const line of lines) {
    const key = `${line.description}||${line.lineType}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      existing.amount += line.amount;
      existing.taxAmount += line.taxAmount;
      existing.itemCount += 1;
    } else {
      map.set(key, {
        description: line.description,
        lineType: line.lineType,
        quantity: line.quantity,
        amount: line.amount,
        taxAmount: line.taxAmount,
        itemCount: 1,
      });
    }
  }
  return Array.from(map.values());
}

function CreateInvoiceInline({ folioId, folio, onClose, onDone }: { folioId: string; folio: FolioV2; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [customerName, setCustomerName] = useState(folio.guestName || folio.ownerName || '');
  const [customerTin, setCustomerTin] = useState('');
  const [customerVatNo, setCustomerVatNo] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [showCustomerFields, setShowCustomerFields] = useState(false);
  const [previewData, setPreviewData] = useState<InvoicePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [step, setStep] = useState<'edit' | 'preview'>('edit');

  const fetchPreview = async () => {
    setPreviewLoading(true); setError(null);
    try {
      const res = await fetch(`/api/folios/${folioId}/generate-invoice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'folio',
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          preview: true,
          customerName: customerName || undefined,
          customerTin: customerTin || undefined,
          customerVatNo: customerVatNo || undefined,
          customerAddress: customerAddress || undefined,
          customerEmail: customerEmail || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to load preview');
      }
      const data = await res.json();
      setPreviewData(data);
      setStep('preview');
      // Update customer fields with resolved values
      if (data.customerName && !customerName) setCustomerName(data.customerName);
      if (data.customerTin && !customerTin) setCustomerTin(data.customerTin);
      if (data.customerVatNo && !customerVatNo) setCustomerVatNo(data.customerVatNo);
      if (data.customerAddress && !customerAddress) setCustomerAddress(data.customerAddress);
      if (data.customerEmail && !customerEmail) setCustomerEmail(data.customerEmail);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/folios/${folioId}/generate-invoice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceType: 'folio',
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          customerName: customerName || undefined,
          customerTin: customerTin || undefined,
          customerVatNo: customerVatNo || undefined,
          customerAddress: customerAddress || undefined,
          customerEmail: customerEmail || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to generate invoice');
      }
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-w-2xl w-full bg-white dark:bg-slate-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {step === 'preview' ? 'Invoice Preview' : 'Create Invoice'}
            </h2>
            {step === 'preview' && (
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Review before posting
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400">{error}</div>}

          {/* ── Step 1: Edit ── */}
          {step === 'edit' && (
            <>
              {/* Customer info (editable) */}
              <div className="mb-4">
                <button
                  onClick={() => setShowCustomerFields(!showCustomerFields)}
                  className="text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                >
                  {showCustomerFields ? '▼' : '▶'} Bill To (Customer Info)
                </button>
                {showCustomerFields && (
                  <div className="mt-2 space-y-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                    <label className="block">
                      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Customer Name</span>
                      <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Auto-resolved from reservation/group" className="w-full mt-0.5 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">TIN</span>
                        <input value={customerTin} onChange={(e) => setCustomerTin(e.target.value)} placeholder="Tax ID" className="w-full mt-0.5 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">VAT No.</span>
                        <input value={customerVatNo} onChange={(e) => setCustomerVatNo(e.target.value)} placeholder="VAT registration" className="w-full mt-0.5 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Address</span>
                      <input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Billing address" className="w-full mt-0.5 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Email</span>
                      <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Contact email" className="w-full mt-0.5 px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
                    </label>
                    <p className="text-[9px] text-gray-400">Leave fields blank to auto-resolve from reservation or group profile.</p>
                  </div>
                )}
              </div>

              <label className="block mb-3">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Due Date (optional)</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
              </label>
              <label className="block mb-3">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800" />
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Click "Preview" to see the invoice details before posting.
              </p>
            </>
          )}

          {/* ── Step 2: Preview ── */}
          {step === 'preview' && previewData && (
            <div className="space-y-4">
              {/* Invoice header preview */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Bill To</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{customerName || previewData.customerName || '—'}</div>
                  {previewData.customerTin && <div className="text-[10px] text-gray-500">TIN: {previewData.customerTin}</div>}
                  {previewData.customerVatNo && <div className="text-[10px] text-gray-500">VAT: {previewData.customerVatNo}</div>}
                  {previewData.customerAddress && <div className="text-[10px] text-gray-500">{previewData.customerAddress}</div>}
                  {previewData.customerEmail && <div className="text-[10px] text-gray-500">{previewData.customerEmail}</div>}
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Invoice</div>
                  <div className="text-xs text-gray-500">Folio: {folio.folioNumber || folio.id.slice(0, 8)}</div>
                  <div className="text-xs text-gray-500">Type: {previewData.folioType}</div>
                  <div className="text-xs text-gray-500">Date: {new Date().toISOString().slice(0, 10)}</div>
                  {dueDate && <div className="text-xs text-gray-500">Due: {dueDate}</div>}
                </div>
              </div>

              {/* Line items (grouped by description) */}
              <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/40 text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                      <th className="py-2 px-3 font-semibold">Description</th>
                      <th className="py-2 px-3 font-semibold text-center">Qty</th>
                      <th className="py-2 px-3 font-semibold text-right">Amount</th>
                      <th className="py-2 px-3 font-semibold text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {groupPreviewLines(previewData.lines).map((line, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 text-gray-700 dark:text-gray-200">
                          {line.description}
                          {line.itemCount > 1 && (
                            <span className="ml-1.5 text-[9px] font-semibold text-blue-500">
                              ({line.itemCount} items grouped)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center font-semibold text-gray-700 dark:text-gray-200">{line.quantity}</td>
                        <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                          {line.amount.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">
                          {line.taxAmount > 0 ? line.taxAmount.toFixed(2) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="ml-auto w-56 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium text-gray-900 dark:text-white">{previewData.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Tax</span>
                  <span className="font-medium text-gray-900 dark:text-white">{previewData.taxTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-gray-200 dark:border-slate-700">
                  <span className="text-gray-900 dark:text-white">Total</span>
                  <span className="text-gray-900 dark:text-white">{previewData.total.toFixed(2)}</span>
                </div>
              </div>

              {notes && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Notes</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">{notes}</div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{previewData.lineCount} line item(s) will be invoiced.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer changes based on step */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex justify-end gap-2">
          {step === 'edit' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-slate-600">Cancel</button>
              <button
                onClick={fetchPreview}
                disabled={previewLoading}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {previewLoading ? 'Loading…' : 'Preview'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('edit')}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-slate-600"
              >
                ← Back to Edit
              </button>
              <button
                onClick={submit}
                disabled={loading}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white disabled:opacity-50"
              >
                {loading ? 'Posting…' : 'Confirm & Post Invoice'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
