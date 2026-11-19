/**
 * storeIds.ts — Central registry of unified inventory store IDs.
 *
 * Previously these IDs were hardcoded as string literals scattered across
 * multiple route files (housekeepingPortal, engineeringPortal,
 * unifiedInventoryPortal, unifiedInventoryBridge, standardReports,
 * procurementIntegration). If a store was ever recreated with a different
 * ID, every file would break silently.
 *
 * This module is the single source of truth. All route files should import
 * from here instead of inlining string literals.
 */

// ── Central / Main Warehouse ────────────────────────────────────────────
/** The Main Warehouse — the central gate that distributes to department stores. */
export const MAIN_STORE_ID = 'UINV-ST-MAIN';

// ── Department stores (seeded by migration 360, department column by 361) ──
/** Housekeeping working store — cleaning supplies, amenities, equipment. */
export const HK_STORE_ID = 'UINV-ST-HK';
/** Linen sub-store — linens / laundry supplies. */
export const HK_LINEN_STORE_ID = 'UINV-ST-LINEN';
/** Engineering store — spare parts, tools. */
export const ENG_STORE_ID = 'UINV-ST-ENG';
/** F&B Food store. */
export const FB_FOOD_STORE_ID = 'UINV-ST-FOOD';
/** F&B Beverage store (also used for minibar revenue goods). */
export const FB_BEV_STORE_ID = 'UINV-ST-BEV';
/** General store — items that don't map to a specific department. */
export const GEN_STORE_ID = 'UINV-ST-GEN';
/** Spa & Wellness store — massage oils, towels, spa supplies. */
export const SPA_STORE_ID = 'UINV-ST-SPA';

// ── Department → store ID mapping ───────────────────────────────────────
/** Map a department name to its primary store ID. */
export const DEPARTMENT_STORE_MAP: Record<string, string> = {
  Housekeeping: HK_STORE_ID,
  Engineering: ENG_STORE_ID,
  'Food & Beverage': FB_FOOD_STORE_ID, // primary; BEV is secondary
  'Spa & Wellness': SPA_STORE_ID,
};

/**
 * Department → store_code mapping (single source of truth).
 *
 * Maps every ERP department to the `store_code`(s) of its dedicated
 * uinv_stores. Used by `resolveDepartmentStoreIds()` in
 * unifiedInventoryPortal.routes.ts to filter stock balances by department.
 *
 * Operational departments (F&B, HK, Engineering) have their own stores.
 * All other departments share the General Store + Main Warehouse.
 * The Inventory portal sees every store.
 *
 * NOTE: this is the legacy store_code mapping. The `department` column on
 * uinv_stores (migration 361) is the modern mechanism — stores created via
 * the portal set `department` directly. Both are queried at runtime by
 * `resolveDepartmentStoreIds()` so newly-created department stores are
 * included without needing to update this map.
 */
export const DEPARTMENT_STORE_CODES: Record<string, string[]> = {
  'Food & Beverage': ['FOOD', 'BEV'],
  'Housekeeping':     ['HK', 'LINEN'],
  'Engineering':      ['ENG'],
  'Front Office':     ['GEN', 'MAIN'],
  'Finance':          ['GEN', 'MAIN'],
  'Human Resources':  ['GEN', 'MAIN'],
  'Security':         ['GEN', 'MAIN'],
  'Procurement':      ['GEN', 'MAIN'],
  'Sales':            ['GEN', 'MAIN'],
  'Transportation':   ['GEN', 'MAIN'],
  'Concierge':        ['GEN', 'MAIN'],
  'Spa & Wellness':   ['SPA'],
  'Banquet & Events': ['GEN', 'MAIN'],
  'Operations':       ['GEN', 'MAIN'],
  'Admin':            ['GEN', 'MAIN'],
  'Executive':        ['GEN', 'MAIN'],
  'Inventory':        ['GEN', 'MAIN', 'FOOD', 'BEV', 'HK', 'LINEN', 'ENG'],
};

/**
 * Resolve the store ID(s) for a department.
 * Returns an array because some departments (e.g. Housekeeping) have
 * multiple stores (HK + Linen).
 */
export function getStoreIdsForDepartment(department: string): string[] {
  if (department === 'Housekeeping') return [HK_STORE_ID, HK_LINEN_STORE_ID];
  if (department === 'Food & Beverage') return [FB_FOOD_STORE_ID, FB_BEV_STORE_ID];
  if (department === 'Spa & Wellness') return [SPA_STORE_ID];
  const single = DEPARTMENT_STORE_MAP[department];
  return single ? [single] : [];
}

/**
 * In-memory cache key pattern used by department portals for their
 * inventory list cache. Used by the central issue flow to invalidate
 * department caches when stock is distributed to a department store.
 *
 * Currently only Housekeeping caches its inventory list
 * (`hk-inventory-central:<propertyId>`). Other departments don't cache,
 * so invalidating is a no-op for them.
 */
export function getInventoryCachePattern(department: string): string | null {
  if (department === 'Housekeeping') return '^hk-inventory-central:';
  return null;
}

/**
 * Resolve the inventory cache pattern for a given store ID.
 * Returns null if the store's department doesn't cache its inventory list.
 */
export function getInventoryCachePatternForStore(storeId: string): string | null {
  if (storeId === HK_STORE_ID || storeId === HK_LINEN_STORE_ID) {
    return '^hk-inventory-central:';
  }
  return null;
}
