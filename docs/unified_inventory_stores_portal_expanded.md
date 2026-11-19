# Unified Inventory, Stores & Physical Asset Management Portal

## 1. Purpose

The Inventory & Stores Portal is the hotel's operational system of record for physical resources.

It manages:

- Consumable inventory
- Non-consumable stock
- Warehouses and stores
- Receiving and put-away
- Stock issues and returns
- Transfers and reservations
- Batch, lot, serial and expiry tracking
- Stock counts and adjustments
- Waste, spoilage and loss
- Replenishment and stock planning
- Fixed assets
- Equipment and tools
- IT equipment
- Furniture and fixtures
- Linen and uniforms
- Returnable and loanable items
- Asset custody and assignment
- Asset tagging and verification
- Asset transfers
- Asset components
- Warranty and insurance references
- Asset disposal and retirement
- Physical-resource audit trails

## 2. Architectural Principle

> Procurement manages acquisition. Inventory & Stores manages physical custody and movement. Finance manages accounting and financial asset records. Engineering manages maintenance. Security manages investigations.

```text
SUPPLY & PROCUREMENT
        ↓
     ACQUISITION
        ↓
INVENTORY & STORES
        ↓
 PHYSICAL CONTROL
        ↓
DEPARTMENT / CUSTODIAN
        ↓
 OPERATIONAL USE
        ↓
CONSUMPTION / MAINTENANCE
        ↓
 VERIFICATION
        ↓
DISPOSAL / RETIREMENT
        ↓
      FINANCE
```

---

# 3. Complete Portal Modules

```text
Inventory & Stores
│
├── Dashboard
├── Item & Material Master
├── Inventory Control
├── Stores & Warehouses
├── Receiving
├── Put-Away
├── Picking
├── Issues & Returns
├── Transfers
├── Reservations & Allocations
├── Replenishment & Stock Planning
├── Batch / Lot / Serial Control
├── Expiry Management
├── Stock Counts
├── Adjustments
├── Waste / Loss / Spoilage
├── Quarantine
│
├── Fixed Assets
│   ├── Asset Register
│   ├── Asset Classes
│   ├── Asset Tags
│   ├── Asset Components
│   ├── Asset Locations
│   ├── Asset Custody
│   ├── Asset Assignment
│   ├── Asset Transfers
│   ├── Asset Verification
│   ├── Warranty
│   ├── Insurance
│   ├── Disposal
│   └── Retirement
│
├── Equipment & Tools
├── Linen Management
├── Uniform Management
├── Returnable Items
├── Loanable Equipment
├── Physical Verification
├── Inventory & Asset Valuation
├── Audit & Compliance
├── Reports
└── Configuration
```

---

# 4. Resource Classification

```text
Physical Resource
│
├── Inventory
│   ├── Raw Material
│   ├── Consumable
│   ├── Finished Product
│   ├── Semi-Finished Product
│   ├── Spare Part
│   └── Chemical
│
├── Non-Consumable
│   ├── Equipment
│   ├── Tool
│   ├── Utensil
│   └── Reusable Item
│
├── Fixed Asset
│   ├── Furniture & Fixtures
│   ├── Machinery
│   ├── Vehicles
│   ├── IT Equipment
│   └── Building Equipment
│
├── Linen
├── Uniform
├── Returnable
└── Loanable Item
```

Classification must be configurable according to hotel policy and accounting rules.

---

# 5. Inventory Item Master

## Identity

- Item ID
- Item Code
- Item Name
- Description
- Category
- Subcategory
- Brand
- Manufacturer
- SKU
- Barcode
- QR Code
- Item Type
- Active/Inactive

## Units

- Base Unit
- Purchase Unit
- Stock Unit
- Issue Unit
- Unit Conversion

Example:

```text
1 Case = 24 Bottles
Purchase Unit = Case
Stock Unit = Bottle
Issue Unit = Bottle
```

## Stock Rules

- Minimum Stock
- Maximum Stock
- Reorder Point
- Safety Stock
- Par Level
- Default Store
- Default Location
- FIFO/FEFO
- Batch Controlled
- Lot Controlled
- Serial Controlled
- Expiry Controlled

---

# 6. Stores & Warehouse Management

Support:

- Central warehouse
- Main store
- Food store
- Dry store
- Cold store
- Freezer
- Beverage store
- Housekeeping store
- Engineering store
- Linen store
- Spa store
- Department stores
- Property stores

## Location hierarchy

```text
Property
 ↓
Building
 ↓
Store
 ↓
Zone
 ↓
Rack
 ↓
Shelf
 ↓
Bin
```

Track:

- Capacity
- Temperature requirement
- Security level
- Responsible staff
- Allowed item categories

---

# 7. Complete Storekeeping Workflow

```text
Receive
 ↓
Inspect
 ↓
Accept / Quarantine / Reject
 ↓
Label
 ↓
Put Away
 ↓
Store
 ↓
Pick
 ↓
Issue
 ↓
Return / Transfer
 ↓
Count
 ↓
Reconcile
 ↓
Close
```

Storekeepers should be able to perform the full operational cycle without leaving the portal.

---

# 8. Goods Receiving

Integrate with Supply & Procurement purchase orders.

```text
Purchase Order
 ↓
Expected Delivery
 ↓
Supplier Delivery
 ↓
Receiving
 ↓
Quantity Verification
 ↓
Quality Inspection
 ↓
Batch / Lot / Expiry Capture
 ↓
Goods Receipt
 ↓
Put-Away
 ↓
Stock Updated
```

Support:

- Full receipt
- Partial receipt
- Over receipt
- Short receipt
- Wrong item
- Damaged item
- Rejected item
- Supplier return
- Delivery-note matching

---

# 9. Quality & Quarantine

Stock can be:

```text
Available
Reserved
Allocated
Inspection
Quarantine
Damaged
Blocked
Expired
Rejected
```

Quarantined stock cannot be issued.

Workflow:

```text
Received
 ↓
Inspection
 ├── Accepted → Available
 └── Quarantine
       ├── Release → Available
       └── Reject → Return / Disposal
```

---

# 10. Put-Away & Location Control

After receipt, create a put-away task.

The system recommends storage based on:

- Item category
- Temperature
- Existing stock
- Capacity
- FEFO
- Store rules

Every stock unit should be traceable to its current location.

---

# 11. Stock Control

For every item/location maintain:

- On Hand
- Available
- Reserved
- Allocated
- In Transit
- Quarantined
- Damaged
- Expired

```text
Available
=
On Hand
-
Reserved
-
Allocated
-
Quarantined
-
Other Blocked Stock
```

---

# 12. Stock Ledger

Every stock movement creates an immutable ledger transaction.

```text
Date
Time
Item
Property
Store
Location
Transaction Type
Reference
Batch/Lot
Serial
Quantity In
Quantity Out
Balance
Unit Cost
Value
User
```

Never directly edit a posted stock balance.

Corrections use:

- Reversal
- Adjustment
- Return
- Corrective transaction

---

# 13. Stock Issues

```text
Department Request
 ↓
Approval
 ↓
Availability Check
 ↓
Reservation
 ↓
Picking
 ↓
Barcode Scan
 ↓
Issue
 ↓
Department Receives
```

Support:

- Full issue
- Partial issue
- Backorder
- Substitution
- Emergency issue
- After-hours issue

---

# 14. Stock Returns

Departments can return unused or rejected stock.

Track:

- Original issue
- Item
- Quantity
- Batch
- Condition
- Return reason
- Store
- Receiver

Returned stock can be:

```text
Good → Available
Damaged → Quarantine
Expired → Disposal
```

---

# 15. Transfers

Support:

- Store-to-store
- Location-to-location
- Department-to-store
- Property-to-property
- Central warehouse distribution

```text
Transfer Request
 ↓
Approval
 ↓
Pick
 ↓
Dispatch
 ↓
In Transit
 ↓
Destination Receipt
 ↓
Stock Updated
```

---

# 16. Reservations

Reserve stock for:

- Banquets
- Events
- Groups
- F&B production
- Maintenance
- Spa
- Housekeeping
- Future operations

Example:

```text
On Hand = 100
Reserved = 30
Available = 70
```

Reservations must retain their source document.

---

# 17. Replenishment

Calculate replenishment from:

- Min/max
- Par levels
- Reorder point
- Safety stock
- Consumption
- Forecast demand
- Lead time
- Open purchase orders
- In-transit stock
- Reservations

```text
Stock Below Reorder Point
 ↓
Replenishment Requirement
 ↓
Supply & Procurement
 ↓
Purchase Requisition
```

---

# 18. FIFO / FEFO

Support:

- FIFO for suitable general inventory
- FEFO for expiry-controlled inventory

The system should recommend the correct batch during picking.

---

# 19. Batch, Lot & Serial Tracking

Track:

- Batch
- Lot
- Serial number
- Manufacturing date
- Expiry
- Supplier
- Receipt
- Current location
- Quantity
- Movement history

Serial tracking is particularly important for equipment and high-value items.

---

# 20. Expiry Management

Configurable alerts:

```text
90 Days
60 Days
30 Days
14 Days
7 Days
Expired
```

Support:

- Expiry dashboard
- FEFO picking
- Expiry transfer
- Expiry disposal
- Expiry value report

---

# 21. Waste, Loss & Spoilage

Record:

- Food waste
- Expired goods
- Damaged goods
- Breakage
- Leakage
- Spoilage
- Operational loss
- Unexplained loss

Every record contains:

- Item
- Quantity
- Batch
- Store
- Department
- Reason
- Cost
- User
- Date
- Approval

---

# 22. Stock Counts

Support:

- Full physical inventory
- Cycle count
- Blind count
- Spot count
- Category count
- Location count
- Batch count

```text
Count Session
 ↓
Count
 ↓
System Comparison
 ↓
Variance
 ↓
Investigation
 ↓
Approval
 ↓
Adjustment
```

---

# 23. Inventory Variance

```text
Variance
=
Physical Quantity - System Quantity
```

Investigate:

- Receiving
- Issues
- Returns
- Transfers
- Waste
- Adjustments
- Batch movements
- Previous counts

---

# 24. Fixed Asset Management

The portal should maintain the **operational fixed-asset register**.

Finance remains the accounting owner.

## Asset Master

- Asset ID
- Asset Number
- Asset Tag
- Barcode
- QR Code
- Serial Number
- Asset Name
- Description
- Class
- Category
- Manufacturer
- Model
- Supplier
- Purchase Order
- GRN
- Purchase Date
- In-Service Date
- Acquisition Cost
- Currency
- Property
- Building
- Department
- Location
- Custodian
- Condition
- Status
- Warranty
- Insurance
- Finance Asset ID
- Parent Asset

---

# 25. Fixed Asset Classes

Typical hotel classes:

```text
Land
Buildings
Building Improvements
Furniture & Fixtures
Kitchen Equipment
Laundry Equipment
HVAC
Electrical Equipment
Plumbing Equipment
Generators
Boilers
Elevators
IT Equipment
Telecommunications
Security Equipment
Audio Visual
Restaurant Equipment
Spa Equipment
Vehicles
Workshop Equipment
Other Capital Equipment
```

Actual capitalization thresholds and classes must remain configurable by Finance.

---

# 26. Asset Lifecycle

```text
Request
 ↓
Procurement
 ↓
Receive
 ↓
Inspect
 ↓
Identify
 ↓
Tag
 ↓
Finance Capitalization
 ↓
Assign
 ↓
In Service
 ↓
Transfer
 ↓
Maintain
 ↓
Verify
 ↓
Impair / Replace if applicable
 ↓
Dispose
 ↓
Retire
```

---

# 27. Asset Status

```text
Ordered
Received
Inspection
Tagged
Available
Assigned
In Service
In Transit
Under Maintenance
Damaged
Lost
Stolen
Impaired
Held for Disposal
Disposed
Retired
```

---

# 28. Asset Tagging

Every controlled asset should support:

- Asset number
- QR code
- Barcode
- RFID where appropriate
- Serial number
- Asset photograph

Example:

```text
Asset ID: AST-HOTEL-000123
Class: Kitchen Equipment
Location: Main Kitchen
Custodian: Executive Chef
Status: In Service
```

---

# 29. Asset Components

Complex assets can have parent/child structures.

```text
HVAC System
├── Main Unit
├── Compressor
├── Control Panel
├── Fan Assembly
└── Sensors
```

Components may have separate:

- Serial numbers
- Warranty
- Costs
- Maintenance history
- Replacement history

---

# 30. Asset Location

Support:

```text
Property
 ↓
Building
 ↓
Floor
 ↓
Area
 ↓
Room
 ↓
Specific Location
```

Example:

```text
Hotel A
 → Main Building
 → Floor 03
 → Room 305
 → Bedroom
 → TV
```

---

# 31. Asset Custody

Track **location and custodian independently**.

Example:

```text
Location:
Engineering Workshop

Custodian:
Engineering Supervisor
```

A physical asset can be located in one place while assigned to a different responsible person or department.

---

# 32. Asset Assignment

```text
Available Asset
 ↓
Assignment Request
 ↓
Approval
 ↓
Custodian Acceptance
 ↓
Asset Assigned
```

Capture:

- Employee
- Department
- Location
- Issue date
- Expected return
- Condition
- Accessories
- Acknowledgement

---

# 33. Employee Custody

Maintain a custody statement for every employee.

```text
Employee
├── Laptop
├── Mobile
├── Radio
├── Keys
├── Tools
└── Other Assigned Equipment
```

Support employee transfer and exit clearance.

---

# 34. Asset Return

```text
Assigned
 ↓
Return
 ↓
Physical Inspection
 ↓
Condition Assessment
 ↓
Available / Maintenance / Disposal
```

---

# 35. Asset Transfer

Support:

- Employee transfer
- Department transfer
- Location transfer
- Property transfer
- Temporary transfer
- Inter-company transfer where applicable

Always retain:

```text
Previous Location
New Location
Previous Custodian
New Custodian
Date
Reason
Approval
```

---

# 36. Inter-Property Asset Transfer

```text
Property A
 ↓
Transfer Request
 ↓
Approval
 ↓
Dispatch
 ↓
In Transit
 ↓
Property B
 ↓
Verification
 ↓
New Custody
```

Finance receives the required accounting/entity notification.

---

# 37. Asset Verification

Support periodic physical verification.

```text
Verification Campaign
 ↓
Scan Asset Tag
 ↓
Confirm Location
 ↓
Confirm Custodian
 ↓
Confirm Condition
 ↓
Submit
 ↓
Exception Handling
```

Results:

- Found
- Wrong location
- Wrong custodian
- Damaged
- Missing
- Duplicate
- Unidentified

---

# 38. Missing Asset Workflow

```text
Asset Missing
 ↓
Exception
 ↓
Department Investigation
 ↓
Custodian Review
 ↓
Security Review if Required
 ↓
Management Decision
 ├── Found
 ├── Transfer
 ├── Write-Off
 └── Loss / Incident Process
```

Security & Risk owns formal investigations.

---

# 39. Asset Condition

```text
New
Excellent
Good
Fair
Poor
Damaged
Unusable
```

Condition changes should be auditable.

---

# 40. Warranty Management

Track:

- Warranty provider
- Warranty number
- Start/end dates
- Coverage
- Supplier
- Service contact
- Claims
- Repair history

Alerts:

```text
90 / 60 / 30 / 7 Days
```

---

# 41. Insurance Reference

For insured assets:

- Policy
- Insurer
- Coverage
- Insured value
- Start date
- Expiry
- Claim history

---

# 42. Asset Maintenance Integration

Engineering remains responsible for maintenance.

```text
Asset
 ↓
Engineering Work Order
 ↓
Material Requirement
 ↓
Inventory Reservation
 ↓
Stock Issue
 ↓
Work Order Consumption
```

Inventory displays:

- Maintenance history
- Parts consumed
- Downtime
- Warranty work
- Failure history

---

# 43. Equipment & Tool Management

Track:

- Tool ID
- Type
- Serial number
- Location
- Custodian
- Condition
- Calibration requirement
- Last calibration
- Next calibration
- Issue history
- Return history

Useful for:

- Engineering tools
- Workshop tools
- Testing equipment
- Specialized operational equipment

---

# 44. Loanable Equipment

Support temporary loans of:

- Laptops
- Projectors
- Radios
- Event equipment
- Tools
- Portable equipment

Track:

- Borrower
- Department
- Purpose
- Issue date
- Due date
- Return date
- Condition
- Approval

---

# 45. Linen Management

Linen is controlled inventory, not fixed assets.

Categories:

- Bed sheets
- Pillowcases
- Duvets
- Towels
- Bath mats
- Table linen
- Pool towels
- Spa linen
- Kitchen linen

Track:

- Store quantity
- Department quantity
- Laundry quantity
- Clean quantity
- Dirty quantity
- Damaged
- Lost
- Retired

---

# 46. Linen Lifecycle

```text
Purchase
 ↓
Linen Store
 ↓
Issue
 ↓
Operational Use
 ↓
Laundry
 ↓
Clean Linen
 ↓
Reissue
 ↓
Damage / Loss
 ↓
Retirement
```

---

# 47. Uniform Management

Track:

- Employee
- Department
- Role
- Size
- Quantity issued
- Issue date
- Return date
- Condition
- Replacement
- Retirement

Also integrate with HR employee lifecycle:

```text
Employee Join
 ↓
Uniform Issue
 ↓
Employee Transfer
 ↓
Replacement
 ↓
Employee Exit
 ↓
Uniform Return / Clearance
```

---

# 48. Returnable & Consignment Inventory

Support:

- Supplier-owned stock
- Consignment stock
- Reusable containers
- Supplier crates
- Pallets
- Other returnable resources

Track ownership separately from hotel-owned stock.

```text
Owner
Supplier
Hotel
Guest/Third Party
```

---

# 49. Guest / Third-Party Custody

If the hotel temporarily stores third-party property, use a separate custody register.

Track:

- Owner
- Receiving record
- Location
- Custodian
- Release authorization
- Release date
- Condition

Do not mix third-party property with hotel-owned inventory.

---

# 50. High-Value Resource Control

For high-value stock/assets:

- Individual identification
- Barcode/QR
- Serial number
- Photograph
- Custodian
- Location
- Approval
- Periodic verification
- Full audit history

---

# 51. Critical Spare Parts

Engineering can classify spare parts as:

```text
Critical
High
Medium
Normal
```

Track:

- Minimum stock
- Lead time
- Compatible equipment
- Alternative part
- Emergency availability

---

# 52. Equipment Compatibility

```text
Spare Part A
 ↓
Compatible Equipment
├── Generator 01
├── Generator 02
└── Generator 03
```

This prevents issuing an incompatible spare part.

---

# 53. Temperature-Controlled Stores

Track:

- Required range
- Actual temperature
- Reading time
- Store
- User
- Exception
- Corrective action

Example:

```text
Cold Store
Required: 0–5°C
Actual: 7°C
Status: Exception
```

---

# 54. Chemical Inventory

For controlled chemicals track:

- Classification
- Storage requirement
- Safety data reference
- Quantity
- Batch
- Expiry
- Location
- Authorized handlers
- Issues
- Waste

---

# 55. Physical Resource Search

Global search should find:

- Item code
- Item name
- Asset ID
- Asset tag
- Serial number
- Barcode
- QR code
- Batch
- Lot
- Employee
- Department
- Store
- Location
- Supplier
- PO
- GRN
- Work order

---

# 56. Inventory Profile

```text
ITEM
├── Stock
├── Locations
├── Batches
├── Expiry
├── Movements
├── Consumption
├── Suppliers
├── Replenishment
└── Cost
```

# 57. Asset Profile

```text
ASSET
├── Identity
├── Financial Reference
├── Location
├── Custody
├── Components
├── Warranty
├── Maintenance
├── Transfers
├── Verification
├── Disposal
└── Audit History
```

---

# 58. Fixed Asset Disposal

Supported methods:

- Sale
- Auction
- Scrap
- Donation
- Return to supplier
- Recycling
- Destruction
- Trade-in

Workflow:

```text
Disposal Request
 ↓
Condition Assessment
 ↓
Approval
 ↓
Finance Review
 ↓
Disposal
 ↓
Asset Register Update
 ↓
Accounting Update
```

Never use a normal stock adjustment to dispose of a fixed asset.

---

# 59. Asset Retirement

Retain:

- Retirement date
- Reason
- Disposal method
- Approval
- Disposal reference
- Condition
- Finance reference
- Evidence

Assets should not be physically deleted from the database.

---

# 60. Finance Integration

Inventory provides:

- Quantity
- Unit cost
- Inventory value
- Waste value
- Adjustment value
- Consumption value

For fixed assets it provides:

- Acquisition reference
- Asset identity
- Physical location
- Custodian
- Transfer
- Disposal information

Finance owns:

- Capitalization
- Depreciation
- Impairment accounting
- Gain/loss on disposal
- Financial asset register
- General ledger

---

# 61. F&B Integration

```text
POS Sale
 ↓
Menu Item
 ↓
Recipe
 ↓
Ingredient Consumption
 ↓
Inventory
```

Production:

```text
Ingredients
 ↓
Kitchen Production
 ↓
Sub-Recipe
 ↓
Inventory
```

F&B owns recipes and production rules; Inventory owns physical stock.

---

# 62. Housekeeping Integration

Track:

- Amenities
- Chemicals
- Linen
- Towels
- Laundry supplies
- Cleaning equipment

Issue by:

- Floor
- Department
- Team
- Shift

---

# 63. Engineering Integration

```text
Work Order
 ↓
Material Requirement
 ↓
Reservation
 ↓
Issue
 ↓
Consumption
```

Engineering owns the work order; Inventory owns the material transaction.

---

# 64. Banquet Integration

```text
Event
 ↓
Event Requirement
 ↓
Reservation
 ↓
Picking
 ↓
Issue
 ↓
Consumption
```

---

# 65. Spa Integration

Track consumption by:

- Treatment
- Therapist
- Service
- Booking
- Cost center

---

# 66. Front Office / Guest Operations Integration

Inventory can support:

- Guest amenities
- VIP supplies
- Front-office stationery
- Welcome materials
- Lost-and-found custody references where configured

Guest-facing processes remain in the appropriate operational portal.

---

# 67. Security Integration

Security receives alerts for:

- Missing assets
- Suspected theft
- High-value unexplained loss
- Unauthorized after-hours transactions
- Suspicious adjustments

Inventory records the stock/asset exception; Security manages the incident investigation.

---

# 68. Executive BI Integration

Publish:

- Inventory value
- Stock accuracy
- Turnover
- Stockout
- Waste
- Expiry
- Slow-moving stock
- Asset count
- Asset verification
- Missing assets
- Asset condition
- Inventory variance
- Department consumption

BI is read/analytics oriented and should not directly modify operational transactions.

---

# 69. Dashboard

## Executive

```text
Inventory Value
Fixed Asset Count
Asset Value Reference
Stock Accuracy
Stockout Rate
Waste Value
Expiry Value
Inventory Turnover
Missing Assets
Verification Progress
```

## Inventory Manager

```text
Stock On Hand
Low Stock
Out of Stock
Pending Receipts
Pending Issues
Pending Transfers
Expiry
Variance
Waste
Slow Moving
Dead Stock
```

## Asset Manager

```text
Total Assets
Assets by Property
Assets by Department
Assets by Location
Assets by Custodian
Missing Assets
Verification Progress
Warranty Expiry
Maintenance Status
Disposal Pipeline
```

## Storekeeper

```text
Today's Receipts
Today's Issues
Picking Tasks
Transfers
Returns
Expiry Alerts
Count Tasks
Quarantine
Pending Deliveries
```

---

# 70. Reports

## Daily

- Goods Received
- Stock Issues
- Returns
- Transfers
- Adjustments
- Waste
- Expiry
- Stockout
- Pending Transactions

## Weekly

- Inventory Variance
- Consumption
- Stockout
- Slow Moving
- Receiving Accuracy
- Replenishment

## Monthly

- Inventory Valuation
- Stock Turnover
- Department Consumption
- Waste Analysis
- Expiry Loss
- Adjustment Report
- Inventory Accuracy

## Asset

- Fixed Asset Register
- Asset by Property
- Asset by Department
- Asset by Location
- Asset by Custodian
- Missing Asset
- Asset Verification
- Asset Transfer
- Asset Disposal
- Warranty Expiry
- Asset Condition
- Asset Maintenance Summary

## Executive

- Total Inventory Value
- Total Physical Resources
- Fixed Asset Summary
- Stock Turnover
- Inventory Accuracy
- Waste
- Expiry
- Stockout
- Missing Assets
- Asset Verification
- Resource Utilization

---

# 71. Approval & Segregation of Duties

Recommended:

```text
Requester
   ≠
Approver
   ≠
Storekeeper
   ≠
Inventory Adjuster
   ≠
Finance Accountant
```

For assets:

```text
Custodian
   ≠
Verifier
   ≠
Disposal Approver
```

Configurable approvals:

- High-value stock adjustment
- High-value waste
- Asset transfer
- Inter-property transfer
- Asset disposal
- Missing asset
- High-value issue
- Count variance
- Quarantine release

---

# 72. Audit Trail

Every important transaction records:

- User
- Timestamp
- Property
- Department
- Transaction
- Item/Asset
- Quantity
- Value
- Location
- Batch/Serial
- Reason
- Approval
- Previous state
- New state
- Related document

Posted transactions are immutable except through controlled reversal/correction.

---

# 73. Documents

Support attachments for:

- Purchase documents
- Delivery notes
- Inspection records
- Damage photographs
- Asset photographs
- Warranty documents
- Insurance documents
- Count sheets
- Transfer documents
- Custody acknowledgements
- Disposal evidence
- Calibration certificates

---

# 74. Mobile Store & Asset Operations

Mobile/tablet support should include:

- Barcode scanning
- QR scanning
- Receiving
- Put-away
- Picking
- Issuing
- Transfers
- Counts
- Asset verification
- Asset assignment
- Asset transfer
- Asset return
- Photo capture
- Location confirmation

---

# 75. Opening & Closing Store

## Opening

- Access verification
- Temperature check
- Security check
- Cold-room check
- Pending transactions
- Stock exceptions

## Closing

- Complete receipts
- Complete issues
- Review transfers
- Review returns
- Review expiry
- Secure high-value items
- Temperature check
- Store security
- Daily close report

---

# 76. Period-End Inventory

```text
Freeze / Control Transactions
 ↓
Complete Receipts
 ↓
Complete Issues
 ↓
Complete Transfers
 ↓
Complete Returns
 ↓
Count
 ↓
Investigate Variances
 ↓
Adjust
 ↓
Calculate Valuation
 ↓
Finance Handoff
 ↓
Period Close
```

---

# 77. Year-End Physical Resource Verification

Perform:

```text
Inventory Count
+
Fixed Asset Verification
+
Equipment Verification
+
Tool Verification
+
Linen Verification
+
Uniform Verification
+
Custody Verification
```

Produce a consolidated physical-resource report.

---

# 78. Core Database Domains

```text
inventory_items
item_categories
item_units
item_conversions

stores
store_zones
store_locations
store_bins

stock_balances
stock_ledger
stock_batches
stock_lots
stock_serials

goods_receipts
goods_receipt_lines

stock_issues
stock_issue_lines

stock_returns
stock_return_lines

stock_transfers
stock_transfer_lines

stock_reservations
stock_allocations

stock_counts
stock_count_lines
stock_adjustments

waste_records
quarantine_records

replenishment_rules
replenishment_requests

assets
asset_classes
asset_categories
asset_tags
asset_components
asset_locations
asset_assignments
asset_custody
asset_transfers
asset_verifications
asset_disposals
asset_warranties
asset_insurance
asset_documents

tools
tool_assignments
tool_calibrations

linen_items
linen_movements
linen_assignments

uniform_items
uniform_assignments

returnable_items
returnable_movements
loanable_items
loan_transactions

inventory_periods
inventory_audit_logs
```

---

# 79. Core Transaction References

Examples:

```text
GRN-2026-000001
ISS-2026-000145
RET-2026-000021
TRF-2026-000034
ADJ-2026-000011
WST-2026-000021
CNT-2026-000009

AST-2026-000821
ASTTRF-2026-000017
ASTDSP-2026-000003
ASTVER-2026-000041
```

---

# 80. API Domains

```text
/api/inventory/items
/api/inventory/stores
/api/inventory/locations
/api/inventory/stock
/api/inventory/stock-ledger

/api/inventory/receipts
/api/inventory/issues
/api/inventory/returns
/api/inventory/transfers
/api/inventory/reservations

/api/inventory/counts
/api/inventory/adjustments
/api/inventory/waste
/api/inventory/quarantine
/api/inventory/replenishment
/api/inventory/expiry

/api/assets
/api/assets/classes
/api/assets/components
/api/assets/locations
/api/assets/assignments
/api/assets/custody
/api/assets/transfers
/api/assets/verifications
/api/assets/warranty
/api/assets/insurance
/api/assets/disposals

/api/tools
/api/linen
/api/uniforms
/api/returnables
/api/loanable-equipment
```

---

# 81. Domain Events

```text
GoodsReceiptCreated
GoodsReceived
StockUpdated
StockIssued
StockReturned
TransferCreated
TransferDispatched
TransferReceived

StockReservationCreated
StockReservationReleased

StockCountCreated
StockCountCompleted
StockVarianceDetected
StockAdjustmentCreated
StockAdjustmentApproved

LowStockDetected
StockoutDetected
ExpiryDetected
ExpiredStockDetected
WasteRecorded
QuarantineCreated
QuarantineReleased

AssetCreated
AssetTagged
AssetAssigned
AssetTransferred
AssetVerified
AssetMissing
AssetDamaged
AssetReturned
AssetDisposed
AssetRetired
WarrantyExpiring
CustodyChanged
```

---

# 82. Recommended Role Model

## Storekeeper

- Receive
- Inspect
- Put away
- Pick
- Issue
- Return
- Transfer
- Count

## Inventory Supervisor

- Manage stores
- Approve operational transactions
- Review variances
- Manage stock policies
- Supervise storekeepers

## Inventory Manager

- Multi-store management
- Inventory policy
- Replenishment
- Optimization
- Reporting

## Asset Manager

- Asset register
- Tagging
- Assignment
- Verification
- Transfer
- Disposal coordination

## Department Custodian

- Accept assets
- Confirm custody
- Report damage/loss
- Participate in verification

## Finance

- Capitalization
- Depreciation
- Financial valuation
- Accounting

## Engineering

- Maintenance
- Technical condition
- Work orders
- Spare-part requirements

## Security & Risk

- Missing asset investigations
- Theft/loss incidents

## System Administrator

- Configuration
- Permissions
- Approval rules
- Master data governance

---

# 83. Final Portal Architecture

```text
                         HOTEL ERP
                             │
                             ▼
              ┌────────────────────────────┐
              │ INVENTORY & STORES          │
              │                            │
              │ Physical Resource Control  │
              └─────────────┬──────────────┘
                            │
      ┌─────────────────────┼─────────────────────┐
      │                     │                     │
      ▼                     ▼                     ▼
 INVENTORY               STORES                ASSETS
      │                     │                     │
      ├── Receiving         ├── Locations         ├── Fixed Assets
      ├── Issues            ├── Put-Away          ├── Equipment
      ├── Returns           ├── Picking           ├── Tools
      ├── Transfers         ├── Counts            ├── IT Assets
      ├── Reservations      └── Storekeeping      ├── Furniture
      ├── Batch/Lot                               ├── Components
      ├── Expiry                                  ├── Custody
      ├── Waste                                   ├── Verification
      └── Valuation                               └── Disposal
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       LINEN              UNIFORMS           RETURNABLES
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                    PHYSICAL VERIFICATION
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
              COUNTS        ASSETS       CUSTODY
                 │       VERIFICATION    CONTROL
                 └────────────┼────────────┘
                              ▼
                       AUDIT & CONTROL
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          FINANCE         ENGINEERING        SECURITY
             │                │                │
       Accounting         Maintenance       Incidents
```

---

# 84. Final Responsibility Boundary

| Function | Owner |
|---|---|
| Supplier sourcing | Supply & Procurement |
| Purchase orders | Supply & Procurement |
| Physical receiving | Inventory & Stores |
| Warehouse/store custody | Inventory & Stores |
| Stock movement | Inventory & Stores |
| Stock availability | Inventory & Stores |
| Replenishment requirement | Inventory & Stores |
| Recipes | F&B |
| Production | F&B |
| Maintenance work orders | Engineering |
| Physical asset register | Inventory & Stores |
| Asset custody | Inventory & Stores |
| Asset verification | Inventory & Stores |
| Asset technical maintenance | Engineering |
| Asset capitalization | Finance |
| Depreciation | Finance |
| Asset accounting | Finance |
| Asset disposal accounting | Finance |
| Missing asset investigation | Security & Risk |
| Executive analytics | Executive BI |

---

# 85. Final Design Principle

The expanded portal should be the hotel's **single operational control layer for physical resources**.

It must answer, at any time:

```text
WHAT do we have?
HOW MUCH do we have?
WHERE is it?
WHO has custody?
WHAT condition is it in?
WHEN was it received?
WHEN was it moved?
WHAT was it used for?
WHAT is reserved?
WHAT is expiring?
WHAT is missing?
WHAT is under maintenance?
WHAT needs replenishment?
WHAT needs verification?
WHAT should be disposed or retired?
```

The portal therefore becomes:

> **Unified Inventory + Stores + Warehouse + Fixed Assets + Equipment + Tools + Linen + Uniforms + Custody + Physical Verification + Resource Lifecycle Management**

while preserving clean integration boundaries with Procurement, Finance, Engineering, Security, F&B, Housekeeping, Banquet, Spa, Front Office and Executive BI.
