/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryContext — frontend state bridge for the unified inventory.
 *
 * Previously backed by legacy inventory_items/inventory_stores tables via
 * supabaseService. Now uses inventoryService.ts (uinv-portal) as the single
 * source of truth, with localStorage as an offline cache fallback.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { InventoryItem, Store, Requisition, RequisitionStatus, StockMovement, Supplier } from '../types/inventory';
import { useSystem } from './SystemContext';
import {
  fetchItems as fetchUinvItems,
  fetchStores as fetchUinvStores,
  fetchIssues as fetchUinvIssues,
  fetchLedger as fetchUinvLedger,
  createItem as createUinvItem,
  updateItem as updateUinvItem,
  deleteItem as deleteUinvItem,
  createStore as createUinvStore,
  updateStore as updateUinvStore,
  deleteStore as deleteUinvStore,
  createIssue as createUinvIssue,
  deleteIssue as deleteUinvIssue,
  type UinvItem,
  type UinvStore,
  type UinvIssue,
  type UinvLedgerEntry,
} from '../services/inventoryService';

export interface InventoryContextType {
  inventoryItems: InventoryItem[];
  inventoryStores: Store[];
  inventoryRequisitions: Requisition[];
  stockMovements: StockMovement[];
  suppliers: Supplier[];

  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => void;
  updateInventoryItem: (id: string, updates: Partial<InventoryItem>) => void;
  deleteInventoryItem: (id: string) => void;
  addInventoryStore: (store: Omit<Store, 'id'>) => void;
  updateInventoryStore: (id: string, updates: Partial<Store>) => void;
  deleteInventoryStore: (id: string) => void;
  addInventoryRequisition: (req: Omit<Requisition, 'id' | 'number'>) => void;
  updateInventoryRequisitionStatus: (id: string, status: RequisitionStatus, itemsWithIssuedQty?: { itemId: string, issuedQty: number }[]) => void;
  recordStockMovement: (movement: Omit<StockMovement, 'id'>) => void;
  addSupplier: (supplier: Omit<Supplier, 'id'>) => void;
  updateSupplier: (id: string, updates: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;
  refreshData: () => Promise<void>;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (!context) throw new Error('useInventory must be used within a InventoryProvider');
  return context;
};

// ── Mappers: uinv_* → legacy frontend types ──────────────────────────────

function uinvItemToLegacy(u: UinvItem): InventoryItem {
  return {
    id: u.id,
    code: u.item_code || '',
    name: u.item_name || '',
    category: (u.category as any) || 'Operating Supplies',
    subcategory: (u.subcategory as any) || 'Consumables',
    unit: u.unit_of_measure || 'PCS',
    brand: u.brand || undefined,
    supplierId: '',
    minStock: u.min_stock || 0,
    maxStock: u.max_stock || 0,
    reorderLevel: u.reorder_point || 0,
    lastCost: u.last_cost || 0,
    avgCost: u.avg_cost || u.last_cost || 0,
    currentStock: 0, // Stock lives in uinv_stock_balances, not on the item
    location: '',
    storeId: u.default_store_id || undefined,
  };
}

function uinvStoreToLegacy(s: UinvStore): Store {
  return {
    id: s.id,
    name: s.store_name || '',
    type: (s.store_type as any) || 'Main',
    manager: s.manager || '',
  };
}

function uinvIssueToLegacy(r: UinvIssue): Requisition {
  return {
    id: r.id,
    number: r.issue_number || '',
    department: r.department || '',
    requestedBy: r.requester || '',
    requestDate: r.created_at ? String(r.created_at).slice(0, 10) : '',
    priority: 'Normal',
    status: (r.approval_status as any) || 'Pending',
    items: (r.lines || []).map((l: any) => ({
      itemId: l.itemId || '',
      name: l.itemName || '',
      requestedQty: l.requestedQty || 0,
      issuedQty: l.issuedQty || 0,
      unit: l.unit || 'PCS',
      cost: l.unitCost || 0,
    })),
  };
}

function uinvLedgerToLegacy(l: UinvLedgerEntry): StockMovement {
  return {
    id: l.id,
    date: l.transaction_date || '',
    itemId: l.item_id || '',
    itemName: '',
    type: (l.transaction_type as any) || 'Adjustment',
    quantity: (l.quantity_in || 0) - (l.quantity_out || 0),
    cost: l.unit_cost || 0,
    reference: l.reference || '',
    user: l.performed_by || '',
    storeFrom: l.store_id || undefined,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logAudit } = useSystem();

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hotel_erp_inventory_items_v2');
      if (saved) return JSON.parse(saved);
    }
    return [];
  });

  const [inventoryStores, setInventoryStores] = useState<Store[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hotel_erp_inventory_stores_v1');
      if (saved) return JSON.parse(saved);
    }
    return [];
  });

  const [inventoryRequisitions, setInventoryRequisitions] = useState<Requisition[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hotel_erp_inventory_requisitions_v1');
      if (saved) return JSON.parse(saved);
    }
    return [];
  });

  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hotel_erp_stock_movements_v1');
      if (saved) return JSON.parse(saved);
    }
    return [];
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hotel_erp_suppliers_v1');
      if (saved) return JSON.parse(saved);
    }
    return [
      { id: 'S-001', code: 'SUP-001', name: 'Global Foods Ltd', contactPerson: 'Account Manager', phone: '+1 234 567 890', email: 'sales@globalfoods.com', status: 'Active', rating: 4.8 },
      { id: 'S-002', code: 'SUP-002', name: 'Luxe Hospitality Supplies', contactPerson: 'Operations Lead', phone: '+1 987 654 321', email: 'orders@luxesupplies.pro', status: 'Active', rating: 4.5 },
      { id: 'S-003', code: 'SUP-003', name: 'Prime Meats & Poultry', contactPerson: 'Sales Representative', phone: '+1 555 123 456', email: 'sales@primemeats.com', status: 'Active', rating: 4.2 },
      { id: 'S-004', code: 'SUP-004', name: 'Metro Office Solutions', contactPerson: 'Client Services', phone: '+1 444 888 999', email: 'support@metro-office.com', status: 'Inactive', rating: 3.8 },
      { id: 'S-005', code: 'SUP-005', name: 'Technical Maintenance Parts', contactPerson: 'Fleet Supervisor', phone: '+1 222 333 444', email: 'service@techmaintenance.net', status: 'Active', rating: 4.9 }
    ];
  });

  const persistRequisitions = useCallback((reqs: Requisition[]) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hotel_erp_inventory_requisitions_v1', JSON.stringify(reqs));
    }
  }, []);

  const persistStockMovements = useCallback((movements: StockMovement[]) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hotel_erp_stock_movements_v1', JSON.stringify(movements));
    }
  }, []);

  const persistSuppliers = useCallback((sups: Supplier[]) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hotel_erp_suppliers_v1', JSON.stringify(sups));
    }
  }, []);

  // ── Sync from unified inventory API ────────────────────────────────────
  const refreshData = useCallback(async () => {
    try {
      const [items, stores, issues, ledger] = await Promise.all([
        fetchUinvItems().catch(() => [] as UinvItem[]),
        fetchUinvStores().catch(() => [] as UinvStore[]),
        fetchUinvIssues().catch(() => [] as UinvIssue[]),
        fetchUinvLedger().catch(() => [] as UinvLedgerEntry[]),
      ]);

      const legacyItems = items.map(uinvItemToLegacy);
      setInventoryItems(legacyItems);
      localStorage.setItem('hotel_erp_inventory_items_v2', JSON.stringify(legacyItems));

      const legacyStores = stores.map(uinvStoreToLegacy);
      if (legacyStores.length > 0) {
        setInventoryStores(legacyStores);
        localStorage.setItem('hotel_erp_inventory_stores_v1', JSON.stringify(legacyStores));
      }

      const legacyReqs = issues.map(uinvIssueToLegacy);
      if (legacyReqs.length > 0) {
        setInventoryRequisitions(legacyReqs);
        persistRequisitions(legacyReqs);
      }

      const legacyMovements = ledger.map(uinvLedgerToLegacy);
      if (legacyMovements.length > 0) {
        setStockMovements(legacyMovements);
        persistStockMovements(legacyMovements);
      }
    } catch (error) {
      console.error('Failed to sync from unified inventory:', error);
    }
  }, [persistRequisitions, persistStockMovements]);

  React.useEffect(() => {
    refreshData();
  }, [refreshData]);

  // ── Stock movements (local cache; ledger is authoritative server-side) ─
  const recordStockMovement = useCallback((movementData: Omit<StockMovement, 'id'>) => {
    const newMovement: StockMovement = { ...movementData, id: `M-${Date.now()}-${Math.floor(Math.random() * 1000)}` };
    setStockMovements(prev => {
      const updated = [...prev, newMovement];
      persistStockMovements(updated);
      return updated;
    });
  }, [persistStockMovements]);

  // ── Items ──────────────────────────────────────────────────────────────
  const addInventoryItem = useCallback((itemData: Omit<InventoryItem, 'id'>) => {
    const newItem: InventoryItem = { ...itemData, id: `I-${Date.now()}` };
    setInventoryItems(prev => {
      const updated = [...prev, newItem];
      localStorage.setItem('hotel_erp_inventory_items_v2', JSON.stringify(updated));
      return updated;
    });
    // Sync to unified inventory
    createUinvItem({
      item_code: newItem.code,
      item_name: newItem.name,
      category: newItem.category,
      subcategory: newItem.subcategory,
      unit_of_measure: newItem.unit,
      brand: newItem.brand,
      min_stock: newItem.minStock,
      max_stock: newItem.maxStock,
      reorder_point: newItem.reorderLevel,
      last_cost: newItem.lastCost,
      avg_cost: newItem.avgCost,
      standard_cost: newItem.avgCost,
      is_active: true,
    }).catch(console.error);
    logAudit(`Added inventory item: ${newItem.name}`);
  }, [logAudit]);

  const updateInventoryItem = useCallback((id: string, updates: Partial<InventoryItem>) => {
    setInventoryItems(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, ...updates } : item);
      localStorage.setItem('hotel_erp_inventory_items_v2', JSON.stringify(updated));
      return updated;
    });
    // Sync to unified inventory
    const patch: Partial<UinvItem> = {};
    if (updates.code !== undefined) patch.item_code = updates.code;
    if (updates.name !== undefined) patch.item_name = updates.name;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.subcategory !== undefined) patch.subcategory = updates.subcategory;
    if (updates.unit !== undefined) patch.unit_of_measure = updates.unit;
    if (updates.minStock !== undefined) patch.min_stock = updates.minStock;
    if (updates.maxStock !== undefined) patch.max_stock = updates.maxStock;
    if (updates.reorderLevel !== undefined) patch.reorder_point = updates.reorderLevel;
    if (updates.lastCost !== undefined) patch.last_cost = updates.lastCost;
    if (updates.avgCost !== undefined) { patch.avg_cost = updates.avgCost; patch.standard_cost = updates.avgCost; }
    if (Object.keys(patch).length > 0) {
      updateUinvItem(id, patch).catch(console.error);
    }
    if (Object.keys(updates).length > 0) logAudit(`Updated inventory item ${id}`);
  }, [logAudit]);

  const deleteInventoryItem = useCallback((id: string) => {
    setInventoryItems(prev => {
      const updated = prev.filter(item => item.id !== id);
      localStorage.setItem('hotel_erp_inventory_items_v2', JSON.stringify(updated));
      return updated;
    });
    deleteUinvItem(id).catch(console.error);
    logAudit(`Deleted inventory item ${id}`);
  }, [logAudit]);

  // ── Stores ─────────────────────────────────────────────────────────────
  const addInventoryStore = useCallback((storeData: Omit<Store, 'id'>) => {
    const newStore = { ...storeData, id: `ST-${Date.now()}` };
    setInventoryStores(prev => {
      const updated = [...prev, newStore];
      if (typeof window !== 'undefined') {
        localStorage.setItem('hotel_erp_inventory_stores_v1', JSON.stringify(updated));
      }
      return updated;
    });
    createUinvStore({
      store_name: newStore.name,
      store_type: newStore.type,
      manager: newStore.manager,
      is_active: true,
    } as any).catch(console.error);
  }, []);

  const updateInventoryStore = useCallback((id: string, updates: Partial<Store>) => {
    setInventoryStores(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, ...updates } : s);
      if (typeof window !== 'undefined') {
        localStorage.setItem('hotel_erp_inventory_stores_v1', JSON.stringify(updated));
      }
      return updated;
    });
    const patch: Partial<UinvStore> = {};
    if (updates.name !== undefined) patch.store_name = updates.name;
    if (updates.type !== undefined) patch.store_type = updates.type;
    if (updates.manager !== undefined) patch.manager = updates.manager;
    if (Object.keys(patch).length > 0) {
      updateUinvStore(id, patch).catch(console.error);
    }
  }, []);

  const deleteInventoryStore = useCallback((id: string) => {
    setInventoryStores(prev => {
      const updated = prev.filter(s => s.id !== id);
      if (typeof window !== 'undefined') {
        localStorage.setItem('hotel_erp_inventory_stores_v1', JSON.stringify(updated));
      }
      return updated;
    });
    deleteUinvStore(id).catch(console.error);
  }, []);

  // ── Suppliers (not in unified inventory; local only) ───────────────────
  const addSupplier = useCallback((supplierData: Omit<Supplier, 'id'>) => {
    const newSupplier: Supplier = { ...supplierData, id: `SUP-${Date.now()}` };
    setSuppliers(prev => {
      const updated = [...prev, newSupplier];
      persistSuppliers(updated);
      return updated;
    });
    logAudit(`Added supplier: ${newSupplier.name}`);
  }, [logAudit, persistSuppliers]);

  const updateSupplier = useCallback((id: string, updates: Partial<Supplier>) => {
    setSuppliers(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, ...updates } : s);
      persistSuppliers(updated);
      return updated;
    });
    logAudit(`Updated supplier ${id}`);
  }, [logAudit, persistSuppliers]);

  const deleteSupplier = useCallback((id: string) => {
    setSuppliers(prev => {
      const updated = prev.filter(s => s.id !== id);
      persistSuppliers(updated);
      return updated;
    });
    logAudit(`Deleted supplier ${id}`);
  }, [logAudit, persistSuppliers]);

  // ── Requisitions (unified issues) ──────────────────────────────────────
  const addInventoryRequisition = useCallback((reqData: Omit<Requisition, 'id' | 'number'>) => {
    const reqId = `REQ-${Date.now()}`;
    setInventoryRequisitions(prev => {
      const counter = (Number(localStorage.getItem('hotel_erp_req_counter') || '0')) + 1;
      localStorage.setItem('hotel_erp_req_counter', String(counter));
      const newReq: Requisition = { ...reqData, id: reqId, number: `REQ-${String(counter).padStart(4, '0')}` };
      const updated = [...prev, newReq];
      persistRequisitions(updated);
      // Sync to unified issues
      createUinvIssue({
        issue_number: newReq.number,
        department: newReq.department,
        requester: newReq.requestedBy,
        source: 'Requisition',
        lines: newReq.items.map(i => ({
          itemId: i.itemId,
          itemName: i.name,
          requestedQty: i.requestedQty,
          unit: i.unit,
          unitCost: i.cost || 0,
        })),
      } as any).catch(console.error);
      return updated;
    });
  }, [persistRequisitions]);

  const updateInventoryRequisitionStatus = useCallback((id: string, status: RequisitionStatus, itemsWithIssuedQty?: { itemId: string, issuedQty: number }[]) => {
    setInventoryRequisitions(prev => {
      const updated = prev.map(req => {
        if (req.id !== id) return req;
        const updatedReq = { ...req, status };
        if (status === 'Issued' && itemsWithIssuedQty && itemsWithIssuedQty.length > 0) {
          const issuedMap = new Map(itemsWithIssuedQty.map(i => [i.itemId, i.issuedQty]));
          updatedReq.items = req.items.map(item => ({
            ...item,
            issuedQty: issuedMap.get(item.itemId) ?? item.issuedQty
          }));
        }
        return updatedReq;
      });
      persistRequisitions(updated);
      return updated;
    });

    // When issuing, record stock movements locally
    if (status === 'Issued' && itemsWithIssuedQty && itemsWithIssuedQty.length > 0) {
      itemsWithIssuedQty.forEach(({ itemId, issuedQty }) => {
        if (issuedQty > 0) {
          const item = inventoryItems.find(i => i.id === itemId || i.code === itemId);
          if (item) {
            recordStockMovement({
              date: new Date().toISOString(),
              itemId: item.id,
              itemName: item.name,
              type: 'Issue',
              quantity: -issuedQty,
              cost: item.avgCost,
              reference: id,
              user: 'System',
              storeFrom: item.location
            });
          }
        }
      });
      logAudit(`Issued requisition ${id} for ${itemsWithIssuedQty.length} items`);
    }
  }, [inventoryItems, recordStockMovement, logAudit, persistRequisitions]);

  const value = {
    inventoryItems, inventoryStores, inventoryRequisitions, stockMovements, suppliers,
    addInventoryItem, updateInventoryItem, deleteInventoryItem,
    addInventoryStore, updateInventoryStore, deleteInventoryStore, addInventoryRequisition, updateInventoryRequisitionStatus,
    recordStockMovement, addSupplier, updateSupplier, deleteSupplier,
    refreshData
  };

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
};
