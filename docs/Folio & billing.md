Hotel ERP — Folio Management UI Architecture

1. Purpose

Folio Management is a shared financial workspace for the hotel ERP.

It is primarily surfaced through:

Front Office Portal

Finance & Accounting Portal

Other operational portals post charges into the common folio engine:

F&B / POS

Banquet & Events

Spa & Wellness

Concierge

Transportation & Fleet

Housekeeping

Guest Services

Room Charges

Telephone

Laundry

The Folio Management UI must provide a unified way to view, organize, transfer, split, settle, invoice, and audit financial transactions.

2. ERP Integration

HOTEL ERP
│
├── FRONT OFFICE PORTAL
│   ├── Reservations
│   ├── Arrivals / Departures
│   ├── In-House Guests
│   ├── Room Management
│   ├── Guest Services
│   └── FOLIO MANAGEMENT
│
├── F&B PORTAL
│   └── POS Charges
│
├── BANQUET & EVENTS
│   └── Event Charges
│
├── SPA & WELLNESS
│   └── Spa Charges
│
├── CONCIERGE
│   └── Service Charges
│
├── TRANSPORTATION & FLEET
│   └── Transfer Charges
│
├── FINANCE & ACCOUNTING
│   ├── FOLIO MANAGEMENT
│   ├── Accounts Receivable
│   ├── Company Accounts
│   ├── Payments
│   ├── Invoices
│   ├── City Ledger
│   ├── Credit Management
│   └── Financial Reports
│
└── SYSTEM ADMIN
    ├── Charge Types
    ├── Transaction Types
    ├── Tax Rules
    ├── Routing Rules
    ├── Payment Methods
    └── Folio Permissions

3. Core Financial Architecture

Keep these concepts separate:

ACCOUNT
    ↓
RESERVATION / GROUP / BUSINESS RELATIONSHIP
    ↓
FOLIO
    ↓
FOLIO TRANSACTIONS
    ↓
PAYMENTS / ADJUSTMENTS / TRANSFERS
    ↓
INVOICE

Account

Represents the financial party:

Guest

Company

Travel Agency

Group account

Folio

Represents the financial container where transactions are accumulated.

Transaction

Represents an individual financial event:

Charge

Payment

Adjustment

Transfer

Reversal

Refund

Invoice

Formal billing document generated from folio transactions.

4. Folio Types

The system supports four primary folio types:

FOLIO
│
├── Guest Folio
├── Group Folio
├── Company Folio
└── Master Folio

Guest Folio

Belongs to a guest/reservation/stay.

Typical charges:

Room

Breakfast

F&B

Minibar

Laundry

Spa

Transportation

Other guest charges

Group Folio

Belongs to a specific group booking.

Typical charges:

Group accommodation

Group meals

Transportation

Banquet

Event charges

Company Folio

Belongs to a company/corporate/travel-agency account.

Typical use:

Direct billing

Corporate credit

Travel agency billing

Contract billing

City ledger

Master Folio

Consolidates related folios.

Typical use:

Multiple groups belonging to the same agency

Large corporate account

Multi-reservation billing

Consolidated invoicing

Split Folio

Split Folio is not a permanent folio type.

It is a billing operation that separates selected transactions between existing or newly created folios.

5. Travel Agency Example

The system must support:

ABC TRAVEL AGENCY
Company Account
│
└── MASTER FOLIO
    MF0001
    │
    ├── GROUP 001
    │   Ethiopian Highlands Tour
    │   GF0001
    │   │
    │   ├── Guest Folio
    │   ├── Guest Folio
    │   ├── Guest Folio
    │   └── Group Charges
    │
    └── GROUP 002
        Northern Ethiopia Tour
        GF0002
        │
        ├── Guest Folio
        ├── Guest Folio
        ├── Guest Folio
        └── Group Charges

The two groups remain separate operational entities while being associated with the same travel agency.

The master folio can consolidate their financial activity without duplicating the underlying transactions.

6. Main UI Architecture

┌───────────────────────────────────────────────────────────────────────┐
│ Global Header                                                         │
│ Search / Notifications / User / Actions                              │
├────────────────┬──────────────────────────────────────────────────────┤
│                │ Breadcrumb                                            │
│                │ Folio Management                                      │
│                ├──────────────────────────────────────────────────────┤
│                │ Folio Header                                          │
│                │ Master Folio #MF0001 [Active]                         │
│                ├──────────────────────────────────────────────────────┤
│ FOLIO          │ Financial Summary                                     │
│ HIERARCHY      │                                                      │
│                │ Charges | Payments | Balance | Credit                │
│ ABC Agency     ├──────────────────────────────────────────────────────┤
│   │            │ Summary | Transactions | Payments | Invoices | ...   │
│   ├ Master     ├──────────────────────────────────────────────────────┤
│   │            │                                                      │
│   ├ Group 001  │                  Workspace                            │
│   │   ├ Guest  │                                                      │
│   │   └ Guest  │                                                      │
│   │            │                                                      │
│   └ Group 002  │                                                      │
│       ├ Guest  │                                                      │
│       └ Guest  │                                                      │
│                │                                                      │
└────────────────┴──────────────────────────────────────────────────────┘

7. UI Component Architecture

FolioManagement/
│
├── FolioManagementPage
│
├── layout/
│   ├── FolioHeader
│   ├── FolioSidebar
│   └── FolioWorkspace
│
├── hierarchy/
│   ├── FolioTree
│   ├── FolioTreeNode
│   ├── AccountNode
│   ├── MasterFolioNode
│   ├── GroupFolioNode
│   ├── GuestFolioNode
│   └── GroupChargeNode
│
├── header/
│   ├── FolioTitle
│   ├── FolioStatus
│   ├── FolioMetadata
│   └── FolioActions
│
├── financial/
│   ├── FinancialSummary
│   ├── ChargesCard
│   ├── PaymentsCard
│   ├── BalanceCard
│   └── CreditCard
│
├── tabs/
│   ├── SummaryTab
│   ├── TransactionsTab
│   ├── PaymentsTab
│   ├── InvoicesTab
│   ├── NotesTab
│   ├── DocumentsTab
│   └── ActivityTab
│
├── transactions/
│   ├── TransactionToolbar
│   ├── TransactionFilters
│   ├── TransactionTable
│   ├── TransactionRow
│   └── TransactionActions
│
├── payments/
│   ├── PaymentTable
│   ├── PaymentSummary
│   └── PaymentActions
│
├── invoices/
│   ├── InvoiceTable
│   ├── InvoiceStatus
│   └── InvoiceActions
│
├── operations/
│   ├── AddChargeDrawer
│   ├── AddPaymentDrawer
│   ├── SplitFolioDrawer
│   ├── TransferFolioDrawer
│   └── CreateInvoiceDrawer
│
└── shared/
    ├── CurrencyAmount
    ├── StatusBadge
    ├── ConfirmationDialog
    ├── AuditTimeline
    ├── EmptyState
    └── LoadingState

8. Main Folio Page

Route:

/accounts/folios/:folioId

The page contains:

Folio hierarchy

Folio header

Financial summary

Folio tabs

Summary workspace

Linked folios

Operational drawers

9. Folio Header

Display:

Master Folio

MF0001
Status: Active

Account: ABC Travel Agency
Folio Type: Master Folio
Currency: USD
Created: Aug 09, 2026

Actions:

Edit Folio

Add Charge

Add Payment

Transfer

Split

Merge

Create Invoice

Print

Close

Reopen

Void

10. Financial Summary

Four primary cards:

┌──────────────┐
│ Total Charges│
│ USD 22,540   │
└──────────────┘

┌──────────────┐
│ Payments     │
│ USD 5,000    │
└──────────────┘

┌──────────────┐
│ Balance      │
│ USD 17,540   │
└──────────────┘

┌──────────────┐
│ Credit        │
│ USD 32,460    │
└──────────────┘

For company/master folios, display:

Credit Limit

Available Credit

For guest folios, display:

Amount Due

Due Date

11. Folio Tabs

Summary
Transactions
Payments
Invoices
Notes
Documents
Activity

Recommended routes:

/accounts/folios/:folioId/summary
/accounts/folios/:folioId/transactions
/accounts/folios/:folioId/payments
/accounts/folios/:folioId/invoices
/accounts/folios/:folioId/notes
/accounts/folios/:folioId/documents
/accounts/folios/:folioId/activity

12. Summary Tab

Folio Information

Folio Number       MF0001
Folio Type         Master Folio
Status             Active
Account            ABC Travel Agency
Currency           USD
Created            Aug 09, 2026
Created By         Abebe M.
Description        ABC Travel Agency consolidated folio

Balance Breakdown

Total Charges       USD 22,540
Total Payments      USD 5,000
Adjustments         USD 0
Transfers In        USD 0
Transfers Out       USD 0
Current Balance     USD 17,540

Linked Folios

Folio

Type

Charges

Payments

Balance

Status

GF0001

Group

11,420

2,500

8,920

Active

GF0002

Group

11,120

2,500

8,620

Active

13. Transactions Tab

Route:

/accounts/folios/:folioId/transactions

Ledger columns:

Date/Time
Transaction #
Type
Description
Reference
Department
Debit
Credit
Balance
Posted By
Status
Actions

Example:

Aug 09
TRX-10001
Charge
Room 101
RES-1001
Front Office
1,200.00
-
1,200.00

Aug 09
TRX-10002
Charge
Breakfast
RES-1001
F&B
300.00
-
1,500.00

Aug 09
TRX-10003
Charge
Transportation
GRP-001
Transport
2,000.00
-
3,500.00

Aug 09
TRX-10004
Payment
Bank Transfer
PAY-001
Finance
-
2,500.00
1,000.00

Filters:

Date range

Transaction type

Department

Reservation

Group

Debit/Credit

User

Status

Actions:

Export

Print

Post Charge

Reverse

View Details

14. Add Charge Drawer

Use a right-side drawer rather than leaving the folio page.

Fields:

Charge Date
Charge Type
Department
Description
Reference
Quantity
Unit Price
Tax
Discount
Destination Folio

Charge types:

Room

Food

Beverage

Minibar

Laundry

Transportation

Spa

Banquet

Telephone

Other

Calculation:

Subtotal
Tax
Discount
Grand Total

Actions:

Cancel
Post Charge

15. Payments Tab

Route:

/accounts/folios/:folioId/payments

Columns:

Payment #
Date
Method
Reference
Amount
Currency
Posted By
Status
Actions

Methods:

Cash

Credit Card

Bank Transfer

Mobile Money

Account Transfer

City Ledger

Actions:

Add Payment

Refund

Reverse

Print Receipt

16. Add Payment Drawer

Fields:

Payment Date
Payment Method
Amount
Currency
Reference
Bank / Card Details
Notes

Show:

Current Balance
Payment Amount
Remaining Balance

Require confirmation before posting.

17. Split Folio

Split is an operation, not a permanent folio type.

Example:

CURRENT FOLIO

Room          USD 1,200
Breakfast     USD 300
Minibar       USD 80
Laundry       USD 50

User selects transactions:

Room       → Company Folio
Breakfast  → Company Folio
Minibar    → Guest Folio
Laundry    → Guest Folio

Destination options:

Guest Folio

Company Folio

Group Folio

New Folio

Preview:

Original Balance
Selected Charges
Remaining Balance
Destination Balance

Actions:

Cancel
Preview Split
Confirm Split

18. Folio Transfer

Use a transfer drawer.

From Folio
To Folio

Transfer Type
    Selected Transactions
    Entire Folio
    Charge Category

Reason
Reference
Notes

Preview:

SOURCE
Current Balance
Transfer Amount
New Balance

DESTINATION
Current Balance
Transfer Amount
New Balance

Actions:

Cancel
Confirm Transfer

Every transfer creates an audit record.

19. Invoices Tab

Route:

/accounts/folios/:folioId/invoices

Columns:

Invoice #
Date
Customer
Subtotal
Tax
Total
Paid
Balance
Status
Actions

Statuses:

Draft

Issued

Partially Paid

Paid

Overdue

Void

Actions:

Create Invoice

View

Print

Email

Void

20. Activity Tab

Use an immutable audit timeline.

Example:

09:42
Abebe M.
Added charge
USD 1,200
Room 101

09:48
Abebe M.
Payment posted
USD 2,500
Bank Transfer

10:05
Sara K.
Transferred charge
USD 300
GF0001 → MF0001

Track:

User

Timestamp

Action

Old value

New value

Reference

Source

Destination

Reason

21. Charge Routing

All revenue-generating portals should post into the common folio engine.

                    F&B POS
                       │
                    F&B Charge
                       │
                       ▼
┌──────────────┐  ┌──────────────┐
│ Front Office │─►│ Charge       │
│ Room Charge  │  │ Routing      │
└──────────────┘  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     Guest Folio    Group Folio    Company Folio

Other charge sources:

F&B POS
Banquet
Spa
Concierge
Transportation
Housekeeping
Room Charges
Telephone
Laundry

The source system creates the transaction.

The folio engine determines the financial destination.

22. Charge Routing Configuration

Example:

Charge Category

Destination

Room

Company Folio

Breakfast

Company Folio

Lunch

Guest Folio

Dinner

Guest Folio

Minibar

Guest Folio

Laundry

Guest Folio

Transportation

Group Folio

Banquet

Master Folio

Spa

Guest Folio

Routing can be configured at:

Reservation

Guest

Group

Company

Contract

Rate plan

Charge category

23. URL Architecture

Because the ERP uses URL-driven navigation, every major folio workspace should be directly addressable.

/accounts/folios

/accounts/folios/:folioId

/accounts/folios/:folioId/summary

/accounts/folios/:folioId/transactions

/accounts/folios/:folioId/payments

/accounts/folios/:folioId/invoices

/accounts/folios/:folioId/activity

Operational drawers can use query parameters:

/accounts/folios/MF0001?drawer=add-charge

/accounts/folios/MF0001?drawer=add-payment

/accounts/folios/MF0001?drawer=split

/accounts/folios/MF0001?drawer=transfer

/accounts/folios/MF0001?drawer=create-invoice

Benefits:

Deep linking

Browser back/forward

Refresh persistence

Bookmarkable states

Permission-aware routes

Easier testing

Better navigation consistency across the ERP

24. Data Model

Recommended core entities:

accounts
│
├── guests
├── companies
├── travel_agencies
└── groups

reservations
│
└── reservation_folios

folios
│
├── guest folio
├── group folio
├── company folio
└── master folio

folio_relationships
│
├── parent_folio_id
└── child_folio_id

folio_transactions
│
├── charges
├── payments
├── adjustments
├── transfers
├── refunds
└── reversals

payments
│
└── payment_allocations

invoices
│
└── invoice_lines

charge_routing_rules
│
└── destination_folio

folio_audit_logs

Core relationship:

Folio
│
├── Transactions
├── Payments
├── Invoices
├── Child Folios
└── Audit Log

25. Transaction Lifecycle

SOURCE PORTAL
     │
     ▼
CREATE CHARGE
     │
     ▼
VALIDATE
     │
     ├── Tax
     ├── Currency
     ├── Routing
     ├── Permissions
     └── Folio Status
     │
     ▼
POST TRANSACTION
     │
     ▼
UPDATE FOLIO BALANCE
     │
     ▼
AUDIT LOG

Never hard-delete posted financial transactions.

Use:

Original Transaction
        │
        ▼
Reversal Transaction
        │
        ▼
Audit Record

26. Folio Statuses

Support:

Open
Active
Pending
Settled
Closed
Reopened
Suspended
Void

Rules:

Open/Active: charges and payments allowed

Pending: restricted according to permission

Settled: balance is zero

Closed: no new transactions

Reopened: requires authorization

Suspended: financial posting restricted

Void: permanently inactive

27. UI Design System

Use:

Dark navy navigation

White cards

Light gray page background

Blue primary actions

Green for paid/settled

Red for outstanding/overdue

Yellow for pending/warning

Gray for inactive

Components:

Rounded cards

Subtle borders

Compact financial tables

Sticky financial summary

Dropdown menus

Right-side drawers

Confirmation dialogs

Toast notifications

Tooltips

Loading states

Empty states

Error states

Never rely on color alone for financial status.

28. Permissions

Recommended permissions:

folio.view
folio.create
folio.edit
folio.post_charge
folio.post_payment
folio.transfer
folio.split
folio.merge
folio.adjust
folio.reverse
folio.close
folio.reopen
folio.void
folio.create_invoice
folio.refund
folio.export
folio.view_audit

High-risk operations should require elevated permissions:

Void

Reopen

Refund

Large transfer

Balance adjustment

Merge

29. Final UI Architecture

                         FOLIO MANAGEMENT
                                │
                ┌───────────────┴────────────────┐
                │                                │
          FOLIO HIERARCHY                  FOLIO WORKSPACE
                │                                │
       ┌────────┼────────┐              ┌────────┼─────────┐
       │        │        │              │        │         │
    Master    Group    Guest          Summary Transactions Payments
       │        │        │                       │
       │        │        └───────────────┐       │
       │        └────────────────┐       │       │
       └─────────────────────────┴───────┴───────┘
                                │
                         FOLIO OPERATIONS
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
          Add Charge       Add Payment       Transfer
              │                 │                 │
              └────────────┬────┴───────┬─────────┘
                           │            │
                         Split       Invoice
                           │            │
                           └─────┬──────┘
                                 │
                           AUDIT / LEDGER

Architecture Principle

Operational portals generate transactions. Folio Management organizes and controls those transactions. Finance & Accounting settles and reports them.

This keeps the hotel ERP modular while maintaining one authoritative financial transaction and folio engine.