/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SplitFolioDrawer — split selected transactions (spec §17).
 * TransferFolioDrawer — transfer transactions (spec §18).
 */
import React, { useState, useMemo } from 'react';
import { Drawer, Field, inputCls, selectCls, DrawerFooter } from './Drawer';
import { CurrencyAmount } from '../shared/primitives';
import { splitFolioV2, transferFolioV2, listFoliosV2 } from '../../../services/folioService';
import type { FolioV2, FolioTransactionV2 } from '../../../services/folioService';

// ── SplitFolioDrawer ───────────────────────────────────────────
export function SplitFolioDrawer({
  open,
  folio,
  selectedLineIds,
  transactions,
  onClose,
  onDone,
}: {
  open: boolean;
  folio: FolioV2 | null;
  selectedLineIds: Set<string>;
  transactions: FolioTransactionV2[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [destFolioId, setDestFolioId] = useState('');
  const [destType, setDestType] = useState('Guest');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLines = useMemo(
    () => transactions.filter((t) => selectedLineIds.has(t.transactionId) && t.transactionType === 'charge'),
    [transactions, selectedLineIds]
  );
  const selectedTotal = selectedLines.reduce((s, t) => s + t.debit, 0);
  const originalBalance = folio?.balance ?? 0;
  const remainingBalance = originalBalance - selectedTotal;

  const reset = () => { setDestFolioId(''); setDestType('Guest'); setReason(''); setError(null); };

  const submit = async () => {
    if (!folio) return;
    if (selectedLineIds.size === 0) { setError('Select at least one transaction to split'); return; }
    setLoading(true); setError(null);
    try {
      await splitFolioV2(folio.id, {
        lineIds: Array.from(selectedLineIds),
        destFolioId: destFolioId || undefined,
        destFolioType: destType,
        reason: reason || undefined,
      });
      reset();
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Split failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Split Folio"
      onClose={() => { reset(); onClose(); }}
      footer={<DrawerFooter onCancel={() => { reset(); onClose(); }} onConfirm={submit} confirmLabel="Confirm Split" loading={loading} disabled={selectedLineIds.size === 0} />}
    >
      {error && <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400">{error}</div>}
      <div className="mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-700 dark:text-blue-400">
        {selectedLineIds.size} transaction(s) selected · <CurrencyAmount amount={selectedTotal} currency={folio?.currency} />
      </div>
      <Field label="Destination Folio (leave blank to create new)">
        <input value={destFolioId} onChange={(e) => setDestFolioId(e.target.value)} className={inputCls} placeholder="Existing folio ID (optional)" />
      </Field>
      {!destFolioId && (
        <Field label="New Folio Type">
          <select value={destType} onChange={(e) => setDestType(e.target.value)} className={selectCls}>
            <option value="Guest">Guest Folio</option>
            <option value="Company">Company Folio</option>
            <option value="Group">Group Folio</option>
          </select>
        </Field>
      )}
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Why is this split being made?" /></Field>
      <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">Original Balance</span><CurrencyAmount amount={originalBalance} currency={folio?.currency} /></div>
        <div className="flex justify-between"><span className="text-gray-500">Selected Charges</span><CurrencyAmount amount={selectedTotal} currency={folio?.currency} /></div>
        <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-200 dark:border-slate-700"><span>Remaining Balance</span><CurrencyAmount amount={remainingBalance} currency={folio?.currency} /></div>
      </div>
    </Drawer>
  );
}

// ── TransferFolioDrawer ────────────────────────────────────────
export function TransferFolioDrawer({
  open,
  folio,
  selectedLineIds,
  transactions,
  onClose,
  onDone,
}: {
  open: boolean;
  folio: FolioV2 | null;
  selectedLineIds: Set<string>;
  transactions: FolioTransactionV2[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [destFolioId, setDestFolioId] = useState('');
  const [transferType, setTransferType] = useState<'selected' | 'entire'>('selected');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destFolios, setDestFolios] = useState<FolioV2[]>([]);

  React.useEffect(() => {
    if (open) {
      listFoliosV2({ status: 'Open' }).then(setDestFolios).catch(() => {});
    }
  }, [open]);

  const selectedLines = useMemo(
    () => transactions.filter((t) => selectedLineIds.has(t.transactionId) && t.transactionType === 'charge'),
    [transactions, selectedLineIds]
  );
  const selectedTotal = selectedLines.reduce((s, t) => s + t.debit, 0);
  const transferAmount = transferType === 'entire' ? (folio?.balance ?? 0) : selectedTotal;

  const reset = () => { setDestFolioId(''); setTransferType('selected'); setReason(''); setReference(''); setError(null); };

  const submit = async () => {
    if (!folio) return;
    if (!destFolioId) { setError('Destination folio is required'); return; }
    if (destFolioId === folio.id) { setError('Cannot transfer to the same folio'); return; }
    setLoading(true); setError(null);
    try {
      await transferFolioV2(folio.id, {
        destFolioId,
        lineIds: transferType === 'selected' ? Array.from(selectedLineIds) : undefined,
        transferType,
        reason: reason || undefined,
        reference: reference || undefined,
      });
      reset();
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      title="Transfer Folio"
      onClose={() => { reset(); onClose(); }}
      footer={<DrawerFooter onCancel={() => { reset(); onClose(); }} onConfirm={submit} confirmLabel="Confirm Transfer" loading={loading} disabled={!destFolioId} />}
    >
      {error && <div className="mb-3 px-3 py-2 text-xs rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400">{error}</div>}
      <Field label="From Folio">
        <input disabled value={folio?.folio_number || folio?.id.slice(0, 8) || ''} className={inputCls + ' opacity-60'} />
      </Field>
      <Field label="To Folio">
        <select value={destFolioId} onChange={(e) => setDestFolioId(e.target.value)} className={selectCls}>
          <option value="">Select destination folio…</option>
          {destFolios.filter((f) => f.id !== folio?.id).map((f) => (
            <option key={f.id} value={f.id}>
              {f.folio_type} — {f.folio_number || f.id.slice(0, 8)} ({f.reservations?.guest_name || f.ownerName || '—'})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Transfer Type">
        <select value={transferType} onChange={(e) => setTransferType(e.target.value as any)} className={selectCls}>
          <option value="selected">Selected Transactions ({selectedLineIds.size})</option>
          <option value="entire">Entire Folio Balance</option>
        </select>
      </Field>
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Why is this transfer being made?" /></Field>
      <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="Optional reference" /></Field>
      <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/40 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-gray-500">Source Balance</span><CurrencyAmount amount={folio?.balance ?? 0} currency={folio?.currency} /></div>
        <div className="flex justify-between"><span className="text-gray-500">Transfer Amount</span><CurrencyAmount amount={transferAmount} currency={folio?.currency} /></div>
        <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-200 dark:border-slate-700"><span>New Source Balance</span><CurrencyAmount amount={(folio?.balance ?? 0) - transferAmount} currency={folio?.currency} /></div>
      </div>
    </Drawer>
  );
}
