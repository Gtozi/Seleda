# Folio System Analysis

**Date:** August 9, 2026
**Scope:** Guest Folio, Group Folio, Master Folio, Company Folio, Split Folio

---

## 1. Database Schema

### `folios` table — key columns

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text (PK) | UUID or custom ID |
| `reservation_id` | text (FK) | Links to `reservations.id` |
| `folio_type` | text | **CHECK constraint allows: `Guest`, `Group`, `Master`, `House`** |
| `target_folio` | text | **CHECK constraint allows: `A`, `B`, or NULL** |
| `status` | text | `Open`, `Closed`, `Transferred`, `Voided` |
| `balance` | numeric | Cached balance (real source: folio_lines + folio_payments) |
| `total_charges` | numeric | Cached total charges |
| `total_payments` | numeric | Cached total payments |
| `group_id` | text | **Currently unused (always NULL in production data)** |
| `owner_type` | text | **Currently unused (always NULL)** |
| `owner_id` | text | **Currently unused (always NULL)** |

### Current production data

| folio_type | target_folio | Count | Notes |
|------------|-------------|-------|-------|
| `Guest` | NULL | 3 | Individual bookings (Walk-In) |
| `Guest` | `B` | 2 | Split folio B — incidentals for group/corporate bookings |
| `Master` | `A` | 2 | Split folio A — room charges for group/corporate bookings |

---

## 2. Folio Types — Current Implementation

### 2.1 Guest Folio (`folio_type='Guest'`, `target_folio=NULL`)

**When created:** At check-in for individual (non-group, non-corporate) bookings.

**Creation logic** (`reservations.routes.ts` line 608-624):
```
if NOT (channel === 'Corporate' OR group_booking_id != null):
  → Create single Guest folio (target_folio=NULL)
  → Post room charge to it
```

**Purpose:** Holds ALL charges (room + incidentals) and payments for an individual guest.

**Current data:** 3 folios — "hagos kj" (Closed), "zer hk" (Open, $385), "jjh jk" (Open, $200)

---

### 2.2 Split Folio (Master A + Guest B)

**When created:** At check-in when `isCorporate = true` (channel='Corporate' OR group_booking_id != null).

**Creation logic** (`reservations.routes.ts` line 558-607):
```
if isCorporate:
  → Create Master folio (folio_type='Master', target_folio='A')
  → Create Guest folio (folio_type='Guest', target_folio='B')
  → Post room charge to Master (A) folio
  → Guest (B) folio starts at $0 for incidentals
```

**Purpose:**
- **Folio A (Master):** Company/corporate pays — room charges, conference fees, group meals
- **Folio B (Guest):** Guest pays personally — minibar, spa, personal extras

**Charge routing** (`folioRouting.ts`):
- `getChargeFolio()` determines A vs B based on:
  1. Explicit `targetFolio` on the charge
  2. `billingMode === 'group'` → routes by `activeGroupChargeTypes` (Room, F&B, Laundry, Transfer, Extra)
  3. Corporate billing profile → routes by `primaryTypes` / `secondaryTypes`
  4. Description-based inference (room→A, minibar→B, etc.)

**Current data:** 2 pairs — both for group booking GRP-UCD77R ("lemlem1" and "lemlem2")

**⚠️ Issue:** The `isCorporate` check uses `group_booking_id != null` — so ALL group bookings (even those without a corporation) get split folios. This may not be desired for group bookings where the travel agency is just a booking channel, not the payer.

---

### 2.3 Master Folio (`folio_type='Master'`, `target_folio='A'`)

**When created:** Same as split folio above — only created as part of the A/B split.

**Purpose:** The "company pays" side of a split folio. Room charges and company-billed extras go here.

**Invoice generation:** Supports `invoiceType='Group Master'` which produces a "GROUP MASTER INVOICE" title.

**⚠️ Gap:** No standalone "Master Folio" exists that aggregates charges across MULTIPLE reservations in a group. Each reservation in a group gets its OWN Master (A) folio — there's no single consolidated master folio for the entire group.

---

### 2.4 Group Folio (`folio_type='Group'`)

**Status: ⚠️ DEFINED IN SCHEMA BUT NEVER CREATED**

The CHECK constraint allows `folio_type='Group'`, but:
- **No code path creates a Group folio** — `ensureFolio()` and `check_in_reservation()` only create `Guest` or `Master` folios
- **0 Group folios exist in production data**
- The `group_id` column on `folios` exists but is **always NULL**

**What it should be:** A single folio that aggregates charges across ALL reservations in a group booking — used for group master billing, group checkout, and consolidated group invoicing.

**Current workaround:** The frontend `CheckInOutModule` has a "Group Master Ledger" view that **consolidates** charges from multiple reservations' individual folios in the UI, but there's no single database-level Group folio record.

---

### 2.5 Company Folio (`folio_type='Company'` or similar)

**Status: ❌ NOT IMPLEMENTED**

- The CHECK constraint does NOT allow `'Company'` as a folio_type — only `Guest`, `Group`, `Master`, `House`
- No code path creates a company folio
- The `owner_type` / `owner_id` columns exist but are unused

**What it should be:** A folio owned by a `corporate_account` or `group_profile` (type=CorporateAccount/TravelAgent) that aggregates all charges billed to that company across multiple stays and reservations — for periodic billing/invoicing.

---

### 2.6 House Folio (`folio_type='House'`)

**Status: ⚠️ DEFINED IN SCHEMA BUT NEVER CREATED**

Allowed by the CHECK constraint but no code creates it. Typically used for internal hotel charges, complimentary stays, or staff accommodations.

---

## 3. Architecture Gaps

### Gap 1: No true Group Folio (aggregated)
**Problem:** Each reservation in a group gets its own A/B split folios. There's no single folio that aggregates all charges for the entire group.
**Impact:** Group master invoicing must be done per-reservation, not per-group. The frontend simulates consolidation by summing across reservations.
**Fix:** Create a `folio_type='Group'` folio with `group_id` set to the group booking ID. Route group-billed charges to this folio instead of per-reservation Master folios.

### Gap 2: No Company Folio
**Problem:** Corporate accounts and travel agencies have no persistent folio for periodic billing.
**Impact:** Each stay creates separate folios. The company can't see a consolidated balance across all their bookings.
**Fix:** Add `'Company'` to the folio_type CHECK constraint. Create company folios linked to `group_profiles` (type=CorporateAccount/TravelAgent) via `owner_type='group_profile'` and `owner_id=<profile_id>`.

### Gap 3: Split folio triggered for ALL group bookings
**Problem:** `isCorporate = channel === 'Corporate' || group_booking_id != null` — any group booking gets split folios, even if the travel agency is just a booking channel and the guest pays their own bill.
**Impact:** Group bookings without corporate billing still get A/B split, which is confusing and unnecessary.
**Fix:** Only create split folios when there's an actual corporate account or when the billing mode is explicitly set to 'group'. Use `corporate_account_id` presence or a `billing_mode` field on the reservation.

### Gap 4: `group_id` column unused
**Problem:** The `folios.group_id` column exists but is never populated.
**Impact:** Can't query "which folios belong to this group" without joining through reservations.
**Fix:** Set `group_id` when creating folios for group bookings.

### Gap 5: `owner_type` / `owner_id` columns unused
**Problem:** These columns exist for folio ownership (e.g., company-owned folios) but are never set.
**Impact:** No way to link a folio to a corporate account or travel agency directly.
**Fix:** Use these when implementing Company Folios.

---

## 4. Folio Creation Flow (Current)

```
Reservation created (FrontOffice)
  └── No folio created yet

Guest checks in (POST /:id/check-in)
  ├── Individual booking (no group_booking_id, channel != Corporate)
  │   └── Create 1× Guest folio (target_folio=NULL)
  │       └── Post room charge to it
  │
  └── Group/Corporate booking (group_booking_id != null OR channel=Corporate)
      └── Create 2× folios (split):
          ├── Master folio (folio_type='Master', target_folio='A')
          │   └── Post room charge to A
          └── Guest folio (folio_type='Guest', target_folio='B')
              └── Starts at $0 (for incidentals)

Charge posted (POST /:id/charges)
  └── getChargeFolio() determines A or B
      └── Charge routed to appropriate folio

Payment posted (POST /:id/payments)
  └── Payment applied to specified folio (A or B)

Invoice generated (POST /folios/:folioId/generate-invoice)
  └── Invoice created from folio_lines on that folio
  └── Tax/VAT info pulled from group_profile / corporate_account / settings
```

---

## 5. Recommendations

### Priority 1: Fix split folio trigger
Only create A/B split folios when:
- `corporate_account_id` is set on the reservation, OR
- A billing profile explicitly requests corporate billing, OR
- The reservation has a parent group profile of type `CorporateAccount`

### Priority 2: Implement true Group Folio
- Create a `folio_type='Group'` folio when a group booking is checked in
- Set `group_id` to the group booking ID
- Optionally aggregate room charges from all member reservations onto this folio
- Enable group master invoice generation from a single folio

### Priority 3: Implement Company Folio
- Add `'Company'` to the folio_type CHECK constraint
- Create company folios linked to corporate accounts / travel agencies
- Use `owner_type='group_profile'` and `owner_id=<profile_id>`
- Enable periodic consolidated billing for companies

### Priority 4: Populate `group_id` on existing folios
- Backfill `folios.group_id` from `reservations.booking_group_id` for existing folios
- Set it automatically on all new folio creations for group bookings
