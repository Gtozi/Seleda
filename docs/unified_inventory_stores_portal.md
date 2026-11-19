# Unified Inventory & Stores Portal

## 1. Purpose

The Unified Inventory & Stores Portal manages the complete physical inventory lifecycle across the hotel ERP:

> Demand → Replenishment → Receiving → Storage → Transfers → Issues → Consumption → Counts → Adjustments → Valuation → Reporting

It is the **system of record for physical stock**.

### Inventory & Stores owns

- Item master
- Store master
- Stock locations
- Bin locations
- Stock balances
- Goods receiving
- Stock movements
- Internal transfers
- Department issues
- Returns
- Stock counts
- Stock adjustments
- Batch/lot tracking
- Expiry tracking
- Inventory valuation
- Par levels
- Reorder levels
- Stock reservations
- Stock availability
- Waste/spoilage
- Inventory reports

### It does not own

- Supplier sourcing
- RFQs
- Supplier negotiation
- Purchase orders
- Supplier contracts
- Supplier payments
- Recipes
- Maintenance work orders
- Guest reservations

Those remain in their respective portals.

---

# 2. Position Within the Hotel ERP

```text
                           HOTEL ERP
                              |
       +----------------------+----------------------+
       |                      |                      |
       v                      v                      v
  DEPARTMENTS           SUPPLY & PROCUREMENT      FINANCE
       |                      |                      |
       |                      v                      |
       |                PURCHASE ORDERS             |
       |                      |                      |
       +----------------------+----------------------+
                              |
                              v
                    INVENTORY & STORES
                              |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
       F&B              HOUSEKEEPING          ENGINEERING
        |                     |                     |
        +---------------------+---------------------+
                              |
                              v
                         CONSUMPTION
```

---

# 3. Architectural Boundary

| Area | Primary Responsibility |
|---|---|
| Supply & Procurement | What to buy, from whom, at what commercial terms |
| Inventory & Stores | What is physically available, where it is, and where it moved |
| Finance & Accounting | Financial value and accounting impact |
| F&B | Recipes, menus, production and culinary consumption rules |
| Housekeeping | Room/floor operational consumption |
| Engineering | Maintenance work orders and material requirements |
| Banquet & Events | Event requirements and operational consumption |
| Spa & Wellness | Treatments and service consumption |
| Executive BI | Analytics and decision support |

---

# 4. Main Modules

```text
Inventory & Stores
│
├── Dashboard
│
├── Item Master
│
├── Inventory
│   ├── Stock On Hand
│   ├── Available Stock
│   ├── Reserved Stock
│   ├── Allocated Stock
│   ├── On Order
│   └── In Transit
│
├── Stores
│   ├── Warehouses
│   ├── Store Locations
│   ├── Zones
│   ├── Racks
│   ├── Shelves
│   └── Bins
│
├── Receiving
│   ├── Expected Deliveries
│   ├── Goods Receipts
│   ├── Partial Receipts
│   ├── Quality Inspection
│   ├── Rejected Goods
│   └── Supplier Returns
│
├── Stock Operations
│   ├── Issues
│   ├── Transfers
│   ├── Returns
│   ├── Adjustments
│   ├── Reservations
│   └── Picking
│
├── Stock Control
│   ├── Par Levels
│   ├── Reorder Points
│   ├── Min/Max
│   ├── Batch/Lot
│   ├── Expiry
│   ├── Slow Moving
│   └── Dead Stock
│
├── Stock Counts
│   ├── Cycle Counts
│   ├── Physical Counts
│   ├── Blind Counts
│   └── Variance
│
├── Waste & Spoilage
│
├── Inventory Valuation
│
├── Replenishment
│
├── Reports
│
└── Configuration
```

---

# 5. Inventory Dashboard

## KPI Cards

- Total Inventory Value
- Total SKU Count
- Stock On Hand
- Available Stock
- Reserved Stock
- Low Stock Items
- Out-of-Stock Items
- Expiring Items
- Expired Items
- Pending Receipts
- Pending Issues
- Pending Transfers
- Inventory Variance
- Waste Value

## Dashboard Layout

```text
+------------------------------------------------------------------+
| INVENTORY & STORES                                               |
+------------------------------------------------------------------+
| Inventory Value | SKUs | Low Stock | Expiring | Variance | Waste|
+------------------------------------------------------------------+
| Inventory Value Trend                                            |
+--------------------------------+---------------------------------+
| Low Stock Items                | Expiring Items                  |
+--------------------------------+---------------------------------+
| Pending Receipts               | Pending Issues                  |
+--------------------------------+---------------------------------+
| Pending Transfers              | Store Utilization               |
+--------------------------------+---------------------------------+
| Inventory Variance             | Consumption Trend               |
+--------------------------------+---------------------------------+
```

---

# 6. Item Master

The Item Master is the central definition of every inventory-controlled item.

## Core Information

- Item ID
- Item Code
- Item Name
- Description
- Category
- Subcategory
- Item Type
- Brand
- Manufacturer
- SKU
- Barcode
- Secondary Barcode
- Unit of Measure
- Base Unit
- Purchase Unit
- Stock Unit
- Issue Unit
- Active/Inactive Status

## Inventory Properties

- Inventory Controlled
- Batch Controlled
- Lot Controlled
- Serial Controlled
- Expiry Controlled
- FEFO Required
- FIFO Required
- Minimum Stock
- Maximum Stock
- Reorder Point
- Safety Stock
- Par Level
- Default Store
- Default Location
- Costing Method

---

# 7. Item Types

## Food

- Meat
- Poultry
- Seafood
- Vegetables
- Fruits
- Dairy
- Dry Goods
- Frozen Goods
- Bakery Ingredients

## Beverage

- Soft Drinks
- Juice
- Water
- Coffee
- Tea
- Bar Products

## Housekeeping

- Cleaning Chemicals
- Guest Amenities
- Linen
- Towels
- Laundry Supplies

## Engineering

- Spare Parts
- Electrical Components
- Plumbing Components
- HVAC Components
- Tools
- Lubricants
- Consumables

## Spa

- Treatment Products
- Oils
- Creams
- Disposable Supplies
- Retail Products

## Administration

- Stationery
- Office Supplies
- Consumables

---

# 8. Item Classification

```text
Item
│
├── Inventory Item
├── Non-Inventory Item
├── Consumable
├── Spare Part
├── Asset
├── Food
├── Beverage
└── Service
```

Only inventory-controlled items affect stock balances.

---

# 9. Units of Measure

Support multiple units of measure and conversion rules.

Example:

```text
Purchase Unit = Case
Stock Unit    = Bottle
Issue Unit    = Bottle

1 Case = 24 Bottles
```

Other examples:

```text
1 Kg = 1,000 g
1 Liter = 1,000 ml
1 Carton = 24 Pieces
1 Box = 12 Pieces
```

Unit conversions must be centrally controlled.

---

# 10. Barcode Management

Support:

- SKU barcode
- Supplier barcode
- Internal barcode
- QR code
- Batch barcode
- Lot barcode
- Serial number

Barcode scanning should be available for:

- Receiving
- Put-away
- Picking
- Issuing
- Transfers
- Stock counts
- Returns

---

# 11. Store Structure

A hotel can have multiple stores.

```text
Property
│
├── Main Warehouse
│
├── Food Store
│   ├── Dry Store
│   ├── Cold Store
│   └── Freezer
│
├── Beverage Store
│
├── Housekeeping Store
│
├── Engineering Store
│
├── Linen Store
│
└── Spa Store
```

---

# 12. Location Hierarchy

```text
Property
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

Example:

```text
Hotel A
  ↓
Main Food Store
  ↓
Dry Storage
  ↓
Rack A
  ↓
Shelf 03
  ↓
Bin A03-04
```

---

# 13. Stock Balance

For every item and location maintain:

- On Hand
- Available
- Reserved
- Allocated
- On Order
- In Transit
- Damaged
- Quarantined
- Expired

### Core Formula

```text
Available Stock
=
On Hand
-
Reserved
-
Allocated
-
Quarantined
```

---

# 14. Inventory Status

Supported stock statuses:

- Available
- Reserved
- Allocated
- Damaged
- Quarantined
- Expired
- Blocked
- Under Inspection

---

# 15. Goods Receiving

Receiving is performed by Inventory & Stores.

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
Quality Verification
       ↓
Batch / Expiry Capture
       ↓
Goods Receipt
       ↓
Put Away
       ↓
Stock Updated
```

---

# 16. Goods Receipt

## Header

- GRN Number
- Purchase Order
- Supplier
- Property
- Store
- Receiving Date
- Receiver
- Delivery Note
- Invoice Reference
- Vehicle/Delivery Reference
- Inspection Status

## Lines

- Item
- Ordered Quantity
- Delivered Quantity
- Accepted Quantity
- Rejected Quantity
- Unit
- Batch
- Lot
- Manufacturing Date
- Expiry Date
- Unit Cost
- Storage Location

---

# 17. Receiving Variances

Support:

- Short delivery
- Over delivery
- Wrong item
- Damaged item
- Expired item
- Poor quality
- Wrong batch
- Wrong unit
- Quantity discrepancy
- Price discrepancy

Receiving exceptions should be automatically flagged.

---

# 18. Quality Inspection

Certain categories should require inspection.

Examples:

- Food
- Meat
- Seafood
- Dairy
- Chemicals
- Engineering parts

Inspection fields:

- Quality Status
- Inspector
- Inspection Date
- Temperature
- Packaging Condition
- Expiry
- Certification
- Rejection Reason
- Inspection Notes

---

# 19. Quarantine Stock

Rejected or uncertain goods must not become available stock.

```text
Received
   ↓
Inspection
   ↓
+----------------+
|                |
Accepted      Quarantine
|                |
v                v
Available     Investigation
                 |
          +------+------+
          |             |
        Accept        Reject
          |             |
          v             v
      Available       Return/
                      Disposal
```

---

# 20. Put-Away

After receiving, stock is assigned to storage locations.

```text
Goods Receipt
      ↓
Put-Away Task
      ↓
Recommended Location
      ↓
Storekeeper Confirmation
      ↓
Stock Location Updated
```

The system should recommend locations based on:

- Item category
- Temperature requirements
- Available capacity
- Existing stock
- FEFO requirements
- Store rules

---

# 21. FIFO and FEFO

## FIFO

First In, First Out.

Useful for:

- General stock
- Non-expiring products

## FEFO

First Expired, First Out.

Recommended for:

- Food
- Beverage
- Chemicals
- Spa products
- Other expiry-controlled inventory

Issue rules must be configurable by item/category.

---

# 22. Batch and Lot Tracking

Track:

- Batch Number
- Lot Number
- Manufacturing Date
- Expiry Date
- Supplier
- Receipt Date
- Cost
- Current Location
- Quantity
- Movement History

This provides traceability and recall capability.

---

# 23. Expiry Management

Configurable alerts:

```text
90 Days
60 Days
30 Days
14 Days
7 Days
Expired
```

The system should support category-specific expiry alert thresholds.

---

# 24. Stock Issue

Department requests stock.

```text
Department Request
       ↓
Approval
       ↓
Stock Availability
       ↓
Reservation
       ↓
Picking
       ↓
Issue
       ↓
Department Receives
       ↓
Inventory Decreases
```

---

# 25. Stock Issue Request

## Header

- Issue Number
- Department
- Requester
- Store
- Required Date
- Priority
- Cost Center
- Purpose
- Approval Status

## Lines

- Item
- Requested Quantity
- Approved Quantity
- Issued Quantity
- Unit
- Batch
- Location
- Substitution
- Notes

---

# 26. Department Issues

Supported departments include:

- Kitchen
- Restaurant
- Bar
- Housekeeping
- Laundry
- Engineering
- Spa
- Banquet
- Security
- Administration
- Other operational departments

---

# 27. Partial Issue

If requested quantity is unavailable:

```text
Requested = 100
Available = 70

Issued = 70
Backorder = 30
```

The remaining quantity can trigger:

- Replenishment
- Inter-store transfer
- Emergency procurement
- Approved substitution

---

# 28. Stock Transfers

Transfer stock between:

- Stores
- Locations
- Departments
- Properties
- Central warehouse

```text
Transfer Request
      ↓
Approval
      ↓
Source Picking
      ↓
Dispatch
      ↓
In Transit
      ↓
Destination Receiving
      ↓
Destination Stock
```

---

# 29. Inter-Property Transfers

Example:

```text
Hotel A Main Store
       ↓
Transfer
       ↓
Central Transit
       ↓
Hotel B Main Store
```

Track:

- Source Property
- Destination Property
- Transfer Value
- Dispatch Date
- Transit Status
- Receiving Date
- Receiver
- Variance

---

# 30. Stock Reservations

Reserve inventory for:

- Banquet events
- VIP requirements
- Group bookings
- F&B events
- Maintenance projects
- Spa events
- Future operations
- Approved departmental requests

Example:

```text
On Hand   = 100
Reserved  = 30
Available = 70
```

Reservations should have:

- Reference
- Required Date
- Expiry Date
- Quantity
- Department
- Property
- Status

---

# 31. Event Inventory

Banquet and event bookings can reserve inventory.

```text
Event
  ↓
BEO / Event Requirements
  ↓
Inventory Requirement
  ↓
Stock Reservation
  ↓
Picking
  ↓
Event Consumption
```

---

# 32. Inventory Replenishment

Replenishment is calculated from:

- Minimum level
- Maximum level
- Par level
- Reorder point
- Forecast demand
- Lead time
- Consumption
- Open purchase orders
- Stock on hand
- Reserved stock
- In-transit stock

---

# 33. Reorder Point

Basic model:

```text
Reorder Point
=
Average Daily Consumption × Lead Time
+
Safety Stock
```

---

# 34. Min/Max Stock

Example:

```text
Minimum = 20
Maximum = 100
Current = 15

Replenishment = 85
```

---

# 35. Par Stock

Useful for:

- Housekeeping
- Linen
- F&B
- Bars
- Banquet
- Engineering

Example:

```text
Housekeeping Floor
Par Level = 50 towels
Current = 38
Required = 12
```

---

# 36. Automatic Replenishment

```text
Stock Falls
    ↓
Reorder Rule Triggered
    ↓
Replenishment Requirement
    ↓
Supply & Procurement
    ↓
Purchase Requisition
```

Inventory creates the replenishment requirement; Procurement handles the commercial purchasing process.

---

# 37. Inventory Consumption

Consumption can originate from:

- Department issues
- Recipe production
- POS sales
- Kitchen production
- Housekeeping consumption
- Engineering work orders
- Spa treatments
- Banquet events
- Other operational activities

---

# 38. F&B Integration

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

Kitchen production:

```text
Recipe
   ↓
Production
   ↓
Ingredients Consumed
   ↓
Finished / Semi-Finished Stock
```

The F&B Portal owns:

- Menus
- Recipes
- Production rules
- Culinary standards

Inventory owns:

- Physical ingredient stock
- Storage
- Movements
- Costing
- Availability

---

# 39. Sub-Recipe / Production Inventory

```text
Raw Materials
     ↓
Production
     ↓
Sub-Recipe
     ↓
Stored Inventory
     ↓
Final Recipe
```

Example:

```text
Tomato
Onion
Garlic
Oil
   ↓
Tomato Sauce
   ↓
Refrigerated Store
```

Production may be initiated by the F&B portal, while inventory records the physical stock movement.

---

# 40. Housekeeping Integration

Track consumption of:

- Cleaning chemicals
- Guest amenities
- Linen
- Towels
- Laundry supplies
- Disposable supplies

Issue stock by:

- Floor
- Room section
- Department
- Shift
- Housekeeping team

---

# 41. Engineering Integration

Engineering work orders can consume:

- Spare parts
- Tools
- Lubricants
- Electrical components
- Plumbing components
- HVAC components

```text
Maintenance Work Order
       ↓
Material Requirement
       ↓
Inventory Reservation
       ↓
Issue
       ↓
Work Order Consumption
```

---

# 42. Spa Integration

Spa treatments can consume:

- Oils
- Creams
- Towels
- Disposable supplies
- Treatment products

Consumption can be linked to:

- Treatment
- Therapist
- Service
- Booking
- Cost center

---

# 43. Banquet Integration

Events can reserve and consume:

- Food
- Beverage
- Disposable items
- Event supplies

```text
Event
 ↓
Event Requirements
 ↓
Inventory Reservation
 ↓
Picking
 ↓
Issue
 ↓
Consumption
```

---

# 44. Waste and Spoilage

Record:

- Food waste
- Expired goods
- Damaged goods
- Breakage
- Leakage
- Spoilage
- Production waste
- Operational loss
- Unexplained loss

## Waste Record

- Waste Number
- Item
- Quantity
- Batch
- Location
- Reason
- Cost
- Department
- User
- Approval
- Date
- Notes

---

# 45. Waste Approval

High-value waste requires approval.

```text
Waste Recorded
      ↓
Threshold Check
      ↓
+------------------+
|                  |
Low Value       High Value
|                  |
v                  v
Auto Approve     Manager Approval
```

Thresholds should be configurable by:

- Property
- Department
- Item category
- Value
- Quantity

---

# 46. Stock Counts

Support:

- Full physical count
- Cycle count
- Blind count
- Spot count
- Category count
- Location count
- Batch count

---

# 47. Physical Inventory

```text
Count Session Created
       ↓
Count Sheets
       ↓
Physical Count
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

# 48. Blind Count

In a blind count, the storekeeper does not see the system quantity.

```text
Item
   ↓
Physical Quantity
   ↓
Submitted
   ↓
System Comparison
```

This improves count integrity.

---

# 49. Inventory Variance

```text
Variance
=
Physical Quantity
-
System Quantity
```

Example:

```text
System   = 100
Physical = 96

Variance = -4
```

---

# 50. Variance Investigation

For significant variances review:

- Receiving
- Issues
- Transfers
- Returns
- Waste
- Adjustments
- Previous counts
- User activity
- Batch history
- Location history

---

# 51. Stock Adjustment

Adjustment reasons:

- Count variance
- Damage
- Expiry
- Waste
- Theft/loss
- Data correction
- Opening balance
- Unit conversion error
- Inventory correction

Every adjustment should record:

- Reason
- User
- Date
- Quantity
- Value
- Reference
- Approval

---

# 52. Inventory Valuation

Support configurable valuation methods:

- Weighted Average Cost
- FIFO
- Standard Cost

The final accounting treatment is controlled by Finance and the ERP accounting configuration.

---

# 53. Weighted Average Cost

Concept:

```text
New Average Cost
=
(Current Stock Value + New Receipt Value)
/
(Current Quantity + New Receipt Quantity)
```

---

# 54. Inventory Valuation Integration

Inventory provides Finance with:

- Quantity
- Unit Cost
- Inventory Value
- Stock Adjustments
- Waste Value
- Transfer Value
- Consumption Value

Finance creates the accounting entries.

---

# 55. Inventory Accounting Events

```text
Goods Receipt
       ↓
Inventory Value Increase

Department Issue
       ↓
Inventory Value Decrease
       ↓
Department Consumption

Waste
       ↓
Inventory Decrease
       ↓
Waste Expense

Adjustment
       ↓
Inventory Variance
```

---

# 56. Inventory Costing

Track:

- Purchase Cost
- Landed Cost
- Average Cost
- Standard Cost
- Last Purchase Cost

Optional landed-cost components:

- Freight
- Customs
- Insurance
- Handling
- Other acquisition costs

---

# 57. Stock Ledger

Every inventory movement must create an immutable stock ledger entry.

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
Quantity In
Quantity Out
Balance
Unit Cost
Value
User
```

Example:

| Date | Transaction | In | Out | Balance |
|---|---|---:|---:|---:|
| Aug 1 | Opening | 100 | 0 | 100 |
| Aug 3 | Receipt | 50 | 0 | 150 |
| Aug 5 | Issue | 0 | 20 | 130 |
| Aug 7 | Waste | 0 | 5 | 125 |

Stock transactions should not be silently deleted. Corrections should use reversing or adjustment transactions.

---

# 58. Inventory Transaction Types

```text
Opening Balance
Goods Receipt
Purchase Return
Department Issue
Department Return
Store Transfer
Property Transfer
Production Consumption
Production Receipt
Waste
Adjustment
Count Adjustment
Reservation
Reservation Release
Stock Allocation
Stock Deallocation
```

---

# 59. Inventory Audit Trail

Record:

- User
- Timestamp
- Transaction
- Quantity
- Location
- Batch
- Cost
- Reference
- Reason
- Previous Status
- New Status

---

# 60. Storekeeper Workflow

```text
Receive
  ↓
Inspect
  ↓
Accept
  ↓
Put Away
  ↓
Store
  ↓
Pick
  ↓
Issue
  ↓
Transfer
  ↓
Count
  ↓
Reconcile
```

---

# 61. Picking

For stock issues and transfers:

```text
Issue Request
     ↓
Picking List
     ↓
FEFO/FIFO Recommendation
     ↓
Storekeeper Picks
     ↓
Barcode Scan
     ↓
Confirm
```

Picking should support:

- Single-order picking
- Batch picking
- Zone picking
- Priority picking

---

# 62. Mobile Store Operations

The portal should support mobile/tablet workflows for:

- Barcode scanning
- Receiving
- Put-away
- Picking
- Issuing
- Transfers
- Stock counts
- Location lookup
- Batch scanning
- Expiry scanning
- Returns

---

# 63. Barcode Receiving

Recommended flow:

```text
Scan PO
   ↓
Scan Item
   ↓
Scan Batch
   ↓
Enter Quantity
   ↓
Scan Expiry
   ↓
Confirm
```

---

# 64. Inventory Alerts

Generate alerts for:

- Low stock
- Out of stock
- Overstock
- Expiring stock
- Expired stock
- Negative stock
- High variance
- Unusual consumption
- Slow-moving inventory
- Dead stock
- Pending receiving
- Delayed transfers
- Unapproved adjustments
- Quarantine aging

---

# 65. Slow-Moving Inventory

Identify items with low movement over configurable periods:

- 30 days
- 60 days
- 90 days
- 180 days
- 365 days

---

# 66. Dead Stock

Identify inventory with:

- No movement
- No planned consumption
- No upcoming demand

Possible actions:

- Transfer
- Consume
- Return to supplier
- Reallocate
- Dispose
- Write off

---

# 67. Inventory Optimization

Track:

- Stock Turnover
- Days on Hand
- Carrying Cost
- Stockout Rate
- Overstock Rate
- Waste Rate
- Inventory Accuracy

---

# 68. Inventory KPIs

## Operational

- Inventory Accuracy %
- Stockout %
- Receiving Accuracy
- Put-Away Time
- Issue Fulfillment %
- Transfer Cycle Time

## Financial

- Inventory Value
- Inventory Turnover
- Carrying Cost
- Waste Value
- Adjustment Value

## Control

- Variance %
- Expiry Loss
- Shrinkage
- Unapproved Adjustments

---

# 69. Inventory Turnover

```text
Inventory Turnover
=
Cost of Goods Consumed
/
Average Inventory
```

---

# 70. Days on Hand

```text
Days on Hand
=
Average Inventory
/
Average Daily Consumption
```

---

# 71. Stockout Management

When an item reaches zero:

```text
Stockout
   ↓
Department Alert
   ↓
Alternative Item Check
   ↓
Inter-Store Transfer
   ↓
Emergency Procurement
```

The system should recommend the fastest and/or lowest-cost approved solution.

---

# 72. Alternative Items

Maintain approved substitutions.

```text
Item A
   ↓
Out of Stock
   ↓
Approved Alternative B
```

Substitutions must be controlled by the relevant department.

For recipes, substitutions should be controlled by F&B/culinary rules rather than automatically changing recipes.

---

# 73. Multi-Store Inventory

```text
Central Warehouse
     |
     +-- F&B Store
     +-- Beverage Store
     +-- Housekeeping Store
     +-- Engineering Store
     +-- Linen Store
     +-- Spa Store
```

Each store can have independent:

- Stock
- Par levels
- Users
- Locations
- Counts
- Issue workflows
- Approval rules

---

# 74. Multi-Property Inventory

```text
Hotel Group
│
├── Property A
│   ├── Main Store
│   ├── F&B Store
│   └── Engineering Store
│
├── Property B
│   ├── Main Store
│   └── F&B Store
│
└── Central Warehouse
```

Support:

- Property-level stock visibility
- Inter-property transfers
- Central warehouse distribution
- Corporate inventory reporting
- Property-specific stock policies

---

# 75. Inventory Ownership Matrix

| Activity | Owner |
|---|---|
| Item Master | Inventory / System Admin |
| Store Master | Inventory |
| Stock Balance | Inventory |
| Goods Receipt | Inventory |
| Put-Away | Inventory |
| Stock Issue | Inventory |
| Stock Transfer | Inventory |
| Stock Count | Inventory |
| Stock Adjustment | Inventory |
| Waste Recording | Inventory + Department |
| Reorder Requirement | Inventory |
| Supplier Selection | Procurement |
| Purchase Order | Procurement |
| Supplier Invoice | Finance |
| Payment | Finance |
| Recipe | F&B |
| Production | F&B |
| Maintenance Work Order | Engineering |
| Guest Room Operations | Housekeeping |
| Event Requirement | Banquet |
| Treatment Consumption | Spa |
| Analytics | Executive BI |

---

# 76. Integration With Supply & Procurement

```text
INVENTORY
     |
     | Reorder Requirement
     v
PROCUREMENT
     |
     | Purchase Order
     v
SUPPLIER
     |
     | Delivery
     v
INVENTORY
     |
     | Goods Receipt
     v
STOCK
```

Inventory should not create supplier purchase orders directly for normal purchasing.

---

# 77. Integration With Finance

```text
INVENTORY
    |
    | Receipt / Issue / Adjustment
    v
INVENTORY VALUATION
    |
    v
FINANCE
    |
    v
GENERAL LEDGER
```

---

# 78. Integration With F&B

```text
POS
 ↓
Menu
 ↓
Recipe
 ↓
Consumption
 ↓
Inventory
```

Production:

```text
Ingredients
 ↓
Kitchen Production
 ↓
Sub-Recipe / Finished Product
 ↓
Inventory
```

---

# 79. Integration With Housekeeping

```text
Room Operations
      ↓
Housekeeping Consumption
      ↓
Issue Request
      ↓
Inventory
```

---

# 80. Integration With Engineering

```text
Work Order
     ↓
Required Materials
     ↓
Reservation
     ↓
Issue
     ↓
Inventory
```

---

# 81. Integration With Banquet

```text
Event
 ↓
Event Requirements
 ↓
Inventory Reservation
 ↓
Issue
 ↓
Consumption
```

---

# 82. Integration With Spa

```text
Spa Service
     ↓
Product Consumption
     ↓
Inventory
```

---

# 83. Integration With Executive BI

Inventory should publish:

- Inventory Value
- Stock Turnover
- Stock Accuracy
- Waste
- Expiry
- Consumption
- Stockout
- Slow-Moving Stock
- Department Consumption
- Inventory Variance
- Replenishment Requirements

Executive BI should not directly modify inventory transactions.

---

# 84. Approval Workflow

Approval is required for configurable events:

- High-value stock adjustment
- High-value waste
- Inter-property transfer
- Emergency issue
- Stock write-off
- Inventory count variance
- Manual inventory opening balance
- Quarantine release
- Supplier return

---

# 85. Segregation of Duties

Prevent:

```text
Create Count
      X
Approve Own Variance
```

```text
Create Adjustment
      X
Approve Own Adjustment
```

```text
Receive Goods
      X
Approve Supplier Payment
```

```text
Record Waste
      X
Approve High-Value Waste
```

---

# 86. Inventory Permissions

Permissions can be assigned by:

- Organization
- Brand
- Property
- Store
- Department
- Item Category
- Transaction Type

Example:

```text
Storekeeper
→ Receive, pick and issue assigned stores

Inventory Supervisor
→ Approve counts, transfers and adjustments

Corporate Inventory Manager
→ View and manage multiple properties

Property General Manager
→ Approve high-value exceptions

Finance
→ View valuation and accounting impact
```

---

# 87. Reports

## Daily

- Stock Movement
- Goods Received
- Issues
- Transfers
- Adjustments
- Waste
- Expiry Alerts
- Stockout Report

## Weekly

- Inventory Variance
- Stockout
- Slow Moving
- Consumption
- Receiving Performance
- Replenishment

## Monthly

- Inventory Valuation
- Stock Turnover
- Consumption by Department
- Waste Analysis
- Inventory Accuracy
- Adjustment Report
- Expiry Loss

## Executive

- Total Inventory Value
- Inventory Trend
- Inventory Turnover
- Stockout Rate
- Waste Value
- Expiry Value
- Inventory Accuracy
- Inventory by Property
- Inventory by Category

---

# 88. Inventory Reports by Department

## F&B

- Ingredient Consumption
- Food Waste
- Beverage Consumption
- Recipe Variance
- Stock Usage
- Production Consumption

## Housekeeping

- Amenities Consumption
- Linen Movement
- Cleaning Chemical Consumption
- Floor/Room Consumption

## Engineering

- Spare Parts Consumption
- Maintenance Material Cost
- Parts Stock
- Critical Spare Availability

## Spa

- Treatment Product Consumption
- Retail Product Stock
- Product Usage per Treatment

## Banquet

- Event Inventory Usage
- Event Waste
- Event Stock Variance

---

# 89. Inventory Configuration

Configure:

- Stores
- Locations
- Bins
- Units
- Conversion Rules
- Item Categories
- Stock Policies
- Reorder Rules
- Par Levels
- Count Frequencies
- Valuation Method
- Approval Thresholds
- Expiry Rules
- Barcode Rules
- Batch Rules
- Transfer Rules
- Reservation Rules

---

# 90. API Architecture

Example endpoints:

```text
GET    /api/inventory/items
POST   /api/inventory/items
PUT    /api/inventory/items/:id

GET    /api/inventory/stores
POST   /api/inventory/stores
GET    /api/inventory/locations

GET    /api/inventory/stock
GET    /api/inventory/stock-ledger

GET    /api/inventory/receipts
POST   /api/inventory/receipts
POST   /api/inventory/receipts/:id/approve

GET    /api/inventory/issues
POST   /api/inventory/issues
POST   /api/inventory/issues/:id/approve
POST   /api/inventory/issues/:id/issue

GET    /api/inventory/transfers
POST   /api/inventory/transfers
POST   /api/inventory/transfers/:id/dispatch
POST   /api/inventory/transfers/:id/receive

GET    /api/inventory/counts
POST   /api/inventory/counts
POST   /api/inventory/counts/:id/complete

GET    /api/inventory/adjustments
POST   /api/inventory/adjustments
POST   /api/inventory/adjustments/:id/approve

GET    /api/inventory/expiry
GET    /api/inventory/replenishment
GET    /api/inventory/reservations
POST   /api/inventory/reservations

GET    /api/inventory/waste
POST   /api/inventory/waste
POST   /api/inventory/waste/:id/approve
```

---

# 91. Event Architecture

Important domain events:

```text
GoodsReceiptCreated
GoodsReceiptApproved
GoodsReceived
StockUpdated

StockIssueCreated
StockIssueApproved
StockIssued
StockReturned

TransferCreated
TransferApproved
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
WasteApproved

ReplenishmentRequired
QuarantineCreated
QuarantineReleased
SupplierReturnCreated
```

---

# 92. End-to-End Inventory Lifecycle

```text
DEMAND
   ↓
STOCK CHECK
   ↓
AVAILABLE?
   ├── YES → RESERVE / ISSUE
   |
   └── NO
        ↓
REPLENISHMENT
        ↓
PROCUREMENT
        ↓
PURCHASE ORDER
        ↓
SUPPLIER
        ↓
DELIVERY
        ↓
RECEIVING
        ↓
QUALITY CHECK
        ↓
PUT-AWAY
        ↓
STOCK
        ↓
RESERVATION / PICKING
        ↓
ISSUE
        ↓
CONSUMPTION
        ↓
COUNT
        ↓
RECONCILIATION
        ↓
VALUATION
        ↓
FINANCE
```

---

# 93. Final Portal Architecture

```text
                 INVENTORY & STORES
                         |
       +-----------------+-----------------+
       |                 |                 |
       v                 v                 v
   ITEM MASTER        STORES           INVENTORY
                         |                 |
                         +--------+--------+
                                  |
                                  v
                              RECEIVING
                                  |
                                  v
                               PUT-AWAY
                                  |
                                  v
                                STOCK
                                  |
            +---------------------+---------------------+
            |                     |                     |
            v                     v                     v
          ISSUES               TRANSFERS           RESERVES
            |                     |                     |
            +---------------------+---------------------+
                                  |
                                  v
                              CONSUMPTION
                                  |
            +---------------------+---------------------+
            |                     |                     |
            v                     v                     v
           F&B              HOUSEKEEPING          ENGINEERING
            |                     |                     |
            +---------------------+---------------------+
                                  |
                                  v
                            STOCK CONTROL
                                  |
                 +----------------+----------------+
                 |                |                |
                 v                v                v
               COUNTS           WASTE           EXPIRY
                 |                |                |
                 +----------------+----------------+
                                  |
                                  v
                              VALUATION
                                  |
                                  v
                                FINANCE
```

---

# 94. Recommended Separation From Supply & Procurement

The two portals should be **separate but tightly integrated**.

## Supply & Procurement

```text
Supplier
Sourcing
RFQ
Quotation
Negotiation
Contracts
Purchase Requisition
Purchase Order
Procurement Budget
Supplier Performance
```

## Inventory & Stores

```text
Item
Store
Location
Stock
Receiving
Put-Away
Issue
Transfer
Reservation
Count
Adjustment
Waste
Expiry
Valuation
```

The core relationship is:

```text
PROCUREMENT
     |
     | Purchase Order
     v
SUPPLIER
     |
     | Delivery
     v
INVENTORY
     |
     | Goods Receipt
     v
STOCK
```

---

# 95. Recommended Unified Hotel ERP Relationship

```text
                         HOTEL ERP
                            |
       +--------------------+--------------------+
       |                    |                    |
       v                    v                    v
  OPERATIONS          COMMERCIAL              FINANCE
       |                    |                    |
       |              SALES & CRM              |
       |              REVENUE                  |
       |              BANQUET                  |
       |                    |                    |
       +--------------------+--------------------+
                            |
                 +----------+----------+
                 |                     |
                 v                     v
        SUPPLY & PROCUREMENT    INVENTORY & STORES
                 |                     |
                 |                     |
                 +----------+----------+
                            |
                            v
                         FINANCE
```

The architectural principle is:

> **Procurement manages the acquisition of goods; Inventory & Stores manages the physical custody and movement of goods; Finance manages the financial value and accounting of those goods.**

---

# 96. Final Design Principle

Inventory & Stores should be a **standalone unified portal**, not embedded inside Supply & Procurement.

The recommended architecture is:

```text
Supply & Procurement
        |
        | Purchasing
        v
Inventory & Stores
        |
        | Physical Stock
        +-------------------+
        |                   |
        v                   v
 Departments             Finance
```

This gives the hotel ERP:

- Clean separation of duties
- Accurate stock control
- Independent warehouse/store management
- Better inventory auditing
- Multi-property support
- Strong F&B integration
- Better procurement planning
- Accurate inventory valuation
- Better operational approvals
- Real-time stock visibility
- Scalable integration with all hotel ERP portals
