/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the reservation billing_mode mapping round-trip, added alongside
 * the "seamless billing" fixes so the explicit billing-mode selector in
 * BookingTypeSelector actually persists through mapReservationToDb ->
 * PUT /api/reservations/:id -> mapReservationFromDb without being dropped.
 */

import { describe, it, expect } from 'vitest';
import { mapReservationFromDb, mapReservationToDb } from './dataMapper';

describe('reservation billing_mode mapping', () => {
  it('maps billing_mode from a DB row into billingMode', () => {
    const mapped = mapReservationFromDb({ id: 'R-1', billing_mode: 'group' });
    expect(mapped.billingMode).toBe('group');
  });

  it('leaves billingMode undefined when billing_mode is absent', () => {
    const mapped = mapReservationFromDb({ id: 'R-1' });
    expect(mapped.billingMode).toBeUndefined();
  });

  it('maps billingMode back to billing_mode for persistence', () => {
    const row = mapReservationToDb({ billingMode: 'corporate' });
    expect(row.billing_mode).toBe('corporate');
  });

  it('omits billing_mode from the row when billingMode is not set', () => {
    const row = mapReservationToDb({ guestName: 'Jane Doe' });
    expect(row.billing_mode).toBeUndefined();
  });

  it('round-trips individual/group/corporate values', () => {
    (['individual', 'group', 'corporate'] as const).forEach((mode) => {
      const row = mapReservationToDb({ billingMode: mode });
      const mapped = mapReservationFromDb(row);
      expect(mapped.billingMode).toBe(mode);
    });
  });
});
