/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FolioSidebar + FolioTree — the left-hand folio hierarchy (spec §6, §7).
 * Renders Account → Master → Group → Guest as a collapsible tree.
 */
import React, { useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Building2, Users, User, Star, FolderTree, Search,
} from 'lucide-react';
import type { FolioV2, FolioTreeNodeV2 } from '../../../services/folioService';
import { FolioTypeBadge, StatusBadge, CurrencyAmount, LoadingState, EmptyState } from '../shared/primitives';

// ── FolioTreeNode component ────────────────────────────────────
function FolioTreeNodeView({
  node,
  selectedFolioId,
  onSelect,
  depth = 0,
}: {
  node: FolioTreeNodeV2;
  selectedFolioId?: string;
  onSelect: (folioId: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedFolioId === node.id;

  const Icon =
    node.folioType === 'Master' ? Star :
    node.folioType === 'Company' ? Building2 :
    node.folioType === 'Group' ? Users : User;

  const label =
    node.folioType === 'Guest' && node.guestName
      ? `${node.guestName}${node.roomNumber ? ` · Rm ${node.roomNumber}` : ''}`
      : node.folioType === 'Group' && (node.ownerName || node.groupId)
      ? (node.ownerName || `Group ${node.groupId!.slice(0, 8)}`)
      : node.folioType === 'Company' && node.ownerName
      ? node.ownerName
      : node.folioType === 'Master' && node.ownerName
      ? node.ownerName
      : `${node.folioType} Folio`;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
          isSelected
            ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] font-semibold'
            : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-gray-700 dark:text-gray-300'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <Icon size={13} className="shrink-0" />
        <span className="truncate flex-1">{label}</span>
        <CurrencyAmount amount={node.balance} className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0" />
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <FolioTreeNodeView
              key={child.id}
              node={child}
              selectedFolioId={selectedFolioId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── FolioSidebar ───────────────────────────────────────────────
export function FolioSidebar({
  folios,
  trees,
  loading,
  selectedFolioId,
  onSelect,
}: {
  folios: FolioV2[];
  trees: FolioTreeNodeV2[];
  loading: boolean;
  selectedFolioId?: string;
  onSelect: (folioId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  // Build a flat searchable list from all tree nodes + standalone folios
  const flatNodes = useMemo(() => {
    const out: FolioTreeNodeV2[] = [];
    const walk = (nodes: FolioTreeNodeV2[]) => {
      nodes.forEach((n) => {
        out.push(n);
        if (n.children) walk(n.children);
      });
    };
    walk(trees);
    // Add standalone folios not in any tree
    const inTree = new Set(out.map((n) => n.id));
    folios
      .filter((f) => !inTree.has(f.id))
      .forEach((f) =>
        out.push({
          id: f.id,
          folioType: f.folio_type,
          status: f.status,
          balance: f.balance,
          totalCharges: f.total_charges,
          totalPayments: f.total_payments,
          currency: f.currency,
          folioNumber: f.folio_number,
          parentFolioId: f.parent_folio_id,
          reservationId: f.reservation_id,
          ownerType: f.owner_type,
          ownerId: f.owner_id,
          groupId: f.group_id,
          openedAt: f.opened_at,
          closedAt: f.closed_at,
          guestName: f.reservations?.guest_name ?? null,
          roomNumber: f.reservations?.room_number ?? null,
          checkInDate: f.reservations?.check_in_date ?? null,
          checkOutDate: f.reservations?.check_out_date ?? null,
          ownerName: f.ownerName ?? null,
          depth: 0,
          children: [],
        })
      );
    return out;
  }, [trees, folios]);

  const filtered = useMemo(() => {
    let list = flatNodes;
    if (filterType !== 'all') list = list.filter((n) => n.folioType === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.id.toLowerCase().includes(q) ||
          n.guestName?.toLowerCase().includes(q) ||
          n.folioType.toLowerCase().includes(q) ||
          n.groupId?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [flatNodes, filterType, search]);

  return (
    <aside className="w-72 shrink-0 border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col">
      <div className="px-3 py-3 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <FolderTree size={16} className="text-[var(--color-accent-operations)]" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200">
            Folio Hierarchy
          </h2>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search folios…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-gray-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
          />
        </div>
        <div className="flex gap-1 mt-2">
          {['all', 'Master', 'Company', 'Group', 'Guest'].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                filterType === t
                  ? 'bg-[var(--color-accent-operations)] text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <LoadingState label="Loading folios…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No folios found" description="Try adjusting your search or filter." />
        ) : (
          <div className="space-y-0.5">
            {filtered.map((node) => (
              <FolioTreeNodeView
                key={node.id}
                node={node}
                selectedFolioId={selectedFolioId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
