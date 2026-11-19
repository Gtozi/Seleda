/**
 * Inventory domain events (spec §81 / §91 of the Unified Inventory &
 * Stores portal docs).
 *
 * Lightweight in-process pub/sub for the inventory domain. Key business
 * transitions publish events so cross-cutting consumers (notifications,
 * BI refresh, integrations) can subscribe without the route handlers
 * growing side-effect chains.
 *
 * Event names follow `<entity>.<action>`:
 *   movement.applied            — every atomic stock movement (via the
 *                                 uinv_apply_stock_movement RPC helper)
 *   receipt.created             — GRN created
 *   issue.issued                — issue distributed to a department
 *   transfer.dispatched         — transfer left the source store
 *   transfer.received           — transfer arrived at the destination
 *   adjustment.approved         — adjustment applied to stock
 *   waste.approved              — waste written off
 *   reservation.created         — stock reserved
 *   reservation.released        — reservation hold released
 *   count.completed             — stock count completed
 *   disposal.disposed           — asset disposed (+ journal posted)
 *   asset.retired               — asset retired (+ journal posted)
 *   variance.investigation      — variance investigation created/resolved
 *
 * Usage:
 *   import { inventoryEvents, InventoryEvent } from './inventoryEvents';
 *   inventoryEvents.emit('transfer.dispatched', { transferId, ... });
 *   inventoryEvents.on('transfer.dispatched', (e) => { ... });
 */

import { EventEmitter } from 'events';

export type InventoryEventName =
  | 'movement.applied'
  | 'receipt.created'
  | 'issue.issued'
  | 'transfer.dispatched'
  | 'transfer.received'
  | 'adjustment.approved'
  | 'waste.approved'
  | 'reservation.created'
  | 'reservation.released'
  | 'count.completed'
  | 'disposal.disposed'
  | 'asset.retired'
  | 'variance.investigation';

export interface InventoryEvent {
  name: InventoryEventName;
  /** ISO timestamp of emission. */
  at: string;
  /** Acting user (name or id). */
  performedBy: string;
  /** Property scope when known. */
  propertyId?: string | null;
  /** Free-form payload with at least an entity reference. */
  payload: Record<string, any>;
}

class InventoryEventBus extends EventEmitter {
  emit(name: InventoryEventName, payload: Record<string, any>, opts: { performedBy?: string; propertyId?: string | null } = {}): boolean {
    const event: InventoryEvent = {
      name,
      at: new Date().toISOString(),
      performedBy: opts.performedBy ?? 'system',
      propertyId: opts.propertyId ?? null,
      payload,
    };
    return super.emit(name, event);
  }

  /** Subscribe with typed events. Returns an unsubscribe function. */
  subscribe(name: InventoryEventName, listener: (event: InventoryEvent) => void): () => void {
    super.on(name, listener as any);
    return () => super.off(name, listener as any);
  }
}

export const inventoryEvents = new InventoryEventBus();
inventoryEvents.setMaxListeners(50);
