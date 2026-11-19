/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NotesTab, DocumentsTab, ActivityTab — simpler tabs (spec §11, §20).
 */
import React, { useEffect, useState } from 'react';
import { StickyNote, FolderOpen, Save } from 'lucide-react';
import type { FolioV2, FolioAuditEntryV2 } from '../../../services/folioService';
import { getFolioActivityV2, updateFolioV2 } from '../../../services/folioService';
import { AuditTimeline } from '../shared/AuditTimeline';
import { EmptyState, LoadingState, ErrorState } from '../shared/primitives';

// ── NotesTab ───────────────────────────────────────────────────
export function NotesTab({ folio, onChanged }: { folio: FolioV2; onChanged?: () => void }) {
  const [notes, setNotes] = useState(folio.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setNotes(folio.notes || ''); }, [folio.id, folio.notes]);

  const save = async () => {
    setSaving(true);
    try {
      await updateFolioV2(folio.id, { notes });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Folio Notes</h3>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90 disabled:opacity-50"
        >
          <Save size={13} /> {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={10}
        placeholder="Add internal notes about this folio…"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
      />
    </div>
  );
}

// ── DocumentsTab ───────────────────────────────────────────────
export function DocumentsTab({ folio }: { folio: FolioV2 }) {
  return (
    <div className="p-6">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Documents</h3>
      <EmptyState
        title="No documents"
        description="Invoices, receipts, and other documents attached to this folio will appear here."
        icon={FolderOpen}
      />
    </div>
  );
}

// ── ActivityTab ────────────────────────────────────────────────
export function ActivityTab({ folio }: { folio: FolioV2 }) {
  const [entries, setEntries] = useState<FolioAuditEntryV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFolioActivityV2(folio.id);
      setEntries(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [folio.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Activity Timeline</h3>
      {loading ? (
        <LoadingState label="Loading activity…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <AuditTimeline entries={entries} />
      )}
    </div>
  );
}
