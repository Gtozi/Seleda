# Unified Food & Beverage Portal Architecture

> **Version:** 2.0
> **Portal:** Food & Beverage Management Portal (F&B)
> **Architecture:** Unified Hotel ERP
> **Purpose:** Centralized management of restaurants, bars, room service, menus, recipes, outlets, F&B operations, costing, service standards, and F&B commercial performance.

---

# 1. Architecture Position

The Food & Beverage Portal is the **management and orchestration layer for all hotel F&B operations**.

It manages the business configuration and operational processes while delegating specialized execution to dedicated systems.

```text
                    FOOD & BEVERAGE PORTAL
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
       ▼                     ▼                     ▼
   F&B Management        Menu & Recipe         Outlet Management
       │                  Management                │
       │                     │                     │
       ├──────────────┬──────┴───────┬─────────────┤
       ▼              ▼              ▼             ▼
      POS            KDS          Banquets     Room Service
       │              │              │             │
       ▼              ▼              ▼             ▼
    Sales        Production      Events       Guest Orders
```

---

# 2. Core Architectural Principle

## F&B Portal Owns

* F&B outlets
* Menus
* Menu engineering
* Recipes
* Sub-recipes
* Menu pricing
* Recipe costing
* F&B packages
* Outlet configuration
* F&B operational controls
* Service standards
* F&B promotions
* F&B performance

## Specialized Systems Own

### POS

* Order entry
* Payment
* Checks
* Discounts
* Voids
* Cashier operations
* Fiscal transactions

### KDS

* Kitchen tickets
* Station routing
* Production queue
* Preparation status
* Expo/pass
* Kitchen timing

### Inventory

* Stock ledger
* Receiving
* Transfers
* Stock counts
* Inventory valuation

### Procurement

* Purchase requisitions
* Purchase orders
* Supplier purchasing

### Finance

* General ledger
* Accounts payable
* Accounts receivable
* Tax accounting
* Financial statements

### HR & Payroll

* Employee records
* Scheduling
* Attendance
* Payroll

---

# 3. F&B Portal Modules

```text
Food & Beverage Portal
│
├── F&B Executive Dashboard
│
├── Outlet Management
│   ├── Restaurants
│   ├── Bars
│   ├── Lounges
│   ├── Room Service
│   ├── Pool Bar
│   ├── Banquet F&B
│   ├── Café
│   └── Specialty Outlets
│
├── Menu Management
│   ├── Menus
│   ├── Menu Items
│   ├── Categories
│   ├── Modifiers
│   ├── Menu Versions
│   ├── Menu Availability
│   └── Menu Engineering
│
├── Recipe Management
│   ├── Recipes
│   ├── Sub-Recipes
│   ├── Prep Items
│   ├── Batch Recipes
│   ├── Yield Management
│   ├── Recipe Costing
│   └── Production Standards
│
├── Pricing & Packages
│   ├── Price Lists
│   ├── Meal Plans
│   ├── Packages
│   ├── Promotions
│   └── Special Offers
│
├── Service Operations
│   ├── Outlet Operations
│   ├── Table Management
│   ├── Reservations
│   ├── Waitlist
│   ├── Service Standards
│   └── Guest Requests
│
├── Production Coordination
│   ├── KDS Integration
│   ├── Production Planning
│   ├── Prep Planning
│   ├── Batch Production
│   └── Kitchen Communication
│
├── Banquet F&B
│   ├── BEO Integration
│   ├── Event Menus
│   ├── Event Packages
│   ├── Production Requirements
│   └── Event Consumption
│
├── Room Service
│   ├── Menu
│   ├── Orders
│   ├── Delivery
│   ├── Minibar
│   └── Guest Preferences
│
├── Beverage Management
│   ├── Bar Menus
│   ├── Cocktails
│   ├── Wine Lists
│   ├── Beverage Recipes
│   └── Beverage Costing
│
├── F&B Inventory Coordination
├── Supplier & Procurement Coordination
├── Guest Experience
├── F&B Staff Operations
├── Quality & Compliance
├── F&B Financial Control
├── F&B Analytics
├── Reports
└── Configuration
```

---

# 4. F&B Executive Dashboard

## Revenue

* Today's F&B Revenue
* MTD Revenue
* YTD Revenue
* Revenue by Outlet
* Revenue by Category
* Revenue by Menu Item
* Average Check
* Revenue per Guest

## Operations

* Open Outlets
* Active Orders
* Kitchen Load
* Open Tables
* Restaurant Occupancy
* Reservations
* Waiting Guests
* Room Service Orders

## Cost Control

* Food Cost %
* Beverage Cost %
* Prime Cost
* Actual vs Theoretical Cost
* Waste
* Variance
* Gross Profit

## Guest Experience

* Guest Satisfaction
* Complaints
* Service Recovery
* Average Service Time
* Order Accuracy

---

# 5. Outlet Management

Manage all F&B outlets from one portal.

## Outlet Types

* All-Day Dining
* Fine Dining
* Specialty Restaurant
* Bar
* Lounge
* Café
* Pool Bar
* Rooftop
* Nightclub
* Room Service
* Banquet
* Staff Restaurant

## Outlet Configuration

* Outlet Name
* Outlet Code
* Operating Hours
* Days of Operation
* Menu
* Price List
* Seating Capacity
* POS Assignment
* KDS Assignment
* Revenue Center
* Cost Center
* Service Charge
* Tax Rules

---

# 6. Menu Management

The **menu is a commercial presentation of recipes**, not the source of recipe definitions.

Recommended relationship:

```text
Ingredient
     │
     ▼
Sub-Recipe / Prep Item
     │
     ▼
Recipe
     │
     ▼
Menu Item
     │
     ▼
Menu
     │
     ▼
Outlet / Sales Channel
```

## Menu Functions

* Create Menu
* Menu Versions
* Menu Items
* Categories
* Modifiers
* Add-ons
* Allergens
* Dietary Labels
* Availability
* Pricing
* Menu Publishing

---

# 7. Recipe Management

Recipes are the operational and costing foundation behind menu items.

## Recipe Types

### Standard Recipe

Used for a finished menu item.

### Sub-Recipe

Prepared in advance and used by multiple recipes.

Examples:

```text
Tomato Sauce
    │
    ├── Pasta
    ├── Pizza
    └── Lasagna
```

### Batch Recipe

Prepared in predefined quantities.

Examples:

* Soup
* Sauce
* Stock
* Dough
* Marinade
* Dessert Base

### Prep Item

Intermediate kitchen preparation.

Examples:

* Chopped Onion
* Grilled Chicken
* Caramelized Onion
* Pizza Dough

---

# 8. Recipe Costing

Calculate:

```text
Ingredient Cost
       +
Sub-Recipe Cost
       +
Packaging Cost
       +
Production Cost
       =
Recipe Cost
```

Then:

```text
Recipe Cost
       ↓
Target Food Cost %
       ↓
Recommended Selling Price
```

Track:

* Standard Cost
* Current Cost
* Theoretical Cost
* Actual Cost
* Yield
* Portion Size
* Waste Factor
* Food Cost %

---

# 9. Menu Engineering

Analyze every menu item.

## Metrics

* Popularity
* Contribution Margin
* Food Cost %
* Selling Price
* Gross Profit
* Quantity Sold

## Classification

```text
             High Profit
                 │
       ┌─────────┼─────────┐
       │         │         │
       │       STAR        │
       │                   │
Low    │                   │    High
Sales  │                   │    Sales
       │                   │
       │      PUZZLE       │
       └─────────┼─────────┘
                 │
             Low Profit
```

Categories:

* Star
* Plow Horse
* Puzzle
* Dog

---

# 10. POS Integration

The F&B Portal is the **management layer** while POS is the **transaction execution layer**.

```text
F&B Portal
    │
    ├── Menu
    ├── Pricing
    ├── Outlet
    └── Promotions
          │
          ▼
         POS
          │
          ├── Order
          ├── Check
          ├── Payment
          └── Fiscal Transaction
```

POS sends back:

* Sales
* Voids
* Discounts
* Refunds
* Payments
* Item quantities
* Revenue

---

# 11. KDS Integration

KDS is the kitchen execution system.

```text
POS
 │
 ▼
F&B Portal Rules
 │
 ▼
KDS Routing
 │
 ├── Grill
 ├── Fry
 ├── Cold
 ├── Pizza
 └── Pastry
 │
 ▼
Expo
 │
 ▼
Service
```

F&B Portal manages:

* Station configuration
* Menu-to-station mapping
* Production rules
* Recipe relationships
* Service standards

KDS manages:

* Ticket
* Queue
* Preparation
* Timing
* Expo

---

# 12. Beverage Management

Manage:

* Bar Menus
* Cocktails
* Mocktails
* Spirits
* Wine
* Beer
* Coffee
* Tea
* Soft Drinks

## Beverage Recipes

Examples:

```text
Mojito
├── Rum
├── Lime
├── Mint
├── Sugar Syrup
└── Soda
```

Track:

* Recipe Cost
* Pour Size
* Bottle Yield
* Theoretical Consumption
* Actual Consumption
* Beverage Variance

---

# 13. Bar Control

Features:

* Bottle Tracking
* Open Bottle Management
* Pour Control
* Complimentary Drinks
* Void Control
* Beverage Waste
* Stock Variance

---

# 14. Room Service

Room service is an F&B operational channel.

```text
Guest Portal
      │
      ▼
Room Service
      │
      ▼
POS
      │
      ▼
KDS
      │
      ▼
Kitchen
      │
      ▼
Delivery
      │
      ▼
PMS Folio
```

Functions:

* Room Service Menu
* Scheduled Orders
* Delivery Tracking
* Guest Preferences
* Special Instructions
* Charge to Room
* Tray Collection

---

# 15. Banquet F&B

Integrated with the **Banquet & Events Portal**.

Banquet Portal owns:

* Event
* Client
* Venue
* BEO
* Event timeline

F&B Portal owns:

* Menu
* Recipe
* Food production requirements
* Beverage requirements
* Service setup
* F&B staffing requirements

KDS/Kitchen owns:

* Production execution

---

# 16. F&B Packages

Examples:

* Breakfast Package
* Half Board
* Full Board
* All Inclusive
* Conference Package
* Wedding Package
* Cocktail Package
* Beverage Package

Packages may contain:

```text
Package
├── Breakfast
├── Lunch
├── Dinner
├── Coffee Break
└── Beverage
```

---

# 17. Promotions

Manage:

* Happy Hour
* Buy One Get One
* Set Menu
* Seasonal Menu
* Chef Specials
* Early Dining
* Lunch Specials
* Loyalty Discounts
* Corporate Discounts

Promotions can be distributed to:

* POS
* Guest Portal
* Public Booking Portal
* CRM
* Mobile App

---

# 18. Restaurant Reservations

The F&B Portal may manage **operational restaurant reservations**, while the Guest/Public Booking portals act as booking channels.

```text
Public Booking Portal
Guest Portal
Concierge
        │
        ▼
Restaurant Reservation Service
        │
        ▼
F&B Outlet
```

Functions:

* Table Availability
* Reservations
* Waitlist
* Table Assignment
* No-show Tracking
* Guest Preferences

---

# 19. Table Management

Manage:

* Floor Plans
* Tables
* Sections
* Table Capacity
* Table Status
* Reservations
* Combining Tables

Statuses:

* Available
* Reserved
* Seated
* Ordering
* Dining
* Bill Requested
* Cleaning

---

# 20. Guest Experience

Integrate with Guest Portal and CRM.

Track:

* Dining Preferences
* Favorite Dishes
* Allergies
* Dietary Requirements
* Special Occasions
* VIP Dining
* Previous Visits

---

# 21. Inventory Coordination

F&B should **consume inventory**, but Inventory Management owns the stock ledger.

Integration:

```text
Recipe
   │
   ▼
Theoretical Consumption
   │
   ▼
Inventory
   │
   ▼
Actual Consumption
   │
   ▼
Variance
```

Track:

* Food Consumption
* Beverage Consumption
* Waste
* Spoilage
* Breakage
* Transfers
* Variance

---

# 22. Procurement Coordination

F&B generates demand.

```text
F&B Forecast
     │
     ▼
Production Requirement
     │
     ▼
Inventory Availability
     │
     ▼
Purchase Requisition
     │
     ▼
Procurement
     │
     ▼
Receiving
     │
     ▼
Inventory
```

F&B should not duplicate the Procurement Portal's purchasing workflow.

---

# 23. Kitchen Production Coordination

F&B manages:

* Production standards
* Recipes
* Yield
* Prep requirements
* Forecast demand

Kitchen/KDS manages:

* Production queue
* Station workload
* Preparation
* Completion

---

# 24. F&B Staff Operations

Integrated with HR & Payroll.

Manage operational requirements:

* Staff Assignment
* Outlet Staffing Requirements
* Shift Requirements
* Training Requirements
* Productivity

HR owns:

* Employee master
* Attendance
* Payroll
* Contracts
* Leave

---

# 25. Quality & Compliance

Monitor:

* Food Safety
* Hygiene
* Temperature Logs
* HACCP Checks
* Cleaning Checklists
* Allergen Controls
* Expiry Controls
* Service Standards

Compliance records can integrate with Hotel Operations and Security & Risk.

---

# 26. Waste Management

Record:

* Preparation Waste
* Spoilage
* Expired Items
* Overproduction
* Plate Waste
* Breakage
* Complimentary Waste

Track:

```text
Theoretical Usage
       ↓
Actual Usage
       ↓
Variance
       ↓
Waste Analysis
```

---

# 27. F&B Financial Control

F&B provides operational financial data to Finance.

Track:

* Revenue
* Cost of Sales
* Food Cost
* Beverage Cost
* Labor Cost
* Gross Profit
* Contribution Margin
* Discounts
* Comps
* Voids
* Waste

Finance remains the system of record for accounting.

---

# 28. F&B Analytics

## Outlet Analytics

* Revenue
* Covers
* Average Check
* RevPASH
* Occupancy
* Table Turnover

## Menu Analytics

* Item Sales
* Popularity
* Contribution Margin
* Food Cost
* Menu Engineering

## Kitchen Analytics

* Ticket Time
* Production Volume
* Station Performance
* Order Accuracy

## Cost Analytics

* Food Cost %
* Beverage Cost %
* Waste
* Variance
* Theoretical vs Actual

---

# 29. F&B Reports

## Daily

* Daily Outlet Sales
* Covers
* Average Check
* Food Cost
* Beverage Cost
* Discounts
* Voids
* Comps
* Waste

## Weekly

* Outlet Performance
* Menu Performance
* Labor Productivity
* Cost Variance

## Monthly

* F&B P&L
* Outlet Profitability
* Menu Engineering
* Food Cost Analysis
* Beverage Cost Analysis
* Waste Analysis

## Executive

* F&B Revenue
* Profitability
* RevPASH
* Outlet Ranking
* Menu Performance
* Cost Trends

---

# 30. F&B Configuration

Configure:

* Outlets
* Menus
* Menu Categories
* Menu Items
* Modifiers
* Recipes
* Sub-Recipes
* Production Stations
* Price Lists
* Meal Plans
* Packages
* Promotions
* Service Charges
* Tax Mapping
* Dietary Labels
* Allergen Definitions
* Service Standards

---

# 31. Portal Integrations

| Portal                 | Integration                                            |
| ---------------------- | ------------------------------------------------------ |
| Front Office / PMS     | Room Charges, Guest Profiles, In-House Guests          |
| Guest Portal           | Room Service, Restaurant Reservations, Dining Orders   |
| Public Booking Portal  | Restaurant Reservations, F&B Packages, Offers          |
| Concierge              | Restaurant Reservations, Dining Recommendations        |
| Banquet & Events       | BEO, Event Menus, Catering Requirements                |
| Kitchen / KDS          | Production Orders, Station Routing, Preparation Status |
| Inventory              | Consumption, Waste, Stock Availability, Variance       |
| Procurement            | Purchase Requisitions, Supplier Requirements           |
| Finance & Accounting   | Revenue, Tax, Payments, Cost Accounting                |
| HR & Payroll           | Staff, Scheduling, Labor Cost                          |
| Sales, Marketing & CRM | Promotions, Corporate Accounts, Loyalty                |
| Revenue Management     | Packages, Pricing, Demand                              |
| Housekeeping           | Linen, Cleaning, Outlet Readiness                      |
| Engineering            | Kitchen Equipment, Repairs, Preventive Maintenance     |
| Security & Risk        | Food Safety, Incidents, Compliance                     |
| Transportation         | Event / Group Dining Transportation                    |
| Hotel Operations       | Operational Issues, Escalations, Approvals             |
| Executive & BI         | F&B KPIs, Profitability, Analytics                     |
| System Administration  | Users, Roles, Configuration, Workflow, Audit           |

---

# 32. Ownership Matrix

| Capability                         | Owner                    |
| ---------------------------------- | ------------------------ |
| Outlet Management                  | F&B                      |
| Menu Management                    | F&B                      |
| Menu Pricing                       | F&B / Revenue            |
| Recipe Management                  | F&B / Kitchen Management |
| Recipe Costing                     | F&B                      |
| Sub-Recipes                        | F&B / Kitchen            |
| POS Transactions                   | POS                      |
| Kitchen Tickets                    | KDS                      |
| Kitchen Production                 | Kitchen / KDS            |
| Inventory Ledger                   | Inventory                |
| Purchasing                         | Procurement              |
| Accounting                         | Finance                  |
| Employee Master                    | HR                       |
| Payroll                            | HR                       |
| Guest Profile                      | PMS / CRM                |
| Restaurant Booking Channel         | Guest/Public/Concierge   |
| Restaurant Operational Reservation | F&B                      |
| Banquet Event                      | Banquet & Events         |
| BEO                                | Banquet & Events         |
| Event Menu                         | F&B                      |
| F&B Analytics                      | F&B / Executive BI       |
| System Configuration               | System Administration    |

---

# 33. Recommended F&B Architecture

```text
                           F&B PORTAL
                               │
       ┌───────────────┬───────┼────────┬───────────────┐
       │               │       │        │               │
       ▼               ▼       ▼        ▼               ▼
    Outlets          Menu    Recipe   Packages       Analytics
       │               │       │        │
       ▼               ▼       ▼        ▼
      POS             KDS   Inventory  CRM/Revenue
       │               │
       ▼               ▼
   Transactions      Production
       │               │
       └───────┬───────┘
               ▼
       F&B Operational Data
               │
     ┌─────────┼─────────┐
     ▼         ▼         ▼
  Finance     BI      Operations
```

---

# 34. End-to-End Dining Flow

```text
Guest
 │
 ├── Public Booking Portal
 ├── Guest Portal
 ├── Concierge
 └── Walk-in
       │
       ▼
Restaurant Reservation
       │
       ▼
F&B Outlet
       │
       ▼
POS
       │
       ▼
KDS
       │
       ▼
Kitchen
       │
       ▼
Expo
       │
       ▼
Service
       │
       ▼
POS Settlement
       │
       ├── Cash/Card → Finance
       │
       └── Room Charge → PMS → Finance
```

---

# 35. End-to-End Recipe Flow

```text
Ingredient
    │
    ▼
Sub-Recipe / Prep Item
    │
    ▼
Recipe
    │
    ▼
Menu Item
    │
    ▼
Menu
    │
    ▼
Outlet / Channel
    │
    ▼
POS
    │
    ▼
KDS
    │
    ▼
Production
    │
    ▼
Inventory Consumption
```

---

# 36. Recommended Portal Separation

The final architecture should therefore be:

```text
                    SYSTEM ADMINISTRATION
                            │
                            ▼
                 HOTEL ERP PLATFORM SERVICES
                            │
     ┌──────────────────────┼───────────────────────┐
     │                      │                       │
     ▼                      ▼                       ▼
  F&B PORTAL             POS SYSTEM              KDS SYSTEM
  Management             Transaction             Production
     │                      │                       │
     │                      └──────────┬────────────┘
     │                                 │
     ▼                                 ▼
 Menu / Recipe                    Kitchen
 Outlet / Pricing                 Production
 Packages / Costing
```

### F&B Portal = Management

### POS = Transaction

### KDS = Production

This is the cleanest separation for the ERP architecture.

---

# 37. Key Design Rule

Do **not** duplicate the same business object in multiple portals.

For example:

```text
Menu
  → F&B owns

Recipe
  → F&B / Kitchen Management owns

Order
  → POS owns transaction

Kitchen Ticket
  → KDS owns execution

Inventory
  → Inventory Portal owns stock ledger

Invoice
  → Finance owns accounting document

Guest
  → PMS / CRM owns master guest record

Event
  → Banquet & Events owns event

Employee
  → HR owns employee master
```

Other portals consume these objects through APIs/events rather than maintaining independent copies.

---

# 38. Final F&B Ecosystem

```text
                         SYSTEM ADMIN
                              │
                              ▼
                    ┌─────────────────┐
                    │   F&B PORTAL    │
                    │   MANAGEMENT    │
                    └────────┬────────┘
                             │
       ┌─────────────┬───────┼────────┬─────────────┐
       ▼             ▼       ▼        ▼             ▼
     MENUS        RECIPES   OUTLETS  PACKAGES     ANALYTICS
       │             │       │        │
       └─────────────┼───────┘        │
                     ▼                ▼
                    POS          Revenue / CRM
                     │
                     ▼
                    KDS
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
      Grill        Cold          Pastry
        │            │             │
        └────────────┼─────────────┘
                     ▼
                    EXPO
                     │
                     ▼
                   SERVICE
                     │
                     ▼
                GUEST / ROOM
```

---

# 39. Final Architectural Principle

The unified F&B ecosystem should follow this rule:

> **F&B manages what is sold and how the business operates; POS records the sale; KDS manages how food is produced; Inventory manages what is consumed; Procurement manages what is purchased; Finance manages what is accounted for.**

This prevents the F&B Portal from becoming an oversized monolithic application while still giving F&B management a **single unified command center**.

**End of Document**
