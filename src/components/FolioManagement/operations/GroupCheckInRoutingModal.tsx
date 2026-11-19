/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GroupCheckInRoutingModal — pre-check-in modal for configuring charge
 * routing policy on group reservations. Lets the user decide which charge
 * categories go to the Master folio (company/group pays) vs the Guest
 * folio (guest pays) before check-in is finalized.
 *
 * The selected policy is sent to the check-in API, which creates
 * routing_rules entries that the post_folio_charge RPC honors.
 */
import React, { useState, useMemo } from 'react';
import { X, ArrowRight, User, Star, Sliders, Coffee, Utensils, Wine, Cookie, Bus, Shirt, Sparkles, Bed, Calculator, Phone, Gift, Spa, Banquet } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
export type ChargeCategory =
  // Accommodation
  | 'Room'
  // Food & Beverage — granular
  | 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' | 'SoftDrink' | 'Alcohol' | 'F&B'
  // Amenities
  | 'Minibar' | 'Laundry' | 'Spa' | 'Telephone' | 'Transfer' | 'Transportation'
  // Other
  | 'Banquet' | 'GiftShop' | 'Extra' | 'Other';

export type FolioTarget = 'master' | 'guest';

export interface RoutingPolicyEntry {
  category: ChargeCategory;
  target: FolioTarget;
}

export interface RoutingPolicy {
  entries: RoutingPolicyEntry[];
  billingMode: 'group' | 'corporate';
  reason?: string;
}

// ── Category groups (for visual grouping in the modal) ─────────
interface CategoryGroup {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  categories: ChargeCategory[];
}

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    label: 'Accommodation',
    icon: Bed,
    categories: ['Room'],
  },
  {
    label: 'Food & Beverage',
    icon: Coffee,
    categories: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'SoftDrink', 'Alcohol', 'F&B'],
  },
  {
    label: 'Amenities',
    icon: Sparkles,
    categories: ['Minibar', 'Laundry', 'Spa', 'Telephone', 'Transfer', 'Transportation'],
  },
  {
    label: 'Other',
    icon: Gift,
    categories: ['Banquet', 'GiftShop', 'Extra', 'Other'],
  },
];

const ALL_CATEGORIES: ChargeCategory[] = CATEGORY_GROUPS.flatMap((g) => g.categories);

const CATEGORY_LABELS: Record<ChargeCategory, string> = {
  Room: 'Room',
  Breakfast: 'Breakfast',
  Lunch: 'Lunch',
  Dinner: 'Dinner',
  Snacks: 'Snacks',
  SoftDrink: 'Soft Drinks',
  Alcohol: 'Alcohol / Bar',
  'F&B': 'F&B (General)',
  Minibar: 'Minibar',
  Laundry: 'Laundry',
  Spa: 'Spa & Wellness',
  Telephone: 'Telephone',
  Transfer: 'Transfer',
  Transportation: 'Transportation',
  Banquet: 'Banquet / Events',
  GiftShop: 'Gift Shop',
  Extra: 'Extra',
  Other: 'Other',
};

// ── Default presets ────────────────────────────────────────────
export const DEFAULT_ROUTING_PRESETS: Record<string, {
  label: string;
  description: string;
  entries: RoutingPolicyEntry[];
}> = {
  'group-master-room': {
    label: 'Master pays Room',
    description: 'Room (incl. tax & service charge) to Master. All F&B and incidentals to Guest.',
    entries: [
      { category: 'Room', target: 'master' },
      { category: 'Breakfast', target: 'guest' },
      { category: 'Lunch', target: 'guest' },
      { category: 'Dinner', target: 'guest' },
      { category: 'Snacks', target: 'guest' },
      { category: 'SoftDrink', target: 'guest' },
      { category: 'Alcohol', target: 'guest' },
      { category: 'F&B', target: 'guest' },
      { category: 'Minibar', target: 'guest' },
      { category: 'Laundry', target: 'guest' },
      { category: 'Spa', target: 'guest' },
      { category: 'Telephone', target: 'guest' },
      { category: 'Transfer', target: 'guest' },
      { category: 'Transportation', target: 'guest' },
      { category: 'Banquet', target: 'guest' },
      { category: 'GiftShop', target: 'guest' },
      { category: 'Extra', target: 'guest' },
      { category: 'Other', target: 'guest' },
    ],
  },
  'group-master-room-meals': {
    label: 'Master pays Room + Meals',
    description: 'Room and all meals (breakfast/lunch/dinner) to Master. Snacks, drinks, and incidentals to Guest.',
    entries: [
      { category: 'Room', target: 'master' },
      { category: 'Breakfast', target: 'master' },
      { category: 'Lunch', target: 'master' },
      { category: 'Dinner', target: 'master' },
      { category: 'Snacks', target: 'guest' },
      { category: 'SoftDrink', target: 'guest' },
      { category: 'Alcohol', target: 'guest' },
      { category: 'F&B', target: 'master' },
      { category: 'Minibar', target: 'guest' },
      { category: 'Laundry', target: 'guest' },
      { category: 'Spa', target: 'guest' },
      { category: 'Telephone', target: 'guest' },
      { category: 'Transfer', target: 'guest' },
      { category: 'Transportation', target: 'guest' },
      { category: 'Banquet', target: 'master' },
      { category: 'GiftShop', target: 'guest' },
      { category: 'Extra', target: 'guest' },
      { category: 'Other', target: 'guest' },
    ],
  },
  'group-master-room-meals-no-alcohol': {
    label: 'Master pays Room + Meals (no alcohol)',
    description: 'Room, meals, and soft drinks to Master. Alcohol, snacks, and incidentals to Guest.',
    entries: [
      { category: 'Room', target: 'master' },
      { category: 'Breakfast', target: 'master' },
      { category: 'Lunch', target: 'master' },
      { category: 'Dinner', target: 'master' },
      { category: 'Snacks', target: 'master' },
      { category: 'SoftDrink', target: 'master' },
      { category: 'Alcohol', target: 'guest' },
      { category: 'F&B', target: 'master' },
      { category: 'Minibar', target: 'guest' },
      { category: 'Laundry', target: 'guest' },
      { category: 'Spa', target: 'guest' },
      { category: 'Telephone', target: 'guest' },
      { category: 'Transfer', target: 'guest' },
      { category: 'Transportation', target: 'guest' },
      { category: 'Banquet', target: 'master' },
      { category: 'GiftShop', target: 'guest' },
      { category: 'Extra', target: 'guest' },
      { category: 'Other', target: 'guest' },
    ],
  },
  'group-master-meals-snacks-guest-drinks': {
    label: 'Master: Meals + Snacks | Guest: Drinks',
    description: 'Master pays room, meals, and snacks. Soft drinks and alcohol to Guest.',
    entries: [
      { category: 'Room', target: 'master' },
      { category: 'Breakfast', target: 'master' },
      { category: 'Lunch', target: 'master' },
      { category: 'Dinner', target: 'master' },
      { category: 'Snacks', target: 'master' },
      { category: 'SoftDrink', target: 'guest' },
      { category: 'Alcohol', target: 'guest' },
      { category: 'F&B', target: 'master' },
      { category: 'Minibar', target: 'guest' },
      { category: 'Laundry', target: 'guest' },
      { category: 'Spa', target: 'guest' },
      { category: 'Telephone', target: 'guest' },
      { category: 'Transfer', target: 'master' },
      { category: 'Transportation', target: 'master' },
      { category: 'Banquet', target: 'master' },
      { category: 'GiftShop', target: 'guest' },
      { category: 'Extra', target: 'guest' },
      { category: 'Other', target: 'guest' },
    ],
  },
  'group-all-master': {
    label: 'Master pays All',
    description: 'All charges route to the Master folio. Guest folio stays at zero.',
    entries: ALL_CATEGORIES.map((c) => ({ category: c, target: 'master' as FolioTarget })),
  },
  'group-all-guest': {
    label: 'Guest pays All',
    description: 'All charges stay on the Guest folio. Master folio remains empty.',
    entries: ALL_CATEGORIES.map((c) => ({ category: c, target: 'guest' as FolioTarget })),
  },
};

// ── Modal ──────────────────────────────────────────────────────
export function GroupCheckInRoutingModal({
  open,
  groupName,
  groupCode,
  memberCount,
  billingMode,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  groupName: string;
  groupCode?: string;
  memberCount: number;
  billingMode: 'group' | 'corporate';
  onConfirm: (policy: RoutingPolicy) => void;
  onCancel: () => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string>('group-master-room');
  const [entries, setEntries] = useState<RoutingPolicyEntry[]>(
    DEFAULT_ROUTING_PRESETS['group-master-room'].entries
  );
  const [reason, setReason] = useState('');

  const applyPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    setEntries(DEFAULT_ROUTING_PRESETS[presetKey].entries);
  };

  const setCategoryTarget = (category: ChargeCategory, target: FolioTarget) => {
    setEntries((prev) => prev.map((e) => e.category === category ? { ...e, target } : e));
    setSelectedPreset('custom');
  };

  const setGroupTarget = (categories: ChargeCategory[], target: FolioTarget) => {
    setEntries((prev) => prev.map((e) => categories.includes(e.category) ? { ...e, target } : e));
    setSelectedPreset('custom');
  };

  const setAllTarget = (target: FolioTarget) => {
    setEntries((prev) => prev.map((e) => ({ ...e, target })));
    setSelectedPreset('custom');
  };

  const getTarget = (category: ChargeCategory): FolioTarget => {
    return entries.find((e) => e.category === category)?.target || 'guest';
  };

  const masterCount = entries.filter((e) => e.target === 'master').length;
  const guestCount = entries.filter((e) => e.target === 'guest').length;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
          <div className="flex items-center gap-2">
            <Sliders size={18} className="text-[var(--color-accent-operations)]" />
            <div>
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                Charge Routing Policy
              </h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Configure how charges split between Master and Guest folios before check-in
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Group info */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-gray-400">Group:</span>{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200">{groupName}</span>
              {groupCode && <span className="ml-1 text-gray-400 font-mono">({groupCode})</span>}
            </div>
            <div>
              <span className="text-gray-400">Members:</span>{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200">{memberCount}</span>
            </div>
            <div>
              <span className="text-gray-400">Mode:</span>{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200 capitalize">{billingMode}</span>
            </div>
          </div>
        </div>

        {/* Presets */}
        <div className="px-5 py-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Quick Presets
          </label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {Object.entries(DEFAULT_ROUTING_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                  selectedPreset === key
                    ? 'border-[var(--color-accent-operations)] bg-[var(--color-accent-operations)]/5 ring-1 ring-[var(--color-accent-operations)]/30'
                    : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500'
                }`}
              >
                <div className="font-semibold text-gray-700 dark:text-gray-200">{preset.label}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{preset.description}</div>
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          <div className="flex items-center justify-between mb-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Per-Category Routing
            </label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setAllTarget('master')}
                className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200"
              >
                All → Master
              </button>
              <button
                onClick={() => setAllTarget('guest')}
                className="px-2 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200"
              >
                All → Guest
              </button>
            </div>
          </div>

          {/* Category groups */}
          <div className="space-y-3">
            {CATEGORY_GROUPS.map((group) => {
              const GroupIcon = group.icon;
              const groupMasterCount = group.categories.filter((c) => getTarget(c) === 'master').length;
              const groupGuestCount = group.categories.filter((c) => getTarget(c) === 'guest').length;
              return (
                <div key={group.label} className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-1.5">
                      <GroupIcon size={13} className="text-gray-500 dark:text-gray-400" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                        {group.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-gray-400">{groupMasterCount}M / {groupGuestCount}G</span>
                      <button
                        onClick={() => setGroupTarget(group.categories, 'master')}
                        className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 hover:bg-amber-100"
                        title={`Set all ${group.label} → Master`}
                      >
                        All Master
                      </button>
                      <button
                        onClick={() => setGroupTarget(group.categories, 'guest')}
                        className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100"
                        title={`Set all ${group.label} → Guest`}
                      >
                        All Guest
                      </button>
                    </div>
                  </div>
                  {/* Category rows */}
                  <div className="p-2 space-y-1">
                    {group.categories.map((cat) => {
                      const target = getTarget(cat);
                      return (
                        <div
                          key={cat}
                          className="flex items-center justify-between p-1.5 rounded bg-slate-50/50 dark:bg-slate-900/20 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                        >
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            {CATEGORY_LABELS[cat]}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setCategoryTarget(cat, 'master')}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition-all ${
                                target === 'master'
                                  ? 'bg-amber-500 text-white shadow-sm'
                                  : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 hover:bg-amber-100 hover:text-amber-700'
                              }`}
                            >
                              <Star size={10} /> Master
                            </button>
                            <button
                              onClick={() => setCategoryTarget(cat, 'guest')}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition-all ${
                                target === 'guest'
                                  ? 'bg-blue-500 text-white shadow-sm'
                                  : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 hover:bg-blue-100 hover:text-blue-700'
                              }`}
                            >
                              <User size={10} /> Guest
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="mt-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-900/60 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Star size={12} className="text-amber-500" />
              <span className="font-semibold text-gray-700 dark:text-gray-200">{masterCount}</span>
              <span className="text-gray-500">→ Master</span>
            </div>
            <div className="flex items-center gap-1.5">
              <User size={12} className="text-blue-500" />
              <span className="font-semibold text-gray-700 dark:text-gray-200">{guestCount}</span>
              <span className="text-gray-500">→ Guest</span>
            </div>
          </div>

          {/* Reason */}
          <div className="mt-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">
              Reason (optional)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Company pays room + meals, guest pays alcohol and incidentals"
              className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-slate-700 sticky bottom-0 bg-white dark:bg-slate-800">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ entries, billingMode, reason: reason || undefined })}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90 shadow-sm"
          >
            <ArrowRight size={13} /> Confirm & Check In
          </button>
        </div>
      </div>
    </div>
  );
}
