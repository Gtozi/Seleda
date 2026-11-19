/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for reservationApiSchema — specifically the billing/folio-routing
 * fields (billing_mode, corporate_account_id, booking_group_id, booking_type)
 * that must survive `PUT /api/reservations/:id` validation, and the
 * room_type_id relaxation that previously caused validation (and therefore
 * persistence) to fail silently for any reservation without an explicit
 * room_type_id FK.
 */

import { describe, it, expect } from 'vitest';
import { reservationApiSchema } from './backendSchemas';

const basePayload = {
  check_in_date: '2026-08-10',
  check_out_date: '2026-08-12',
};

describe('reservationApiSchema', () => {
  it('validates successfully without room_type_id (previously required and would fail)', () => {
    const result = reservationApiSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
  });

  it('preserves billing_mode when provided', () => {
    const result = reservationApiSchema.safeParse({
      ...basePayload,
      billing_mode: 'corporate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.billing_mode).toBe('corporate');
    }
  });

  it('rejects an invalid billing_mode value', () => {
    const result = reservationApiSchema.safeParse({
      ...basePayload,
      billing_mode: 'not-a-real-mode',
    });
    expect(result.success).toBe(false);
  });

  it('preserves corporate_account_id, booking_group_id and booking_type', () => {
    const result = reservationApiSchema.safeParse({
      ...basePayload,
      corporate_account_id: 'CORP-1',
      booking_group_id: 'GRP-1',
      booking_type: 'Corporate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.corporate_account_id).toBe('CORP-1');
      expect(result.data.booking_group_id).toBe('GRP-1');
      expect(result.data.booking_type).toBe('Corporate');
    }
  });

  it('preserves discount_percent', () => {
    const result = reservationApiSchema.safeParse({
      ...basePayload,
      discount_percent: 15,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discount_percent).toBe(15);
    }
  });

  it('passes through additional fields not explicitly declared (e.g. guest_tin) instead of silently stripping them', () => {
    const result = reservationApiSchema.safeParse({
      ...basePayload,
      guest_tin: 'TIN-12345',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).guest_tin).toBe('TIN-12345');
    }
  });

  it('still rejects when check-out is not after check-in', () => {
    const result = reservationApiSchema.safeParse({
      check_in_date: '2026-08-12',
      check_out_date: '2026-08-10',
    });
    expect(result.success).toBe(false);
  });
});
