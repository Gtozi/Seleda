# SELEDA ERP — Agent Guidelines

## Architecture: Route-Driven (Phases 0–5 complete)

The system is 100% route-driven. See `ROUTE_DRIVEN_MIGRATION_PLAN.md` for the full migration history.

### Backend

- **`server.ts`** (~90 lines): Only contains `startServer()`, the `/api/health` endpoint, `app.use('/api', apiRouter)`, Vite SPA middleware, and `app.listen()`. No inline route handlers.
- **`src/server/routes/index.ts`**: Composed `apiRouter` — single mount point for all route files. Every API route is mounted here.
- **Route files** (`src/server/routes/*.routes.ts`): Each file exports a `Router()` mounted at a prefix. Handlers are thin — business logic lives in services.
- **Services** (`src/server/services/`):
  - `sessionService.ts` — session/auth helpers (createSession, authenticateUser, writeAuditEvent, etc.)
  - `sharedServices.ts` — data transforms (camelToSnakeRecord, snakeToCamelRecord, autoAssignRoomsForPublicBookings, etc.)
  - `settingsService.ts` — global settings cache + read/write

### Frontend

- **URL scheme**: `/erp/:department/:tab` — every department + tab has its own URL.
- **`src/config/departments.ts`**: Single source of truth for the 18 departments. Each has `key`, `label`, `urlSegment`, `defaultTab`, and `Portal` component. Includes `getDefaultDeptForUser(user)` and `getDefaultErpPath(user)`.
- **`src/config/departmentTabs.ts`**: Per-department tab registry (id, label, modId). Used by `DepartmentRoute` for access control.
- **`src/components/Shared/ErpLayout.tsx`**: Layout route for `/erp` — owns session/auth/forced-password-change guards, renders `<Outlet/>`.
- **`src/components/Shared/DepartmentRoute.tsx`**: Per-department route wrapper — reads `:department`/`:tab` from URL, checks module-disabled + tab-access, renders the portal with `activeTab`/`activeModule` derived from the URL.
- **`src/components/Shared/DepartmentSwitcher.tsx`**: Dropdown in the header for switching departments.
- **`src/components/Shared/ForcedPasswordChangeScreen.tsx`**: Forced password change UI (extracted from App.tsx).
- **`src/App.tsx`** (~930 lines): Outer layout (header, side nav, theme, currency, property switcher) + `<Routes>` for all top-level routes. `activeDept` and `activeTab` are derived from `location.pathname` — no `useState` for department/tab.
- **Guest portal**: `/guest/:tab` — the public `GuestPortal` is URL-driven too. `MODULE_SLUGS` in `GuestPortal.tsx` maps kebab-case URL slugs to camelCase module ids; unknown slugs redirect to `/guest/dashboard`. Bare `/guest` renders the dashboard. Guest context resolves from `?guestId=&reservationId=` query params (persisted to sessionStorage, preserved across tab navigation). Mobile shell: sticky header with section label + notifications shortcut, bottom tab bar (Home / My Stay / Dining / Messages / More → drawer), safe-area-inset padding (`viewport-fit=cover` in `index.html`), body scroll-lock while the drawer is open. All 23 modules use responsive `p-4 sm:p-6` padding. The Profile tab (`/guest/profile`) is DB-integrated via `GET/PUT /api/guest-portal/profile/:guestId` — personal info on the `guests` row, stay prefs in `guests.preferences` JSONB sharing the FO Guest Profiles keys (`bedType`, `pillowType`, `dietary`, `language`, …). The Reservations tab (`/guest/reservations`) is DB-integrated via `GET /api/guest-portal/reservations/:guestId` (enriched with `properties.property_name`, `rate_plans.name`, `packages.name`), `PATCH /api/guest-portal/reservations/:id` (date modify) and `PATCH /api/guest-portal/reservations/:id/cancel` — both restricted to Reserved/Pending/Confirmed; "New Reservation" navigates to `/booking`. The Digital Check-in tab (`/guest/checkin`) is DB-integrated via migration `650_guest_mobile_check_ins.sql` (creates `mobile_check_ins` — previously the endpoints wrote to a table that did not exist) and routes `GET /api/guest-portal/check-in/:reservationId` (state + reservation/guest prefill), `POST /check-in/initiate` (idempotent per reservation), `PATCH /check-in/:checkInId/progress` (resumable wizard state in `progress` JSONB), `POST /check-in/:checkInId/complete`. If only `guestId` is in context, the module picks the soonest check-in-eligible reservation itself. All guarded by `canActForGuest`. The Digital Key tab (`/guest/digital-key`) is DB-integrated via migration `651_guest_digital_keys.sql` (creates `digital_keys` — also previously missing) and routes `GET /api/guest-portal/digital-key/:reservationId` (keys + reservation context, lazily expires past-due keys), `POST /digital-key/:reservationId/issue` (requires a room-assigned, in-house reservation; expiry = check-out 11:00), `POST /digital-key/:reservationId/share` (`kind='shared'` companion access), `PATCH /digital-key/:keyId/revoke`, `POST /digital-key/:reservationId/revoke-all` (lost device). The My Stay tab (`/guest/my-stay`) is DB-integrated via `GET /api/guest-portal/my-stay/:reservationId` — a composed read of `reservations` + `rooms`/`room_types` (floor, bed_configuration, amenities) + `properties` (name, jsonb address, contacts) + `folios`/`folio_lines` (non-voided lines, balance) + today's itinerary from `spa_appointments` and `fb_table_reservations`/`outlets`. With only `guestId` it resolves the in-house stay first, else soonest upcoming. NOTE: the older `GET /folio/:reservationId` route still reads `reservation_folios`/`folio_charges`, which do not exist — real folio data lives in `folios` + `folio_lines` (+ `guest_folio_view`). The Room Service tab (`/guest/room-service`) is DB-integrated via `GET /api/guest-portal/room-service/menu/:reservationId` (fb_room_service_menu_items + menu_items, availability-window + property filtering, allergens → dietary tags), `GET /room-service/orders/:reservationId` (orders + line items), `POST /room-service/orders` (server-recomputed prices, Immediate/Scheduled, charged to room) and `PATCH /room-service/orders/:orderId/cancel` (Pending only) — the same `fb_room_service_*` rows the staff F&B console manages. NOTE: the older `/services/*` and `/in-stay/*` routes read `guest_services`/`service_orders`/`in_stay_*`, which do not exist. The Restaurant tab (`/guest/restaurant`) is DB-integrated via `GET /api/guest-portal/restaurants/overview/:reservationId` (property outlets + `operating_hours` + the guest's `fb_table_reservations` bookings) plus the pre-existing capacity-aware `GET /restaurants/availability/:propertyId` and `POST /restaurants/reservations`, and a new `PATCH /restaurants/reservations/:bookingId/cancel` (confirmed + future only). Outlet `type` ('Restaurant'|'Bar') drives the card icon — there is no cuisine/rating field; don't fabricate one. The Spa tab (`/guest/spa`) was already DB-integrated: `GET /api/guest-portal/spa/catalog/:guestId`, `GET /spa/availability`, `POST /spa/bookings`, `GET /spa/bookings/:guestId`, `PATCH /spa/bookings/:id/cancel|reschedule`, `POST /spa/waitlist` over `spa_appointments`/`spa_treatments`/`spa_therapists` with staff-shared conflict + contraindication checks. The Concierge (`/guest/concierge`) and Transportation (`/guest/transportation`) tabs were already DB-integrated (`/concierge/*` over `guest_services`+`guest_requests` dept='Concierge'; `/transport/*` over `transport_config_items`+`transport_requests`) but every call lacked the `reservationId` credential `canActForGuest` requires for non-staff — the modules now send it in query/body on all requests. The Housekeeping tab (`/guest/housekeeping`) is DB-integrated via `GET /api/guest-portal/housekeeping/requests/:reservationId`, `POST /housekeeping/requests`, `PATCH /housekeeping/requests/:id/cancel` — all writing `guest_requests` with `assigned_department='HK'` (the same queue staff read via `/api/front-office/guest-requests?department=HK`). NOTE: the earlier `/housekeeping/*` routes wrote to a `housekeeping_requests` table that does not exist — replaced. The Maintenance tab (`/guest/maintenance`) is the same pattern via `GET /api/guest-portal/maintenance/requests/:reservationId`, `POST /maintenance/requests`, `PATCH /maintenance/requests/:id/cancel` writing `guest_requests` with `assigned_department='Engineering'` (the seeded request-type map routes 'Maintenance' → Engineering; the earlier routes wrote to a nonexistent `maintenance_requests` table — replaced). The Events tab (`/guest/events`) is DB-integrated by reusing the concierge endpoints: catalog = `GET /api/guest-portal/concierge/catalog/:guestId` filtered client-side to `guest_services` categories `concierge`/`tour`/`itinerary` (the experience catalog the staff concierge desk sells), bookings = `POST /concierge/requests` (maps to 'Experience Booking'/'Tour Booking'/'Itinerary Planning' request types in `guest_requests`), list = `GET /concierge/requests/:guestId` filtered to those request types, cancel = `PATCH /concierge/requests/:id/cancel`. All calls send `reservationId` for `canActForGuest`. The Meetings tab (`/guest/meetings`) is DB-integrated via `GET /api/guest-portal/meetings/overview/:guestId` (`banquet_venues` catalog + the guest's `banquet_events`), `POST /meetings/inquiries` (creates `banquet_events` rows: client_id=guestId, status='Inquiry', validated event types, optional venue preference in `venue_ids`), and `PATCH /meetings/events/:id/cancel` (Inquiry/Tentative/Planning only) — the same entities the staff events/banquet portal manages. The Loyalty tab (`/guest/loyalty`) is DB-integrated via `GET /api/guest-portal/loyalty/:guestId` — balance from `guests.loyalty_points` (maintained by the `accrue_loyalty_points`/`redeem_loyalty_points` RPCs), ledger from `loyalty_transactions` (accrual/redemption, balance_after), tier thresholds bronze/silver/gold/platinum (0/2500/5000/10000). No rewards-catalog table exists — redemption requests post to the concierge queue (`guest_requests` via `POST /concierge/requests`, service_name='Loyalty Redemption'). NOTE: the earlier `/loyalty/:guestId` read nonexistent `loyalty_members`/`loyalty_points` tables — replaced; `guestStaff.routes.ts` loyalty insert also targets missing columns. The Wallet tab (`/guest/wallet`) is DB-integrated via migration `652_guest_payment_methods.sql` (`guest_payment_methods` — display metadata only: label/last4/expiry, never PAN/CVV) and `GET /api/guest-portal/wallet/:guestId` (methods + `folio_payments` across the guest's reservations), `POST /wallet/:guestId/methods` (first method auto-default), `PATCH /wallet/methods/:id/default`, `DELETE /wallet/methods/:id` (promotes oldest remaining to default). The Billing tab (`/guest/billing`) is DB-integrated via the shared folio stack — `GET /api/:reservationId/folio` (real `folios`+`folio_lines`+`folio_payments`+`get_reservation_billing` RPC), `POST /api/:reservationId/payments` (single or split; writes real `folio_payments`). Guest-role callers must present `guestId` matching `reservations.guest_id` (new `assertGuestFolioAccess` guard in reservations.routes.ts; staff roles unaffected). Guests cannot call `POST /api/folios/:folioId/generate-invoice` (accounting mutation) — the module downloads a client-side folio statement instead. Guest-recorded payments are self-declared (e.g. mobile-money reference) for front-desk reconciliation — no card is charged. With only `guestId` the module resolves in-house → soonest-upcoming stay. The Notifications tab (`/guest/notifications`) is DB-integrated via migration `653_guest_notifications.sql` (`guest_notifications` — guest_id/reservation_id/property_id, category, title, message, priority, read/read_at, dismissed_at soft-delete) and `GET /api/guest-portal/notifications/:guestId`, `PATCH /notifications/:id/read`, `PATCH /notifications/:guestId/read-all`, `DELETE /notifications/:id` — all `canActForGuest`-guarded (mutations send `reservationId` in body/query). Emitters: concierge message reply (`concierge.routes.ts` PUT /communications/:id/reply → `message_reply`), FO guest-request status change (`frontOffice.routes.ts` PUT /guest-requests/:id → `request_update`), and staff push via `POST /notifications/send` (now writes `guest_notifications`; the earlier `push_notifications`/`notification_subscriptions` tables never existed — those endpoints were replaced). The Feedback tab (`/guest/feedback`) is DB-integrated via `GET /api/guest-portal/feedback/:guestId` + `POST /feedback` over the real `guest_feedback` table — the POST validates category (Stay/Room/Staff/Food/Cleanliness/Facilities/Compliment/Suggestion/Complaint) and rating (int 1–5), requires `guestId`+`reservationId` matching `reservations.guest_id`, and resolves `property_id` server-side. NOTE: `GET /feedback/form/:propertyId` reads a `feedback_forms` table that does not exist. The Help Center tab (`/guest/help`) is DB-integrated via migration `654_guest_faqs.sql` (`guest_faqs` — property_id NULL = global, seeded generic FAQs) and `GET /api/guest-portal/help/:guestId` — composed property contacts (`properties.contact_phone`/`contact_email`/`metadata` check-in-out + emergency_contacts) + active FAQs (global ∪ property-scoped). Chat/quick links navigate to real `/guest/*` modules preserving query params. NOTE: `GET /hotel-info/:propertyId` reads `property_amenities`/`property_services`, which do not exist (property data still returns). The Dashboard tab (`/guest/dashboard`) is DB-integrated: featured stay from `GET /reservations/:guestId` (in-house → soonest-upcoming pick; folio balance via `GET /api/:reservationId/folio?guestId=`), loyalty card from `GET /loyalty/:guestId`, announcements from `GET /notifications/:guestId` (unread badge in the header), and "Recommended for You" from the live `GET /concierge/catalog/:guestId` service catalog (cards deep-link to the matching module). The `/recommendations/:guestId` endpoint still returns hardcoded generator output — unused. The Settings tab (`/guest/settings`) is DB-integrated via `GET/PUT /api/guest-portal/settings/:guestId` — portal settings persist under `guests.preferences.portalSettings` (merged, never clobbering the FO-managed preference keys the profile endpoint writes); the PUT sanitizes all fields against whitelists. Sign Out calls the real `POST /api/auth/logout` + clears `auth_token`/`guest_portal_*` storage; Change Password calls `POST /api/auth/change-password` (policy-validated, bcrypt-verified server-side). The Messaging tab (`/guest/messaging`) is DB-integrated via `GET /api/guest-portal/communications/:reservationId` + `POST /communications` over `guest_communications` — the same rows concierge staff reply to via `/api/concierge/communications/:id/reply`; sends also drop a `notifications` row for the concierge desk. The GET injects the path `reservationId` into `req.query` for `canActForGuest` (it only inspects body/query); the POST sends `reservation_id` in body. With only `guestId` the module resolves in-house → soonest-upcoming stay.

- **Guest portal security & ERP integration**: `/api/guest-portal` routes use `authenticateGuestOrStaff` (in `guestMobilePortal.routes.ts`) — accepts an ERP staff session, a guest portal session (migration 655 `guest_sessions`), OR a verified bearer pair of `guestId` + `reservationId` (the reservation must belong to the guest and be in an accessible status — Reserved/Confirmed/CheckedIn/InHouse). Per-request ownership is still enforced via `canActForGuest` (`spaService.ts`); a bare `guestId` is never trusted. Staff/proxy roles (frontoffice, concierge, spa, ops) may act without the pair. Frontend modules propagate `?reservationId=` on every call when present. Legacy `/guest-portal` frontend route and `GuestMobilePortal.tsx` are removed — `/guest` + `/guest/:tab` are canonical. The public booking-link endpoints (`/api/public/guest-requests`, `/api/public/guest-folio/:reservationId`) now require the same `reservationId`+`guestId` pair via `verifyGuestLink` — no more reservation-ID-only IDOR. Guest writes land in shared staff tables: `guest_requests` (HK/concierge/FO), `work_requests` (guest maintenance dual-writes to Engineering), `fb_room_service_orders`, `fb_table_reservations`, `spa_appointments`, `transport_requests`, `banquet_events` (meetings inquiries, `status='Inquiry'`), `guest_communications`, `guest_feedback`, `folios`/`folio_payments`. `mobile_check_ins` completion also creates an FO-visible `guest_requests` row since no staff UI reads that table. `guest_notifications` (migration 653) is the guest feed — emitted by guest bookings (key issue, room service, HK, maintenance, concierge, restaurant, spa, transport, banquet inquiry, reservation modify, mobile check-in) AND staff-side transitions: concierge message reply, FO `guest_requests` status change, FO check-in, F&B room-service status PATCH, transport status via `transportLifecycle.notifyGuest` (repointed from the nonexistent `push_notifications`), banquet event status. Removed dead endpoints (obsolete tables): `/guest-portal/folio/:reservationId`, `/checkout/folio`, `/services/order`, `/in-stay/*`, `/check-out/*`, `/express-checkout`, `/special-requests`, `/offers`, `/feedback/form`, `/requests*` legacy paths, `/recommendations` (hardcoded). Known remaining gaps: `digital_keys`/`guest_payment_methods` have no staff readers, `GET /feedback/form/:propertyId` + `/hotel-info` reference nonexistent tables (`feedback_forms`, `property_amenities`/`property_services`).

- **Guest portal login** (migration 655 `655_guest_portal_auth.sql`): guests sign in at `/guest` with their full name (case-insensitive `guests.name`) + password. Bootstrap password = the guest's own `guests.id` — first login hashes it and sets `guests.force_password_change`; the portal then shows a forced-change screen and the server 403s every non-`/auth/*` endpoint until a real password is set. `guest_sessions` mirrors `user_sessions` (token hash, sliding idle timeout, concurrent cap, revocation) but keys to `guests.id` since guests have no `system_users` row. Endpoints: `POST /api/guest-portal/auth/login` (rate-limited 10/10min), `GET /auth/session`, `POST /auth/change-password` (guest + staff sessions), `POST /auth/logout` (revokes both stores, clears cookie). `canActForGuest` accepts `role === 'guest'` acting on its own `guests.id`. A `guestId`+`reservationId` bearer link still works without login. `GuestPortal.tsx` gates on `GET /auth/session`: no session + no bearer link → login screen; `force_password_change` → change screen. Multiple guests sharing a name are disambiguated by the password.

### Conventions

- **Adding a new department**: Add to `DEPARTMENTS` in `src/config/departments.ts`, add tabs to `DEPARTMENT_TABS` in `src/config/departmentTabs.ts`, create the portal component, and add sub-nav items to the `subNavItems` memo in `App.tsx`. The route is automatically wired via `DepartmentRoute`.
- **Adding a new tab**: Add to the department's tab list in `departmentTabs.ts` and to the `subNavItems` memo in `App.tsx`. The URL `/erp/:dept/:tab` is automatically handled.
- **Adding a new API route**: Create a route file in `src/server/routes/`, import and mount it in `src/server/routes/index.ts`. Do NOT add inline handlers to `server.ts`.
- **Portal props**: Portals receive `activeTab` (or `activeModule` for finance/hr/admin/procurement) and `onTabChange` from `DepartmentRoute`. Internal state fallbacks exist for backward compatibility but should defer to the URL-driven prop.

## Build & Verification

- **Typecheck**: `npx tsc --noEmit` (7 pre-existing errors in `BusinessIntelligenceDashboard.tsx` — unrelated to the migration. Note: these syntax errors suppress all semantic checking program-wide; to see the full pre-existing `noUnusedLocals` error count, temporarily exclude that file.)
- **Build**: `npx vite build`
- **Dev server**: `node --import tsx server.ts` (or `npm run dev`)
- **Smoke test**: Start server, hit `GET /api/health` → 200, load `http://localhost:3000/` → SPA served

## Unified Inventory Integration (Department Workflows)

- **All department inventory workflows** (Engineering, Housekeeping, F&B) now use the unified `uinv_*` system as the single source of truth for stock balances and ledger entries.
- **Engineering**: `adjustSparePartStock()` in `engineeringPortal.routes.ts` writes all consumption, transfers, receipts, waste, and stock counts to `uinv_stock_balances` + `uinv_stock_ledger` using `ENG_STORE_ID`.
- **Housekeeping**: `adjustHkStore()` and the `/inventory/consumption` endpoint in `housekeepingPortal.routes.ts` write all consumption, transfers, waste, and task-consumption to unified ledger using `HK_STORE_ID` / `HK_LINEN_STORE_ID`.
- **F&B**: The `/consumption`, `/batch-production`, `/recipe-batch-production` endpoints in `inventory.routes.ts` and the `/minibar-consumption` endpoint in `foodBeverage.routes.ts` dual-write to both legacy `inventory_transactions` (for frontend compatibility) AND unified `uinv_stock_ledger` + `uinv_stock_balances` (using `UINV-ST-FOOD` or `UINV-ST-BEV` based on outlet name).
- **Department Dynamic Par**: Each department inventory UI has a "Dynamic Par" tab showing consumption-driven par levels from `uinv_consumption_stats`. Endpoints: `GET /api/uinv-portal/replenishment/department-consumption-stats`, `POST /api/uinv-portal/replenishment/department-calculate-dynamic-par`, `GET /api/uinv-portal/replenishment/department-dynamic-par-config`.
- **Department Unified Stock**: The `DepartmentUnifiedStockWidget` component was deleted as orphaned (no longer imported anywhere). Department stock visibility is handled through the unified inventory portal and department inventory modules directly.
- **UI Integration**: The `DepartmentDynamicParPanel` is embedded as a tab within the existing department modules. The redundant `DepartmentUnifiedStockWidget` tab was removed to avoid showing the same items twice (legacy inventory tab vs unified stock tab):
  - `SparePartsInterface.tsx` (Engineering): tabs include `dynamic-par`
  - `HousekeepingInventoryModule.tsx` (Housekeeping): tabs include `dynamic-par`
  - `FoodBeverage/InventoryModule.tsx` (F&B): view toggle includes `dynamic-par`

## Housekeeping Portal Integration

- **Migrations 311–320** must be applied for full housekeeping functionality:
  - `311_hk_task_subtype.sql` — adds `subtype TEXT` to `housekeeping_task_mgmt` for Deep/Preventive cleaning subtypes.
  - `312_hk_linen_amenity_item_link.sql` — adds `inventory_item_id TEXT` to `hk_linen_stock` and `hk_amenity_stock` for explicit inventory linkage.
  - `313_hk_task_consumption_profiles.sql` — adds `hk_task_consumption_profiles` table mapping task types to consumed inventory items; seeded with system defaults for all 13 task types.
  - `314_hk_maintenance_issues.sql` — adds `housekeeping_maintenance_issues` table for the Maintenance Coordination module (8 issue types, 6-stage workflow).
  - `315_hk_communication_messages.sql` — adds `housekeeping_communication_messages` table for the Communication Center module.
  - `316_hk_reports.sql` — adds `hk_reports` table for the Reports module (19 report definitions seeded).
  - `317_hk_dashboard_alerts.sql` — adds `hk_dashboard_alerts` table for the Smart Alert Engine (8 alert types, auto-generated from live data).
  - `318_hk_task_timestamps_timestamptz.sql` — converts `started_at`/`completed_at` in `housekeeping_task_mgmt` from TEXT to TIMESTAMPTZ (fixes productivity trend bucketing).
  - `319_guest_requests_property_id.sql` — adds `property_id` column to `guest_requests` for multi-property scoping.
  - `320_hk_property_setup_and_config.sql` — adds `hk_property_setup` (buildings/floors/zones/public areas) and `hk_config` (JSON section config) tables; seeds 14 public areas.
- **Deep/Preventive Cleaning** are filtered views over `housekeeping_task_mgmt` (`type=Deep Cleaning` / `type=Preventive Cleaning`). Subtype is stored in the `subtype` column, not `notes`.
- **Linen/Amenity → Inventory linkage**: each linen/amenity stock row can be linked to an `inventory_items` row via `inventory_item_id`. When linked, `adjustHkStore()` uses the explicit ID instead of name matching. When unlinked, a warning is surfaced to the UI.
- **Minibar** inventory side-effects categorize as `'other'`, not `'amenities'` (revenue stock vs complimentary).
- **Task consumption**: when any task transitions to `Completed`, the backend reads `hk_task_consumption_profiles` and posts `consume` transactions via `adjustHkStore()`. This covers room cleaning, public area cleaning, deep cleaning, preventive cleaning, and all other task types. Consumption warnings are surfaced in the API response as `consumptionWarnings`.
- **Room status auto-advance**: when a room-bound cleaning task completes, `rooms.status` is auto-advanced (Completed → `Inspected`, Verified → `Vacant Clean`). When a guest checks out (`POST /api/reservations/:id/check-out`), a `Checkout Cleaning` task is auto-created in `housekeeping_task_mgmt`.
- **Maintenance → Engineering integration**: advancing a maintenance issue to "Assigned to Engineering" creates a real `work_orders` row. Reaching "Room Released" writes `rooms.status` back to `Vacant Dirty`.
- **Guest Requests**: the HK Guest Requests tab reads from the shared `guest_requests` table via `/api/front-office/guest-requests?department=HK` (not mock data). New requests are created with `assigned_department='HK'`.
- **Dashboard alerts**: `GET /api/hk-portal/dashboard/alerts` runs an alert generator that scans rooms, tasks, inspections, linen, minibar, and maintenance data, then upserts alerts into `hk_dashboard_alerts`. Alerts auto-resolve when their trigger condition clears.
- **Dashboard property filtering**: all `/api/hk-portal/dashboard/*` endpoints accept `?propertyId=` for multi-property scoping.
- **Configuration persistence**: Property Setup (buildings/floors/zones/public areas) and section configs (room_status/task/staff) are persisted to `hk_property_setup` and `hk_config` via `/api/hk-portal/property-setup/*` and `/api/hk-portal/config/*` routes.

## Engineering Portal — Work Requests Integration

- **Migration 321** (`321_hk_task_durations.sql`) adds `estimated_duration`/`actual_duration` to `housekeeping_task_mgmt`.
- **Migration 322** (`322_eng_work_requests.sql`) must be applied for the `/erp/maintenance/work-requests` tab:
  - Adds the `public.work_requests` table (id, property_id, wr_number, request_date, source, source_type, location, room_number, priority, type, description, status, requested_by, attachments, converted_work_order_id, reviewed_at/approved_at/rejected_at/converted_at, review_notes, rejection_reason, created_by, created_at, updated_at).
  - Seeds the 7 mock rows that were previously hardcoded in `WorkRequests.tsx` useState.
  - RLS enabled; `authenticated` role granted CRUD.
- **Migration 323** (`323_eng_work_orders_seed.sql`) seeds the 6 mock work orders previously hardcoded in `WorkOrderManagement.tsx` useState (the `work_orders` table itself comes from migration 114).
- **Work Requests flow**: `Pending → Reviewed → Approved → (Converted to WO | Rejected)`. Status transitions set the matching timestamp column server-side.
- **Convert to Work Order**: `POST /api/eng-portal/work-requests/:id/convert-to-wo` creates a real `work_orders` row, links it back via `converted_work_order_id`, and marks the request `Converted to WO`. This integrates the Work Requests tab with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET  /work-requests` — list with optional `?status= ?source= ?priority= ?propertyId=` filters.
  - `POST /work-requests` — create.
  - `PATCH /work-requests/:id` — status transition + notes.
  - `POST /work-requests/:id/convert-to-wo` — convert to a work order.
  - `DELETE /work-requests/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchWorkRequests`, `createWorkRequest`, `updateWorkRequest`, `convertWorkRequestToWO`, `deleteWorkRequest`, plus `WorkRequest`/`WorkRequestStatus`/`WorkRequestPriority` types. Note: `API_BASE` is `/api/eng-portal` (the routes are mounted there, not at `/api/engineering`).
- **Component**: `src/components/Engineering/WorkRequests.tsx` now fetches from the DB (no mock useState), supports search + status/source filters, a "New Request" modal, per-row action menu (Review/Approve/Reject/Re-open/Convert to WO), and a convert-to-WO modal. Loading/error states are surfaced.
- **Work Order Management** (`/erp/maintenance/workorders`): `WorkOrderManagement.tsx` is DB-integrated via `/api/eng-portal/work-orders`. Full lifecycle: Open → Assigned → In Progress → (Waiting for Parts | Waiting for Vendor) → Completed → Verified → Closed (+ Cancelled side-branch). Features: KPI StatCards, status segmented filter + search, per-row action menu, detail modal with inline-editable assignee/priority/labor-hours/cost/notes, create modal, delete. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Corrective Maintenance Integration

- **Migration 324** (`324_eng_corrective_maintenance.sql`) must be applied for the `/erp/maintenance/corrective-maintenance` tab:
  - Adds the `public.corrective_maintenance_tasks` table (id, property_id, cm_number, reported_date, type, category, location, room_number, priority, description, status, assigned_technician, estimated_cost, actual_cost, downtime, resolution, converted_work_order_id, diagnosed_at/in_progress_at/parts_ordered_at/completed_at/verified_at, created_by, created_at, updated_at).
  - Seeds the 6 mock rows that were previously hardcoded in `CorrectiveMaintenance.tsx` useState.
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `category` (6 values), `priority` (4 values), and `status` (6 values).
- **Corrective Maintenance flow**: `Reported → Diagnosed → In Progress → Parts Ordered → Completed → Verified`. Status transitions set the matching timestamp column server-side.
- **Convert to Work Order**: `POST /api/eng-portal/corrective-maintenance/:id/convert-to-wo` creates a real `work_orders` row and links it back via `converted_work_order_id`. This integrates the Corrective Maintenance tab with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /corrective-maintenance` — list with optional `?status= ?category= ?priority= ?propertyId=` filters.
  - `POST   /corrective-maintenance` — create.
  - `PATCH  /corrective-maintenance/:id` — status transition + technician/cost/downtime/resolution fields.
  - `POST   /corrective-maintenance/:id/convert-to-wo` — convert to a work order.
  - `DELETE /corrective-maintenance/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchCorrectiveTasks`, `createCorrectiveTask`, `updateCorrectiveTask`, `convertCorrectiveToWO`, `deleteCorrectiveTask`, plus `CorrectiveTask`/`CorrectiveTaskStatus`/`CorrectiveTaskPriority`/`CorrectiveCategory` types.
- **Component**: `src/components/Engineering/CorrectiveMaintenance.tsx` now fetches from the DB (no mock useState), supports search + status/category/type filters, KPI StatCards, a "New Corrective Task" modal, per-row action menu (Diagnose/Start/Order Parts/Complete/Verify/Convert to WO/Delete), and a convert-to-WO modal. Multi-property scoping via `currentPropertyId` from `useERP`. Loading/error states are surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Preventive Maintenance Integration

- **Migration 325** (`325_eng_pm_schedules_seed.sql`) seeds the 7 mock PM schedules that give the `/erp/maintenance/pm` tab data on a fresh DB. The `pm_schedules` table itself comes from migration 114; this only inserts seed rows. Each schedule includes a `checklist_template` (JSONB array of `{id, description}` items) so auto-generated work orders carry actionable checklists. The `fixed_assets` table is empty on a fresh DB, so `asset_id` is left NULL. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping via the `property_id` column.
- **PM Schedules flow**: `Active → Inactive` (deactivate) or hard-delete. "Generate PM WOs" calls the `generate_pm_work_orders(p_date)` RPC, which scans all active PM schedules due on or before the given date and creates `work_orders` rows for each — integrating with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /pm-schedules` — list with optional `?propertyId=` filter.
  - `POST   /pm-schedules` — create (accepts `propertyId`).
  - `PATCH  /pm-schedules/:id` — status/nextDueDate/lastCompletedDate/technician/priority/frequency/interval/checklist fields.
  - `DELETE /pm-schedules/:id` — hard-delete a schedule.
  - `POST   /generate-pm-work-orders` — auto-generate work orders from due schedules.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchPMSchedules` (accepts `{ propertyId }`), `createPMSchedule`, `updatePMSchedule`, `deletePMSchedule`, `generatePMWorkOrders`, plus `PMSchedule`/`ChecklistItem` types.
- **Component**: `src/components/Engineering/PreventiveMaintenanceScheduler.tsx` is DB-integrated via `/api/eng-portal/pm-schedules` + `/api/eng-portal/work-orders`. UI is aligned with `WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Active Schedules/Overdue/Open PM WOs/Completed), PM Schedules list rows (identity icon chip + body + status/priority badges + action menu) inside a `SectionCard pad="none"` with divide-y, segmented status filter + search, Generated Work Orders list rows with Start/Complete inline actions, "New Schedule" `ModalSystem` form with checklist template builder, "Generate PM WOs" button with result banner, schedule detail `ModalSystem` with inline-editable assignee/priority/frequency/next-due-date + editable checklist template + Deactivate/Reactivate/Delete actions, per-row deactivate + delete via action menu. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/generate/complete/start/deactivate/delete (types: `task`/`success`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Equipment Registry Integration

- **Migration 326** (`326_eng_equipment_registry_seed.sql`) seeds the 4 mock equipment rows that were previously hardcoded in `EquipmentRegistry.tsx` useState into the `fixed_assets` table. The `fixed_assets` table itself comes from migration 080; the engineering-specific columns (`serial_number`, `manufacturer`, `model_number`, `warranty_start`, `warranty_end`, `warranty_provider`, `criticality`, `parent_asset_id`, `property_id`) were added by earlier migrations applied to the live DB. This migration only inserts seed rows (idempotent via `ON CONFLICT (asset_code) DO NOTHING`). Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping.
- **Equipment statuses**: `Active`, `Under Maintenance`, `Disposal Pending`, `Disposed`, `Written Off` (CHECK constraint from migration 080). The Equipment Registry UI exposes all five for status transitions.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /assets` — list with optional `?propertyId= ?category= ?status=` filters.
  - `POST   /assets` — create (accepts `propertyId`, all spec/warranty/criticality fields).
  - `PATCH  /assets/:id` — update any field (status, location, manufacturer, model, serial, warranty dates/provider, criticality, description, etc.).
  - `DELETE /assets/:id` — hard-delete an equipment record.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchAssets` (accepts `{ propertyId, category, status }`), `createAsset`, `updateAsset`, `deleteAsset`, plus the `Asset` type (includes `property_id`).
- **Component**: `src/components/Engineering/EquipmentRegistry.tsx` is DB-integrated via `/api/eng-portal/assets`. UI is aligned with `WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` tokens. Features: KPI StatCards (Total/Active/Under Warranty/Warranty Expired), category filter (with per-category icons) + status segmented filter + search, equipment list rows (identity icon chip + body with location/manufacturer/serial + warranty status + status/criticality badges + action menu) inside `SectionCard pad="none"` with divide-y, "Register Equipment" `ModalSystem` form with all spec/warranty/finance fields, detail `ModalSystem` with metadata grid + asset identifier panel + inline-editable status/criticality/location/manufacturer/model/serial/warranty fields + Delete action, per-row status change + delete via action menu. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/update/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Building Maintenance Integration

- **Migration 327** (`327_eng_building_maintenance.sql`) must be applied for the `/erp/maintenance/building-maintenance` tab:
  - Adds the `public.building_maintenance_tasks` table (id, property_id, bm_number, area, location, task_type, description, priority, status, assigned_to, scheduled_date, estimated_cost, actual_cost, completion_date, notes, created_by, created_at, updated_at).
  - CHECK constraints on `area` (9 values), `priority` (4 values), and `status` (5 values).
  - Indexes on property_id, status, area, priority, scheduled_date.
  - Updated-at trigger (`trg_set_updated_at_bm`).
  - RLS enabled; `authenticated` role granted CRUD.
  - Seeds the 8 mock rows that were previously hardcoded in `BuildingMaintenance.tsx` useState.
  - Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping via the `property_id` column.
- **Building Maintenance flow**: `Scheduled → In Progress → Completed` (+ `On Hold` / `Cancelled` side-branches). Status transitions to Completed auto-set `completion_date` server-side.
- **Areas**: Guest Rooms, Public Areas, Roof, Exterior, Parking, Landscaping, Water Systems, Electrical Systems, Mechanical Systems.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /building-maintenance` — list with optional `?status= ?area= ?priority= ?propertyId=` filters.
  - `POST   /building-maintenance` — create (accepts `propertyId`).
  - `PATCH  /building-maintenance/:id` — status transition + all task fields.
  - `DELETE /building-maintenance/:id` — hard-delete a task.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchBuildingTasks` (accepts `{ propertyId, status, area, priority }`), `createBuildingTask`, `updateBuildingTask`, `deleteBuildingTask`, plus `BuildingTask`/`BuildingArea`/`BuildingTaskStatus`/`BuildingTaskPriority` types.
- **Component**: `src/components/Engineering/BuildingMaintenance.tsx` is DB-integrated via `/api/eng-portal/building-maintenance`. UI is aligned with `WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` tokens. Features: KPI StatCards (Scheduled/In Progress/Completed/High Priority), area filter (with per-area icons) + status segmented filter + search, task list rows (identity icon chip + body with location/assignee/scheduled date/est. cost + status/priority badges + action menu) inside `SectionCard pad="none"` with divide-y, "New Task" `ModalSystem` form with all task fields, detail `ModalSystem` with metadata grid + inline-editable status/priority/assignee/scheduled date/estimated cost/actual cost/completion date/notes + lifecycle action buttons + Delete, per-row status transition + delete via action menu, cost summary `SectionCard` (Estimated Total/Actual Spent/Remaining Budget). Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/update/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Energy Management Integration

- **Migration 328** (`328_eng_energy_management.sql`) must be applied for the `/erp/maintenance/energy` tab:
  - Adds three tables:
    - `public.energy_metrics` (id, property_id, metric_date, electricity_kwh, water_liters, gas_m3, diesel_liters, solar_kwh, total_cost, carbon_footprint_tons, created_by, created_at, updated_at).
    - `public.energy_equipment_efficiency` (id, property_id, equipment_name, category, current_efficiency, target_efficiency, status, last_measured, created_by, created_at, updated_at). CHECK on `status` (Optimal/Warning/Critical).
    - `public.energy_projects` (id, property_id, ep_number UNIQUE, name, type, status, estimated_savings, actual_savings, investment, roi, completion_date, created_by, created_at, updated_at). CHECK on `type` (5 values) and `status` (Planned/In Progress/Completed).
  - Indexes on property_id, status, and metric_date/last_measured as appropriate.
  - Updated-at triggers on all three tables.
  - RLS enabled on all three; `authenticated` role granted CRUD.
  - Seeds the mock rows that were previously hardcoded in `EnergyManagement.tsx` useState: 3 metrics, 4 equipment efficiency rows, 4 energy projects.
  - Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping via the `property_id` column.
- **Energy Projects flow**: `Planned → In Progress → Completed`. Status transitions to Completed auto-set `completion_date` server-side.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /energy-metrics` — list with optional `?propertyId= ?limit=` filters.
  - `POST   /energy-metrics` — create a daily consumption record.
  - `PATCH  /energy-metrics/:id` — update any metric field.
  - `DELETE /energy-metrics/:id` — delete a metric.
  - `GET    /energy-efficiency` — list with optional `?propertyId= ?status=` filters.
  - `POST   /energy-efficiency` — create an equipment efficiency record.
  - `PATCH  /energy-efficiency/:id` — update efficiency/status fields.
  - `DELETE /energy-efficiency/:id` — delete a record.
  - `GET    /energy-projects` — list with optional `?propertyId= ?status=` filters.
  - `POST   /energy-projects` — create (auto-generates `ep_number`).
  - `PATCH  /energy-projects/:id` — status transition + savings/investment/ROI fields.
  - `DELETE /energy-projects/:id` — delete a project.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchEnergyMetrics` (accepts `{ propertyId, limit }`), `createEnergyMetric`, `updateEnergyMetric`, `deleteEnergyMetric`, `fetchEnergyEfficiency` (accepts `{ propertyId, status }`), `createEnergyEfficiency`, `updateEnergyEfficiency`, `deleteEnergyEfficiency`, `fetchEnergyProjects` (accepts `{ propertyId, status }`), `createEnergyProject`, `updateEnergyProject`, `deleteEnergyProject`, plus `EnergyMetric`/`EquipmentEfficiency`/`EnergyProject`/`EfficiencyStatus`/`EnergyProjectType`/`EnergyProjectStatus` types.
- **Component**: `src/components/Engineering/EnergyManagement.tsx` is DB-integrated via the three `/api/eng-portal/energy-*` route families. UI is aligned with `WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` tokens. Features: KPI StatCards (Today's Electricity/Water/Carbon Footprint/Cost) sourced from the latest metric, Equipment Efficiency `SectionCard` with status segmented filter + per-equipment progress bars (current vs target) + status badges, Energy Projects list rows (identity icon chip + body with investment/est. savings/actual savings + status badge + ROI + action menu) inside `SectionCard pad="none"` with divide-y + status segmented filter, Sustainability KPIs `SectionCard` (Carbon Reduction/Energy Intensity/Renewable %/Water Intensity), Peak Demand `SectionCard` (alert + current load/peak today/contract limit), "Log Metric" `ModalSystem` form with all consumption fields, "New Project" `ModalSystem` form, project detail `ModalSystem` with metadata grid + inline-editable status/type/investment/estimated savings/actual savings/ROI + lifecycle action buttons + Delete, per-row status transition + delete via action menu. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/update/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Spare Parts Integration

- **Migration 329** (`329_eng_spare_parts.sql`) must be applied for the `/erp/maintenance/spare-parts` tab:
  - Adds `supplier` column to the existing `spare_parts` table (which already had 10 rows from an earlier migration).
  - Backfills `property_id` on all existing rows to the demo property (`18762279-a389-41c9-9169-7ebc682e9703`).
  - Creates `public.spare_parts_transactions` table (id, property_id, part_id FK→spare_parts, transaction_type CHECK Reserve/Issue/Return/Consumption, quantity, transaction_date, work_order, technician, notes, created_by, created_at).
  - Indexes on property_id, part_id, transaction_date.
  - RLS enabled; `authenticated` role granted CRUD.
  - Seeds 3 transactions matching the mock data from `SparePartsInterface.tsx`.
- **Stock status** is derived client-side from `current_stock` vs `min_stock`/`max_stock`: `Out of Stock` (0), `Low Stock` (<min), `Overstocked` (>max), `In Stock` (otherwise). Not stored in DB.
- **Transactions**: Reserve/Issue/Consumption decrease stock; Return increases stock. The POST route automatically adjusts `spare_parts.current_stock` after inserting a transaction row.
- **Legacy route cleanup**: The old `/spare-parts/:propertyId` and `/spare-parts/needed/:propertyId` routes (which referenced the non-existent `spare_parts_inventory` table) were removed. The old POST/PATCH routes that used `requirePermission('engineering:write')` / `requirePermission('eng:inventory:manage')` were relaxed to `authenticate`-only to match the HK portal pattern.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /spare-parts` — list with optional `?propertyId= ?category=` filters.
  - `POST   /spare-parts` — create (accepts `propertyId`, `supplier`).
  - `PATCH  /spare-parts/:id` — update any part field (expanded from stock-only to all fields).
  - `DELETE /spare-parts/:id` — delete a part.
  - `GET    /spare-parts-transactions` — list with optional `?propertyId= ?partId=` filters.
  - `POST   /spare-parts-transactions` — create a transaction + auto-adjust stock.
  - `DELETE /spare-parts-transactions/:id` — delete a transaction.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchSpareParts` (accepts `{ propertyId, category }`), `createSparePart`, `updateSparePart`, `deleteSparePart`, `fetchSparePartTransactions` (accepts `{ propertyId, partId }`), `createSparePartTransaction`, `deleteSparePartTransaction`, plus `SparePart`/`SparePartTransaction`/`SparePartTransactionType` types. The `SparePart` interface now includes `property_id`, `supplier`, and `compatible_assets`.
- **Component**: `src/components/Engineering/SparePartsInterface.tsx` is DB-integrated via `/api/eng-portal/spare-parts` + `/api/eng-portal/spare-parts-transactions`. UI is aligned with `WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` tokens. Features: KPI StatCards (Total Parts/Reorder Required/In Stock/Inventory Value), category segmented filter + status segmented filter + search, parts list rows (identity icon chip + body with supplier/location/stock/min/cost/value + derived stock status badge + action menu) inside `SectionCard pad="none"` with divide-y, Recent Transactions `SectionCard` with per-transaction type badge + part name + quantity + work order/technician/notes + delete, "Add Part" `ModalSystem` form with all part fields, stock transaction `ModalSystem` (type/quantity/work order/technician/notes) showing current stock, part detail `ModalSystem` with metadata grid + inline-editable all fields + New Transaction + Delete, per-row new-transaction + view-details + delete via action menu. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/update/delete/transaction (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Spare Parts Optimization (HK-Inspired, Migration 330)

- **Migration 330** (`330_eng_spare_parts_optimization.sql`) enhances the spare parts module with HK inventory patterns, optimized for maintenance operations:
  - Adds `unit_cost`, `total_cost`, `performed_by`, `reason`, `reference_number`, `waste_type`, `theoretical_qty`, `actual_qty` columns to `spare_parts_transactions`.
  - Expands `transaction_type` CHECK constraint to include `Restock`, `Waste`, `Adjustment`, `Stock Count` (in addition to `Reserve`/`Issue`/`Return`/`Consumption`).
  - Adds `reorder_point` column to `spare_parts` (distinct from `min_stock`: `min_stock` = absolute minimum; `reorder_point` = trigger threshold, typically higher for safety).
  - Backfills `reorder_point` from `min_stock` for existing parts.
  - Backfills cost data (`unit_cost`, `total_cost`, `performed_by`) on existing seed transactions.
- **Central stock adjustment**: `adjustSparePartStock()` in `engineeringPortal.routes.ts` (modeled after HK's `adjustHkStore`) centralizes: part lookup, signed stock delta calculation, stock update, transaction insertion, cost calculation, performed-by attribution, reference/reason metadata, and cache invalidation. Stock deltas: Reserve/Issue/Consumption/Waste → decrease; Return/Restock → increase; Adjustment → signed delta; Stock Count → set to `actual_qty` and log variance. Avoids phantom negative rows by clamping at 0.
- **Waste recording** (maintenance-optimized — parts degrade in storage): `POST /api/eng-portal/spare-parts/:id/waste` with `wasteType` (damaged/expired/lost/obsolete/other), `quantity`, `reason`, `referenceNumber`. Decreases stock and logs a Waste transaction with cost tracking.
- **Restocking**: `POST /api/eng-portal/spare-parts/:id/restock` with `quantity`, `referenceNumber` (PO #), `supplier` (updates the part's supplier field), `notes`. Increases stock, updates `last_reorder_date`, and logs a Restock transaction.
- **Stock count reconciliation**: `POST /api/eng-portal/spare-parts/:id/stock-count` with `actualQty`, `notes`. Sets `current_stock` to the counted value, logs a Stock Count transaction with `theoretical_qty` (system stock before count) and `actual_qty` (counted value), enabling variance tracking.
- **Reorder recommendations**: `GET /api/eng-portal/spare-parts/reorder-recommendations?propertyId=` returns parts at or below `reorder_point` with `suggestedOrderQuantity` (max of `reorder_qty` or `reorder_point * 2 - current`) and `estimatedCost`.
- **Universal transaction endpoint**: `POST /api/eng-portal/spare-parts-transactions` handles all 8 transaction types via the central `adjustSparePartStock()` function. Validates `transactionType`, requires `wasteType` for Waste, requires `actualQty` for Stock Count.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /spare-parts` — list with `?propertyId= ?category=` (unchanged).
  - `POST   /spare-parts` — create (now accepts `reorderPoint`).
  - `PATCH  /spare-parts/:id` — update any part field (now accepts `reorderPoint`).
  - `DELETE /spare-parts/:id` — delete (unchanged).
  - `GET    /spare-parts-transactions` — list with `?propertyId= ?partId=` (unchanged).
  - `POST   /spare-parts-transactions` — universal transaction (all 8 types, auto-adjusts stock).
  - `DELETE /spare-parts-transactions/:id` — delete (unchanged).
  - `POST   /spare-parts/:id/waste` — dedicated waste endpoint.
  - `POST   /spare-parts/:id/restock` — dedicated restock endpoint.
  - `POST   /spare-parts/:id/stock-count` — stock count reconciliation.
  - `GET    /spare-parts/reorder-recommendations` — reorder recommendations.
- **Frontend service**: `src/services/engineeringService.ts` exports `wasteSparePart`, `restockSparePart`, `stockCountSparePart`, `fetchReorderRecommendations`, plus expanded `SparePartTransactionType` (8 types), `SparePartWasteType`, `ReorderRecommendation` types. The `SparePart` interface includes `reorder_point`. The `SparePartTransaction` interface includes `unit_cost`, `total_cost`, `performed_by`, `reason`, `reference_number`, `waste_type`, `theoretical_qty`, `actual_qty`.
- **Component**: `src/components/Engineering/SparePartsInterface.tsx` is enhanced with: Reorder Recommendations `SectionCard` panel (parts at/below reorder point with suggested qty + est. cost + one-click Restock), KPI StatCards (Total Parts/Reorder Required/Inventory Value/Waste Value YTD), waste recording `ModalSystem` (waste type dropdown + quantity + reason + reference), restock `ModalSystem` (quantity + PO reference + supplier + notes), stock count `ModalSystem` (theoretical stock display + actual count input + live variance calculation), rich transaction log with cost tracking + variance display + waste type badges, part detail modal with inline-editable all fields including reorder point + quick action buttons (Issue/Restock/Waste/Stock Count/Delete), per-row action menu (Issue/Restock/Waste/Stock Count/View/Delete) + quick restock button. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on all mutations (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Spare Parts Requisition Workflow (HK-Inspired UI Redesign)

- **Requisition system**: The Spare Parts UI is now aligned with `HousekeepingInventoryModule.tsx` — tabbed interface with no "Add Part" button. Parts arrive via requisitions from Main Store, matching the HK inventory pattern.
- **Reuses shared tables**: `inventory_requisitions` + `inventory_requisition_lines` with `department='Engineering'`. No new tables needed.
- **Requisition workflow**: `pending → approved → completed (issued) | rejected`.
  - **Create**: `POST /api/eng-portal/spare-parts/requisitions` — creates a requisition with line items referencing `inventory_items` (main store).
  - **Approve**: `PUT /api/eng-portal/spare-parts/requisitions/:id/approve` — marks as approved (optionally set approved quantities).
  - **Issue**: `PUT /api/eng-portal/spare-parts/requisitions/:id/issue` — for each line: adds stock to `spare_parts` (creates a new part if name doesn't exist, otherwise updates existing), deducts from main store `inventory_items`, logs a `Restock` transaction in `spare_parts_transactions` with cost tracking and reference number. Marks requisition as `completed`.
  - **Reject**: `PUT /api/eng-portal/spare-parts/requisitions/:id/reject`.
  - **List**: `GET /api/eng-portal/spare-parts/requisitions?propertyId=`.
  - **Main store items**: `GET /api/eng-portal/spare-parts/main-store-items` — returns items from `inventory_items` where `outlet_id` is null or 'ST-MAIN'.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /spare-parts/main-store-items` — items available to request from main store.
  - `GET    /spare-parts/requisitions` — list Engineering requisitions.
  - `POST   /spare-parts/requisitions` — create a requisition.
  - `PUT    /spare-parts/requisitions/:id/approve` — approve.
  - `PUT    /spare-parts/requisitions/:id/issue` — issue (adds stock + logs tx + deducts main store).
  - `PUT    /spare-parts/requisitions/:id/reject` — reject.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchMainStoreItems`, `fetchSparePartRequisitions`, `createSparePartRequisition`, `approveSparePartRequisition`, `issueSparePartRequisition`, `rejectSparePartRequisition`, plus `SparePartRequisition`/`SparePartRequisitionLine`/`MainStoreItem` types.
- **Component**: `src/components/Engineering/SparePartsInterface.tsx` is now a tabbed UI matching `HousekeepingInventoryModule.tsx`:
  - **Tabs**: Inventory, Requisitions, Consumption, Waste & Loss, Stock Movements, Stock Count, Variance Analysis.
  - **Inventory tab**: Table-based listing with stock level bars, status badges (normal/low/critical/out_of_stock), per-row Edit/Adjust Stock/Delete actions. No "Add Part" button — parts arrive via requisitions.
  - **Requisitions tab**: Table of requisitions with status badges + Approve/Reject/Issue actions. "Request from Store" button opens a modal to search main store items, add them with quantities, and submit.
  - **Consumption tab**: Log of Consumption/Issue transactions with work order + technician. "Record Consumption" modal to select parts + quantities + work order.
  - **Waste & Loss tab**: Log of Waste transactions with waste type + cost lost. "Record Waste" modal with part search + waste type dropdown + quantity + reason.
  - **Stock Movements tab**: Log of Restock/Adjustment/Stock Count/Return transactions with reference + performed by + delete.
  - **Stock Count tab**: Table of current system quantities + last count date. "Start Stock Count" modal pre-populates all parts with theoretical qty + editable counted qty + live variance.
  - **Variance Analysis tab**: Table of stock count variances with theoretical/actual/variance/variance %/cost impact.
  - **KPI StatCards**: Total Items, Inventory Value, Low Stock, Critical.
  - **Alerts**: Reorder recommendations alert (links to Requisitions tab), Critical stock alert (links to Inventory tab).
  - Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on all mutations (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Tools Registry & Checkout (Migration 344)

- The `/erp/maintenance/spare-parts` tab is now labeled **"Spare Parts & Tools"** (in `departmentTabs.ts` and `App.tsx`). The component `SparePartsInterface.tsx` gains an 8th tab — **Tools** — for durable, trackable tools with a checkout/return lifecycle to technicians. The tab `id` stays `spare-parts` (URL unchanged); the `modId` stays `eng_spare_parts`.
- **Migration 344** (`344_eng_tools.sql`) must be applied for the Tools sub-tab:
  - Adds `public.eng_tools` (id, property_id, tool_number, tool_name, category, manufacturer, model, serial_number, location, status, condition, assigned_to, purchase_date, purchase_cost, calibration_due_date, notes, created_by, timestamps). CHECK constraints on `status` (5 values: Available/Checked Out/In Repair/Lost/Retired) and `condition` (4 values: New/Good/Fair/Poor). `updated_at` trigger installed.
  - Adds `public.eng_tool_checkouts` (id, property_id, tool_id→eng_tools CASCADE, technician, work_order, checked_out_at, expected_return_at, returned_at, status, checkout_notes, return_notes, created_by, timestamps). CHECK constraint on `status` (3 values: Active/Returned/Overdue). `updated_at` trigger installed.
  - RLS enabled on both tables; `authenticated` role granted CRUD.
  - Seeds 6 tools (Cordless Impact Drill, Digital Multimeter, Pipe Wrench Set, HVAC Manifold Gauge Set, Extension Ladder, Thermal Imaging Camera) spanning common engineering categories, plus 3 checkout records (2 Active, 1 Returned) so the UI has data on a fresh DB. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`).
- **Tool status lifecycle**: `Available → Checked Out` (technician checks out) `→ Available` (return); `Available → In Repair → Available`; `Available → Lost` (terminal, unless manually reset); `Available → Retired` (terminal).
- **Checkout workflow**: `Active` (checked out, not yet returned) `→ Returned`. **Overdue is auto-derived**: on each `GET /api/eng-portal/tool-checkouts`, Active rows whose `expected_return_at` has passed are flipped to `Overdue` server-side.
- **Checkout**: `POST /api/eng-portal/tools/:id/checkout` — requires `technician`. Sets tool `status=Checked Out`, `assigned_to=technician`, and creates an `Active` `eng_tool_checkouts` row with `checked_out_at=now()` and optional `expected_return_at`/`work_order`/`notes`. Refuses if tool is not `Available`.
- **Return**: `POST /api/eng-portal/tools/:id/return` — closes the Active checkout row (`status=Returned`, `returned_at=now()`), sets tool `status=Available`, clears `assigned_to`. Optionally updates `condition` and stores `return_notes`. Refuses if tool is not `Checked Out`.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /tools` — list with optional `?propertyId= ?status= ?category=` filters.
  - `POST   /tools` — create (auto-generates `ENG-TL-<timestamp>` id).
  - `PATCH  /tools/:id` — update tool fields / status (used for In Repair / Lost / Retired transitions and edits).
  - `DELETE /tools/:id` — delete (cascades checkout history).
  - `POST   /tools/:id/checkout` — check out to a technician.
  - `POST   /tools/:id/return` — return a checked-out tool.
  - `GET    /tool-checkouts` — list with optional `?propertyId= ?toolId= ?status= ?technician=` filters; auto-flips overdue.
  - `DELETE /tool-checkouts/:id` — delete a checkout record.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchTools`, `createTool`, `updateTool`, `deleteTool`, `checkoutTool`, `returnTool`, `fetchToolCheckouts`, `deleteToolCheckout`, plus `Tool`/`ToolStatus`/`ToolCondition`/`ToolCheckout`/`ToolCheckoutStatus` types.
- **Component**: `src/components/Engineering/SparePartsInterface.tsx` adds a **Tools** tab (8th tab, `Wrench` icon). Features:
  - **Tools StatCards** (shown only on the Tools tab): Total Tools, Available, Checked Out (with overdue count), In Repair / Lost.
  - **Tools filter bar**: search (tool name/number/serial/manufacturer/assigned_to/location) + status segmented filter (All/Available/Checked Out/In Repair/Lost/Retired) + refresh.
  - **Tools Registry table**: tool #, name, category, manufacturer/model, serial #, location, condition badge, assigned to (with overdue indicator), status badge, per-row action menu.
  - **Per-row actions**: Check Out (Available only), Return (Checked Out only), Mark Available (In Repair only), Mark In Repair (not In Repair/Checked Out), Mark Lost (not Lost/Retired), Edit, Checkout History, Delete.
  - **New Tool / Edit Tool modal**: full tool fields (number, name, category, manufacturer, model, serial, location, status, condition, assigned to, purchase date/cost, calibration due date, notes).
  - **Check Out modal**: technician (required), work order, expected return date (defaults to +7 days), notes.
  - **Return modal**: condition on return (dropdown), return notes.
  - **Checkout History modal**: per-tool table of all checkout records (technician, work order, checked out, expected return, returned, status badge, notes, delete).
  - Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on all mutations (types: `task`/`warning` only — never `error`). Loading/error states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Supply & Procurement (Replaces Vendors & Contractors)

- **Migration 331** (`331_eng_supply_procurement.sql`) must be applied for the `/erp/maintenance/vendor-contractor` tab (now labeled "Supply & Procurement"):
  - Creates `public.eng_purchase_orders` (id, po_number, supplier_id→fb_suppliers, property_id, status, priority, order_date, expected_delivery_date, actual_delivery_date, subtotal, tax_amount, total_amount, currency, payment_status, notes, submitted_by, timestamps).
  - Creates `public.eng_purchase_order_lines` (id, po_id→eng_purchase_orders, item_id, description, quantity_ordered, quantity_received, unit_of_measure, unit_price, line_total, expected_date, reason, created_at).
  - Status CHECK: `draft | submitted | acknowledged | partial | received | closed | cancelled`.
  - Priority CHECK: `low | medium | high | urgent`.
  - RLS enabled; `authenticated` role granted CRUD. `updated_at` trigger installed.
- **Replaces** the old mock `VendorContractorManagement.tsx` component (which used hardcoded `useState` data). The tab URL remains `/erp/maintenance/vendor-contractor` for backward compatibility, but the label is now "Supply & Procurement" and the component is `SupplyProcurementModule.tsx`.
- **Mirrors the HK Supply & Procurement pattern** (`HKSupplyProcurementModule.tsx`): 3 tabs — Replenishment Demand, Purchase Requisitions, Supplier Requirements.
- **Reuses the shared `fb_suppliers` table** as the supplier master (no new supplier table).
- **PO workflow**: `draft → submitted → acknowledged → partial → received → closed | cancelled`.
  - **Create**: `POST /api/eng-portal/supply-procurement/requisitions` — creates an `eng_purchase_order` (status `draft`) with lines.
  - **Advance status**: `PUT /api/eng-portal/supply-procurement/requisitions/:id/status` — validates allowed transitions.
  - **Goods receipt**: `POST /api/eng-portal/supply-procurement/requisitions/:id/receive` — increments `quantity_received` on each line, credits `spare_parts` stock (matched by `part_name`), logs a `Restock` transaction in `spare_parts_transactions` with reference to the PO number. Advances PO to `received` or `partial`.
  - **List**: `GET /api/eng-portal/supply-procurement/requisitions` — optional `?status= ?propertyId=`.
  - **Forecast**: `GET /api/eng-portal/supply-procurement/forecast` — returns `spare_parts` at/below reorder point with shortage + linked PO.
  - **Suppliers**: `GET /api/eng-portal/supply-procurement/suppliers` — returns `fb_suppliers` with lead time + last order date.
  - **Stats**: `GET /api/eng-portal/supply-procurement/stats` — open requisitions, pending approval, active suppliers, avg lead time.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /supply-procurement/forecast` — replenishment demand.
  - `GET    /supply-procurement/requisitions` — list POs.
  - `POST   /supply-procurement/requisitions` — create PO.
  - `PUT    /supply-procurement/requisitions/:id/status` — advance status.
  - `POST   /supply-procurement/requisitions/:id/receive` — goods receipt (credits spare_parts + logs Restock tx).
  - `GET    /supply-procurement/suppliers` — supplier master.
  - `GET    /supply-procurement/stats` — header stat cards.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchEngForecast`, `fetchEngRequisitions`, `createEngRequisition`, `advanceEngPoStatus`, `receiveEngPo`, `fetchEngSuppliers`, `fetchEngProcurementStats`, plus `EngForecastDemand`/`EngPurchaseRequisition`/`EngRequisitionItem`/`EngSupplierRequirement`/`EngProcurementStats` types.
- **Component**: `src/components/Engineering/SupplyProcurementModule.tsx` — 3-tab UI matching `HKSupplyProcurementModule.tsx`:
  - **Replenishment Demand tab**: Table of spare parts at/below reorder point with shortage, unit cost, supplier, linked requisition status, and "Create Requisition" action.
  - **Purchase Requisitions tab**: Table of POs with expandable line items, status badges, priority badges, and Submit/Acknowledge/Receive/Close actions. Status filter dropdown. "New Requisition" button opens a modal with supplier dropdown, priority, notes, and editable line items.
  - **Supplier Requirements tab**: Table of suppliers from `fb_suppliers` with lead time, payment terms, status, last order date.
  - KPI StatCards: Open Requisitions, Pending Approval, Active Suppliers, Avg Lead Time.
  - CSV export per tab. Search/filter bar. Multi-property scoping via `currentPropertyId`. ERP notifications (types: `task`/`warning` only). Loading states with skeleton rows. Routes use `authenticate` only.

## Engineering Portal — Inspections Integration

- **Migration 332** (`332_eng_inspections.sql`) must be applied for the `/erp/maintenance/inspections` tab:
  - Adds the `public.eng_inspections` table (id, property_id, ins_number, type, category, location, room_number, description, status, priority, scheduled_date, completed_date, inspector, findings, next_due_date, converted_work_order_id, in_progress_at/completed_at/failed_at, created_by, created_at, updated_at).
  - Seeds the 6 mock rows that were previously hardcoded in `Inspections.tsx` useState.
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `type` (8 values), `category` (5 values), `status` (5 values), and `priority` (4 values). `updated_at` trigger installed.
- **Inspections flow**: `Scheduled → In Progress → (Completed | Failed)`. `Overdue` is auto-derived server-side: any `Scheduled` inspection whose `scheduled_date` has passed is flipped to `Overdue` on each GET (no manual action needed).
- **Convert to Work Order**: `POST /api/eng-portal/inspections/:id/convert-to-wo` creates a real `work_orders` row, links it back via `converted_work_order_id`, and copies the inspection's findings into the WO description. Typically used when an inspection Fails and a repair work order is needed. Integrates with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /inspections` — list with optional `?status= ?type= ?category= ?priority= ?propertyId=` filters; auto-advances overdue inspections.
  - `POST   /inspections` — create.
  - `PATCH  /inspections/:id` — status transition + inspector/findings/nextDueDate/completedDate fields. Sets the matching timestamp column server-side.
  - `POST   /inspections/:id/convert-to-wo` — convert to a work order.
  - `DELETE /inspections/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchInspections`, `createInspection`, `updateInspection`, `convertInspectionToWO`, `deleteInspection`, plus `Inspection`/`InspectionType`/`InspectionCategory`/`InspectionStatus`/`InspectionPriority`/`InspectionFilters` types.
- **Component**: `src/components/Engineering/Inspections.tsx` now fetches from the DB (no mock useState), aligned with `CorrectiveMaintenance.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Scheduled/In Progress/Overdue/Completed), inspection type quick-filter grid (8 types + All), segmented status filter + search, inspections list rows (identity icon chip + body + status/priority badges + workflow progress bar + Linked WO badge + action menu) inside a `SectionCard pad="none"` with divide-y, per-row action menu (Mark In Progress/Complete/Failed + Convert to WO + Delete), "Schedule Inspection" `ModalSystem` form, inspection detail `ModalSystem` with read-only/edit toggle for inspector/findings/next-due-date/completed-date, convert-to-WO `ModalSystem`. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/status-change/detail-save/convert/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Calibration Management Integration

- **Migration 333** (`333_eng_calibrations.sql`) must be applied for the `/erp/maintenance/calibration` tab:
  - Adds the `public.eng_calibrations` table (id, property_id, cal_number, equipment_id, equipment_name, instrument_type, location, room_number, description, status, priority, scheduled_date, completed_date, calibrated_by, previous_reading, current_reading, tolerance, deviation, next_due_date, converted_work_order_id, in_progress_at/completed_at/failed_at, created_by, created_at, updated_at).
  - Seeds the 5 mock rows that were previously hardcoded in `CalibrationManagement.tsx` useState.
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `instrument_type` (7 values), `status` (5 values), and `priority` (4 values). `updated_at` trigger installed.
- **Calibration flow**: `Scheduled → In Progress → (Completed | Failed)`. `Overdue` is auto-derived server-side: any `Scheduled` calibration whose `scheduled_date` has passed is flipped to `Overdue` on each GET (no manual action needed).
- **Convert to Work Order**: `POST /api/eng-portal/calibrations/:id/convert-to-wo` creates a real `work_orders` row, links it back via `converted_work_order_id`, and copies the calibration's deviation into the WO description. Typically used when a calibration Fails and a repair/replacement work order is needed. Integrates with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /calibrations` — list with optional `?status= ?instrumentType= ?priority= ?propertyId=` filters; auto-advances overdue calibrations.
  - `POST   /calibrations` — create.
  - `PATCH  /calibrations/:id` — status transition + calibratedBy/readings/tolerance/deviation/nextDueDate/completedDate fields. Sets the matching timestamp column server-side.
  - `POST   /calibrations/:id/convert-to-wo` — convert to a work order.
  - `DELETE /calibrations/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchCalibrations`, `createCalibration`, `updateCalibration`, `convertCalibrationToWO`, `deleteCalibration`, plus `Calibration`/`CalibrationInstrumentType`/`CalibrationStatus`/`CalibrationPriority`/`CalibrationFilters` types.
- **Component**: `src/components/Engineering/CalibrationManagement.tsx` now fetches from the DB (no mock useState), aligned with `Inspections.tsx`/`CorrectiveMaintenance.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Scheduled/In Progress/Overdue/Completed), instrument type quick-filter grid (7 types + All), segmented status filter + search, calibrations list rows (identity icon chip + body + readings grid [Previous/Current/Tolerance/Deviation] + status/priority badges + workflow progress bar + Linked WO badge + action menu) inside a `SectionCard pad="none"` with divide-y, per-row action menu (Mark In Progress/Complete/Failed + Convert to WO + Delete), "Schedule Calibration" `ModalSystem` form, calibration detail `ModalSystem` with read-only/edit toggle for calibrated-by/readings/tolerance/deviation/next-due-date/completed-date (deviation is a dropdown: Within tolerance/Out of tolerance/Adjusted/Replaced), convert-to-WO `ModalSystem`. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/status-change/detail-save/convert/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Safety & Regulatory Compliance Integration

- **Migration 341** (`341_eng_compliance.sql`) must be applied for the `/erp/maintenance/compliance` tab:
  - Adds the `public.eng_compliance_items` table (id, property_id, comp_number, title, category, type, authority, status, priority, certificate_number, issue_date, expiry_date, last_inspected_date, next_inspection_date, responsible_person, result, notes, attachments, converted_work_order_id, in_progress_at/verified_at/failed_at, created_by, created_at, updated_at).
  - Seeds the 12 mock rows that were previously hardcoded in `ComplianceModule.tsx` (the 4 regulatory certificates from the tracker plus the fire-safety and electrical sub-items from the UI cards, plus enrichment items for KPIs).
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `category` (10 values), `type` (6 values), `status` (6 values), and `priority` (4 values). `updated_at` trigger installed.
- **Compliance flow**: `Scheduled → In Progress → Valid → (Overdue | Expired | Failed)`. `Overdue` is auto-derived server-side: any `Valid`/`Scheduled` item whose `expiry_date` has passed is flipped to `Overdue` on each GET (no manual action needed).
- **Convert to Work Order**: `POST /api/eng-portal/compliance/:id/convert-to-wo` creates a real `work_orders` row, links it back via `converted_work_order_id`, and copies the item's title/category/authority/notes into the WO. Typically used when an item Fails or goes Overdue and a remediation/renewal work order is needed. Integrates with the Work Order Management console (`/erp/maintenance/workorders`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /compliance` — list with optional `?status= ?category= ?type= ?priority= ?propertyId=` filters; auto-advances overdue items.
  - `POST   /compliance` — create.
  - `PATCH  /compliance/:id` — status transition + certificateNumber/dates/responsiblePerson/result/notes fields. Sets the matching timestamp column server-side (in_progress_at/verified_at/failed_at).
  - `POST   /compliance/:id/convert-to-wo` — convert to a work order.
  - `DELETE /compliance/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchComplianceItems`, `createComplianceItem`, `updateComplianceItem`, `convertComplianceToWO`, `deleteComplianceItem`, plus `ComplianceItem`/`ComplianceCategory`/`ComplianceType`/`ComplianceStatus`/`CompliancePriority`/`ComplianceFilters` types.
- **Component**: `src/components/Engineering/ComplianceModule.tsx` now fetches from the DB (no mock useState), aligned with `CalibrationManagement.tsx`/`CorrectiveMaintenance.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Valid/Scheduled/In Progress/Overdue-Expired), a live-derived General Health Score card (weighted by overdue/failed/in-progress counts → 0–10 score with star rating + label, plus "Next Major Audit" countdown derived from the nearest upcoming expiry), a "By Category" breakdown card (10 categories with per-category counts + overdue indicators, click-to-filter), compliance type quick-filter grid (6 types + All), segmented status filter + search, compliance list rows (category icon chip + body with type/authority/due-date/responsible-person/overdue-days + status/priority badges + workflow progress bar + Linked WO badge + action menu) inside a `SectionCard pad="none"` with divide-y, per-row action menu (Start Inspection/Mark Valid/Re-open + Convert to WO + Delete), "New Compliance Item" `ModalSystem` form (title/category/type/authority/priority/certificate-number/responsible-person/issue/expiry/next-inspection dates/notes), compliance detail `ModalSystem` with read-only/edit toggle for certificate-number/dates/responsible-person/result/notes + inline status action buttons, convert-to-WO `ModalSystem`. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/status-change/detail-save/convert/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Reports Integration

- **Migration 342** (`342_eng_reports.sql`) must be applied for the `/erp/maintenance/reports` tab:
  - Adds the `public.eng_reports` table (id, category, name, description, last_run, status, format, frequency, property_id, created_at, updated_at).
  - Seeds the 19 engineering-specific report definitions across 4 categories: Operational (6), Compliance (5), Assets & Equipment (4), Staff (4).
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `category` (4 values), `status` (4 values), `format` (3 values). `updated_at` trigger installed.
- **Reports registry**: mimics the Housekeeping reports pattern (`hk_reports` / `HKReportsModule.tsx`). Each row is a report definition with its last-run timestamp, status, output format, and generation frequency. Run / Run All / Schedule actions persist back to this table.
- **Report data generators**: each of the 19 report IDs has a dedicated generator function (`REPORT_GENERATORS` map in `engineeringPortal.routes.ts`) that queries real tables and returns `{ sections: ReportDataSection[], summary: Record<string, any> }`. A `ReportDataSection` is `{ title, columns, rows }`. Generators query: `work_orders`, `pm_schedules`, `corrective_maintenance_tasks`, `eng_room_issues`, `building_maintenance_tasks`, `eng_utility_readings`, `eng_compliance_items`, `eng_calibrations`, `eng_inspections`, `fixed_assets`, `spare_parts`, `spare_parts_transactions`, `energy_equipment_efficiency`, `eng_technicians`, `eng_tech_shifts`, `eng_tech_training`, `staff_attendance`. All accept `propertyId` + `dateFrom`/`dateTo` for filtering.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /reports` — list reports (optional `?category=` filter).
  - `GET    /reports/stats` — aggregated KPI counts (total/ready/scheduled/failed/byCategory).
  - `GET    /reports/:id` — fetch a single report.
  - `GET    /reports/:id/data` — generate real report data (sections + summary). Optional `?propertyId= &from= &to=` filters.
  - `POST   /reports/:id/run` — re-run a single report: runs the generator to count rows, then sets status → Ready + last_run = now. Returns `{ ...reportRow, rowCount }`.
  - `POST   /reports/run-all` — queue all non-Ready reports for refresh.
  - `PATCH  /reports/:id` — update frequency / format / status.
- **Component**: `src/components/Engineering/EngineeringReportsModule.tsx` is a 1:1 mirror of `HKReportsModule.tsx` adapted for Engineering — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`) tokens. Features: KPI StatCards (Total Reports/Ready/Scheduled/Failed), period selector (Today/WTD/MTD/YTD/Custom with date pickers), refresh + search toolbar, reports grouped by category in `SectionCard` tables (Report ID/Report/Description/Last Run/Format/Frequency/Status/Period/Actions), per-row View + Download buttons. The View modal fetches real data from `/reports/:id/data` and renders it as scrollable section tables (capped at 50 rows per section with a "download for full data" hint). Download exports real data via `reportExportUtils` (PDF/Excel/CSV), falling back to metadata-only if the data fetch fails. Run Now in the modal refreshes both the report status and the displayed data. Schedule `ModalSystem` (xl) with editable frequency/format/status per report + dirty-state tracking + Save Changes. ERP notifications fired on run/run-all/download/schedule-save (types: `success`/`info`/`warning`). Loading states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.
- **Portal wiring**: `EngineeringPortal.tsx` `reports` tab now renders `<EngineeringReportsModule />` (replaces the generic `DepartmentReportsModule departmentName="Maintenance"`). The `standard-reports` tab still renders `<StandardEngineeringReports />` (the generic `StandardReportView`).

## Engineering Portal — Dashboard Integration

- **Migration 343** (`343_eng_dashboard_alerts.sql`) must be applied for the `/erp/maintenance/dashboard` tab:
  - Adds the `public.eng_dashboard_alerts` table (id, property_id, type, message, priority, status, source, snoozed_until, created_at, updated_at).
  - RLS enabled; `authenticated` role granted CRUD. CHECK constraints on `type` (10 values), `priority` (4 values), `status` (4 values). `updated_at` trigger installed.
- **Dashboard alerts**: `GET /api/eng-portal/dashboard/alerts` runs an alert generator (`regenerateEngAlerts`) that scans work orders, PM schedules, compliance items, generators, room issues, and spare parts, then upserts alerts into `eng_dashboard_alerts`. Alerts auto-resolve when their trigger condition clears. Mimics the HK dashboard alert pattern (`hk_dashboard_alerts` / `regenerateAlerts`).
- **Config-driven thresholds**: the alert engine reads `eng_config` (migration 336) via a `getEngConfig(propertyId, section)` helper. Three config sections drive alert behavior:
  - `work_orders`: `sla-hours` (default 4) sets the global SLA; `priorities[].slaHours` sets per-priority SLA. Open WOs exceeding their priority's SLA generate a "Critical Equipment Failure" SLA breach alert.
  - `preventive_maintenance`: `pm-advance-days` (default 7) controls how many days before `next_due_date` a PM schedule alert fires (advance warning). Overdue PMs get "High" priority; due-soon PMs get "Medium".
  - `alerts`: `critical-threshold` (default 1) sets the minimum emergency WO count before "Critical Equipment Failure" alerts fire. `downtime-alert` (default true) gates the Generator Alarm alert type.
- **Alert types** (10): Critical Equipment Failure (emergency WOs + SLA breaches), Safety Incident, Fire System Fault, Generator Alarm (low fuel/faulted status, gated by `alerts.downtime-alert`), HVAC Alarm, Water Leak, Low Spare Parts Stock (parts at/below `reorder_point`), Compliance Inspection Due (overdue/expired/expiring ≤7 days), PM Overdue (active PMs past `next_due_date` + advance warning per `pm-advance-days`), Room Out of Order (blocking room issues).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET  /dashboard/kpis` — computed KPIs from work_orders + pm_schedules + eng_compliance_items + fixed_assets + eng_room_issues + eng_technicians. Returns workOrderStats (open/completedToday/overdue/emergency/total), pmStats (active/overdue/dueToday/compliancePct), complianceStats (valid/overdue/failed/total), assetStats (total/operational/availabilityPct), roomStats (outOfOrder), techStats (active/utilizationPct), woStatusDist (pie chart data).
  - `GET  /dashboard/alerts` — regenerate then list non-resolved alerts.
  - `POST /dashboard/alerts/:id/acknowledge` — set status → Acknowledged.
  - `POST /dashboard/alerts/:id/snooze` — set status → Snoozed + snoozed_until (default 1 hour).
  - `GET  /dashboard/productivity` — 7-day WO completion trend (completed vs. verified per day).
- **Component**: `src/components/Engineering/EngineeringDashboard.tsx` is a DB-integrated rewrite (replaces the 386-line hardcoded mock component), aligned with `HKDashboard.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`statusTone`) tokens. Features: 6-tile operational KPI grid (Open WOs/Completed Today/Overdue WOs/Emergency/PM Due Today/Room OOO), 4-tile performance KPI grid (PM Compliance %/Asset Availability %/Tech Utilization %/Compliance Issues), WO Status Distribution pie chart with legend, Smart Alert Engine card with priority-sorted alerts + Acknowledge/Snooze actions, PM Compliance breakdown card (overall % bar + active/overdue/due-today counters), 7-day WO Productivity bar chart (Completed vs. Verified). Auto-refresh every 5 minutes. Multi-property scoping via `currentPropertyId` from `useERP`. Loading/error states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Projects & Renovations Integration

- **Migration 334** (`334_eng_projects_renovations.sql`) must be applied for the `/erp/maintenance/projects-renovations` tab:
  - Adds the `public.eng_projects` table (id, property_id, prj_number, name, type, category, location, description, status, priority, start_date, target_completion_date, actual_completion_date, project_manager, budget, spent, progress, approved_at/in_progress_at/completed_at/on_hold_at/cancelled_at, created_by, created_at, updated_at).
  - Adds the `public.eng_project_phases` child table (id, project_id→eng_projects ON DELETE CASCADE, name, status, completed_date, sort_order, created_at, updated_at) for granular stage tracking.
  - Seeds the 5 mock projects + 8 phases (4 for PRJ-001, 4 for PRJ-004) that were previously hardcoded in `ProjectsRenovations.tsx` useState.
  - RLS enabled on both tables; `authenticated` role granted CRUD. CHECK constraints on `type` (5 values), `category` (6 values), `status` (6 values), `priority` (4 values), and phase `status` (4 values). `progress` CHECK 0–100. `updated_at` triggers installed on both tables.
- **Projects flow**: `Planning → Approved → In Progress → (Completed | On Hold | Cancelled)`. Status transitions set the matching timestamp column server-side. When status → `Completed`, `actual_completion_date` is set and `progress` auto-advances to 100 (if not explicitly provided).
- **Phases**: each project has an optional set of phases (`Pending → In Progress → Completed`, + `On Hold`). Phases are returned nested in the project GET response (single batched query). Phase status can be cycled inline from the detail modal; phases can be added/removed at any time.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /projects` — list with optional `?status= ?type= ?category= ?priority= ?propertyId=` filters; returns phases nested per project.
  - `GET    /projects/:id` — single project with phases.
  - `POST   /projects` — create (accepts optional `phases` array of `{ name }`).
  - `PATCH  /projects/:id` — status transition + name/type/category/location/description/priority/dates/projectManager/budget/spent/progress fields. Sets matching timestamp + auto-completion logic server-side.
  - `DELETE /projects/:id` — delete (cascades to phases via FK).
  - `POST   /projects/:id/phases` — add a phase (auto-increments sort_order).
  - `PATCH  /projects/:id/phases/:phaseId` — update a phase (name/status/completedDate/sortOrder).
  - `DELETE /projects/:id/phases/:phaseId` — delete a phase.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchProjects`, `fetchProject`, `createProject`, `updateProject`, `deleteProject`, `addProjectPhase`, `updateProjectPhase`, `deleteProjectPhase`, plus `Project`/`ProjectPhase`/`ProjectType`/`ProjectCategory`/`ProjectStatus`/`ProjectPriority`/`ProjectPhaseStatus`/`ProjectFilters` types.
- **Component**: `src/components/Engineering/ProjectsRenovations.tsx` now fetches from the DB (no mock useState), aligned with `Inspections.tsx`/`CorrectiveMaintenance.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Total Projects/In Progress/Completed/Total Budget), project type quick-filter grid (5 types + All), segmented status filter + search, projects list rows (identity icon chip + body + progress bar + budget/spent/remaining grid with over-budget red highlight + status/priority badges + target/completed dates + action menu) inside a `SectionCard pad="none"` with divide-y, per-row action menu (Approve/Start/Complete/Resume/Cancel + Delete), "New Project" `ModalSystem` form with inline phase builder (add/remove phase name rows), project detail `ModalSystem` with read-only/edit toggle for projectManager/budget/spent/progress/dates + full phases section (cycle status inline, add new phase, remove phase). Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/status-change/detail-save/phase-add/phase-cycle/phase-remove/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Communication Center Integration

- **Migration 335** (`335_eng_communication.sql`) must be applied for the `/erp/maintenance/communication` tab:
  - Adds the `public.eng_communication_messages` table (id, property_id, msg_number, type, category, title, content, sender, sender_role, recipients TEXT[], status, priority, attachments, read_at, archived_at, created_by, created_at, updated_at).
  - Adds the `public.eng_communication_notifications` table (id, property_id, type, title, message, read, action_url, created_at, updated_at) for the sidebar notification feed.
  - Seeds the 5 mock messages + 4 mock notifications that were previously hardcoded in `CommunicationCenter.tsx` useState. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping.
  - RLS enabled on both tables; `authenticated` role granted CRUD. CHECK constraints on message `type` (5 values), `category` (5 values), `status` (3 values), `priority` (4 values), and notification `type` (4 values). `updated_at` triggers installed on both tables.
- **Messages flow**: `Sent → Read → Archived`. Status transitions set the matching timestamp column server-side (`read_at` on Read, `archived_at` on Archived). Archived messages can be restored back to `Sent`.
- **Notifications**: simple read-flag toggle (`read` boolean). Created with `read=false`; can be marked read/unread or deleted from the sidebar action menu.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /communication/messages` — list with optional `?type= ?status= ?priority= ?category= ?propertyId=` filters.
  - `GET    /communication/messages/:id` — single message.
  - `POST   /communication/messages` — create (auto-generates `MSG-YYYY-NNNNNN` id + `msg_number`).
  - `PATCH  /communication/messages/:id` — status transition + title/content/priority/category/type/sender/senderRole/recipients/attachments edits. Sets matching timestamp server-side.
  - `DELETE /communication/messages/:id` — delete.
  - `GET    /communication/notifications` — list with optional `?propertyId= ?read=true|false` filters.
  - `POST   /communication/notifications` — create (auto-generates `NOT-NNNNNN-XXXX` id).
  - `PATCH  /communication/notifications/:id` — toggle read + title/message/actionUrl edits.
  - `DELETE /communication/notifications/:id` — delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchCommunicationMessages`, `fetchCommunicationMessage`, `createCommunicationMessage`, `updateCommunicationMessage`, `deleteCommunicationMessage`, `fetchCommunicationNotifications`, `createCommunicationNotification`, `updateCommunicationNotification`, `deleteCommunicationNotification`, plus `CommunicationMessage`/`CommunicationNotification`/`CommunicationMessageType`/`CommunicationCategory`/`CommunicationMessageStatus`/`CommunicationPriority`/`CommunicationNotificationType`/`CommunicationMessageFilters`/`CommunicationNotificationFilters` types.
- **Component**: `src/components/Engineering/CommunicationCenter.tsx` now fetches from the DB (no mock useState), aligned with `Inspections.tsx`/`ProjectsRenovations.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, `ModalSystem`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Total Messages/Critical/Unread Alerts/Read), message type quick-filter grid (5 types + All), segmented status filter + search, messages list rows (msg_number + status/priority/type badges + title + category/sender/attachments meta + content preview + recipient chips + sent timestamp + per-row action menu) inside a `SectionCard pad="none"` with divide-y, per-row action menu (View Details/Mark Read/Archive/Restore/Delete), dark-themed Notifications sidebar panel with per-notification action menu (Mark Read/Unread/Delete), Quick Actions panel (Send Announcement/Send Alert/Team Request — pre-fills the compose modal), "New Message" `ModalSystem` form (type/category/title/content/sender/senderRole/priority + multi-select recipients chips), message detail `ModalSystem` with status badges + sender/sent/read/archived meta + full content + recipients + inline Mark Read/Archive/Restore/Delete actions. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/status-change/delete (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced for messages; non-blocking loading for the notifications sidebar. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Configuration Integration

- **Migration 336** (`336_eng_config.sql`) must be applied for the `/erp/maintenance/configuration` tab:
  - Adds the `public.eng_config` table (id, property_id, section, data JSONB, created_at, updated_at) — JSON-blob config per property per section, mirroring the HK `hk_config` pattern (migration 320).
  - **Maintenance-only scope**: 4 sections — `work_orders`, `preventive_maintenance`, `alerts`, `safety`. General/department/staff/locations/utilities settings are admin-managed elsewhere and intentionally excluded. CHECK constraint on `section` enforces the 4 allowed values.
  - Unique index on `(property_id, section)`. RLS enabled; `authenticated` role granted CRUD. `updated_at` trigger installed.
  - Each section's JSONB `data` contains both flat key-value settings (booleans/numbers/selects) AND row-based config entity arrays — mimicking the HK `ConfigurationModule` pattern where each config item is an editable row with add/edit/delete via a generic edit modal.
  - Seed data for the demo property (`18762279-a389-41c9-9169-7ebc682e9703`):
    - `work_orders`: 5 flat settings + 4 priority levels (Emergency/High/Normal/Low with SLA hours + color) + 4 categories (Electrical/Plumbing/HVAC/General with default assignee).
    - `preventive_maintenance`: 5 flat settings + 6 PM frequencies (Daily–Annual with interval days) + 4 checklist templates (HVAC Filter/Generator/Elevator/Boiler with item counts).
    - `alerts`: 5 flat settings + 5 alert types (Equipment Down/Temperature/PM Overdue/Inspection Due/Inventory Low with priority + channel).
    - `safety`: 5 flat settings + 5 inspection types (Fire/Electrical/Elevator/Boiler/Emergency Exit with frequency + authority) + 5 PPE items (Hard Hat/Gloves/Goggles/Boots/Vest with required flag).
- **Config pattern**: each section stores its settings as a JSONB object in the `data` column. The API upserts by composite key `eng-cfg-<propertyId>-<section>`.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET /config/:propertyId/:section` — fetch a section's config JSON (returns `{}` if not found). Section must be one of the 4 maintenance sections.
  - `PUT /config/:propertyId/:section` — upsert a section's config JSON. Section must be one of the 4 maintenance sections.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchEngConfig`, `saveEngConfig`, `ENG_CONFIG_SECTIONS` (4 entries), and `EngConfigSection` type (4 values).
- **Component**: `src/components/Engineering/Configuration.tsx` mimics the HK `ConfigurationModule.tsx` pattern:
  - Horizontal section tabs (segmented control) with per-section dirty indicator (amber dot).
  - Each section renders flat settings (boolean toggle / text / number / select inputs) in a `SectionCard` + row-based config entities in separate `SectionCard`s with `Add` button.
  - `ConfigRow` reusable component (title + sub + edit/delete buttons) for each row entity.
  - `AddButton` reusable component in row-group section headers.
  - Generic edit modal (`openEditModal` / `saveEditModal`) via `ModalSystem` with field definitions (text/number/select/boolean) — same pattern as HK.
  - Per-section Save / Reset to Defaults at the bottom (same as HK).
  - Loads all 4 sections in parallel on mount via `Promise.all`, hydrating from DB with fallback to static defaults.
  - Uses `PageHeader`, `SectionCard`, `Badge`, `ModalSystem`, and `brandTheme` (`layout.sectionStack`/`button.*`) tokens.
  - Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on save (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Guest Room Maintenance Integration

- **Migration 337** (`337_eng_room_issues.sql`) must be applied for the `/erp/maintenance/rooms` tab:
  - Adds the `public.eng_room_issues` table (id, property_id, ri_number, room_number, category, description, status, priority, blocks_room, reported_by, assigned_to, resolved_at, notes, created_by, created_at, updated_at).
  - CHECK constraints on `category` (10 values: Plumbing/HVAC/Electrical/Security/Furniture/Lock/TV/Internet/Lighting/Other), `status` (3 values: Open/In Progress/Resolved), and `priority` (4 values).
  - Indexes on property_id, room_number, status. `updated_at` trigger installed. RLS enabled; `authenticated` role granted CRUD.
  - Seeds the 4 mock rows that were previously hardcoded as `roomIssues` in `RoomMaintenanceModule.tsx`. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`) for multi-property scoping via the `property_id` column.
- **Room Issues flow**: `Open → In Progress → Resolved`. Status transitions to Resolved auto-set `resolved_at` server-side.
- **Convert to Work Order**: `POST /api/eng-portal/room-issues/:id/convert-to-wo` creates a real `work_orders` row (title derived from room + category + description, type = category, priority = priority, room_number carried over), links it back via `converted_work_order_id`, and advances the issue status to `In Progress`. This integrates the Room Issues tab with the Work Order Management console (`/erp/maintenance/workorders`). Once converted, the "Convert to Work Order" action is hidden and a "WO linked" badge is shown.
- **Room inventory sync**: when an issue is created with `blocks_room = true`, the backend sets `rooms.status = 'Out of Order'` for that room number. When an issue transitions to Resolved and the room is currently `Out of Order`, the backend restores `rooms.status = 'Vacant Clean'` (return to inventory). This keeps Front Office, Housekeeping, and Engineering in sync via the shared `rooms.status` column (canonical statuses from migration 225).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET    /room-issues` — list with optional `?status= ?category= ?priority= ?roomNumber= ?propertyId=` filters.
  - `POST   /room-issues` — create (syncs `rooms.status` when `blocksRoom` is true).
  - `PATCH  /room-issues/:id` — status transition + field edits (restores `rooms.status` when Resolved).
  - `DELETE /room-issues/:id` — delete.
  - `POST   /room-issues/:id/convert-to-wo` — convert to a work order (creates `work_orders` row, links back via `converted_work_order_id`, advances status to `In Progress`).
  - `GET    /rooms` — list rooms scoped by `?propertyId=`, enriched with `activeIssueCount` + `hasBlockingIssue` per room.
  - `PATCH  /rooms/:id/status` — update `rooms.status` (`:id` may be a room number or room id; validates against the canonical status set).
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchRoomIssues`, `createRoomIssue`, `updateRoomIssue`, `deleteRoomIssue`, `convertRoomIssueToWO`, `fetchEngRooms`, `updateEngRoomStatus`, plus `RoomIssue`/`RoomIssueCategory`/`RoomIssueStatus`/`RoomIssuePriority`/`EngRoom`/`RoomIssueFilters` types. `RoomIssue` includes `converted_work_order_id` + `converted_at`.
- **Component**: `src/components/Engineering/RoomMaintenanceModule.tsx` is DB-integrated via `/api/eng-portal/room-issues` + `/api/eng-portal/rooms` (no mock useState). UI is aligned with `BuildingMaintenance.tsx`/`WorkOrderManagement.tsx` — uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, `ModalSystem`, and `brandTheme` (`layout.sectionStack`/`layout.kpiGrid`/`button.*`/`statusTone`) tokens. Features: KPI StatCards (Open Issues/In Progress/Resolved/Rooms Blocked), Room Status Board grid (per-room cards colored by status + active issue badges with up to 2 issue previews), Room Issues list rows (identity category icon chip + body with assignee/reporter/elapsed/blocks-room flag + status/priority badges + action menu) inside `SectionCard pad="none"` with divide-y, segmented status filter + search, Room Status Actions panel (inline `<select>` to set `rooms.status` for out-of-inventory/blocked rooms — syncs with FO & HK), "New Issue" `ModalSystem` form with room-number datalist + category/priority/assignee/blocks-room/description/notes, detail `ModalSystem` with metadata grid + inline-editable status/priority/category/assignee/blocks-room/notes + Re-open/Start Work/Mark Resolved/Delete actions, per-row status change + delete via action menu. Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on create/update/delete/room-status-change (types: `task`/`warning` only — never `error`). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Utilities & Plant Integration

- **Migration 338** (`338_eng_utilities_plant.sql`) must be applied for the `/erp/maintenance/utilities` tab:
  - Adds 4 tables: `public.eng_utility_readings` (meter readings), `public.eng_generators` (backup power assets), `public.eng_generator_events` (event log), `public.eng_utility_alerts` (abnormal usage alerts).
  - CHECK constraints on `utility_type` (3 values), `generator.status` (4 values), `event_type` (8 values), `alert_type` (6 values), `severity` (3 values), `alert.status` (2 values).
  - `updated_at` triggers on readings, generators, and alerts. RLS enabled; `authenticated` role granted CRUD on all 4 tables.
  - Seeds 21 utility readings (7 days × 3 utilities), 1 generator (G-01), 3 generator events, and 2 utility alerts — matching the data previously hardcoded in `UtilitiesManagement.tsx`. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET/POST/DELETE /utility-readings` — list (with `?utilityType= ?days= ?propertyId=` filters), create, delete.
  - `GET/POST/PATCH/DELETE /generators` — full CRUD with status/hours/fuel/battery/service fields.
  - `GET/POST/DELETE /generator-events` — event log with `?generatorId= ?propertyId=` filters.
  - `GET/POST/PATCH/DELETE /utility-alerts` — alerts with resolve (`PATCH status=Resolved`) / reopen / delete.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchUtilityReadings`, `createUtilityReading`, `deleteUtilityReading`, `fetchGenerators`, `createGenerator`, `updateGenerator`, `deleteGenerator`, `fetchGeneratorEvents`, `createGeneratorEvent`, `deleteGeneratorEvent`, `fetchUtilityAlerts`, `createUtilityAlert`, `updateUtilityAlert`, `deleteUtilityAlert`, plus all associated types.
- **Component**: `src/components/Engineering/UtilitiesManagement.tsx` is DB-integrated (no mock data). UI uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, `ModalSystem`, `brandTheme` tokens. Four sub-tabs: Overall (consumption trends chart + abnormal usage detection alerts panel), Electricity (chart + readings list), Water (chart + readings list), Backup Power (generator cards with stats + status actions + recent events, generator events log, register generator modal, generator detail modal with inline-editable status/fuel/hours/battery). Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on all CRUD operations (types: `task`/`warning` only). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Inventory & Stores Portal — Unified Rebuild (Phases 1–5)

The Inventory & Stores portal has been rebuilt as a full operational system of record for physical resources, per `docs/unified_inventory_stores_portal_expanded.md`. Implementation is DB-backed through `/api/uinv-portal` (Supabase REST via `supabaseAdmin`), route-driven via `/erp/inventory/:tab`, and uses the established shared UI primitives (`PageHeader`, `SectionCard`, `StatCard`, `Badge`, `ModalSystem`, `InventoryTable`, `IdentityCell`, `OpsCell`, `IconButton`) and `brandTheme` tokens (`layout.sectionStack`, `layout.kpiGrid`, `button.*`, `statusTone`).

### Migrations 364–368 (must be applied)

- **`364_uinv_storekeeping.sql`** — Put-away tasks, picking tasks, returns, quarantine, serials, lots, temperature logs, chemicals, expiry alerts view.
- **`365_uinv_fixed_assets.sql`** — Asset classes, asset register, components, assignments/custody, transfers, verification campaigns + verifications, warranties, insurance, disposals, documents. Replaces the obsolete `uinv_asset_checkouts`/`uinv_asset_issues`/`uinv_asset_stock_counts` tables (which had no migrations and were never functional).
- **`366_uinv_physical_resources.sql`** — Tools, tool assignments, tool calibrations, linen items, linen movements, uniforms, uniform assignments, returnables, returnable movements, loanable items, loan transactions.
- **`367_uinv_governance.sql`** — Inventory periods, audit logs, approval requests, dashboard aggregates.
- **`368_uinv_gap_fillers.sql`** — Critical spare parts (`uinv_critical_spares`), spare-part-to-asset compatibility (`uinv_equipment_compatibility`), guest/third-party custody register (`uinv_guest_custody`), store opening/closing checklists (`uinv_store_sessions`).
- **`369_uinv_distribute_stock_to_dept_stores.sql`** — Distributes stock balances from Main Warehouse to department stores based on item category → store department mapping (Food & Beverage → FOOD, Housekeeping → HK, Engineering → ENG, all others → GEN). Splits 60/40 between Main (central reserve) and department store (working stock).

### Backend routes (`src/server/routes/unifiedInventoryPortal.routes.ts`)

All routes use `authenticate` only (no `requirePermission`) and append audit entries for relevant actions. Mounted at `/api/uinv-portal`. New route groups added in this rebuild:
- Storekeeping: `/putaway-tasks`, `/picking-tasks`, `/returns`, `/quarantine`, `/serials`, `/lots`, `/temperature-logs`, `/chemicals`, `/expiry-alerts`.
- Fixed Assets: `/asset-classes`, `/assets`, `/assets/:id`, `/asset-components`, `/asset-assignments`, `/asset-transfers`, `/asset-verification-campaigns`, `/asset-verifications`, `/asset-warranties`, `/asset-insurance`, `/asset-disposals`, `/asset-documents`.
- Physical Resources: `/tools`, `/tool-assignments`, `/tool-calibrations`, `/linen`, `/linen-movements`, `/uniforms`, `/uniform-assignments`, `/returnables`, `/returnable-movements`, `/loanable-items`, `/loan-transactions`.
- Governance: `/inventory-periods`, `/audit-logs`, `/approval-requests`.
- Advanced Operations: `/critical-spares`, `/equipment-compatibility`, `/guest-custody`, `/store-sessions`, `/global-search`.

Notable backend behaviors:
- Creating an asset defaults status to `Received`.
- Creating an assignment defaults status to `Active`, updates the asset to `Assigned`, and sets custodian/department/location.
- Returning an assignment updates the asset to `Available` and clears its custodian.
- Disposing an asset updates its status to `Disposed` and `is_active` to false.
- Approval and finance review actions populate the corresponding user/timestamp fields.

### Frontend service (`src/services/inventoryService.ts`)

Exports DB-backed types and CRUD functions for all new tables. Key types: `UinvPutAwayTask`, `UinvPickingTask`, `UinvReturn`, `UinvQuarantine`, `UinvSerial`, `UinvLot`, `UinvExpiryAlert`, `UinvTemperatureLog`, `UinvChemical`, `UinvAssetClass`, `UinvAsset`, `UinvAssetComponent`, `UinvAssetAssignment`, `UinvAssetTransfer`, `UinvAssetVerification`, `UinvAssetWarranty`, `UinvAssetInsurance`, `UinvAssetDisposal`, `UinvAssetDocument`, `UinvTool`, `UinvToolAssignment`, `UinvToolCalibration`, `UinvLinenItem`, `UinvLinenMovement`, `UinvUniformItem`, `UinvUniformAssignment`, `UinvReturnableItem`, `UinvReturnableMovement`, `UinvLoanableItem`, `UinvLoanTransaction`, `UinvInventoryPeriod`, `UinvAuditLog`, `UinvApprovalRequest`.

### Frontend modules

- **`FixedAssetsModule.tsx`** — Replaced the obsolete checkout/return/issues/counts implementation. DB-backed asset register with classes, components, assignments/custody, transfers, verification campaigns + verifications, warranties, insurance, disposals, and documents. Asset status lifecycle: `Ordered → Received → Inspection → Tagged → Available → Assigned → In Service → In Transit → Under Maintenance → Damaged/Lost/Stolen/Impaired → Held for Disposal → Disposed/Retired`.
- **`StorekeepingModule.tsx`** — Sub-tabs: Put-Away, Picking, Returns, Quarantine, Serials & Lots, Expiry. KPIs for pending put-aways/picks/returns, held quarantine, expiring ≤30d, and expired. Full CRUD with status transitions (e.g. `Pending → In Progress → Put Away`, `Held → Released/Rejected/Returned to Supplier/Disposed`).
- **`PhysicalResourcesModule.tsx`** — Sub-tabs: Tools & Equipment, Linen, Uniforms, Returnables, Loanables. Each sub-tab has its item register + related transactions (assignments, calibrations, movements, loans). KPIs for tools issued, calibration due, linen/uniforms below PAR, returnables out, active loans.
- **`GovernanceModule.tsx`** — Sub-tabs: Inventory Periods, Audit Log, Approval Requests. Period status flow: `Open → Frozen → Closed`. Approval flow: `Pending → Approved/Rejected/Cancelled`. Audit log detail modal shows previous/new state JSON.
- **`ReservationsModule.tsx`** — DB-backed reservations and allocations. KPIs, segmented status filter (All / Active / Released / Cancelled / Fulfilled), create/edit modal, per-row release/cancel/delete. Integrates with stock balance reservation.
- **`PhysicalVerificationModule.tsx`** — Consolidated year-end physical verification (spec §77). Sub-tabs: Campaigns, Asset Verification, Resource Summary. Tracks asset verification results (`Found`, `Wrong Location`, `Wrong Custodian`, `Damaged`, `Missing`, `Duplicate`, `Unidentified`) and rolls up tool/linen/uniform/custody status.
- **`AdvancedOperationsModule.tsx`** — Four sub-tabs: Critical Spare Parts (spec §51), Equipment Compatibility (spec §52), Guest/Third-Party Custody (spec §49), and Store Opening/Closing Checklists (spec §75).
- **`GlobalSearchModule.tsx`** — Debounced global search across items, assets, serials, batches, stores, and tools (spec §55).
- **`UnifiedInventoryDashboard.tsx`** — Role-specific KPI views (spec §69): Executive, Inventory Manager, Asset Manager, Storekeeper.

### Tab registry

Inventory tabs in `src/config/departmentTabs.ts` and `subNavItems` in `src/App.tsx` are aligned (14 consolidated top-level tabs):
`dashboard`, `items`, `inventory`, `stores`, `stock-operations`, `storekeeping`, `stock-control`, `reservations`, `replenishment-procurement`, `assets-resources`, `reports`, `audit`, `advanced-operations`, `configuration`.

`InventoryPortal.tsx` renders each top-level tab to its module. Legacy child tab URLs (`receiving`, `issues-returns`, `transfers`, `put-away`, `picking`, `batch-lot-serial`, `expiry`, `quarantine`, `adjustments`, `stock-counts`, `waste`, `consumption`, `reservations-allocations`, `replenishment`, `supply-procurement`, `fixed-assets`, `physical-resources`, `equipment-tools`, `linen`, `uniforms`, `returnables`, `loanables`, `physical-verification`, `valuation`) are registered as alias tabs in `departmentTabs.ts` (mapping to the same modId as their parent consolidated tab) so old URLs resolve instead of redirecting to the default tab. They are hidden from the side nav (which uses the 14 consolidated tabs from `App.tsx`).

### Cleanup

- Removed obsolete `fetchAssetCheckouts`/`returnAssetCheckout`/`isFixedAssetItem`/`UinvAssetCheckout` imports from `StockOperationsModule.tsx` (these service functions were deleted when the legacy asset-checkout tables were replaced). The asset return modal and `activeAssetsByIssue` logic were removed from `StockOperationsModule.tsx`. Asset custody is now handled through `FixedAssetsModule.tsx` assignments.

### Verification

- `npx tsc --noEmit` — only the 7 pre-existing BI syntax errors in `BusinessIntelligenceDashboard.tsx` remain (unrelated to this rebuild).
- `npx vite build` — passes (exit 0).
- Smoke test — `/api/health` → 200, SPA root → 200.
- Migrations 364–368 applied to Supabase.


## Engineering Portal — Technicians & Staff Management Integration

- **Migration 339** (`339_eng_technicians.sql`) must be applied for the `/erp/maintenance/staff` tab:
  - Adds 5 tables: `public.eng_technicians` (roster + KPIs), `public.eng_tech_shifts` (shift requirements), `public.eng_tech_staffing` (staffing requirements), `public.eng_tech_training` (training records), `public.eng_tech_productivity` (productivity metrics).
  - CHECK constraints on `role` (8 values), `shift` (3 values), `status` (4 values), `workload` (0–100), `training.status` (4 values), `productivity_score` (0–100).
  - `updated_at` trigger on technicians. RLS enabled; `authenticated` role granted CRUD on all 5 tables.
  - Seeds 5 technicians (matching the former hardcoded array in `StaffManagement.tsx`), 3 shift requirements, 4 staffing requirements, 4 training records, and 5 productivity records. Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`).
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET/POST/PATCH/DELETE /technicians` — full CRUD with `?propertyId= ?role= ?shift= ?status=` filters.
  - `GET/POST/PATCH/DELETE /technicians/shifts` — shift requirements CRUD.
  - `GET/POST/PATCH/DELETE /technicians/staffing` — staffing requirements CRUD.
  - `GET/POST/PATCH/DELETE /technicians/training` — training records CRUD with `?technicianId=` filter.
  - `GET/POST/PATCH/DELETE /technicians/productivity` — productivity metrics CRUD with `?technicianId=` filter.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchTechnicians`, `createTechnician`, `updateTechnician`, `deleteTechnician`, `fetchTechShifts`, `createTechShift`, `updateTechShift`, `deleteTechShift`, `fetchTechStaffing`, `createTechStaffing`, `updateTechStaffing`, `deleteTechStaffing`, `fetchTechTraining`, `createTechTraining`, `updateTechTraining`, `deleteTechTraining`, `fetchTechProductivity`, `createTechProductivity`, `updateTechProductivity`, `deleteTechProductivity`, plus all associated types (`Technician`, `TechRole`, `TechShift`, `TechStatus`, `TechShiftReq`, `TechStaffingReq`, `TechTraining`, `TechProductivity`, `TrainingStatus`).
- **Component**: `src/components/Engineering/StaffManagement.tsx` is DB-integrated (no mock data). Mimics the HK `StaffManagementModule.tsx` pattern but adapted for engineering roles. UI uses `PageHeader`, `SectionCard`, `StatCard`, `Badge`, `ModalSystem`, `brandTheme` tokens. Five sub-tabs: Assignments (technician roster cards with status dots, skills tags, search + role/shift/status filters, per-card action menu for quick status change + edit + delete, detail modal with full profile + skills + contact info), Shifts (shift requirements list with assigned/required gap badges), Staffing (role-based staffing targets with gap badges), Training (training records with status badges + technician linkage), Productivity (productivity metrics with score + performance rating badge). Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications fired on all CRUD operations (types: `task`/`warning` only). Loading/error/retry states surfaced. Routes use `authenticate` only (no `requirePermission`) to match the HK portal pattern.

## Engineering Portal — Technician Attendance Integration

- **Migration 340** (`340_eng_attendance.sql`) must be applied for the Attendance sub-tab under `/erp/maintenance/staff`:
  - Extends the shared `staff_attendance` table (created by migration 287, extended by 288/289) to support `department_scope='ENG'`. The CHECK constraint now allows `('HK','FO','FB','ENG')` — `'FB'` was already in use by F&B staff attendance (migration 292).
  - Seeds 5 days of attendance for the 5 `eng_technicians` (Present/Late/Absent/Sick mix) plus Day Off records for 2 days ago. Uses `department_scope='ENG'` and the demo property.
- **Routes** (in `engineeringPortal.routes.ts`, mounted at `/api/eng-portal`):
  - `GET  /technicians/attendance/summary?propertyId=` — grouped by technician with per-status counts, total hours/overtime, and attendance rate.
  - `GET  /technicians/attendance?propertyId=&date=` — flat list of records, optionally filtered by date.
  - `POST /technicians/attendance` — check-in (upsert per staff_id + attendance_date, sets `department_scope='ENG'`).
  - `PATCH /technicians/attendance/:id` — check-out / status change / hours / notes.
  - `DELETE /technicians/attendance/:id` — delete record.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchTechAttendanceSummary`, `fetchTechAttendance`, `checkInTechAttendance`, `updateTechAttendance`, `deleteTechAttendance`, plus types `TechAttendanceRecord`, `TechAttendanceSummary`, `TechAttendanceSummaryResponse`, `TechAttendanceListResponse`, `AttendanceStatus`.
- **Component**: `src/components/Engineering/StaffManagement.tsx` now has a sixth sub-tab **Attendance** (between Assignments and Shifts). Two views:
  - **Summary**: per-technician cards with avatar, status breakdown (Present/Late/Absent/Sick/Day Off counts), total hours, and attendance rate %. Clicking a technician opens a calendar detail modal with full stats + recent records list + inline edit.
  - **Daily Log**: date-filtered flat list of attendance records with status dot, check-in/check-out times, hours, overtime, notes, quick check-out button (for Present records without check-out), edit, and delete.
  - Check-in modal with technician selector, shift, status, check-in/check-out times, hours, overtime, notes, and attendance date.
  - 11 attendance statuses supported (Present/Late/Absent/On Leave/Sick/Half Day/Day Off/Public Holiday/Work From Home/Mission/Training Day) with color-coded badges and dots.
  - Multi-property scoping via `currentPropertyId` from `useERP`. ERP notifications on all CRUD. Loading/error/retry states. Routes use `authenticate` only.

## Engineering Portal — Technician HR Integration

- The `eng_technicians` table has an `employee_id` column (migration 339) that links to the shared `employees` table (HR module). This integration mirrors the HK Staff Management HR link pattern.
- **Routes** (in `engineeringPortal.routes.ts`):
  - `GET /technicians/available-employees?propertyId=` — lists HR employees in the `Engineering` department that are not yet linked to a technician (for the Link Employee dropdown).
  - `GET /technicians` — now joins HR employee data (email, phone, hire_date, salary, department, position) for technicians that have an `employee_id` link. Returns `hrEmail`, `hrPhone`, `hrHireDate`, `hrSalary`, `hrDepartment`, `hrPosition` fields.
  - `POST /technicians` — supports two HR link modes:
    - `employeeId` — link to an existing HR employee record.
    - `email`/`phone`/`hireDate`/`salary` — create a new HR employee record (department='Engineering', position=role) and link it.
  - `PATCH /technicians/:id` — supports `employeeId` field for linking/unlinking. When `employeeId: null` is passed, the technician is unlinked. Returns the updated technician with HR fields populated.
- **Frontend service**: `src/services/engineeringService.ts` exports `fetchAvailableEmployees` (returns `{ employees: AvailableEmployee[] }`), and `createTechnician`/`updateTechnician` now accept `employeeId` and `salary` fields. The `Technician` type includes optional `hrEmail`, `hrPhone`, `hrHireDate`, `hrSalary`, `hrDepartment`, `hrPosition` fields. `AvailableEmployee` type added.
- **Component** (`StaffManagement.tsx`):
  - **Add Technician form**: HR Employee Link section with three modes — "Create New" (creates a new HR employee with email/phone/hireDate/salary), "Link Existing" (dropdown of unlinked Engineering employees), "No Link" (skip, can link later).
  - **Action menu**: "Link HR Employee" button (when unlinked) or "Unlink HR" button (when linked), in addition to Edit/Status/Delete.
  - **Detail modal**: HR Employee section showing department, position, email, phone, hire date, and salary from the linked HR record. "Linked" badge when connected, "Link Employee" button when not.
  - **Link Employee modal**: dedicated modal for linking an existing technician to an unlinked HR employee via dropdown.
  - Caches invalidated on mutations (`eng-*` and `hr-*` patterns).

## Security Portal — SOC & Staff Management Integration

- **Migration 600** (`600_security_soc.sql`) backs `/erp/security/soc` and `/erp/security/staff`:
  - Adds 7 tables: `sec_incidents`, `sec_patrols`, `sec_cctv_cameras`, `sec_alarms`, `sec_access_events`, `sec_emergency_notifications`, `sec_staff`.
  - CHECK constraints on priority/status/shift/role enums; `updated_at` triggers on incidents + staff. RLS enabled; `authenticated` role granted CRUD on all 7 tables.
  - Seeds all rows matching the former hardcoded arrays in `SecurityOperationsCenter.tsx` (5 incidents, 4 patrols, 6 cameras, 4 alarms, 5 access events, 3 emergencies, 5 staff). Uses the demo property (`18762279-a389-41c9-9169-7ebc682e9703`).
- **Routes** (`securityPortal.routes.ts`, mounted at `/api/sec-portal`): `GET /soc/overview` aggregate fetch plus full CRUD for `/soc/incidents`, `/soc/patrols`, `/soc/cctv`, `/soc/alarms`, `/soc/access-events`, `/soc/emergency`, and `/staff` (soft-delete via `is_active`). Routes use `authenticate` only, `sec-*` cache invalidation.
- **Frontend service**: `src/services/securityService.ts` — `fetchSocOverview` + typed CRUD for all resources.
- **Components**:
  - `SecurityOperationsCenter.tsx` — DB-driven (no mock data); 6 tabs (staff tab removed); functional Refresh, New Incident modal, inline actions (incident Start/Resolve, patrol Complete, alarm Acknowledge/Resolve, emergency Resolve); loading/error/empty states; PageHeader/SectionCard/Badge/ModalSystem UI.
  - `StaffManagement.tsx` — new `/erp/security/staff` tab (`sec_staff` modId). Staff availability roster moved here with full CRUD: KPI StatCards, search + role/shift/status filters, DataTable roster with status dots, inline quick reassignment (role/shift/status selects), add/edit modal, confirm soft-delete.
- **Migration 601** (`601_security_incident_management.sql`) backs `/erp/security/incidents` on the SAME `sec_incidents` table — one source of truth shared with the SOC queue:
  - Adds `category` (defaults from `incident_type`), `reported_by`; expands status CHECK to the full case lifecycle: Draft → Reported → Classified → Assigned → In Progress → Investigation → Corrective Action → Closed (SOC's Active/Pending/Resolved kept for compat; Resolved/Closed are the closed states).
  - Seeds the former `IncidentManagement.tsx` mock rows as `INC-2024-###`.
- `IncidentManagement.tsx` — DB-driven incident register: KPI StatCards (total/open/critical/closed), working search + status/priority filters, DataTable with per-category icons, inline status select, view-detail modal (status update + edit/delete), new/edit form (assignee dropdown fed from `sec_staff`), confirm hard-delete. Service: `fetchSecIncidents`, `createSecIncident`, `updateSecIncident`, `deleteSecIncident`.
- **Migration 602** (`602_security_investigations.sql`) backs `/erp/security/investigations`:
  - `sec_investigations` (case register; nullable `incident_id` FK → `sec_incidents` ON DELETE SET NULL; 7-state lifecycle: Open → In Progress → Evidence Collection → Interviews → Analysis → Review → Closed).
  - Child tables: `sec_investigation_witnesses`, `sec_investigation_evidence` (typed: CCTV Footage/Photo/Document/Statement/Log/Physical/Digital/Other), `sec_investigation_activities` (timeline: Case Opened/Status Change/Witness Added/Evidence Added/Note/Case Closed). All CASCADE on case delete, RLS + authenticated grants.
  - Routes `/api/sec-portal/investigations`: list embeds witness/evidence counts via PostgREST `(count)`; `GET /:id` returns case + witnesses + evidence + activities; status PATCH auto-logs Status Change/Case Closed activity; nested POST/DELETE for witnesses + evidence; `POST /:id/notes` appends a Note to the timeline.
  - `Investigations.tsx` — DB-driven case register (KPIs, search/filters, DataTable, inline status select) + `size="xl"` detail modal with live witnesses/evidence add-remove and a real activity timeline fed by `sec_investigation_activities`.
- **Migration 603** (`603_security_visitors.sql`) backs `/erp/security/visitors`:
  - `sec_visitors` — visitor register: 7 visitor types, 5 statuses (Pre-registered → Checked In → Checked Out, plus Blacklisted/Expired), auto badge numbers (`BG-YYYY-###`), expected arrival/departure, contact fields, blacklist_status.
  - Routes `/api/sec-portal/visitors`: CRUD; PATCH handles lifecycle transitions — `Checked In`/`Checked Out` stamp timestamps and log a `sec_access_events` row (event_type `Visitor Checked In/Out`, location 'Main Entrance') so movements appear in the SOC access feed; `Blacklisted` auto-sets blacklist_status.
  - `VisitorManagement.tsx` — DB-driven register: KPIs (On Site / Today / Badges / Blacklisted), search + status/type filters, DataTable with inline Check In/Check Out actions, detail modal with badge card + blacklist/clear actions, register/edit form (host datalist fed from `sec_staff`).
- **Migration 604** (`604_security_access_grants.sql`) backs `/erp/security/access-control`:
  - `sec_access_grants` — access *permissions* register (distinct from `sec_access_events`, the SOC event log): 5 access types, 5 statuses (Active/Inactive/Suspended/Expired/Revoked), `zones` TEXT[], `door_count`, schedule (24-7/business/dayshift/nightshift/custom), valid_from/until, last_access_at, access_count.
  - Routes `/api/sec-portal/access-grants`: CRUD; PATCH transitions (Suspend/Revoke/Reactivate); `door_count` auto-derives from zones length when omitted.
  - `AccessControl.tsx` — DB-driven grants register: KPIs (Active / Doors Covered / Flagged Events from `sec_access_events` / Suspended-Revoked), search + status/type filters, zone-checkbox grant form (user datalist fed from `sec_staff`), detail modal with Suspend/Revoke/Reactivate.
- **Migration 605** (`605_security_keys.sql`) backs `/erp/security/keys`:
  - `sec_keys` — key/keycard register: 8 types (Master/Department/Emergency/Spare keys + Guest Keycard/Mobile Key/Staff Card/Contractor Card), 6 statuses, unique `key_number`, issued/return/last-audit dates.
  - `sec_key_logs` — per-key audit trail (Registered/Issued/Returned/Reported Lost/Reported Found/Marked Damaged/Decommissioned/Audited/Edited/Note), CASCADE on key delete.
  - Routes `/api/sec-portal/keys`: CRUD + `GET /:id` (key + logs); PATCH transitions stamp dates (Issued → issued_date + clears return_date; Available → return_date + clears assignee) and auto-log; `POST /:id/found` = Lost → Available w/ Reported Found log; `lastAuditDate` patch logs Audited.
  - `KeyKeycardManagement.tsx` — DB-driven register: KPIs, search + status/type filters, inline Issue/Return/Found actions, Issue modal (assignee + note), detail modal with lifecycle buttons + real audit-trail timeline.
- **Migration 606** (`606_security_cctv_management.sql`) backs `/erp/security/cctv`:
  - `sec_cctv_cameras` EXTENDED (shared with the SOC camera board — single source of truth): `ip_address`, `health` (Good/Fair/Poor), `retention_days`, `resolution`, `model`; status CHECK expanded to Online/Offline/Maintenance/**Recording**/**Standby**; CAM-007 seeded.
  - `sec_cctv_events` — per-camera activity log (Motion Detected/Snapshot/Playback Requested/Recording Started/Stopped/Status Change/Maintenance/Note), CASCADE on camera delete.
  - Routes `/api/sec-portal/soc/cctv`: POST accepts new fields; `GET /:id` returns camera + events; PATCH logs `Recording Started/Stopped` and `Status Change` events; `POST /:id/events` logs arbitrary events (Motion Detected also stamps `last_motion_at`).
  - `CCTVManagement.tsx` — DB-driven registry: KPIs (Total/Online/Offline/Recording), search + status/location filters, DataTable with inline status select + REC toggle, detail modal with feed panel, camera actions (Start/Stop Recording, Log Motion, Snapshot, Request Playback) + real event timeline; add/edit/delete modals.
  - SOC `CAMERA_STATUS_TONE` covers the expanded status set.
- **Migration 607** (`607_security_patrol_management.sql`) backs `/erp/security/patrols`:
  - `sec_patrols` EXTENDED (shared with the SOC patrol board — single source of truth): `scheduled_start`/`scheduled_end`, `shift` (Day/Evening/Night), `checkpoint_total`/`checkpoint_done`, `notes`, `updated_at` trigger.
  - `sec_patrol_checkpoints` — per-patrol QR/NFC checkpoint list (name, location, order_no, scanned_at, scanned_by), CASCADE on patrol delete.
  - Routes `/api/sec-portal/soc/patrols`: POST accepts schedule/shift/notes + a `checkpoints[]` list (auto-creates child rows); `GET /:id` returns patrol + checkpoints; PATCH supports schedule fields and stamps `started_at` on In Progress; `POST /:id/scan` marks a checkpoint scanned and derives `checkpoint_done`, `progress`, `last_checkpoint`, and auto-Completes at 100%.
  - `PatrolManagement.tsx` — DB-driven register: KPIs (Total/In Progress/Scheduled/Completed), search + status/shift filters, DataTable with checkpoint progress bars + inline status select, detail modal with lifecycle buttons (Start/Complete/Cancel) + real checkpoint scan list; new-patrol form with dynamic checkpoint editor + officer datalist fed from `sec_staff`.
- **Migration 608** (`608_security_lostfound.sql`) backs `/erp/security/lost-found`:
  - `sec_lostfound_cases` — case register: 8 item categories, 6-status lifecycle (Reported → Found → In Storage → Claim Pending → Returned | Disposed), location_lost/found/storage, reporter/finder/claimant fields, estimated_value, lifecycle timestamps.
  - `sec_lostfound_custody` — per-case chain-of-custody log (Registered/Item Found/Placed in Storage/Claim Submitted/Claim Verified/Released to Owner/Disposed/Transferred/Edited/Note), CASCADE on case delete.
  - Routes `/api/sec-portal/lostfound`: CRUD + `GET /:id` (case + custody); PATCH stamps lifecycle timestamps and auto-logs the matching custody action; `POST /:id/custody` adds manual custody/note entries.
  - `LostFoundOversight.tsx` — DB-driven register: KPIs (Open/In Storage/Claims Pending/Returned), search + status/category filters, per-category icons, inline status select, detail modal with lifecycle buttons (Mark Found/Store/Record Claim/Release/Dispose) + live chain-of-custody timeline and custody-note form.
- **Migration 609** (`609_security_emergency_management.sql`) backs `/erp/security/emergency`:
  - `sec_emergency_notifications` EXTENDED (shared with the SOC emergency tab — single source of truth): `description`, `commander` (incident commander), `response_team`, `evacuation` (Not Required/Standby/In Progress/Complete), `resolved_at`, `updated_at` trigger.
  - `sec_emergency_responses` — per-emergency response-action log (Alert Raised/Team Dispatched/Commander Assigned/Evacuation Ordered/Evacuation Complete/Status Update/All Clear/Resolved/Note), CASCADE on delete.
  - Routes `/api/sec-portal/soc/emergency`: POST accepts command fields and logs Alert Raised; `GET /:id` returns emergency + responses; PATCH stamps `resolved_at` and auto-logs Status Update/Resolved/Commander Assigned/Team Dispatched/Evacuation transitions; `POST /:id/responses` adds manual log entries.
  - `EmergencyManagement.tsx` — DB-driven incident-command board: KPIs (Active/Responding/Evacuating/Resolved), search + status/priority filters, per-type icons, inline status select, detail modal with command actions (Begin Response/Order Evacuation/Evacuation Complete/Resolve) + live response timeline and response-action form; alert form with commander datalist fed from `sec_staff`.
- **Migration 610** (`610_security_fire_safety.sql`) backs `/erp/security/fire-safety`:
  - `sec_fire_equipment` — fire/life-safety equipment register: 12 types, 4 statuses (Operational/Needs Service/Out of Service/Under Test), serial/model, install + last_inspection + next_due dates.
  - `sec_fire_activities` — inspections, alarm tests, drills, maintenance events; nullable `equipment_id` FK (SET NULL), result (Pass/Pass with Notes/Fail), inspector, schedule/completion timestamps, drill participants + evacuation_time_sec.
  - Routes `/api/sec-portal/fire-equipment` (CRUD) + `/fire-activities` (CRUD); completing an equipment-linked Inspection/Alarm Test stamps `last_inspection`, rolls `next_due` ~90 days, and derives equipment status from result (Fail → Needs Service).
  - `FireLifeSafety.tsx` — DB-driven with pill sub-tabs: Equipment Register (KPIs incl. live overdue-inspection count, overdue highlighting, inline status select, detail modal w/ Return to Service) and Inspections & Drills (inline Complete action opens a result modal; drill completion captures participants + evac time; linked-equipment select fed from `sec_fire_equipment`).
- **Migration 611** (`611_security_risk_management.sql`) backs `/erp/security/risk`:
  - `sec_risks` — enterprise risk register: 7 categories, likelihood/impact 1–5 with `risk_score` (L×I) + `risk_level` derived server-side (1–4 Low, 5–9 Medium, 10–15 High, 16–25 Critical), 5-status lifecycle (Open → Assessed → Mitigating → Monitoring → Closed), owner, mitigation_plan, next_review.
  - `sec_risk_actions` — per-risk mitigation checklist + review log (Mitigation Action/Review/Status Change/Note) with owner, due_date, done flag, CASCADE on risk delete.
  - Routes `/api/sec-portal/risks`: CRUD sorted by score desc; `GET /:id` returns risk + actions; PATCH re-derives score/level when likelihood/impact change and auto-logs Status Change; `POST /:id/actions` adds actions; `PATCH /:id/actions/:actionId` toggles done.
  - `RiskManagement.tsx` — DB-driven register: KPIs (Open/High+Critical/Mitigating/Reviews Overdue), search + status/level/category filters, score column (L×I=S) + level badges, inline status select, overdue review highlighting; detail modal with lifecycle buttons, likelihood/impact sliders w/ live score preview in the form, and a working mitigation checklist (toggle done + add actions with owner/due-date).
  - `Notification.department` union extended with `'Security'` in `src/types/erp.ts`.
- **Migration 612** (`612_security_business_continuity.sql`) backs `/erp/security/business-continuity`:
  - `sec_bcp_plans` — continuity/DR plan register: 7 plan types (Disaster Recovery/Business Continuity/Emergency Response/IT Recovery/Utility Outage/Pandemic Response/Other), 4-status lifecycle (Draft → Active → Under Review → Archived), criticality, owner, scope, activation_trigger, recovery_steps, RTO/RPO hours, version, last_tested/next_test_due/review_date.
  - `sec_bcp_exercises` — per-plan test log (Tabletop/Simulation/Full Test/Review), Scheduled → In Progress → Completed/Cancelled with result (Pass/Issues Found/Fail), participants, findings, CASCADE on plan delete.
  - Routes `/api/sec-portal/bcp`: plans CRUD (`GET /plans/:id` returns plan + exercises), `/bcp/exercises` list + `POST /bcp/plans/:id/exercises` + PATCH/DELETE `/bcp/exercises/:id`. Completing an exercise stamps the plan's `last_tested` and rolls `next_test_due` +365 days server-side.
  - `BusinessContinuity.tsx` — DB-driven with two pill sub-tabs: Recovery Plans (KPIs Active/Critical/Tests Overdue/Exercises Scheduled, search + status/type filters, RTO/RPO column, inline status select, overdue test highlighting, detail modal w/ lifecycle buttons + exercise history timeline) and Exercises & Tests (schedule/result workflow, Complete modal with Pass/Issues Found/Fail picker + participants + findings).
- **Migration 613** (`613_security_crisis_management.sql`) backs `/erp/security/crisis`:
  - `sec_crises` — crisis register: 9 types (Security Threat/Natural Disaster/Public Health/Media & PR/Cyber Incident/Utility Failure/Structural/Civil Unrest/Other), 5-status lifecycle (Monitoring → Active → Stabilizing → Resolved → Debrief), severity, crisis_lead, comms_channel, nullable FKs `incident_id` → `sec_incidents` and `bcp_plan_id` → `sec_bcp_plans` (SET NULL on delete).
  - `sec_crisis_updates` — comms + decision log (Crisis Declared/Team Mobilized/Status Update/Communication/Decision/Escalation/BCP Activated/Resolved/Note), CASCADE on crisis delete.
  - Routes `/api/sec-portal/crises`: CRUD; `GET /:id` returns crisis + update log; POST auto-logs Crisis Declared; PATCH stamps `resolved_at` and auto-logs Status Change/Resolved/BCP Activated/Team Mobilized entries; `POST /:id/updates` for manual comms/decision entries.
  - `CrisisManagement.tsx` — DB-driven register: KPIs (Active/Critical/Monitoring+Stabilizing/Resolved), search + status/type/severity filters, inline status select; detail modal with ACTIVE CRISIS banner, lifecycle buttons (Activate → Stabilize → Resolve → Debrief), linked incident + BCP plan display, a log-update form (typed entries), and a live comms/decision timeline. Declare form links a crisis to an incident (sec_incidents) and a BCP plan (sec_bcp_plans).
- **Migration 614** (`614_security_health_safety.sql`) backs `/erp/security/health-safety`:
  - `sec_safety_inspections` — inspection register: 7 types (Routine/Fire Safety/Pool Safety/Kitchen Hygiene/Workplace/Compliance/Other), Scheduled → In Progress → Completed/Cancelled with result (Pass/Pass with Notes/Fail), area, inspector, schedule, findings.
  - `sec_safety_hazards` — hazard register: 8 types (Slip-Trip-Fall/Electrical/Chemical/Fire/Structural/Ergonomic/Biological/Other), severity, 5-status lifecycle (Reported → Assessed → Corrective Action → Resolved → Closed), description, corrective_action, reported_by/assigned_to, nullable `inspection_id` FK → `sec_safety_inspections` (SET NULL — hazards survive inspection delete).
  - Routes `/api/sec-portal/safety-inspections` + `/safety-hazards`: CRUD on both; inspection PATCH completing stamps `completed_at`; hazard PATCH stamps `resolved_at` on Resolved/Closed; hazard list embeds linked inspection title.
  - `HealthSafetyCoordination.tsx` — DB-driven with two pill sub-tabs: Safety Inspections (search + status/type filters, inline status select, Complete modal with Pass/Pass with Notes/Fail picker + findings) and Hazard Register (severity/status/type filters, inline status select, detail modal with corrective-action lifecycle buttons, report form with staff datalists + linked-inspection select).
- **Migration 615** (`615_security_compliance.sql`) backs `/erp/security/compliance`:
  - `sec_compliance_items` — license/cert/permit/policy register: 8 categories, authority + reference_no, issue/expiry/last-audit dates, responsible. Status auto-derives from `expiry_date` on write (past → Expired, ≤30d → Expiring Soon) unless explicitly Pending/Non-Compliant.
  - `sec_compliance_audits` — audit register: 4 types (Internal/External/Regulatory/Insurance), Scheduled → In Progress → Completed/Cancelled with result (Pass/Pass with Findings/Fail), auditor, scope, findings.
  - Routes `/api/sec-portal/compliance-items` + `/compliance-audits`: CRUD on both; audit PATCH completing stamps `completed_at`.
  - `ComplianceManagement.tsx` — DB-driven with two pill sub-tabs: Compliance Register (KPIs Compliant/Expiring+Expired/Non-Compliant+Pending/Open Audits, search + status/category filters, live "Nd left/expired" expiry highlighting, detail modal with Pending Renewal/Mark Compliant actions) and Audits (schedule/result workflow, Complete modal with Pass/Pass with Findings/Fail picker + findings).
- **Migration 616** (`616_security_asset_protection.sql`) backs `/erp/security/asset-protection`:
  - `sec_assets` — high-value asset register: 8 types (Artwork/Cash & Valuables/Electronics/Vehicle/Equipment/Documents/Furniture/Other), estimated_value, serial_no, custodian, security_level (Maximum/High/Standard), 5-status lifecycle (Secured/In Transit/Under Review/Missing/Compromised), protection_measures, last_check + next_check_due.
  - `sec_asset_logs` — per-asset movement/review trail (Registered/Check Performed/Moved/Status Change/Security Review/Alarm Test/Note), CASCADE on asset delete.
  - Routes `/api/sec-portal/assets`: CRUD sorted by value desc; `GET /:id` returns asset + log trail; PATCH auto-logs Status Change/Moved; `POST /:id/check` stamps `last_check` and rolls `next_check_due` +30d; `POST /:id/logs` for manual entries.
  - `AssetProtection.tsx` — DB-driven register: KPIs (Total Value/Secured/Attention Required/Checks Overdue), search + status/type/level filters, value column, inline status select, overdue-check highlighting, inline Log Check action; detail modal with lifecycle buttons (Mark Secured/In Transit/Start Review/Report Missing), a typed log-entry form, and a live tracking/review timeline.
- **Migration 617** (`617_security_fraud_prevention.sql`) backs `/erp/security/fraud-prevention`:
  - `sec_fraud_cases` — fraud case register: 8 types (Payment Fraud/Internal Theft/Expense Fraud/Identity Fraud/Refund Fraud/Card Fraud/Vendor Fraud/Other), amount, severity, source (System Alert/Manual Report/Audit Finding/External), assigned_to, nullable `investigation_id` FK → `sec_investigations` (SET NULL), resolution, lifecycle Flagged → Under Review → Investigating → Substantiated/Unfounded → Closed (resolved statuses stamp `resolved_at` server-side).
  - `sec_fraud_alerts` — payment/transaction alert feed: 8 alert types (Large Transaction/Unusual Refund/Velocity Anomaly/Card Mismatch/Duplicate Charge/After-Hours Access/Discount Abuse/Other), source system, status New → Reviewed → Escalated | Dismissed, nullable `case_id` FK → `sec_fraud_cases` (SET NULL).
  - Routes `/api/sec-portal/fraud-cases` + `/fraud-alerts`: CRUD on both; case PATCH stamps/clears `resolved_at`; `POST /fraud-alerts/:id/escalate` creates a linked fraud case from the alert (Under Review, source System Alert) and marks the alert Escalated.
  - `FraudPrevention.tsx` — DB-driven with two pill sub-tabs: Fraud Cases (KPIs Open/High-Critical/New Alerts/Active Exposure, search + status/type filters, inline status select, detail modal with lifecycle buttons Begin Review → Open Investigation → Substantiated/Unfounded → Close/Reopen, linked-investigation select fed from `sec_investigations`, assignee datalist fed from `sec_staff`) and Payment Alerts (alert feed with type/severity badges, inline status select, inline Escalate action + escalate modal picking fraud type/assignee, detail modal with Mark Reviewed/Escalate/Dismiss actions).
- **Migration 618** (`618_security_evidence.sql`) backs `/erp/security/evidence`:
  - `sec_evidence` — evidence item register: 7 types (Photo/Video/Document/Physical Item/Digital File/Audio/Other), collection + storage locations, collected_by, source, nullable FKs → `sec_incidents`/`sec_investigations`/`sec_fraud_cases` (all SET NULL), lifecycle Collected → Secured → In Analysis → Released | Archived (Released stamps `released_at` server-side).
  - `sec_evidence_custody` — real chain-of-custody log (Collected/Logged/Transferred/Analysis Started/Analysis Complete/Released/Archived/Note) with recipient + location per entry, CASCADE on evidence delete.
  - Routes `/api/sec-portal/evidence`: CRUD; `GET /:id` returns item + ordered custody log; POST auto-logs `Collected`; PATCH auto-logs custody entries on status transitions (Secured→Logged, In Analysis→Analysis Started, Released→Released with released_to, Archived→Archived); `POST /:id/custody` for manual entries.
  - `EvidenceManagement.tsx` — DB-driven register: KPIs (Total/In Custody/In Analysis/Released), search + status/type filters, inline status select, linked-record column; detail modal with lifecycle buttons (Secure in Storage → Start Analysis → Analysis Complete/Re-secure → Archive, Release via edit form), a custody-entry form (action + recipient + location + detail), and a live color-coded chain-of-custody timeline. Service names are suffixed `Item` (`SecEvidenceItem`, `fetchSecEvidenceItems`, `addSecEvidenceCustody`…) to avoid collisions with the existing investigation-scoped `SecEvidence`/`sec_investigation_evidence` attachment list and lost-found `SecCustodyEntry`.
- **Migration 619** (`619_security_communications.sql`) backs `/erp/security/communication`:
  - `sec_messages` — dispatch/internal/broadcast register: 4 types (Dispatch/Internal/Broadcast/Emergency), priority (Emergency/Urgent/Routine), channel (Radio/App/Email/PA System), audience + free-text recipient, sender, expiry, status Sent → Acknowledged | Expired | Recalled.
  - `sec_message_acks` — per-person acknowledgement log (acked_by + optional note), CASCADE on message delete.
  - Routes `/api/sec-portal/messages`: CRUD; list embeds ack counts; `GET /:id` returns message + ack list; `POST /:id/ack` records an ack and derives a Sent message → Acknowledged on first ack.
  - `CommunicationCenter.tsx` — DB-driven feed: KPIs (Total/Awaiting Ack/Acknowledged/Emergency Active), search + status/type/priority filters, type icons (radio/megaphone/siren), live ack counts, inline status select, expired-flag highlighting; detail modal with full message view, Recall/Re-send actions, an ack-entry form (staff datalist + note), and a live acknowledgement list; compose/edit form (type, priority, channel, audience, custom recipient datalist, sender, expiry).
- **Migration 620** (`620_security_staff_mgmt.sql`) extends `/erp/security/staff` to full staff management (mirrors `Housekeeping/StaffManagementModule.tsx`):
  - `sec_shift_defs` — shift definitions (name, HH:MM start/end, required_staff); `assigned_staff` derived live from `sec_staff` at read time. `UNIQUE(property_id, name)`.
  - `sec_staffing_reqs` — coverage requirements per post/role/shift (required_count); `assigned_count` derived live. Role/shift CHECK constraints match `sec_staff` enums.
  - `sec_training` — certification records per staff (course, provider, completed_at, expires_at, Scheduled/In Progress/Completed/Expired), FK → `sec_staff` CASCADE.
  - `sec_attendance` — daily attendance (attendance_date, shift, check_in/out timestamptz, 8-status enum, hours_worked, overtime_hours), `UNIQUE(staff_id, attendance_date)`, FK → `sec_staff` CASCADE.
  - `sec_performance` — per-staff period metrics (period_date, patrols_completed, incidents_responded, reports_filed, hours, score 0–100), `UNIQUE(staff_id, period_date)`, FK → `sec_staff` CASCADE.
  - All 5 tables: RLS enabled, `authenticated` CRUD grants; seeded for the demo property (3 shift defs, 8 coverage reqs, 6 training, 10 attendance, 5 performance).
  - Routes `/api/sec-portal/staff/*`: full CRUD on `staff/shifts`, `staff/coverage`, `staff/training`, `staff/attendance` (+ `GET staff/attendance/summary` per-staff rollup: present/late/absent counts, total hours/OT, attendance rate), `staff/performance`. POST attendance/performance upsert on the natural unique keys. Training/attendance/performance list queries embed `sec_staff(id, name, role)`.
  - `StaffManagement.tsx` — six pill sub-tabs (Roster / Attendance / Shifts / Coverage / Training / Performance), per-tab contextual header action, per-tab lazy loading via `loadSubModule` (attendance refetches on date-picker change):
    - **Roster** — unchanged behaviour: KPI StatCards, search + role/shift/status filters, inline role/shift/status quick-update selects, add/edit modal, confirm soft-delete.
    - **Attendance** — date picker in SectionCard actions, per-day record table (check-in/out times, hours, OT, status badge), inline Check Out action (computes hours from check-in), create = check-in upsert, edit form exposes check-out/hours/OT.
    - **Shifts** — def table with window, required vs live-assigned counts, gap badge (short/over/Covered), CRUD modal.
    - **Coverage** — staffing requirements by post/role/shift with the same live gap badges, CRUD modal.
    - **Training** — course/staff/provider/dates/status table, expired expiry-dates flagged red, inline Mark Completed action, CRUD modal with staff select fed from `sec_staff`.
    - **Performance** — per-staff period metrics table (patrols/incidents/reports/hours + score badge), CRUD modal; POST upserts on staff+period.
    - Shared `subDelete` confirm modal handles deletes for all five sub-modules.
- **Migration 621** (`621_security_reports.sql`) backs `/erp/security/reports` — mimics the HK reports pattern (migration 316 / `HKReportsModule.tsx`):
  - `sec_reports` — report-definition registry: 4 categories (operational / staff / compliance / executive), name, description, `last_run`, status (Ready/Scheduled/Generating/Failed), format (PDF/Excel/CSV), frequency, `property_id`, `updated_at` trigger. RLS enabled; `authenticated` CRUD grants.
  - Seeded 18 reports for the demo property: 6 operational (daily security log, incident summary, patrol activity, visitor/access log, alarm & CCTV review, key/keycard audit), 4 staff (officer performance, attendance, training & certification, shift coverage), 4 compliance (compliance status, safety inspection, risk register, fire & life safety), 4 executive (executive summary, incident trends, loss prevention, emergency preparedness).
  - Routes `/api/sec-portal/reports`: `GET /` (optional `?category=` `?propertyId=`), `GET /stats` (KPI rollup), `GET /:id`, `POST /:id/run` (stamps `last_run`, sets Ready), `POST /run-all` (propertyId-scoped refresh), `PATCH /:id` (frequency/format/status).
  - Service: `fetchSecReports`, `fetchSecReportStats`, `fetchSecReport`, `runSecReport`, `runAllSecReports`, `updateSecReport` + `SecReport`/`SecReportCategory`/`SecReportStatus`/`SecReportFormat`/`SecReportStats` types.
  - `SecurityReports.tsx` — near-verbatim port of `HKReportsModule` with `SEC` dept tag: PageHeader with period segmented picker (Today/WTD/MTD/YTD/Custom + custom range inputs), Schedule + Run All actions; StatCards (Total/Ready/Scheduled/Failed); refresh + search toolbar; category-grouped SectionCards with ID chip, last-run, format/frequency/status badges and live period badge; per-row View (detail modal with metadata grid + Run Now/Download) and Download (real PDF/Excel/CSV via `reportExportUtils`); schedule modal with dirty-row highlighting and bulk PATCH save; report-delivery info banner. Property-scoped via `currentPropertyId`.
- **Migration 622** (`622_security_config.sql`) backs `/erp/security/configuration` — mimics the HK `hk_config` / Eng `eng_config` JSON-blob pattern:
  - `sec_config` — one JSONB `data` blob per `(property_id, section)`; sections CHECK-constrained to `zones | patrols | incidents | access`; `UNIQUE(property_id, section)`, `updated_at` trigger, RLS + authenticated grants.
  - Seeded 4 sections for the demo property: zone register (7 zones w/ area + risk level), patrol route templates (4 routes w/ checkpoints + duration), incident categories (8 w/ default priority + SLA minutes), access role definitions (6 w/ level + permitted zones) — each with flat boolean/number/select settings.
  - Routes `/api/sec-portal/config/:propertyId/:section`: `GET` returns `{}` when unset, `PUT` upserts the section blob (`sec-cfg-{propertyId}-{section}` id convention).
  - Service: `fetchSecConfig`, `saveSecConfig`, `SecConfigSection`, `SEC_CONFIG_SECTIONS`.
  - `SecurityConfiguration.tsx` — near-verbatim port of `Engineering/Configuration.tsx`: horizontal segmented section tabs with dirty-dot indicators; per-section General Settings card (toggles/numbers/selects) + row-group cards (Zone Register / Route Templates / Categories / Role Definitions) with Add + per-row Edit/Delete via a generic `ModalSystem` edit form; per-section Save (disabled unless dirty) + Reset to Defaults; merges DB blobs over client-side defaults, property-scoped via `currentPropertyId`.
- **Migration 623** (`623_security_dashboard.sql`) backs `/erp/security/dashboard` — mirrors the HK `hk_dashboard_alerts` Smart Alert Engine:
  - `sec_dashboard_alerts` — persistent alert registry (property_id, ref_id, type, message, priority, status Active/Acknowledged/Snoozed/Resolved, location, snoozed_until, timestamps + trigger, RLS + authenticated grants); seeded for the demo property.
  - Routes `/api/sec-portal/dashboard`: `GET /overview?propertyId=` (aggregates KPIs + chart series live from `sec_incidents`, `sec_investigations`, `sec_patrols`, `sec_alarms`, `sec_cctv_cameras`, `sec_access_events`, `sec_visitors`, `sec_lostfound_cases`, `sec_fire_equipment`, `sec_staff`, `sec_keys`, `sec_risks`, `sec_training` — and runs the alert engine, upserting into `sec_dashboard_alerts` and auto-resolving cleared triggers), `GET /alerts`, `POST /alerts/:id/acknowledge`, `POST /alerts/:id/snooze` (body `{hours}`).
  - Service: `fetchSecDashboardOverview`, `fetchSecDashboardAlerts`, `acknowledgeSecAlert`, `snoozeSecAlert` + `SecDashboardOverview`/`SecDashboardKpis`/`SecDashboardAlert`/`SecAlertPriority` types.
  - `SecurityDashboard.tsx` — DB-driven: PageHeader + Refresh; 12 StatCard KPIs with live captions; SectionCard charts via recharts (incident-category Pie, 7-day incident-trend Line, avg-risk-by-category Bar, per-officer patrol-activity Bar); Smart Alert feed with per-type icons, priority/status badges, time-ago, and working Acknowledge / Snooze-4h actions. Staff availability stays in `/erp/security/staff` (not duplicated on the dashboard).

## Operations Portal — Command Center Integration

- **Migration 627** (`627_ops_command_center.sql`) must be applied for the `/erp/operations/command-center` tab:
  - Adds `public.ops_command_alerts` (id, property_id, severity `critical|warning|info`, category, message, department, status `Active|Acknowledged|Resolved`, acknowledged_by/at, source `seed|generated`, created_at, updated_at + trigger, RLS + authenticated grants).
  - Seeds the 5 mock alerts previously hardcoded in `OperationsCommandCenter.tsx` (`ops-seed-*`, source=`seed`, demo property `18762279-a389-41c9-9169-7ebc682e9703`).
- **Routes** (`src/server/routes/operationsCommandCenter.routes.ts`, mounted at `/api/ops-portal`):
  - `GET  /command-center?propertyId=` — live cross-department overview. Computes each department card from the *real* tables of the other portals (guest_requests + reservations → Front Office/Concierge, housekeeping_task_mgmt + housekeeping_maintenance_issues → Housekeeping, work_orders + corrective_maintenance_tasks → Engineering, orders → F&B + Kitchen, hk_laundry_jobs → Laundry, spa_appointments + spa_alerts → Spa, sec_incidents → Security, transport_maintenance_requests + transport_incidents → Transportation, banquet_events → Events, inventory_items low-stock → Inventory). Runs an alert generator (same pattern as the HK `regenerateAlerts` engine) that upserts deterministic `ops-gen-*` rows into `ops_command_alerts` and auto-resolves generated alerts whose trigger cleared; `source='seed'` rows are never auto-resolved. Response cached 20s (`ops-command-center:*`), invalidated on acknowledge.
  - `POST /command-center/alerts/:id/acknowledge` — sets `status='Acknowledged'` + acknowledged_by/at.
  - Tables that lack a `property_id` column (`orders`, `banquet_events`) are treated as global and not property-scoped; every source query is non-fatal (missing table → empty set) except the `ops_command_alerts` read itself. Column names follow the live schema: `work_orders.created_date` (not `created_at`), `inventory_items.current_quantity`/`reorder_point` (not `current_stock`/`reorder_level`).
- **Access control**: every `operations` tab in `DEPARTMENT_TABS` has a `toggleKey` (`operations_<tab>`) wired to Platform Controls submodules, and the 23 `ops_*` modIds are seeded into `public.modules` by **migration 644** (`644_ops_modules_registry.sql`) so the role editor can grant/revoke them per-role. **Migration 645** (`645_ops_store.sql`) adds the `UINV-ST-OPS` store (`department='Operations'`) used by the Requisitions tab.
- **Removed dead surface**: the legacy `/api/operations/*` router (`operationsManager.routes.ts`) and its orphaned Admin components (`UnifiedPortal`, `OperationsManagerPortal`, `StaffSchedulingOptimization`, `ExecutivePortal`, `OperationsControl`, `Admin/ExecutiveOperations/`) were deleted — nothing reachable imported them. The `operations_*` tables from migrations 097–099/132 remain for historical data.
- **Frontend service**: `src/services/operationsService.ts` — `fetchCommandCenterOverview(propertyId)`, `acknowledgeCommandCenterAlert(id)` + `CommandCenterOverview`/`CommandCenterDepartment`/`CommandCenterAlert`/`CommandCenterSeverity`/`CommandCenterDeptStatus` types. `API_BASE = '/api/ops-portal'`.
- **Component**: `src/components/Operations/modules/OperationsCommandCenter.tsx` — DB-integrated, no mock state. Shared portal design language (PageHeader, SectionCard, StatCard, Badge, brandTheme tokens) matching the HK/Engineering modules. Features: Live/Pause toggle driving a 30s polling loop + manual Refresh (silent background refresh keeps data on screen), 4 KPI StatCards, a 12-card Live Department Status grid where each card clicks through to that department's portal (`/erp/:segment/:defaultTab`), Live Alerts feed with search + severity filter + per-row Acknowledge (optimistic update + rollback on failure). Loading spinner / error-with-retry / empty states surfaced. Property-scoped via `currentPropertyId` from `useERP`.
- **Note**: The legacy `/api/ops/*` routers (`operationsPortal`, `operationsAI`, `operationsIoT`, `operationsOptimization`, `operationsAnalytics`, `operationsSupplyChain`, `operationsHousekeeping`, `operationsSafety`) were **removed** — they referenced ~35 tables (`operations_tasks`, `incidents`, `iot_sensors`, `staff_schedules`, `safety_incidents`, etc.) with no migrations and had no frontend or mobile consumers. `SYSTEM_FEATURES_ROADMAP.md` previously listed them as "COMPLETE"; those entries are aspirational, not implemented.

## Operations Portal — Daily Briefing Integration

- **Migration 628** (`628_ops_daily_briefing.sql`) must be applied for the `/erp/operations/daily-briefing` tab:
  - Adds `public.ops_daily_briefings` (id TEXT `brief-{propertyId|all}-{YYYY-MM-DD}`, property_id, briefing_date, data JSONB, generated_by, timestamps + trigger, UNIQUE(property_id, briefing_date), RLS + authenticated grants).
  - Stores *generated* briefing snapshots only — the briefing itself is always computed from the other portals' live tables; the table exists so a generated date can be revisited later.
- **Routes** (`src/server/routes/operationsDailyBriefing.routes.ts`, also mounted at `/api/ops-portal`):
  - `GET  /daily-briefing?propertyId=&date=` — returns the persisted snapshot for that date if one exists (`persisted:true` + generated_by), else computes live (`persisted:false`). Cached 20s per property+date.
  - `POST /daily-briefing/generate` `{propertyId, date}` — recomputes live and upserts the snapshot (onConflict id), invalidates the GET cache.
  - Aggregation sources (all non-fatal, all property-scoped — every one of these tables has `property_id` in the live schema): `rooms` + `reservations` (occupancy, arrivals/departures, VIPs via `guests.status='VIP'` joined on `reservations.guest_id`), `housekeeping_task_mgmt` type=`VIP Preparation` (VIP rooms without a matching reservation), `group_blocks` + `reservations.is_group` (group arrivals), `banquet_events` + `banquet_venues` (events incl. multi-day spans + venue names), `work_orders` + `corrective_maintenance_tasks` (maintenance impacts, priority-sorted), `transport_airport_transfers` (flights/transfers for the date), `hk|fo|fb_shift_requirements` + `eng_tech_shifts` + `sec_shift_defs` (staffing coverage — `sec_shift_defs` has no `assigned_staff`, shown as "Not tracked"), `orders` + `spa_appointments` + `banquet_events` estimated/actual revenue (yesterday actual vs. today forecast), `ops_command_alerts` status=`Active` (outstanding issues).
- **Frontend service**: `src/services/operationsService.ts` — `fetchDailyBriefing(propertyId, date)`, `generateDailyBriefing(propertyId, date)` + `DailyBriefing*` types.
- **Component**: `src/components/Operations/modules/DailyBriefing.tsx` — DB-integrated, no mock state. Same shared design language as the command center. Features: date picker (saved dates show a "Saved snapshot" badge with generated-by; unsaved dates show "Live data"), "Generate & Save" persists the snapshot, real Download (Markdown file via Blob) and Share (clipboard) actions, 4 KPI StatCards, sections for VIP arrivals / events / group arrivals / maintenance impacts / airport transfers & flight status / staffing coverage bars / outstanding issues. The old mock-only sections with no data source (weather, generic flight-delay feed) were dropped in favor of `transport_airport_transfers` flight status.
- **Caveat**: demo data rows with `property_id NULL` (e.g. some seeded `CheckedIn` reservations) are excluded when `?propertyId=` is passed — consistent with every other property-scoped query. (Most of these were backfilled by migration 630.)

## Operations Portal — Morning Meeting Integration

- **Migration 629** (`629_ops_morning_meeting.sql`) must be applied for the `/erp/operations/morning-meeting` tab:
  - Adds `public.ops_meeting_agenda_items` (id, property_id, meeting_date, category, title, description, priority `low|medium|high`, status `pending|in-progress|completed`, assigned_to, estimated_time, notes, sort_order, source `template|manual`, created_by, timestamps + trigger, RLS + authenticated grants).
- **Routes** (`src/server/routes/operationsMorningMeeting.routes.ts`, also mounted at `/api/ops-portal`):
  - `GET    /morning-meeting?propertyId=&date=` — live metrics + persisted agenda. On first view of a date the standard 10-item template agenda is auto-seeded with deterministic `mtg-{prop}-{date}-tpl-{i}` ids (upsert ignoreDuplicates → concurrency-safe), descriptions filled from live counts. Cached 20s, invalidated on mutations.
  - `POST   /morning-meeting/items` / `PATCH /morning-meeting/items/:id` / `DELETE /morning-meeting/items/:id` — agenda CRUD.
  - Metrics: yesterday occupancy / revenue (orders + spa completed + banquet actual) / ADR (avg `reservations.rate` of occupied rooms) / satisfaction (30-day avg `guest_feedback.rating`); today's expected occupancy, arrivals, departures, VIP arrivals (`guests.status='VIP'` join).
- **Frontend service**: `src/services/operationsService.ts` — `fetchMorningMeeting`, `createAgendaItem`, `updateAgendaItem`, `deleteAgendaItem` + `MorningMeeting*` types.
- **Component**: `src/components/Operations/modules/MorningMeetingDashboard.tsx` — DB-integrated, no mock state. Shared design language (PageHeader/SectionCard/StatCard/Badge). Date picker, 4 KPI StatCards, agenda checklist with checkbox completion toggle (optimistic + rollback), expandable items with notes editing (saves on blur in edit mode), Edit Agenda mode for add/delete, completion progress bar. Currency via `formatAmount` from `useERP`.

## Operations Portal — Manager Approval Center Integration

- **Migration 632** (`632_ops_approval_center.sql`) must be applied for the `/erp/operations/approvals` tab:
  - Adds `public.ops_approval_requests` (id, property_id, type, category, department, title, description, amount, requested_by, urgency `low|medium|high|critical`, status `pending|approved|rejected|escalated`, details JSONB, decided_by/at/notes, timestamps + trigger, RLS + authenticated grants) — ops-native requests only.
  - Seeds the 6 mock rows previously hardcoded in `ManagerApprovalCenter.tsx` (`ops-apr-seed-001..006`).
- **Routes** (`src/server/routes/operationsApprovalCenter.routes.ts`, mounted at `/api/ops-portal`):
  - `GET  /approvals?propertyId=` — aggregates requests from the *real* department tables into one normalized inbox: `fin_approval_requests` (multi-level finance workflow), `fin_journal_approvals`, `hr_approval_requests`, `hr_manager_approvals`, `hr_overtime_requests`, `uinv_approval_requests`, plus `ops_approval_requests`. Statuses normalized (mixed-case `Pending|Approved|Rejected` in the source tables → lowercase). Sorted pending-first, then urgency, then recency. Cached 15s, invalidated on decisions.
  - `POST /approvals/:source/:id/decide` `{decision: approve|reject|escalate, notes?}` — writes the decision **back to the source table** so the originating portal sees it resolved. Per-source field mapping: fin→`status`+`approved_by/at`/`rejected_by/at`+`rejection_reason`; fj→`Approved|Rejected`; hr→`request_status`+`approved_date/by`/`rejected_date/by`+`reason`; hrm→`status`; ot→`status`+`reviewed_by/at`; uinv→`status`+`approver`+`approved_at`+`decision_notes`; ops→`status`+`decided_*`.
  - **Escalation** is only supported where the model allows it: `fin` advances `current_level` (rejects at final level); `ops` sets `status='escalated'`. All other sources return 400 and report `canEscalate=false` to the UI.
- **Frontend service**: `src/services/operationsService.ts` — `fetchOpsApprovals`, `decideApproval` + `OpsApprovalRequest`/`ApprovalUrgency`/`ApprovalStatus`/`ApprovalDecision` types.
- **Component**: `src/components/Operations/modules/ManagerApprovalCenter.tsx` — DB-integrated, no mock state. Shared design language (PageHeader/SectionCard/StatCard/Badge/brandTheme). 4 KPI StatCards, search + status + department filters, master-detail list, detail panel with decision-notes textarea + Approve/Reject/Escalate (Escalate hidden when `canEscalate=false`), optimistic update + rollback. Amounts via `formatAmount`.
- **Not aggregated** (by design): `expense_approval_workflows` and `proc_approval_delegations` are config tables, `void_audit_log` is audit history, `fb_discount_records`/`rms_daily_rate_overrides`/`uinv_manual_par_overrides` lack request/status semantics.

## Operations Portal — Duty Manager Workspace Integration

- **Migration 633** (`633_ops_duty_manager.sql`) must be applied for the `/erp/operations/duty-manager` tab:
  - `ops_shift_log_entries` (property_id, shift_date, shift `Morning|Afternoon|Evening|Night`, category, description, author, priority `low|medium|high`) — seeded with the 4 former mock logbook entries.
  - `ops_walkthrough_items` (property_id, shift_date, shift, area, item, status `pending|completed|issue`, notes, completed_at/by, sort_order) — seeded with the 9 former mock checklist items.
  - `ops_shift_handovers` (property_id, shift_date, from_shift, to_shift, managers, summary, open_items JSONB, acknowledged_at/by) — seeded with the 1 former mock handover.
  - All: `updated_at` triggers, RLS, authenticated grants.
- **Routes** (`src/server/routes/operationsDutyManager.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /duty-manager?propertyId=&shift=&date=` — shift-scoped logbook + walkthrough, cross-shift live views of Guest Issues (real `guest_requests` — same records as the FO portal) and Incidents (real `sec_incidents`), last 20 handovers. Walkthrough auto-seeds the standard 9-item template only when a shift+date has **zero** items (deterministic `ops-walk-{prop}-{date}-{shift}-{i}` ids). Statuses normalized: guest_requests `Open|Assigned|In Progress|Completed` → `open|in-progress|resolved`; sec_incidents `Pending|Active|Investigation|In Progress|Corrective Action|Resolved|Closed` → `open|investigating|resolved`; `priority` → `minor|moderate|major|critical` severity. Cached 15s, invalidated on mutations.
  - `POST /duty-manager/log` — append logbook entry (author = session user).
  - `PATCH /duty-manager/walkthrough/:id` — set `pending|completed|issue` + notes; sets/clears completed_at/by.
  - `POST /duty-manager/handovers` — creates handover; `open_items` **auto-collected** from open guest requests, unresolved incidents, and this shift's walkthrough issues.
  - `POST /duty-manager/handovers/:id/acknowledge` — sets acknowledged_at/by.
- **Frontend service**: `src/services/operationsService.ts` — `fetchDutyManager`, `addShiftLogEntry`, `updateWalkthroughItem`, `createHandover`, `acknowledgeHandover` + `Duty*`/`DutyShift` types.
- **Component**: `src/components/Operations/modules/DutyManagerWorkspace.tsx` — DB-integrated, no mock state. Shared design language (PageHeader/SectionCard/StatCard/Badge/brandTheme). Date + shift pickers, 4 KPI StatCards, tab badges with live counts, add-entry logbook form, walkthrough 3-state toggles (optimistic + refetch), handover create form (from→to shift derived from picker) + acknowledge action.

## Operations Portal — Cross-Department Task Center Integration

- **Migration 634** (`634_ops_cross_dept_tasks.sql`) must be applied for the `/erp/operations/cross-department-tasks` tab:
  - Adds `public.ops_cross_dept_tasks` (id, property_id, title, description, type `vip-arrival|wedding|conference|emergency|maintenance|renovation|other`, priority, status `planning|in-progress|completed|on-hold`, `departments` JSONB `[{department,status,lead}]` with status `pending|in-progress|completed|on-hold`, start_at/end_at, `source_ref`, created_by, timestamps + trigger, RLS + grants).
  - Seeds the 5 mock tasks previously hardcoded in `CrossDepartmentTaskCenter.tsx`.
- **Routes** (`src/server/routes/operationsCrossDeptTasks.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /cross-dept-tasks?propertyId=` — persisted tasks (progress derived server-side = % departments completed) + a live **suggestions** feed detected across portals: upcoming `banquet_events` (Confirmed/InProgress/Planning/Tentative; Wedding→wedding, Conference/Meeting/etc→conference), VIP `reservations` (join `guests.status='VIP'`, arrivals within 3 days), `group_blocks` checking in within 3 days, and Emergency-priority `work_orders`. Each suggestion has a `sourceRef` (`banquet/<id>`, `reservation/<id>`, `group-block/<id>`, `work-order/<id>`); already-adopted refs are suppressed. Cached 15s, invalidated on mutations.
  - `POST /cross-dept-tasks` — create; `POST /cross-dept-tasks/adopt {sourceRef}` — re-derives the live suggestion server-side and persists it (409 if already adopted); `PATCH /cross-dept-tasks/:id` — status/priority/dates or `departmentUpdate:{department,status}` merged into the departments JSONB; `DELETE /cross-dept-tasks/:id`.
- **Frontend service**: `src/services/operationsService.ts` — `fetchCrossDeptTasks`, `createCrossDeptTask`, `adoptCrossDeptSuggestion`, `updateCrossDeptTask`, `deleteCrossDeptTask` + `CrossDept*` types.
- **Component**: `src/components/Operations/modules/CrossDepartmentTaskCenter.tsx` — DB-integrated, no mock state. Shared design language. 4 KPI StatCards, "Detected Coordination Needs" suggestion cards with Adopt buttons + source-portal badges, New Task form with department chips, filters, master-detail list; detail panel has click-to-advance per-department status (pending→in-progress→completed), Start/Complete/Hold/Resume/Delete actions.

## Operations Portal — Operational Calendar Integration

- **Migration 635** (`635_ops_calendar_events.sql`) must be applied for the `/erp/operations/calandar` tab:
  - Adds `public.ops_calendar_events` (id, property_id, title, event_date, end_date, type `conference|wedding|holiday|vip|maintenance|promotion|drill|training|audit|event|group|task`, location, attendees, description, source_ref, created_by, timestamps + trigger, RLS + grants).
  - Seeds only the mock rows with no live source (holiday, drill, training, audit, promotion, VIP visit) — the mock conference/wedding/vip/maintenance items are NOT seeded because real equivalents exist in `banquet_events`/`reservations`/`pm_schedules`.
- **Routes** (`src/server/routes/operationsCalendar.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /operational-calendar?propertyId=&date=&from=&to=` — aggregates 10 sources into one normalized `{id,title,date,endDate,type,location,attendees,description,source,editable}` feed for the window (defaults: month of `date` ± 7 days): `banquet_events` (venue names resolved via `banquet_venues.venue_name` — NOT `.name`), VIP `reservations` (join `guests.status='VIP'` via `guest_id`), `pm_schedules.next_due_date` (status='Active'), `hr_training_sessions.session_date`, `fb_promotions`/`rms_promotions`/`sales_promotions` (start/end range overlap), `sec_compliance_audits.scheduled_at`, `fin_external_audits.start_date`, `group_blocks.arrival_date`, `ops_cross_dept_tasks.start_at`, `ops_calendar_events`. Cached 20s, invalidated on mutations.
  - `POST/PATCH/DELETE /operational-calendar/events[/:id]` — CRUD for ops-native events only (`cal-*` rows; portal-sourced rows are read-only projections).
- **Frontend service**: `src/services/operationsService.ts` — `fetchOpsCalendar`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` + `OpsCalendarEvent`/`CalendarEventType` types.
- **Component**: `src/components/Operations/modules/OperationalCalendar.tsx` — DB-integrated, no mock state. Shared design language. Real month grid (padded weeks, today ring, +N overflow), functional Week view (7-column cards) and Day view (list) — the mock's view buttons were dead. Type filter, Add Event form, detail modal (Delete only for `editable` ops rows), source legend strip, 4 KPI StatCards.

## Operations Portal — VIP Guest Management Integration

- **Migration 636** (`636_ops_vip_profiles.sql`) must be applied for the `/erp/operations/vip-management` tab:
  - Adds `public.ops_vip_profiles` (id, property_id, guest_id UNIQUE → guests.id text, category CHECK `VIP|VVIP|Loyalty Elite|Corporate Executive|Government Official|Celebrity`, butler, notifications, notes, RLS + grants). Seed assigns profiles to existing VIP/Loyalty guests.
- **Routes** (`src/server/routes/operationsVipGuests.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /vip-guests?propertyId=` — VIP roster from `guests.status IN ('VIP','Loyalty Member')`, joined to best `reservations` row (in-house > upcoming > recent) for room/dates/stay status, `ops_vip_profiles` overrides, open `guest_requests` (matched by reservation_id or guest_name), `transport_airport_transfers` + `spa_appointments` (guest_id), and `housekeeping_task_mgmt` VIP-prep tasks (location match). `guests.preferences`/`special_requests` normalized to string[].
  - `POST /vip-guests` — inserts a `guests` row (status='VIP') + profile. NOTE: `guests.email` is NOT NULL — route defaults to `gst-*@guest.local`.
  - `PATCH /vip-guests/:guestId/profile` — upserts ops_vip_profiles.
  - `POST /vip-guests/:guestId/requests` — inserts a real `guest_requests` row (priority High, dept FO) linked to the guest's active reservation — visible in the FO concierge queue.
- **Frontend service**: `operationsService.ts` — `fetchVipGuests`, `createVipGuest`, `updateVipProfile`, `createVipRequest` + `VipGuest`/`VipCategory` types.
- **Component**: `VIPGuestManagement.tsx` — DB-integrated, no mock state. Shared design language. 4 KPI StatCards, Add VIP form, category/status/search filters, master-detail; detail panel shows live cross-portal activity (open requests, transfers, spa, HK prep), a "Send to Concierge" request form, and the editable ops profile (category/butler/notes/notifications).

## Operations Portal — Guest Recovery Integration

- **Migration 637** (`637_ops_recovery_cases.sql`) must be applied for the `/erp/operations/guest-recovery` tab:
  - Adds `public.ops_recovery_cases` (id, property_id, guest_name, room_number, complaint, category CHECK 8 values, status CHECK `logged→investigating→compensation-pending→corrective-action→follow-up→guest-confirmation→closed`, priority, assigned_to, compensation_amount, corrective_action, follow_up_date, `feedback_id` → guest_feedback, `work_order_id` → work_orders, closed_at, RLS + grants). Seeds the 4 former mock cases.
- **Routes** (`src/server/routes/operationsGuestRecovery.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /guest-recovery?propertyId=` — cases + `feedbackQueue` (guest_feedback rating ≤ 3 with no linked case, deduped by feedback_id; guest names/rooms resolved via guests/reservations) + linked WO status per case.
  - `POST /guest-recovery` — create case. `POST /guest-recovery/from-feedback` — one-click case from a feedback row (409 on dup).
  - `PATCH /guest-recovery/:id` — status/fields; `closed` stamps `closed_at`.
  - `POST /guest-recovery/:id/work-order` — inserts a real `work_orders` row (type Corrective, room from case) visible in the Engineering portal, links `work_order_id`, auto-adances logged/investigating → corrective-action.
  - `DELETE /guest-recovery/:id`.
- **Frontend service**: `operationsService.ts` — `fetchGuestRecovery`, `createRecoveryCase`, `createRecoveryFromFeedback`, `updateRecoveryCase`, `createRecoveryWorkOrder`, `deleteRecoveryCase` + types.
- **Component**: `GuestRecovery.tsx` — DB-integrated, shared design language. 4 KPI StatCards, complaint-intake queue (Open Case buttons), 7-stage status stepper, editable assignee/compensation/corrective-action/follow-up, Create Work Order button (Maintenance/Facilities), status advance buttons, delete.

## Operations Portal — Service Quality Integration

- **Migration 638** (`638_backfill_fb_property_id.sql`) must be applied — adds `property_id` to `fb_guest_feedback` (column didn't exist) and backfills NULL `property_id` on `fb_quality_service_standards`, `fb_compliance_audits`, `fb_guest_feedback` (same convention as 630).
- **Routes** (`src/server/routes/operationsServiceQuality.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**, pure aggregation:
  - `GET /service-quality?propertyId=&period=week|month|quarter` — 8 live metrics: Guest Satisfaction (guest_feedback + guest_feedbacks + fb_guest_feedback + banquet_event_feedback + guest_requests.rating), Room Inspection Pass Rate (room_inspections Pass/Fail — `inspection_date` is TEXT 'YYYY-MM-DD HH:MM', filterable lexically), F&B Standards (fb_quality_service_standards score/max_score), F&B Audits (fb_compliance_audits), Concierge Response (guest_requests submitted_at→completed_at hours, lowerIsBetter), Request Completion, Engineering Inspections, Safety & Compliance (sec_compliance_audits + sec_safety_inspections results). Trend compares the window vs the prior equal window. Audit feed normalizes fb_compliance_audits / sec_compliance_audits / sec_safety_inspections / eng_inspections / room_inspections (per-item % from `items` jsonb).
  - `POST /service-quality/audits` — schedules a real `sec_compliance_audits` row. NOTE: its `audit_type` CHECK only allows `External|Internal|Regulatory|Insurance` — the route uses `Internal` and puts "Quality Standards" in `scope`.
- **Frontend service**: `operationsService.ts` — `fetchServiceQuality`, `scheduleQualityAudit` + types.
- **Component**: `ServiceQualityManagement.tsx` — DB-integrated, shared design language. 4 KPI StatCards, period selector (refetches), department chips, metric cards with unit-aware scores (rating/percent/hours) + trend icons + sample sizes, audit feed with dept/status/score, Run Audit form.

## Operations Portal — Room Operations Integration

- **Routes** (`src/server/routes/operationsRoomOps.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**; `rooms` is the shared source of truth:
  - `GET /room-operations?propertyId=` — all rooms (columns are `number`/`type`, NOT room_number/room_type) with `status` normalized to board buckets (occupied/dirty/clean/inspected/vacant/out-of-order/out-of-service/maintenance; rawStatus preserved), enriched per room: CheckedIn reservations → guest, housekeeping_task_mgmt by `location='Room N'`, work_orders by room_number, latest room_inspections, open guest_requests, `needsAttention` flag.
  - `PATCH /room-operations/rooms/:id` — writes `rooms.status` (shared with the FO room rack and HK board). Valid vocabulary: `Occupied Clean|Occupied Dirty|Vacant Clean|Vacant Dirty|Inspected|Out of Order|Out of Service|Maintenance`.
  - `POST /room-operations/rooms/:id/cleaning-task` — real `housekeeping_task_mgmt` row. NOTE: `category` CHECK = `Manual|Automatic` only; `priority` CHECK = `Low|Medium|High|Critical` (no 'Normal'); type uses HK vocabulary (Room Refresh / Stayover Service).
  - `POST /room-operations/rooms/:id/work-order` — real `work_orders` row (Engineering portal).
- **Frontend service**: `operationsService.ts` — `fetchRoomOperations`, `setRoomStatus`, `createRoomCleaningTask`, `createRoomWorkOrder`, `ROOM_STATUS_OPTIONS` + types.
- **Component**: `RoomOperationsOverview.tsx` — DB-integrated room board. 5 KPI StatCards, status chips (click-to-filter), floor/status/search filters, color-coded tile grid, detail panel with guest/HK-task/WO/inspection/request enrichment, status dropdown (persists to rooms), Request Cleaning + New Work Order actions.

## Operations Portal — Occupancy Forecast Integration

- **Routes** (`src/server/routes/operationsOccupancyForecast.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**, pure computation:
  - `GET /occupancy-forecast?propertyId=&days=` — per-day forecast for [today-1, today+days): `rooms` (sellable = total minus OOO/OOS/Maintenance), `reservations` (live statuses only; booked room-nights, arrivals on check_in_date, departures on check_out_date), `group_blocks` (blocked_rooms added on top). Revenue/night = `reservations.rate` → fallback `total_amount/nights` → `rooms.rate` → portfolio avg. Returns `today` snapshot with vs-yesterday deltas and `upcomingGroups`.
- **Frontend service**: `operationsService.ts` — `fetchOccupancyForecast` + `OccupancyForecastOverview`/`OccupancyDay` types.
- **Component**: `OccupancyForecastMonitor.tsx` — DB-integrated. 4 KPI StatCards (today occupancy, available, arrivals, departures with yesterday deltas), delta strip (avg rate via `formatAmount`, OOO count), upcoming group-blocks badges, forecast rows with transient+group breakdown and per-night revenue. Today/7-day/30-day views.

## Operations Portal — Event & Group Coordination Integration

- **Routes** (`src/server/routes/operationsEventCoordination.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**; `banquet_events` + `group_blocks` are the sources of truth:
  - `GET /event-coordination?propertyId=` — banquet_events (venue names resolved via `banquet_venues`, per-event `banquet_checklists` rollup, linked `ops_cross_dept_tasks` via `source_ref='banquet/{id}'`) + `group_blocks` projected as group-checkin/group-checkout entries. Status vocabulary mapped to the board: Inquiry/Tentative/Planning→planning, Confirmed→setup, InProgress→in-progress, Completed→completed.
  - `POST /event-coordination/events` — creates a real `banquet_events` row (Events portal sees it).
  - `PATCH /event-coordination/events/:id` — status/coordinator/attendees/notes.
  - `POST /event-coordination/events/:id/coordination-task` — creates a linked `ops_cross_dept_tasks` row (409 on duplicate via source_ref).
  - `PATCH /event-coordination/checklists/:id` — toggles `banquet_checklists.is_completed`.
- **`banquet_events` is a VIEW over `event_bookings`** — inserts/updates pass through to the base table. Do NOT write explicit NULLs for view columns mapped to NOT NULL base columns (e.g. `estimated_revenue`→`quoted_amount`, `guest_count`→`expected_attendance`); an explicit NULL bypasses the column default and violates the constraint. Omit unset fields instead.
- **Frontend service**: `operationsService.ts` — `fetchEventCoordination`, `createCoordinationEvent`, `updateCoordinationEvent`, `createEventCoordinationTask`, `toggleChecklistItem` + `BANQUET_EVENT_STATUSES`.
- **Component**: `EventGroupCoordination.tsx` — DB-integrated. 4 KPI StatCards, Add Event form (real banquet_events insert), type/status/search filters, master-detail board; detail panel shows venue/attendees/revenue/departments, clickable banquet checklist toggles, status dropdown (writes banquet_events.status), and Create Coordination Task (links into the Cross-Dept tab).

## Operations Portal — Emergency Coordination Integration

- **Routes** (`src/server/routes/operationsEmergency.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**; shares the Security portal's emergency tables so alerts raised in Ops appear in `/erp/security` SOC Emergency and vice-versa:
  - `GET /emergency?propertyId=` — `sec_emergency_notifications` with `sec_emergency_responses` timelines + a critical-incidents watch list (`sec_incidents`, Critical/High open).
  - `POST /emergency` — raise alert (+ 'Alert Raised' response log). `PATCH /emergency/:id` — status/priority/commander/responseTeam/evacuation with auto-logged response entries. `POST /emergency/:id/responses` — timeline entry. `POST /emergency/escalate-incident` — promotes a `sec_incidents` row to a full emergency (incident → In Progress).
- **CHECK vocabularies** (verified live): `sec_emergency_notifications.status` = Active/In Progress/Scheduled/Resolved only (no Contained/Cancelled); `sec_emergency_responses.action` = Alert Raised/Team Dispatched/Commander Assigned/Evacuation Ordered/Evacuation Complete/Status Update/All Clear/Resolved/Note — free-form entries must be logged as `Note` with detail.
- **Frontend service**: `operationsService.ts` — `fetchOpsEmergencies`, `raiseEmergency`, `updateEmergency`, `addEmergencyResponse`, `escalateIncidentToEmergency` + `EMERGENCY_STATUS_OPTIONS`/`EMERGENCY_PRIORITY_OPTIONS`/`EVACUATION_OPTIONS`.
- **Component**: `EmergencyCoordination.tsx` — DB-integrated. 4 KPI StatCards, quick-report strip (Fire/Medical/Security/Evacuation pre-fills the form), report form, critical-incidents watch list with Escalate buttons, master-detail board with status/evacuation dropdowns, Set Commander, and a live response timeline with note entry.

## Operations Portal — Communication Center Integration

- **Routes** (`src/server/routes/operationsCommunication.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**; unified feed across every portal's messaging tables:
  - `GET /communication?propertyId=` — normalized feed from `communications` (FO shared, no property_id column), `housekeeping_communication_messages`, `eng_communication_messages`, `sec_messages`, `fb_kitchen_messages`, and `notifications` (system alerts).
  - `POST /communication` — sends broadcast/department/direct via `communications` (channel='ops'); broadcasts + department sends also write a `notifications` row so they ring the bell.
  - `PATCH /communication/:source/:id/read` — marks read in the *originating* portal table (each source has a different read flag: communications.status, hk.unread, eng.read_at, sec.status='Read', notifications.read).
- **Frontend service**: `operationsService.ts` — `fetchOpsCommunication`, `sendOpsMessage`, `markCommRead` + `CommMessage`/`CommSource` types.
- **Component**: `OperationalCommunicationCenter.tsx` — DB-integrated. 4 KPI StatCards, All/Chat/Broadcasts/Department tabs, per-source filter + search, compose form (broadcast/department/direct), unread highlighting with per-message mark-read that writes back to the source portal.

## Operations Portal — Escalation Center Integration

- **Migration `639_ops_escalations.sql`** — `ops_escalations` table (type/severity/status CHECKs, `source_ref` UNIQUE dedup, lifecycle timestamps, RLS + grants). **Applied.**
- **Routes** (`src/server/routes/operationsEscalations.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /escalations?propertyId=` — persisted escalations + **live auto-detected candidates** from `work_orders` (Emergency open, or High open >24h → equipment-failure), `guest_requests` (Urgent open, or High open >4h → guest-complaint), `sec_incidents` (Critical open → high-risk-incident), `housekeeping_task_mgmt` (Critical pending or High/Critical past `due_date` → sla-violation/delayed-task), `ops_recovery_cases` (stuck >24h → guest-complaint). Adopted `source_ref`s are suppressed.
  - `POST /escalations` (manual), `POST /escalations/adopt` (persist candidate, 409 dedup, +2h SLA), `PATCH /:id` (open→acknowledged→in-progress→resolved with acknowledged_at/resolved_at), `DELETE /:id`.
- **`ops_recovery_cases` column is `complaint`**, not `issue` (route uses `complaint`).
- **Frontend service**: `operationsService.ts` — `fetchOpsEscalations`, `createEscalation`, `adoptEscalation`, `updateEscalation`, `deleteEscalation` + types.
- **Component**: `EscalationCenter.tsx` — DB-integrated. 4 KPI StatCards, auto-detected candidate feed with Adopt buttons, manual-create form, status/type filters, tracked-escalation cards with lifecycle advance buttons + overdue highlighting + resolution notes.

## Operations Portal — SOP Compliance Integration

- **Routes** (`src/server/routes/operationsSopCompliance.routes.ts`, mounted at `/api/ops-portal`) — **no new tables**; aggregates each portal's compliance register:
  - `GET /sop-compliance?propertyId=` — normalized items from `sec_compliance_items` (Security), `eng_compliance_items` (Engineering), `risk_compliance` (Risk), `fb_service_standards` (F&B), `fin_compliance_issues` (Finance open = non-compliant), plus a unified audit feed from `sec_compliance_audits` + `fb_compliance_audits`. Overall score = % compliant.
  - `PATCH /sop-compliance/:source/:id` — writes normalized status back to the source table using a per-source vocabulary map (security: Compliant/Non-Compliant/Pending; engineering: Valid/Overdue/Scheduled; risk: Good/Critical/Warning) and stamps last_audit.
  - `POST /sop-compliance/audit` — records a real `sec_compliance_audits` row (audit_type='Internal') and stamps the linked item's last-audit date.
- **Frontend service**: `operationsService.ts` — `fetchSopCompliance`, `setComplianceStatus`, `recordComplianceAudit` + types.
- **Component**: `SOPComplianceMonitoring.tsx` — DB-integrated. 4 KPI StatCards (overall score, compliant/non-compliant/pending), department + status filters, item cards with score bars, findings, expiry dates, and per-source status write-back buttons; audit feed; Record Audit form.

## Operations Portal — Executive Checklists Integration

- **Migration 640** (`640_ops_exec_checklists.sql`) — `ops_exec_checklists` recurring-checklist templates (frequency CHECK daily/weekly/monthly, `started_at`/`completed_at`/`completed_by`, RLS + grants). Seeded with the 9 former mock items.
- **Routes** (`src/server/routes/operationsExecChecklists.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /executive-checklists?propertyId=` — templates with **effective status derived from frequency vs. current period** (daily=today, weekly=ISO week, monthly=calendar month): `completed_at` in period → completed, `started_at` → in-progress, else pending — auto-reset without cron. Each item also gets a live cross-portal `context` line from category: open guest_requests (walkthrough), open work_orders + failed room_inspections (inspection), Critical/High sec_incidents (safety), open ops_escalations (review), Scheduled sec_compliance_audits (audit), non-Good risk_compliance (compliance).
  - `POST /executive-checklists`, `PATCH /:id` (action `start`|`complete`|`reset` or field edits), `DELETE /:id`.
  - **Schema note**: `sec_incidents` uses `priority` (not `severity`); `room_inspections` uses `result` (not `overall_result`) — values Pass/Pending/Fail.
- **Frontend service**: `operationsService.ts` — `fetchExecutiveChecklists`, `createExecutiveChecklist`, `updateExecutiveChecklist`, `deleteExecutiveChecklist` + types.
- **Component**: `ExecutiveChecklists.tsx` — DB-integrated. 4 KPI StatCards (completion %, completed/in-progress/pending), working frequency tabs + status filter + search, per-item live context line, Start/Complete/Reset actions, create form, delete.

## Operations Portal — Daily Flash Reports Integration

- **Migration 641** (`641_ops_flash_reports.sql`) — `ops_flash_reports` persisted report snapshots (type, period_date, generated_by, status CHECK, `payload` JSONB).
- **Routes** (`src/server/routes/operationsFlashReports.routes.ts`, mounted at `/api/ops-portal`):
  - `GET /flash-reports?propertyId=` — report archive list (metadata only).
  - `GET /flash-reports/:id` — full stored payload.
  - `POST /flash-reports` — generates a report: `computeSnapshot()` pulls live data from 13 sources (rooms, reservations, guests-VIP, housekeeping_task_mgmt, work_orders, guest_requests, sec_incidents, sec_emergency_notifications, banquet_events, group_blocks, ops_escalations, ops_recovery_cases, guest_feedback) into 8 sections; `SECTIONS_BY_TYPE` picks the subset per report type (daily-operations gets all, morning-flash gets occupancy/safety/escalations/events, etc.). Persisted as a snapshot.
  - `DELETE /flash-reports/:id`.
  - **Schema notes**: `work_orders` uses `created_date`/`completed_at` (no `created_at`); `ops_recovery_cases` uses `compensation_amount`; `reservations` has no `vip` column — VIP arrivals matched via `guests.status IN ('VIP','Loyalty Member')` by guest_name.
- **Frontend service**: `operationsService.ts` — `fetchFlashReports`, `fetchFlashReport`, `generateFlashReport`, `deleteFlashReport` + `FlashReportPayload`/`FlashReportSection` types.
- **Component**: `DailyFlashReports.tsx` — DB-integrated. 4 KPI StatCards, generate form with 9 report types, report archive list with view/delete, and a full report viewer rendering metric grids (revenue formatted via `formatAmount`) + highlights, with print support.
- **Column fixes in earlier routes** (found via dev-server warnings): `ops_cross_dept_tasks` has no `progress` column (progress derived from status), `group_blocks` has no `contact_name`, `fb_service_standards` has no `property_id` (unscoped in SOP route).

## Operations Portal — Reports Integration (mimics HK reports)

- **Migration 642** (`642_ops_reports.sql`) — `ops_reports` registry mirroring `hk_reports` (category CHECK operations/guest/approval/executive, status/format CHECKs, `last_run`, plus a `summary` JSONB of live metrics captured per run). Seeded with the 17 former mock report definitions.
- **Routes** (`src/server/routes/operationsReports.routes.ts`, mounted at `/api/ops-portal`) — same shape as `/api/hk-portal/reports`:
  - `GET /reports` (?category= ?propertyId=), `GET /reports/stats`, `GET /reports/:id`, `PATCH /reports/:id` (frequency/format/status).
  - `POST /reports/:id/run` and `POST /reports/run-all` — compute `computeCounters()` across ~18 live tables (rooms, reservations, VIP guests, HK tasks, work_orders, guest_requests, sec_incidents, emergencies, banquet_events, escalations, recovery cases, cross-dept tasks, room_inspections, fb_service_standards, guest_feedback, shift log, 4 approval tables) and store a per-report `summary` metric set (`REPORT_METRICS` map) + stamp `last_run`/`Ready`. Failed runs mark status `Failed`.
  - **Schema notes**: `guest_requests` uses `request_type` (not `type`); `ops_escalations` SLA column is `due_by`; approval decision timestamps differ per table (`decided_at`/`approved_at`/`rejected_at`).
- **Frontend service**: `operationsService.ts` — `fetchOpsReports`, `fetchOpsReportStats`, `runOpsReport`, `runAllOpsReports`, `updateOpsReport` + types.
- **Component**: `Reports.tsx` — DB-integrated clone of `HKReportsModule`: period selector (Today/WTD/MTD/YTD/Custom), 4 KPI StatCards, search, category-grouped report cards, Run / Run All, Schedule modal (PATCH frequency/format/status), View modal showing the stored live-metrics summary, Download via `reportExportUtils` (embeds the summary). `addNotification` department tag is `'Executive'` (the union has no 'Operations').

## Operations Portal — Configuration Integration

- **Migration 643** (`643_ops_config.sql`) — new `ops_config` table mirroring the `hk_config` pattern (`id`, `property_id`, `section`, `data` JSONB, `updated_by`, timestamps; RLS + grants). Seeded with 6 sections: `shift-types`, `alert-thresholds`, `notification-rules`, `escalation`, `reports`, `duty-manager`.
- **Routes** (`src/server/routes/operationsConfiguration.routes.ts`, mounted at `/api/ops-portal`) — four sources in one overview:
  - `GET /configuration?propertyId=` — returns `{ approvalLevels, opsConfig, globalSettings, deptConfigs }`.
  - Approval Matrix → `fin_approval_levels` (the real shared matrix Finance uses): `POST /configuration/approval-levels`, `PATCH /configuration/approval-levels/:id` (name/level/spending_limit/approvers/requires_unanimous/status/description), `DELETE /configuration/approval-levels/:id`. Live rows: Department Manager L1 (50k), Finance Controller L2 (250k), CFO/GM L3 (1M).
  - Ops Settings → `PUT /configuration/section/:section` upserts the JSONB `data` blob (conflict target is `id` — `(property_id,section)` unique doesn't match NULL property_ids; the route generates a deterministic id).
  - Global Settings → `PATCH /configuration/global` updates a **whitelist** (`GLOBAL_FIELDS`) of ~40 `global_settings` columns on the singleton `id='main'` row — check-in/out times, tax/service-charge %, exchange rate, session timeout, night audit, VIP threshold, booking/portal toggles, etc. Writes are captured by the `config_versions` diff trigger (useful for recovering prior values).
  - Department Config → read-only overview aggregated from `hk_config`, `eng_config`, `sec_config`, `uinv_config`, `proc_config` (key/value, not section/data), `hr_configuration` (group/category/setting_name, not section/data) — normalized to `{dept, table, sections[], count, lastUpdated}`.
- **Frontend service**: `operationsService.ts` — `fetchOpsConfiguration`, `createApprovalLevel`, `updateApprovalLevel`, `deleteApprovalLevel`, `saveOpsConfigSection`, `updateGlobalSettings` + types.
- **Component**: `Configuration.tsx` — expanded from 2 mock tabs to 4 live tabs: Approval Matrix (per-level limit/status/approver editing, add form, delete), Operations Settings (schema-driven per-section forms rendered from `OPS_SECTION_SCHEMA` — text/number/boolean/select, save stamps `updated_by`), Global Settings (whitelisted form), Department Config (read-only cross-portal cards). 4 KPI StatCards + tab switcher.

## Operations Portal — Executive Dashboard Integration

- **Route** (`src/server/routes/operationsDashboard.routes.ts`, mounted at `/api/ops-portal`): `GET /dashboard?period=today|week|month&propertyId=` — no new tables; computes 4 KPI groups live from ~13 tables with real previous-period deltas (same-length window immediately before the current period).
  - **Rooms**: occupancy % (occupied/sellable), available rooms (`Vacant*`/`Inspected` statuses — the DB uses `Occupied Clean/Dirty`, `Vacant Dirty`), arrivals/departures in period, VIP arrivals (matched to `guests.status IN ('VIP','Loyalty Member')` by name), in-house count.
  - **Revenue**: room revenue = `reservations.rate` (or `total_amount/nights`) × overlap nights in window + `banquet_events.estimated_revenue` in window; ADR, RevPAR, next-period forecast.
  - **Guest**: open complaints (complaint-type `guest_requests` + open `ops_recovery_cases`), avg `guest_feedback.rating`, feedback count in period.
  - **Operations**: open WOs, HK task completion % for the period, open `sec_incidents`, `staff_attendance` presence % for today.
  - **Alerts feed**: real rows severity-ordered — active emergencies, Critical/High open incidents (`incident_type`/`location`, not `title`), Emergency open WOs (`room_number`, not `location`), overdue `ops_escalations` (`description`, not `title`), OOO rooms, VIP arrivals, stale urgent requests (>4h), stale recovery cases (>48h).
- **Frontend service**: `operationsService.ts` — `fetchOpsDashboard(period, propertyId)` + types.
- **Component**: `ExecutiveOperationsDashboard.tsx` — rewritten to the **department-dashboard pattern** (same layout as `HKDashboard`): PageHeader (period selector + last-updated + refresh, 5-min auto-refresh), 8 room/flow StatCards, 4 revenue StatCards, 8 guest/ops StatCards, a `recharts` room-status **pie** (`roomStatusDist`) beside a scrollable cross-portal **alerts panel** (`lg:col-span-7/5`, severity Badges + `timeAgo`), and a 7-day **arrivals/departures/events bar chart** (`flow7d`). Escalation alerts carry `acknowledgeable` (escalation id) → working Acknowledge button via `updateEscalation(id, {status:'acknowledged'})`.

## Executive BI — Strategic Planning Integration

- **Route**: `GET /api/executive/strategic-planning?days=&propertyId=` in `executive.routes.ts` — aggregates derived strategic items from ~18 tables (budget_forecasts, fin_bi_forecasts, rms_bi_yoy_metrics, proc_budgets, eng_projects/phases, energy_projects, sales_campaigns/contracts, banquet_events, housekeeping, attendance, audits, PM, labor, fb_cost) plus **user-authored rows** from `exec_strategic_items`. Cached 10 min via `cacheService` (`exec-strategic-planning:{propertyId}:{days}`).
- **Semantics**: each item carries `metric` — what its `progress` % actually measures (`completion` | `attainment` | `confidence` | `utilization` | `adherence` | `elapsed` | `pipeline`). The UI labels the number accordingly and colors bars by **status**, not magnitude.
- **Windowing**: `days` filters every source that has a real date column; TEXT-period tables (budget_forecasts, fin_bi_forecasts, hr_labor_cost_analysis — formats like 'Q2 2024', 'June 2024', '2024') keep only the **latest period** to avoid cross-period double-counting. `fb_cost_analytics` uses MTD rows only (Today/MTD/YTD would triple-count outlets). Audit pass rate counts `result` starting with 'pass' ('Pass with Findings' included). KPI targets are only emitted when their source table has rows.
- **Migration 646** (`646_exec_strategic_items.sql`) — user-authored strategic items: title, description, category CHECK (7 categories), department, owner, `target_value`/`current_value`/`unit` (progress auto-derives as attainment when target>0), `metric`, `status`, start/due dates. RLS + authenticated CRUD. Seeded with 5 items for the demo property.
- **CRUD routes** (same file): `POST/PATCH/DELETE /strategic-planning/items[/:id]` — `requirePermission('exec:strategic:manage')` (resolves via superuser/full-access roles, same as other `exec:*` mutations). PATCH re-fetches the row so a `currentValue`-only update still derives progress from the stored target; status auto-derives unless sent explicitly. Mutations invalidate the GET cache.
- **Frontend**: `executiveService.ts` — `createStrategicItem`/`updateStrategicItem`/`deleteStrategicItem` + `StrategicItemInput`. `StrategicPlanning.tsx` — "New Item" button, `ModalSystem` create/edit form (target-driven or manual progress), edit/delete icons on `custom` items only, `ConfirmDialog` delete. Derived items are read-only by design.

## Data-quality migrations 630–631 (apply with 629)

- **Migration 630** (`630_backfill_property_id.sql`) — backfills `property_id = NULL → demo property` on legacy-seeded operational tables (reservations, guest_requests, work_orders, guests, orders, banquet_events, inventory_items, guest_feedback, group_blocks). These tables predated multi-property scoping; without the backfill every `?propertyId=`-scoped query silently hides them. Safe because no rows are tagged to the second property ("Gheralta Airport Branch").
- **Migration 631** (`631_fix_banquet_audit_trigger.sql`) — fixes `trg_banquet_audit()`, which unconditionally read `NEW.event_id` and therefore broke **every** insert/update/delete on banquet tables lacking that column (banquet_events, banquet_venues, …). Now reads the row via `to_jsonb()` and treats `event_id` as optional.

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Entry point — health, apiRouter mount, Vite middleware, listen |
| `src/server/routes/index.ts` | Composed API router — mounts all route files |
| `src/config/departments.ts` | Department registry (18 depts) + role-to-dept mapping |
| `src/config/departmentTabs.ts` | Per-department tab registry with modIds |
| `src/components/Shared/ErpLayout.tsx` | Layout route with auth guards |
| `src/components/Shared/DepartmentRoute.tsx` | Per-department route wrapper + access control |
| `src/components/Shared/DepartmentSwitcher.tsx` | Header dropdown for dept switching |
| `src/App.tsx` | Outer layout + top-level routes |
| `ROUTE_DRIVEN_MIGRATION_PLAN.md` | Full migration plan + history |

## Inventory System Enhancements (Migration 373)

Migration 373 (`373_inventory_system_enhancements.sql`) implements 6 enhancement areas for the inventory system. Schema changes are applied to the remote Supabase DB via MCP `apply_migration` (in 3 parts). Routes are added to `unifiedInventoryPortal.routes.ts` (mounted at `/api/uinv-portal`). All 4 new tables have RLS enabled with `authenticated` + `service_role` policies.

### Gap 1: Dual-Ledger Consumption (Central = Separate Stock Model)

- **Model**: Central warehouse (`UINV-ST-MAIN`) holds its own physical stock. Department consumption does NOT deduct central directly. Instead, when dept stock drops below its effective par, a **replenishment pull** request is auto-generated from central → dept (a transfer request, not a simultaneous deduct). This avoids double-counting.
- **Table**: `uinv_replenishment_pulls` (id, pull_number, dept_store_id, source_store_id, item_id, quantity_requested, quantity_shipped, trigger_type, status, transfer_id, reason, stock_at_generation, par_at_generation, approval fields).
- **Status flow**: `Pending → Approved → Converted to Transfer → Fulfilled` (or `Rejected`/`Cancelled`).
- **Function**: `generate_replenishment_pulls_for_dept(p_dept_store_id, p_property_id)` — scans a dept store for items below effective par and auto-creates pull requests. Skips items that already have a pending/approved pull.
- **Routes** (in `unifiedInventoryPortal.routes.ts`):
  - `GET  /api/uinv-portal/replenishment-pulls` — list (filters: propertyId, deptStoreId, status).
  - `POST /api/uinv-portal/replenishment-pulls/generate` — auto-generate pulls for a dept store. Body: `{ deptStoreId, propertyId }`.
  - `PATCH /api/uinv-portal/replenishment-pulls/:id/approve` — approve a pending pull.
  - `PATCH /api/uinv-portal/replenishment-pulls/:id/reject` — reject (body: `rejectionReason`).
  - `POST /api/uinv-portal/replenishment-pulls/:id/convert-to-transfer` — convert an approved pull into a `uinv_transfers` row (dispatch from central).
  - `DELETE /api/uinv-portal/replenishment-pulls/:id` — delete.

### Gap 2: Three-Tier Par System (Manual > Dynamic > Standard)

- **Three tiers**: (1) Manual override (temporary, with optional expiry) — highest priority; (2) Dynamic par (from `uinv_consumption_stats`, 30-day lookback) — medium; (3) Standard par (`uinv_items.par_level` / `stock_balances.replenish_max`) — fallback.
- **Table**: `uinv_manual_par_overrides` (id, store_id, item_id, manual_par_level, manual_replenish_min, manual_replenish_max, reason, effective_from, effective_until, is_active).
- **Auto-revert**: manual overrides have an optional `effective_until` timestamp; the `effective_par_level()` function automatically ignores expired overrides.
- **Function**: `effective_par_level(p_item_id, p_store_id)` — returns `{ par_level, replenish_min, replenish_max, source }` where source is `'manual'`, `'dynamic'`, or `'standard'`.
- **Routes**:
  - `GET  /api/uinv-portal/manual-par-overrides` — list (filters: propertyId, storeId, itemId, activeOnly).
  - `POST /api/uinv-portal/manual-par-overrides` — create a manual override.
  - `PATCH /api/uinv-portal/manual-par-overrides/:id` — update.
  - `PATCH /api/uinv-portal/manual-par-overrides/:id/deactivate` — deactivate (revert to dynamic/standard).
  - `DELETE /api/uinv-portal/manual-par-overrides/:id` — delete.
  - `GET  /api/uinv-portal/effective-par?itemId=&storeId=` — resolve the effective three-tier par.

### Gap 3: Procurement Auto-Trigger (Low Central Stock → Purchase Requisition)

- **Function**: `generate_procurement_requisition_from_low_stock(p_property_id, p_created_by)` — scans `UINV-ST-MAIN` for items where `on_hand <= reorder_point` (or `min_stock`), and auto-creates `proc_requisitions` + `proc_requisition_lines` rows with `source_system='inventory'`, `status='Submitted'`. Skips items that already have an open inventory-sourced requisition.
- **Bug fix**: Migration 373 also fixes `proc_requisitions.id` and `proc_requisition_lines.id` to have `DEFAULT gen_random_uuid()::text` (migration 345 left them without a default, causing insert failures).
- **Routes**:
  - `GET  /api/uinv-portal/procurement-trigger/preview` — preview low-stock items at central (returns suggested order qty + estimated value).
  - `POST /api/uinv-portal/procurement-trigger/generate` — auto-generate procurement requisitions. Body: `{ propertyId }`.

### Gap 4: Finance Journal Auto-Posting (COGS / Inventory Valuation / Shrinkage)

- **GL accounts added** to `usali_chart_of_accounts`:
  - Inventory assets: `1100` (Food), `1110` (Beverage), `1120` (Housekeeping), `1130` (Engineering), `1140` (General), `1150` (Linen), `1190` (Central Warehouse, control account).
  - Shrinkage/waste: `8400` (general), `8410` (Food), `8420` (Beverage), `8430` (Housekeeping), `8440` (Engineering), `8450` (Variance).
  - Dept COGS: `3300` (Housekeeping), `3400` (Engineering), `3500` (General). F&B COGS (`3100`/`3200`) already existed.
- **Table**: `uinv_journal_posting_log` (source_entity, source_id, journal_id, posting_type, amount) — prevents duplicate postings via `UNIQUE (source_entity, source_id)`.
- **Function**: `post_inventory_journal(p_source_entity, p_source_id, p_posting_type, p_amount, p_description, p_department, p_property_id, p_reference, p_created_by)` — creates a `journal_entries` header + `journal_lines` (balanced double-entry) + posting log entry. Posting types: `'COGS'` (debit COGS / credit inventory), `'Inventory Valuation'` (debit inventory / credit AP), `'Shrinkage'` (debit shrinkage expense / credit inventory). GL account resolution is department-driven.
- **Auto-posting wired in**: The `POST /api/uinv-portal/waste` route now auto-calls `post_inventory_journal` with `posting_type='Shrinkage'` after creating a waste record.
- **Routes**:
  - `GET  /api/uinv-portal/journal-posting-log` — list posting log entries (filters: sourceEntity, postingType).
  - `POST /api/uinv-portal/journal-posting/post` — manually trigger a journal posting for any inventory movement.
  - `POST /api/uinv-portal/journal-posting/batch-waste` — batch-post shrinkage journals for all unposted waste records.

### Gap 5: Inter-Departmental Stock Borrowing (Temporary Loans + Approval + Return)

- **Table**: `uinv_dept_borrows` (id, borrow_number, borrowing_store_id, lending_store_id, item_id, quantity_borrowed, quantity_returned, expected_return_date, actual_return_date, status, purpose, approval/dispatch/receive/return fields, outbound_transfer_id, return_transfer_id).
- **Status flow**: `Requested → Approved → Dispatched → Received → (Partially Returned) → Returned` (or `Rejected`/`Overdue`/`Cancelled`).
- **Stock movements**: Dispatch deducts from lending store + ledger; Receive adds to borrowing store + ledger; Return deducts from borrowing store and adds back to lending store (supports partial returns).
- **Routes**:
  - `GET  /api/uinv-portal/dept-borrows` — list (filters: propertyId, borrowingStoreId, lendingStoreId, status).
  - `POST /api/uinv-portal/dept-borrows` — create a borrow request. Body: `{ borrowingStoreId, lendingStoreId, itemId, quantityBorrowed, expectedReturnDate, purpose }`.
  - `PATCH /api/uinv-portal/dept-borrows/:id/approve` — approve.
  - `PATCH /api/uinv-portal/dept-borrows/:id/reject` — reject (body: `rejectionReason`).
  - `POST /api/uinv-portal/dept-borrows/:id/dispatch` — dispatch (creates outbound transfer, deducts lending store).
  - `PATCH /api/uinv-portal/dept-borrows/:id/receive` — mark received by borrowing store (adds to borrowing store).
  - `POST /api/uinv-portal/dept-borrows/:id/return` — return borrowed item (body: `quantityReturned`; supports partial returns; auto-sets status to `Returned` when fully returned).
  - `PATCH /api/uinv-portal/dept-borrows/:id/cancel` — cancel (only from Requested/Approved).
  - `DELETE /api/uinv-portal/dept-borrows/:id` — delete.

### Gap 6: POS → Unified Inventory Dual-Write

- **Linkage columns added**:
  - `pos_outlets.default_store_id` (FK to `uinv_stores`) — backfilled from outlet name (bar/bev/lounge/minibar → `UINV-ST-BEV`; restaurant/kitchen/room service/banquet → `UINV-ST-FOOD`).
  - `ingredients.uinv_item_id` (FK to `uinv_items`) — backfilled by case-insensitive name match within Food & Beverage category.
- **`deduct_outlet_inventory()` replaced**: The original function (migration 175) referenced non-existent `fn_*` tables and used wrong column names (`current_stock` instead of `current_quantity`, `code` instead of `item_code`/`sku`). The replacement:
  - **Recipe mode**: reads from real `recipes` / `recipe_lines` / `ingredients` tables, writes to `stock_transactions` (legacy) AND dual-writes to `uinv_stock_balances` + `uinv_stock_ledger` (unified). Resolves `uinv_item_id` via `ingredients.uinv_item_id` FK first, then name-match fallback.
  - **SKU mode**: updates `inventory_items.current_quantity` (legacy, fixed column name) AND dual-writes to `uinv_stock_balances` + `uinv_stock_ledger`. Resolves `uinv_item_id` via `inventory_items.uinv_item_id` FK first, then name-match fallback.
  - Store routing via `pos_outlets.default_store_id` first, then `UINV-ST-FOOD` fallback.
- **No route changes needed**: the existing POS routes (`pos.routes.ts`, `posSync.routes.ts`) call `deduct_outlet_inventory` via RPC — the replaced function is transparent to callers.

## Central Store Dynamic Par (Migration 376)

Migration 376 (`376_central_store_dynamic_par.sql`) implements the Central Store ROP formula so the Main Warehouse (`UINV-ST-MAIN`) has dynamic Min / ROP / Par Level derived from aggregated department demand. Apply via `npx tsx supabase/run-migration-376.ts`.

### Formula

$$ROP_{Central} = (D_{Total} \times LT_{Vendor}) + SS_{Central}$$

- **D_Total** — combined average daily usage of the item across ALL department stores (sum of `uinv_consumption_stats.avg_daily_consumption` for stores ≠ MAIN).
- **LT_Vendor** — vendor lead time: days from external supplier order → central shelf. Configurable per item / Main-store-default / global.
- **SS_Central** — central safety stock, two configurable methods:
  - **bulletproof** (default, zero risk): `SS = Σ (Par_dept − ROP_dept)` — guarantees no department passes its min even if all order on the same day.
  - **statistical** (standard risk): `SS = Z × √(LT × σ²_D + D² × σ²_LT)` — lower central inventory; small risk if all depts spike simultaneously.
- **Central Min** = `SS_Central` (the floor buffer).
- **Central ROP** = `(D_Total × LT_Vendor) + SS_Central`.
- **Central Order Qty** = bulletproof: `Σ (Par_dept − ROP_dept)`; statistical: `D_Total × reorder_cycle_days`.
- **Central Par** = `max(ROP + OrderQty, Σ dept Par + 1)` — enforced strictly larger than combined dept par levels.

### Config Precedence (highest → lowest)

1. Item-specific Main config (`store_id='UINV-ST-MAIN'`, `item_id=<item>`)
2. Main-store default (`store_id='UINV-ST-MAIN'`, `item_id=NULL`)
3. Global default (`store_id=NULL`, `item_id=NULL`)

Built-in defaults: LT=5d, safety=3d, cycle=7d, service=0.95, method=bulletproof, σ_LT=0.

### Schema

- **`uinv_dynamic_par_config`** (existing table, extended): adds `safety_stock_method text DEFAULT 'bulletproof'` (CHECK: `bulletproof`/`statistical`) and `lead_time_stddev_days numeric(8,3) DEFAULT 0`. A Main-store-default config row is seeded.
- **`uinv_central_store_stats`** (new): cached per-item central calculations — `d_total, demand_variance, dept_count, vendor_lead_time_days, lead_time_stddev_days, safety_stock_method, ss_central, central_min, central_rop, central_order_qty, central_par, combined_dept_par, combined_dept_rop, service_level, z_score, dept_breakdown jsonb`. RLS enabled; `authenticated` + `service_role` policies. Unique on `(item_id, lookback_days)`.

### Function: `refresh_central_store_stats(p_lookback_days, p_property_id)`

1. Calls `refresh_consumption_stats()` first (ensures dept avg_daily / dynamic par are current).
2. Aggregates per item across all department stores (store_id ≠ MAIN): `D_Total = Σ avg_daily`, `σ²_D = Σ stddev²`, `Σ dept Par`, `Σ dept ROP`, `Σ dept order qty`, plus a `dept_breakdown` JSONB array for auditability.
3. Resolves config (item > Main-store > global) for LT, cycle, service level, SS method, σ_LT.
4. Computes SS_Central, Central Min, ROP, Order Qty, Par per the formulas above.
5. Upserts into `uinv_central_store_stats`.
6. Updates `uinv_stock_balances` (store=MAIN) `replenish_min`/`replenish_max` with central ROP/Par.
7. Updates `uinv_items` `reorder_point`/`par_level`/`min_stock` so the procurement auto-trigger (Gap 3) sees the central values.
8. Scheduled via pg_cron daily at 1:30 AM (`uinv-central-par-recalc`) if pg_cron is installed.

### Routes (in `unifiedInventoryPortal.routes.ts`, mounted at `/api/uinv-portal`)

- `GET  /replenishment/central-store-stats` — cached central par per item (joins item master + MAIN balance for on-hand). Filters: `?propertyId= ?lookbackDays=30 ?itemId=`.
- `POST /replenishment/central-calculate-dynamic-par` — trigger recalculation. Body: `{ lookbackDays?, propertyId? }`. Returns per-item `{ dTotal, centralMin, centralRop, centralPar, ssMethod, deptCount }`.
- `GET  /replenishment/central-store-config` — list MAIN-scoped + global config rows. Filter: `?itemId=`.
- `POST /replenishment/central-store-config` — upsert a MAIN-scoped config row. Body: `{ item_id?, lead_time_days, safety_stock_method, reorder_cycle_days, service_level, lead_time_stddev_days, ... }`.

### Frontend

- **Service** (`src/services/inventoryService.ts`): exports `fetchCentralStoreStats`, `calculateCentralDynamicPar`, `fetchCentralStoreConfig`, `saveCentralStoreConfig`, plus `CentralStoreStat` / `CentralDynamicParResult` / `CentralStoreConfig` types.
- **Component** (`src/components/Inventory/CentralStoreDynamicParPanel.tsx`): KPI StatCards (Tracked Items, Total Daily Demand, Bulletproof SS count, Below Central ROP count); main table showing per-item On Hand, D_Total, LT, SS_Central (+ method label), Min, ROP, Par, Σ Dept Par; expandable row → per-department demand breakdown (store, department, avg daily, dept par, dept min, order qty); Config panel listing MAIN-scoped + global config rows with an edit modal (vendor LT, reorder cycle, SS method, service level, σ_LT, safety stock days, lookback).
- **Wiring**: The panel is toggled via a "Central Par" button in the `ReplenishmentModule.tsx` header (`/erp/inventory/replenishment`), alongside the existing Pulls / Procurement / Dynamic Par / Auto-Replenish toggles.

## Department Store Hierarchy Fix (Migrations 377–378)

Migrations 377 + 378 fix a critical bug where the seeded department stores (FOOD, BEV, HK, LINEN, ENG, GEN) had `parent_store_id = NULL`, breaking stock distribution from the Main Warehouse. Apply via `npx tsx supabase/run-migration-377-378.ts`.

### Problem

The seeded department stores (migration 346) were created without `parent_store_id`. Three flows relied on `parent_store_id = 'UINV-ST-MAIN'` to identify department stores, so all three were broken for every seeded store:

1. **`findDeptStore()`** in `unifiedInventoryPortal.routes.ts` — returned NULL → issue distribution couldn't resolve the target dept store.
2. **`issue_stock_to_department()` RPC** (migration 375) — `v_dept_store_id` was NULL → stock distribution failed or wrote to a NULL store_id.
3. **`POST /stores/transfer-stock`** — rejected stores where `parent_store_id !== MAIN_STORE_ID` → the "Transfer" button in `StoresModule.tsx` returned 400 for every seeded department store.

Additionally, the seeded stores had `store_type = 'Warehouse'` instead of `'Department'`, inconsistent with the hierarchy model.

### Migration 377 (`377_uinv_dept_store_hierarchy_fix.sql`)

- Sets `parent_store_id = 'UINV-ST-MAIN'` on all stores with a `department` set (excluding Inventory and MAIN itself) where `parent_store_id IS NULL`.
- Sets `store_type = 'Department'` on those same stores (only updates `Warehouse` → `Department`).
- Adds `idx_uinv_stores_parent_store` index for the lookup queries.
- Idempotent: WHERE guards make re-runs safe.

### Migration 378 (`378_issue_stock_rpc_dept_fallback.sql`)

- Replaces `issue_stock_to_department()` RPC with a version that falls back to the `department` column alone when the `parent_store_id` lookup returns nothing.
- Defense in depth: works whether or not migration 377 has been applied, and handles stores created via the portal without a parent.
- Returns an explicit error if no department store is found (instead of silently writing to NULL).

### Application-Layer Fixes (no migration needed)

- **`findDeptStore()`** (`unifiedInventoryPortal.routes.ts`): now has a fallback query — if the primary `parent_store_id = MAIN + department` lookup returns nothing, it queries any active store with matching `department` (excluding MAIN), ordered so parented stores are preferred.
- **`POST /stores/transfer-stock`**: validation now accepts a store as a department store if `isDepartmentStore(store)` (has `department` set, excluding Inventory) OR `parent_store_id === MAIN_STORE_ID`. Also explicitly rejects `store_code === 'MAIN'`.
- **`DEPARTMENT_STORE_CODES` consolidated**: the department→store_code map was duplicated between `unifiedInventoryPortal.routes.ts` and `storeIds.ts`. It now lives only in `src/server/config/storeIds.ts` (single source of truth) and is imported by the routes file. `storeIds.ts` is the canonical registry for all store IDs and department→store mappings.

### Migration 387 (`387_uinv_movement_integrity.sql`)

- **Atomic stock movement RPC** (`uinv_apply_stock_movement`): replaces all route-level read-modify-write balance updates. Locks the exact `(item_id, store_id, location_id)` balance row with `FOR UPDATE`, validates availability (rejects over-issue/over-transfer/over-waste -- no silent `Math.max(0, ...)` clamping), blends weighted-average cost, optionally deducts FEFO/FIFO batches, appends the immutable ledger row, and enforces Frozen/Closed inventory-period locks -- all in one transaction.
- **NULL-location uniqueness**: partial unique index `uinv_stock_balances_item_store_null_loc` on `(item_id, store_id) WHERE location_id IS NULL` prevents duplicate aggregate balance rows. Existing duplicates are reconciled via a `DO` block before the index is created.
- **Status CHECK constraints** (added `NOT VALID` to avoid full-table scans on large tables): transfers, adjustments, reservations, counts, waste, and goods receipts.
- **FEFO/FIFO batch selection** (`uinv_recommend_batches`): pure function that returns a picking plan ordered by expiry (FEFO) or received date (FIFO) without mutating stock.
- **`issue_stock_to_department()` and `deduct_outlet_inventory()` replaced**: both now delegate to `uinv_apply_stock_movement` for atomicity and availability validation.
- Route handlers for receipts, transfers, adjustments, waste, consumption, put-away, picking, returns, count variance, and reservations now call `applyStockMovement()` instead of manually updating balances and ledgers.

### Migration 388 (`388_uinv_governance_gap_fixes.sql`)

- **Module registry**: registers the 10 missing current inventory module IDs (`inv_inventory`, `inv_stock_operations`, `inv_storekeeping`, `inv_stock_control`, `inv_reservations_allocations`, `inv_replenishment`, `inv_fixed_assets`, `inv_audit`, `inv_advanced_operations`, `inv_configuration`) and deactivates 5 stale pre-rebuild module rows.
- **Disposal/retirement accounting**: `post_asset_disposal_journal()` and `post_asset_retirement_journal()` SQL functions post the correct journal entries. `uinv_assets` gains `retired_at`, `retirement_reason`, `retirement_reference` columns.
- **Variance investigations**: `uinv_variance_investigations` table bridges count variance detection and resolution.
- **Warranty claims**: `uinv_warranty_claims` table with claim lifecycle (Open/In Progress/Resolved - Repaired/Resolved - Replaced/Rejected/Closed).
- **Insurance claims**: `uinv_insurance_claims` table with claim lifecycle (Open/Under Review/Approved/Paid/Rejected/Closed).
- All new tables have RLS enabled, indexes, and `authenticated` + `service_role` grants.

### Inventory Domain Events (no migration)

- `src/server/services/inventoryEvents.ts` provides a lightweight in-process event bus for inventory domain events.

### BI Metrics Extended

- `GET /api/uinv-portal/bi/metrics` now includes: `inventory_turnover_annualized`, `days_on_hand`, `stockout_rate`, `stockout_items`, `asset_verification_coverage`.

### Orphaned Components Removed

- `ReceivingModule.tsx`, `GlobalSearchModule.tsx`, `DepartmentRequisitionsModule.tsx`, `DepartmentUnifiedStockWidget.tsx` were deleted (no imports anywhere in the codebase).

## Finance Portal � Inventory Accounting Integration

- **Migration 397** (`397_finance_inventory_accounting.sql`) must be applied for the `/erp/finance/inventory` tab:
  - Creates 5 tables: `fin_inventory_valuation`, `fin_cogs_entries`, `fin_inventory_adjustments`, `fin_stock_writeoffs`, `fin_stock_revaluations`.
  - All tables are property-scoped (`property_id`), RLS-enabled, and seeded with demo rows for the Gheralta Main Property.
- **Routes** (in `financePortal.routes.ts`, mounted at `/api/fin-portal`):
  - `GET/POST/PATCH/DELETE /inventory-valuation` � valuation snapshot CRUD.
  - `GET/POST/DELETE /cogs` � COGS entries (department, category, qty, cost, reference, period auto-derived).
  - `GET/POST/PATCH/DELETE /inventory-adjustments` � adjustments with `Pending ? Approved ? Posted` workflow; `value_impact` computed server-side.
  - `GET/POST/PATCH/DELETE /stock-writeoffs` � write-offs with approval flow + `gl_posted` flag.
  - `GET/POST/PATCH/DELETE /stock-revaluations` � revaluations with `variance` computed server-side; `Pending ? Approved ? Posted` workflow.
- **Frontend service**: `src/services/financePortalService.ts` exports `fetchInventoryValuation`, `createInventoryValuation`, `deleteInventoryValuation`, `fetchCogsEntries`, `createCogsEntry`, `deleteCogsEntry`, `fetchInventoryAdjustments`, `createInventoryAdjustment`, `updateInventoryAdjustment`, `deleteInventoryAdjustment`, `fetchStockWriteoffs`, `createStockWriteoff`, `updateStockWriteoff`, `deleteStockWriteoff`, `fetchStockRevaluations`, `createStockRevaluation`, `updateStockRevaluation`, `deleteStockRevaluation`, plus `InventoryValuationFE`/`CogsEntryFE`/`InventoryAdjustmentFE`/`StockWriteoffFE`/`StockRevaluationFE` types.
- **Component**: `src/components/Finance/InventoryAccounting.tsx` rewritten � 5 tabs (Valuation, COGS, Adjustments, Write-offs, Revaluation) all backed by the fin-portal API. Uses shared FrontOffice UI primitives (`PageHeader`, `StatCard`, `SectionCard`, `Badge`), `useERP()` for `formatAmount`/`addNotification`/`currentPropertyId`, and matches the F&B/HK inventory module look & feel.

- **Public portal / booking**: `/public-portal?section=<module>` is the single public site; the booking engine is `BookingPage` rendered with `embedded` as `section=booking` (prefill via `checkIn`, `checkOut`, `adults`, `children` query params). `/booking` only redirects there. Public inquiry forms (`/api/public/{meeting,wedding}-inquiry`, `/contact`) create `sales_leads` (source `Website`).

## Admin Control Plane (migration 657)

- `src/server/routes/adminControl.routes.ts` is mounted at `/api/admin/control` (before `/api/admin`). It serves a whitelisted generic CRUD for `admin_*` tables (`departments`, `feature-flags`, `approval-rules`, `workflows`, `business-rules`, `notification-templates`, `document-templates`, `payment-gateways`, `tax-rules`, `locales`, `licenses`, `devices`, `pos-terminals` (backs the POS Terminals tab inside Admin → Device Management; targets `pos_terminals`, no `created_by` column), `identity-providers`), plus `GET /overview` (Executive Dashboard counts) and `GET /datasets/:name` (Reports). All guarded by `settings:manage`; writes are audited. Add a resource by adding a `RESOURCES` entry + migration table.
- Frontend: `Admin/shared/ResourceManager.tsx` is a declarative CRUD screen; `Admin/modules/ControlModules.tsx` declares each module's fields. Mock-only `Admin/modules/*` screens were removed; `adminModules.tsx` now maps tabs to API-backed components (legacy `UserManagementSecurity` tabs for Users/Roles/Audit/Security, `MasterData`, `POSOutletManagement`, etc.).
- Platform Controls' admin toggle list is generated from `CORE_ADMIN_MODULES` (do not hand-maintain `admin_*` keys). Legacy admin tab ids redirect via `adminModuleAliases`.
- Secrets (payment gateways, identity providers) store only a `secret_ref` name, never the secret.

### Central tax rules, business rules and workflows (migrations 657–658)

- **Tax**: `getTaxRates({ appliesTo, propertyId })` in `adminConfigService.ts` is the single source for VAT / service charge from `admin_tax_rules` (`appliesTo`: `all`, `rooms`, `f&b`, `procurement`). Returns `null` when no rule matches so callers keep their old default. Wired into: POS `/tax-calculate` + transaction fallback (outlet tax profile still overrides), online ordering, PO line tax, reservation payment VAT, public booking. Folio `postCharge` still takes `taxAmount` from its caller. New code must call `getTaxRates`, not hard-code rates.
- **Business rules**: `evaluateBusinessRules(category, context, propertyId)`; expressions run through `ruleEngine.ts` (own parser, never eval; tested in `ruleEngine.test.ts`). Actions: `block`, `require_approval`, `apply_discount`, `add_charge`, `set`, `notify`, `flag` — the caller applies the effects it supports. Live categories: `booking` (public booking can be blocked), `procurement` (PO submit can be blocked; `require_approval` restricts who may approve). Rules are validated on save.
- **Workflows**: `workflowEngine.ts` — `startWorkflows(event, …)`, `advanceWorkflow`, `workflowBlocker`. State in `admin_workflow_instances`. Live triggers: `purchase_order.submitted`, `reservation.created`. A PO cannot be approved while its workflow is pending/rejected (`poApprovalGate` in `procurementPortal.routes.ts`, also applies the approval matrix and rule approvers).
- Admin sandbox/queue endpoints: `POST /api/admin/control/rules/evaluate`, `GET /workflow-instances/mine`, `POST /workflow-instances/:id/advance`, `GET /runtime/tax-rates`.
