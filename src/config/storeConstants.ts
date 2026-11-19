/**
 * storeConstants.ts — Frontend mirror of server-side store IDs.
 * Used by inter-department transfer UI to route transfers through Central.
 */

export const MAIN_STORE_ID = 'UINV-ST-MAIN';
export const HK_STORE_ID = 'UINV-ST-HK';
export const HK_LINEN_STORE_ID = 'UINV-ST-LINEN';
export const ENG_STORE_ID = 'UINV-ST-ENG';
export const FB_FOOD_STORE_ID = 'UINV-ST-FOOD';
export const FB_BEV_STORE_ID = 'UINV-ST-BEV';
export const GEN_STORE_ID = 'UINV-ST-GEN';

export const DEPARTMENT_STORE_MAP: Record<string, string[]> = {
  Housekeeping: [HK_STORE_ID, HK_LINEN_STORE_ID],
  Engineering: [ENG_STORE_ID],
  'Food & Beverage': [FB_FOOD_STORE_ID, FB_BEV_STORE_ID],
};

export const ALL_DEPARTMENTS = ['Housekeeping', 'Engineering', 'Food & Beverage'] as const;
