/**
 * Department → Item Category mapping.
 *
 * Determines which item categories a department can request or be issued.
 * An item is allowed for a department if its primary `category` OR any of its
 * `secondary_categories` matches one of the department's allowed categories.
 *
 * This is the single source of truth for category-based item access control.
 */

/** All valid item categories (must match CATEGORIES in ItemMasterModule). */
export const ITEM_CATEGORIES = [
  'Food & Beverage',
  'Housekeeping',
  'Engineering',
  'Office Supplies',
  'Operating Supplies',
  'Spa',
  'Administration',
] as const;

/**
 * Maps each department to the item categories it is allowed to request/receive.
 * Departments not listed here default to ['Office Supplies', 'Operating Supplies'].
 */
export const DEPARTMENT_CATEGORIES: Record<string, string[]> = {
  'Food & Beverage': ['Food & Beverage'],
  'Housekeeping': ['Housekeeping'],
  'Engineering': ['Engineering'],
  'Front Office': ['Office Supplies', 'Operating Supplies'],
  'Finance': ['Office Supplies', 'Administration'],
  'Human Resources': ['Office Supplies', 'Administration'],
  'Security': ['Operating Supplies', 'Office Supplies'],
  'Procurement': ['Office Supplies', 'Operating Supplies', 'Administration'],
  'Sales': ['Office Supplies', 'Administration'],
  'Revenue Management': ['Office Supplies', 'Administration', 'Operating Supplies'],
  'Transportation': ['Operating Supplies'],
  'Concierge': ['Office Supplies', 'Operating Supplies'],
  'Spa & Wellness': ['Spa & Wellness', 'Spa', 'Operating Supplies'],
  'Banquet & Events': ['Food & Beverage', 'Operating Supplies'],
  'Operations': ['Operating Supplies', 'Office Supplies'],
  'Admin': ['Administration', 'Office Supplies'],
  'Executive': ['Administration', 'Office Supplies'],
  'General': ['Office Supplies', 'Operating Supplies'],
  'Inventory': ['Food & Beverage', 'Housekeeping', 'Engineering', 'Office Supplies', 'Operating Supplies', 'Spa', 'Administration'],
};

/**
 * Returns the list of item categories a department is allowed to request/receive.
 */
export function getDepartmentCategories(department: string): string[] {
  return DEPARTMENT_CATEGORIES[department] || ['Office Supplies', 'Operating Supplies'];
}

/**
 * Checks if an item is allowed for a department based on its categories.
 * Matches against primary category AND secondary_categories.
 */
export function isItemAllowedForDepartment(
  item: { category: string; secondary_categories?: string[] | null },
  department: string,
): boolean {
  const allowed = getDepartmentCategories(department);
  const itemCats = [item.category, ...(item.secondary_categories || [])];
  return itemCats.some(c => allowed.includes(c));
}

/**
 * Filters a list of items to only those allowed for the given department.
 */
export function filterItemsForDepartment<
  T extends { category: string; secondary_categories?: string[] | null },
>(items: T[], department: string): T[] {
  return items.filter(it => isItemAllowedForDepartment(it, department));
}
