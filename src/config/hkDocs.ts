/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Housekeeping Docs — SOPs & Checklists.
 *
 * Single source of truth for housekeeping Standard Operating Procedures
 * and per-task-type checklists. Used by:
 *   - ConfigurationModule (§24) — Docs tab where SOPs & checklists are managed
 *   - TaskManagementModule (§6) — print task sheets pull checklists from here
 *   - RoomInspectionsModule (§9) — inspection checklist
 *
 * Persisted to the database via /api/hk-portal/config/:propertyId/docs (hk_config
 * table, migration 320). Falls back to localStorage if the API is unavailable,
 * so the app still works offline. Defaults are seeded from
 * docs/Housekeeping Portal new.md (§7, §9, §18, §19, §6).
 */

import { useCallback, useEffect, useState } from 'react';
import { useERP } from '../context/ERPContext';

// ── Types ────────────────────────────────────────────────────────────────

export type TaskTypeKey =
  | 'Checkout Cleaning' | 'Stayover Service' | 'VIP Preparation' | 'Turndown Service'
  | 'Early Arrival Preparation' | 'Deep Cleaning' | 'Preventive Cleaning' | 'Public Area Cleaning'
  | 'Special Cleaning' | 'Emergency Cleaning' | 'Biohazard Cleaning' | 'Room Refresh' | 'Guest Complaint Follow-up';

export interface SOP {
  id: string;
  title: string;
  category: 'Cleaning' | 'Safety' | 'Inspection' | 'Guest Service' | 'Linen' | 'General';
  description: string;
  steps: string[];
  updatedAt: string;
}

export interface ChecklistEntry {
  taskType: TaskTypeKey;
  items: string[];
}

export interface HKDocs {
  sops: SOP[];
  checklists: ChecklistEntry[];
}

// ── Defaults (from docs/Housekeeping Portal new.md) ──────────────────────

const STANDARD_CLEANING = [
  'Bed Making', 'Bathroom Cleaning', 'Vacuuming', 'Dusting',
  'Trash Removal', 'Surface Sanitization', 'Amenity Refill', 'Towel Replacement',
];

export const ALL_TASK_TYPES: TaskTypeKey[] = [
  'Checkout Cleaning', 'Stayover Service', 'VIP Preparation', 'Turndown Service',
  'Early Arrival Preparation', 'Deep Cleaning', 'Preventive Cleaning', 'Public Area Cleaning',
  'Special Cleaning', 'Emergency Cleaning', 'Biohazard Cleaning', 'Room Refresh', 'Guest Complaint Follow-up',
];

const DEFAULT_CHECKLISTS: ChecklistEntry[] = [
  { taskType: 'Checkout Cleaning', items: [...STANDARD_CLEANING, 'Linen Change', 'Mini-bar Check', 'Final Inspection'] },
  { taskType: 'Stayover Service', items: ['Bed Making', 'Bathroom Refresh', 'Trash Removal', 'Towel Replacement', 'Amenity Refill', 'Vacuuming'] },
  { taskType: 'VIP Preparation', items: [...STANDARD_CLEANING, 'VIP Amenities Setup', 'Welcome Note', 'Fruit / Gift Placement', 'Final Inspection'] },
  { taskType: 'Turndown Service', items: ['Close Curtains', 'Turn Down Bed', 'Lighting Set', 'Towel Placement', 'Slippers & Robe', 'Climate Check'] },
  { taskType: 'Early Arrival Preparation', items: [...STANDARD_CLEANING, 'Room Refresh', 'Climate Pre-set', 'Final Inspection'] },
  { taskType: 'Deep Cleaning', items: ['Carpet Shampoo', 'Curtain Cleaning', 'Mattress Rotation', 'Upholstery Cleaning', 'Wall Cleaning', 'Air Vent Cleaning'] },
  { taskType: 'Preventive Cleaning', items: ['Air Filters', 'Furniture Polish', 'Tile Grout', 'Window Cleaning', 'Balcony Cleaning', 'Ceiling Cleaning'] },
  { taskType: 'Public Area Cleaning', items: ['Floor Sweeping', 'Mopping', 'Surface Wipe-down', 'Trash Emptying', 'Glass Cleaning', 'Restroom Check'] },
  { taskType: 'Special Cleaning', items: [...STANDARD_CLEANING, 'Guest Request Items', 'Final Inspection'] },
  { taskType: 'Emergency Cleaning', items: [...STANDARD_CLEANING, 'Hazard Removal', 'Sanitization', 'Supervisor Sign-off'] },
  { taskType: 'Biohazard Cleaning', items: ['PPE Donned', 'Containment Setup', 'Biohazard Removal', 'Disinfection', 'Proper Disposal', 'Area Decontamination', 'Supervisor Sign-off'] },
  { taskType: 'Room Refresh', items: ['Amenity Refill', 'Towel Replacement', 'Trash Removal', 'Surface Wipe', 'Bed Tidy'] },
  { taskType: 'Guest Complaint Follow-up', items: ['Issue Verified', 'Corrective Action', 'Guest Informed', 'Follow-up Documentation', 'Supervisor Sign-off'] },
];

const DEFAULT_SOPS: SOP[] = [
  {
    id: 'SOP-001',
    title: 'Standard Room Cleaning Procedure',
    category: 'Cleaning',
    description: 'Step-by-step procedure for full room cleaning after guest checkout.',
    steps: [
      'Knock and announce "Housekeeping" before entering',
      'Open curtains and turn on all lights',
      'Remove trash and empty all bins',
      'Strip bed and remove used linens',
      'Spray bathroom surfaces with cleaner, let sit',
      'Make bed with fresh linens',
      'Clean and sanitize bathroom (toilet, sink, shower, mirror)',
      'Vacuum floor and mop if needed',
      'Dust all surfaces and furniture',
      'Refill amenities (soap, shampoo, towels, water)',
      'Check mini-bar and restock',
      'Final visual inspection',
    ],
    updatedAt: '2026-08-01',
  },
  {
    id: 'SOP-002',
    title: 'Biohazard Cleaning Protocol',
    category: 'Safety',
    description: 'Mandatory safety protocol for biohazard cleanup situations.',
    steps: [
      'Don full PPE (gloves, mask, gown, eye protection)',
      'Set up containment area with warning signs',
      'Remove biohazard material using approved tools',
      'Apply disinfectant to all affected surfaces',
      'Dispose of waste in biohazard bags per regulation',
      'Decontaminate the entire area',
      'Remove PPE in proper sequence',
      'Wash hands thoroughly',
      'Obtain supervisor sign-off',
      'Document incident in log',
    ],
    updatedAt: '2026-08-05',
  },
  {
    id: 'SOP-003',
    title: 'Room Inspection Procedure',
    category: 'Inspection',
    description: 'Supervisor inspection checklist and pass/fail criteria.',
    steps: [
      'Verify bed quality and linens',
      'Check bathroom cleanliness and amenities',
      'Inspect floors for stains or debris',
      'Check windows and mirrors for smudges',
      'Examine furniture condition',
      'Test lighting and replace bulbs if needed',
      'Verify air conditioning operation',
      'Test television and remote',
      'Verify internet connectivity',
      'Check amenity stock levels',
      'Verify safety equipment (smoke detector, fire plan)',
      'Assess overall presentation',
      'Record pass / fail / rework',
    ],
    updatedAt: '2026-08-10',
  },
  {
    id: 'SOP-004',
    title: 'VIP Guest Preparation',
    category: 'Guest Service',
    description: 'Enhanced preparation protocol for VIP arrivals.',
    steps: [
      'Perform full standard cleaning',
      'Set up VIP welcome amenities (fruit, note, gift)',
      'Place premium toiletries and robes',
      'Pre-set climate control to comfortable temperature',
      'Verify all electronics are functional',
      'Arrange flowers if specified',
      'Final supervisor inspection',
      'Notify front desk when room is ready',
    ],
    updatedAt: '2026-08-12',
  },
  {
    id: 'SOP-005',
    title: 'Linen Handling & Laundry Exchange',
    category: 'Linen',
    description: 'Procedure for issuing, returning, and reporting linen.',
    steps: [
      'Count linen before issuing to attendant',
      'Record issue in linen log',
      'Collect soiled linen in designated bags',
      'Separate damaged linen for reporting',
      'Return clean linen to proper storage',
      'Reconcile counts at end of shift',
      'Report shortages or damage to supervisor',
    ],
    updatedAt: '2026-08-08',
  },
];

const DEFAULT_DOCS: HKDocs = { sops: DEFAULT_SOPS, checklists: DEFAULT_CHECKLISTS };

// ── Persistence ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'hk-docs-v1';

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function loadDocsFromStorage(): HKDocs {
  if (typeof window === 'undefined') return DEFAULT_DOCS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DOCS;
    const parsed = JSON.parse(raw) as HKDocs;
    // Merge: ensure all task types have a checklist even if storage is stale
    const existingTypes = new Set(parsed.checklists.map(c => c.taskType));
    const missing = DEFAULT_CHECKLISTS.filter(c => !existingTypes.has(c.taskType));
    return {
      sops: parsed.sops?.length ? parsed.sops : DEFAULT_SOPS,
      checklists: [...parsed.checklists, ...missing],
    };
  } catch {
    return DEFAULT_DOCS;
  }
}

function saveDocsToStorage(docs: HKDocs) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Fetch docs from the backend (hk_config section 'docs').
 * Returns null if the API is unavailable or returns no data.
 */
async function fetchDocsFromAPI(propertyId: string | null): Promise<HKDocs | null> {
  if (!propertyId || typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/api/hk-portal/config/${propertyId}/docs`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || Object.keys(data).length === 0) return null;
    const docs = data as HKDocs;
    // Merge: ensure all task types have a checklist
    const existingTypes = new Set(docs.checklists?.map(c => c.taskType) ?? []);
    const missing = DEFAULT_CHECKLISTS.filter(c => !existingTypes.has(c.taskType));
    return {
      sops: docs.sops?.length ? docs.sops : DEFAULT_SOPS,
      checklists: [...(docs.checklists ?? []), ...missing],
    };
  } catch {
    return null;
  }
}

/**
 * Save docs to the backend (hk_config section 'docs').
 * Non-fatal if it fails — localStorage is the fallback.
 */
async function saveDocsToAPI(propertyId: string | null, docs: HKDocs): Promise<void> {
  if (!propertyId || typeof window === 'undefined') return;
  try {
    await fetch(`/api/hk-portal/config/${propertyId}/docs`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify(docs),
    });
  } catch {
    /* non-fatal — localStorage is the fallback */
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Shared hook for HK docs. Multiple components can call this; they each
 * get their own state but all read/write the same localStorage key, so
 * edits in Configuration are picked up by TaskManagement on next mount
 * or via the `version` bump event.
 *
 * On mount, it tries to fetch from the API (property-scoped). If the API
 * is unavailable, it falls back to localStorage. All writes go to both
 * localStorage (immediate) and the API (fire-and-forget).
 */
export function useHKDocs() {
  const { currentPropertyId } = useERP();
  const [docs, setDocs] = useState<HKDocs>(DEFAULT_DOCS);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Start with localStorage for instant render
    setDocs(loadDocsFromStorage());
    // Then try the API for the authoritative version
    let cancelled = false;
    fetchDocsFromAPI(currentPropertyId).then(apiDocs => {
      if (cancelled || !apiDocs) return;
      setDocs(apiDocs);
      saveDocsToStorage(apiDocs); // keep localStorage in sync
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setDocs(loadDocsFromStorage());
    };
    const onRefresh = () => { setDocs(loadDocsFromStorage()); setVersion(v => v + 1); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('hk-docs-changed', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('hk-docs-changed', onRefresh);
    };
  }, [currentPropertyId]);

  const update = useCallback((next: HKDocs) => {
    setDocs(next);
    saveDocsToStorage(next);
    window.dispatchEvent(new Event('hk-docs-changed'));
    // Fire-and-forget API save
    saveDocsToAPI(currentPropertyId, next);
  }, [currentPropertyId]);

  const reset = useCallback(() => {
    setDocs(DEFAULT_DOCS);
    saveDocsToStorage(DEFAULT_DOCS);
    window.dispatchEvent(new Event('hk-docs-changed'));
    saveDocsToAPI(currentPropertyId, DEFAULT_DOCS);
  }, [currentPropertyId]);

  return { docs, version, update, reset };
}

/**
 * Get the checklist for a specific task type. Falls back to standard
 * cleaning items if the type is not found.
 */
export function getChecklistForType(docs: HKDocs, taskType: string): string[] {
  const entry = docs.checklists.find(c => c.taskType === taskType);
  return entry?.items ?? STANDARD_CLEANING;
}
