# Unified Supply Chain & Procurement Portal

**Version:** 1.0  
**System:** Unified Hotel ERP  
**Portal:** Supply Chain & Procurement  
**Scope:** Multi-property, multi-brand hotel enterprise

---

## 1. Purpose

The Unified Supply Chain & Procurement Portal manages the complete hotel procurement lifecycle:

> Demand → Requisition → Sourcing → Quotation → Supplier Selection → Purchase Order → Delivery Coordination → Inventory → Finance

The portal is responsible for acquiring goods and services efficiently, transparently, and within approved budgets.

It is intentionally separate from **Inventory & Stores** and **Finance & Accounting** while remaining fully integrated with both.

---

## 2. Core Responsibilities

### Supply Chain & Procurement owns

- Demand planning
- Procurement planning
- Purchase requisitions
- Supplier management
- Supplier onboarding
- Supplier qualification
- Sourcing
- RFQ
- Tender management
- Quotation management
- Supplier comparison
- Negotiation
- Supplier award
- Purchase orders
- Procurement contracts
- Supplier pricing
- Procurement approvals
- Procurement budgets
- Supplier performance
- Supplier risk
- Procurement savings
- Procurement analytics

### Inventory & Stores owns

- Physical stock
- Store locations
- Bin locations
- Goods receiving
- Stock ledger
- Stock transfers
- Stock counts
- Stock adjustments
- Department issues
- Consumption
- Waste
- Expiry
- Batch/lot tracking
- Inventory valuation

### Finance & Accounting owns

- Supplier invoices
- Accounts payable
- Payment processing
- Tax accounting
- General ledger
- Financial reconciliation
- Supplier settlement

---

# 3. Architectural Position

```text
                         HOTEL ERP
                             |
                             v
               SUPPLY CHAIN & PROCUREMENT
                             |
       +---------------------+---------------------+
       |                     |                     |
       v                     v                     v
   SUPPLIERS              SOURCING             CONTRACTS
       |                     |                     |
       +---------------------+---------------------+
                             |
                             v
                        PURCHASING
                             |
                             v
                       PURCHASE ORDER
                             |
                             v
                          SUPPLIER
                             |
                             v
                          DELIVERY
                             |
                             v
                    INVENTORY & STORES
                             |
              +--------------+--------------+
              |              |              |
              v              v              v
             F&B       HOUSEKEEPING    ENGINEERING
              |              |              |
              +--------------+--------------+
                             |
                             v
                          FINANCE
```

---

# 4. Architectural Principles

1. Procurement and inventory are separate business domains.
2. Departments create demand; Procurement manages sourcing and purchasing.
3. Inventory is the system of record for physical stock.
4. Finance is the system of record for financial liability and payment.
5. Supplier master data should be centralized.
6. Approval workflows must be configurable.
7. Every procurement transaction must have an audit trail.
8. Procurement must support both centralized and property-level purchasing.
9. Emergency procurement must be supported but controlled.
10. Procurement must integrate with hotel demand forecasts.
11. No portal should duplicate another portal's system-of-record responsibilities.
12. All portals should communicate through standardized APIs/events.

---

# 5. Portal Modules

```text
Supply Chain & Procurement
|
+-- Executive Dashboard
|
+-- Demand Planning
|
+-- Procurement Planning
|
+-- Purchase Requisitions
|
+-- Sourcing
|   +-- RFQ
|   +-- Tender
|   +-- Quotations
|   +-- Comparison
|   +-- Negotiation
|   +-- Supplier Award
|
+-- Purchasing
|   +-- Purchase Orders
|   +-- PO Approvals
|   +-- PO Amendments
|   +-- PO Tracking
|
+-- Supplier Management
|   +-- Supplier Directory
|   +-- Onboarding
|   +-- Qualification
|   +-- Evaluation
|   +-- Performance
|   +-- Risk
|   +-- Documents
|
+-- Contract Management
|
+-- Procurement Budget
|
+-- Receiving Coordination
|
+-- Procurement Risk
|
+-- Procurement Analytics
|
+-- Reports
|
+-- Configuration
```

---

# 6. Executive Dashboard

## KPI Cards

- Total Procurement Spend
- Monthly Procurement Spend
- Annual Procurement Spend
- Open Purchase Requisitions
- Pending Approvals
- Open RFQs
- Open Purchase Orders
- Overdue Purchase Orders
- Pending Deliveries
- Procurement Savings
- Budget Utilization
- Supplier Performance
- Contract Expiry
- Supplier Risk

## Dashboard Sections

```text
+------------------------------------------------------------+
| SUPPLY CHAIN & PROCUREMENT                                 |
+------------------------------------------------------------+
| Spend | Open PR | Open PO | Approvals | Savings | Budget |
+------------------------------------------------------------+
| Procurement Spend Trend                                   |
+---------------------------+--------------------------------+
| Open Requisitions         | Supplier Performance          |
+---------------------------+--------------------------------+
| Delivery Alerts           | Contract Expiry              |
+---------------------------+--------------------------------+
| Budget Utilization        | Supplier Risk                |
+---------------------------+--------------------------------+
```

---

# 7. Procurement Alerts

The portal should generate alerts for:

- Purchase requisition pending approval
- Purchase order pending approval
- Critical procurement requirement
- RFQ deadline
- Supplier quotation received
- Delayed supplier delivery
- Overdue purchase order
- Contract expiry
- Supplier qualification expiry
- Supplier certification expiry
- Price increase
- Budget exceeded
- Supplier performance decline
- High supplier concentration
- Emergency purchase
- Unusual procurement activity

---

# 8. Demand Planning

Demand can originate from:

- Food & Beverage
- Kitchen
- Housekeeping
- Engineering & Maintenance
- Spa & Wellness
- Banquet & Events
- Transportation & Fleet
- Human Resources
- Administration
- Security & Risk
- IT
- Other hotel departments

## Demand Sources

- Current inventory
- Minimum stock
- Maximum stock
- Par level
- Reorder point
- Historical consumption
- Occupancy forecast
- Restaurant forecast
- Banquet events
- Spa bookings
- Maintenance schedules
- Seasonal demand
- Supplier lead time
- Open purchase orders
- Expected deliveries

## Demand Flow

```text
Occupancy / Business Forecast
            +
Historical Consumption
            +
Department Requirements
            +
Current Inventory
            +
Open Purchase Orders
            +
Future Events
            |
            v
      Demand Forecast
            |
            v
     Procurement Need
            |
            v
    Purchase Requisition
```

---

# 9. Procurement Planning

Procurement planning converts expected demand into a purchasing plan.

## Planning Horizons

- Daily
- Weekly
- Monthly
- Quarterly
- Annual

## Planning Factors

- Occupancy
- Forecast rooms sold
- Restaurant covers
- Banquet events
- Spa appointments
- Maintenance plans
- Seasonal demand
- Supplier lead time
- Contract commitments
- Inventory levels
- Budget availability

---

# 10. Purchase Requisitions

A Purchase Requisition (PR) is an internal request to purchase goods or services.

## Header

- PR Number
- Property
- Department
- Requester
- Request Date
- Required Date
- Priority
- Cost Center
- Budget
- Purpose
- Notes
- Attachments

## Lines

- Item
- Description
- Category
- Quantity
- Unit
- Estimated Unit Price
- Estimated Total
- Required Date
- Preferred Supplier
- Specification
- Cost Center

## Status

```text
Draft
  ↓
Submitted
  ↓
Under Review
  ↓
Approved
  ↓
Sourcing
  ↓
Converted to PO
  ↓
Partially Fulfilled
  ↓
Fully Fulfilled
  ↓
Closed
```

Alternative statuses:

- Rejected
- Returned
- Cancelled
- On Hold

---

# 11. Purchase Requisition Priorities

- Low
- Normal
- High
- Urgent
- Critical
- Emergency

Priority affects:

- Approval routing
- Sourcing priority
- Supplier response deadline
- Delivery requirement
- Escalation

---

# 12. Procurement Categories

## Food & Beverage

- Food
- Beverage
- Dry Goods
- Fresh Produce
- Meat
- Seafood
- Dairy
- Bakery Supplies
- Packaging

## Housekeeping

- Cleaning Chemicals
- Guest Amenities
- Linen
- Towels
- Laundry Supplies
- Guest Room Supplies

## Engineering

- Electrical
- Plumbing
- HVAC
- Mechanical
- Tools
- Spare Parts
- Building Materials

## Spa & Wellness

- Treatment Products
- Massage Oils
- Beauty Supplies
- Consumables
- Retail Products

## Banquet & Events

- Event Supplies
- Catering Supplies
- Decorations
- Disposable Items

## Transportation & Fleet

- Vehicle Parts
- Tires
- Lubricants
- Vehicle Supplies
- Cleaning Materials

## Administration

- Office Supplies
- Stationery
- Furniture
- IT Equipment

---

# 13. Sourcing Management

Sourcing manages competitive procurement.

## Functions

- Create sourcing event
- Select suppliers
- Issue RFQ
- Issue tender
- Receive quotations
- Compare suppliers
- Negotiate
- Evaluate
- Award supplier
- Create purchase order

---

# 14. RFQ Management

RFQ = Request for Quotation.

## RFQ Header

- RFQ Number
- Property
- Department
- Procurement Officer
- Issue Date
- Response Deadline
- Currency
- Delivery Requirement
- Terms
- Conditions

## RFQ Lines

- Item
- Specification
- Quantity
- Unit
- Required Delivery Date
- Quality Requirement

---

# 15. Supplier Selection for RFQ

Suppliers can be selected from:

- Approved suppliers
- Preferred suppliers
- Qualified suppliers
- Local suppliers
- Strategic suppliers

The system should prevent RFQs from being issued to suppliers that are:

- Suspended
- Disqualified
- Expired
- Non-compliant

---

# 16. Supplier Quotations

Capture:

- Supplier
- Item
- Quantity
- Unit Price
- Currency
- Tax
- Discount
- Freight
- Delivery Cost
- Lead Time
- Payment Terms
- Warranty
- Quote Validity
- Minimum Order Quantity
- Supplier Notes

---

# 17. Quotation Comparison

The system must provide side-by-side comparison.

| Supplier | Price | Delivery | Quality | Payment | Score |
|---|---:|---:|---:|---|---:|
| Supplier A | 100 | 3 days | 95% | 30 days | 92 |
| Supplier B | 95 | 7 days | 88% | 15 days | 84 |
| Supplier C | 110 | 2 days | 97% | 45 days | 94 |

## Weighted Evaluation Example

```text
Price                30%
Quality              25%
Delivery             20%
Supplier Rating      10%
Payment Terms        10%
Sustainability        5%
-------------------------
Total               100%
```

Weights must be configurable.

---

# 18. Supplier Award

The procurement officer creates an award recommendation.

## Award Data

- Supplier
- Award Amount
- Evaluation Score
- Award Reason
- Negotiated Price
- Delivery Terms
- Contract Reference
- Approval Status

High-value awards require configurable approval.

---

# 19. Purchase Orders

A Purchase Order is the formal purchasing commitment to a supplier.

## Header

- PO Number
- Property
- Supplier
- Buyer
- Department
- Cost Center
- Currency
- Order Date
- Required Delivery Date
- Delivery Location
- Payment Terms
- Contract
- Notes

## Lines

- Item
- Description
- Quantity
- Unit
- Unit Price
- Discount
- Tax
- Total
- Required Date
- Specification

---

# 20. Purchase Order Status

```text
Draft
  ↓
Pending Approval
  ↓
Approved
  ↓
Sent to Supplier
  ↓
Supplier Acknowledged
  ↓
Partially Received
  ↓
Fully Received
  ↓
Closed
```

Alternative statuses:

- Rejected
- Cancelled
- On Hold
- Expired

---

# 21. Purchase Order Amendments

Controlled PO amendments may change:

- Quantity
- Unit Price
- Supplier
- Delivery Date
- Tax
- Currency
- Payment Terms
- Total Value

Every amendment must record:

- User
- Date/time
- Previous value
- New value
- Reason
- Approval

---

# 22. Supplier Management

```text
Supplier
|
+-- Profile
+-- Contacts
+-- Categories
+-- Documents
+-- Certifications
+-- Tax Information
+-- Bank Information
+-- Contracts
+-- Pricing
+-- Performance
+-- Risk
+-- Transaction History
```

---

# 23. Supplier Profile

## General

- Supplier Code
- Legal Name
- Trading Name
- Supplier Type
- Supplier Category
- Status

## Contact

- Address
- Phone
- Email
- Website
- Contact Persons

## Compliance

- Tax Registration
- Business License
- Certifications
- Insurance
- Regulatory Documents

## Commercial

- Currency
- Payment Terms
- Delivery Terms
- Lead Time
- Minimum Order Quantity

---

# 24. Supplier Status

- Application
- Under Review
- Pending Approval
- Active
- Preferred
- Restricted
- Suspended
- Disqualified
- Inactive

---

# 25. Supplier Onboarding

```text
Supplier Application
        ↓
Document Submission
        ↓
Procurement Review
        ↓
Compliance Review
        ↓
Finance Verification
        ↓
Approval
        ↓
Supplier Activated
```

---

# 26. Supplier Qualification

Qualification criteria:

- Legal compliance
- Product quality
- Financial capability
- Delivery capacity
- Production capacity
- Certifications
- Food safety
- Insurance
- References
- Sustainability
- Regulatory compliance

---

# 27. Supplier Documents

Supported documents:

- Business License
- Tax Certificate
- Insurance
- Food Safety Certificate
- Quality Certificate
- Environmental Certificate
- Bank Letter
- Contract
- NDA
- Other compliance documents

Track:

- Issue Date
- Expiry Date
- Document Status
- Verification Status

---

# 28. Supplier Performance

Measure:

- On-Time Delivery
- Delivery Accuracy
- Product Quality
- Rejection Rate
- Price Stability
- Response Time
- Complaint Rate
- Contract Compliance

## Supplier Score

```text
Quality              30%
On-Time Delivery     25%
Price                20%
Service              15%
Compliance           10%
-------------------------
Total               100%
```

Ratings:

- Excellent
- Good
- Acceptable
- Poor
- Critical

---

# 29. Supplier Risk

Monitor:

- Single-source dependency
- Financial risk
- Delivery risk
- Quality risk
- Compliance risk
- Geographic risk
- Price volatility
- Contract dependency

Risk levels:

- Low
- Medium
- High
- Critical

---

# 30. Supplier Concentration

Example:

```text
Food Category

Supplier A = 75%
Supplier B = 15%
Supplier C = 10%

Result:
HIGH SUPPLIER CONCENTRATION RISK
```

The system should automatically identify concentration above configured thresholds.

---

# 31. Contract Management

Manage:

- Supplier Contracts
- Framework Agreements
- Rate Agreements
- Service Agreements
- Volume Agreements
- Long-Term Agreements
- Exclusive Agreements

## Contract Data

- Contract Number
- Supplier
- Property
- Category
- Start Date
- End Date
- Renewal Date
- Contract Value
- Currency
- Payment Terms
- SLA
- Penalties
- Minimum Commitment
- Maximum Commitment
- Pricing Rules

---

# 32. Contract Lifecycle

```text
Draft
  ↓
Review
  ↓
Approval
  ↓
Active
  ↓
Renewal Review
  ↓
Renewed / Expired
  ↓
Closed
```

---

# 33. Contract Alerts

Generate alerts for:

- 90 days before expiry
- 60 days before expiry
- 30 days before expiry
- Renewal date
- SLA breach
- Price review
- Minimum volume
- Maximum volume

Alert periods must be configurable.

---

# 34. Supplier Pricing

Maintain:

- Current Price
- Contract Price
- Negotiated Price
- Historical Price
- Market Reference Price

Track:

- Effective Date
- Expiry Date
- Currency
- Minimum Quantity
- Supplier
- Contract

---

# 35. Purchase Price Variance

```text
PPV =
Actual Purchase Price
-
Standard / Contract Price
```

Analyze by:

- Supplier
- Item
- Category
- Department
- Property
- Period

---

# 36. Procurement Savings

Track:

- Competitive bidding savings
- Negotiation savings
- Supplier consolidation savings
- Contract savings
- Volume discounts
- Cost avoidance

```text
Original Price
      ↓
Negotiated Price
      ↓
Actual Purchase Price
      ↓
Procurement Savings
```

---

# 37. Procurement Budget

Manage:

- Annual Budget
- Monthly Budget
- Department Budget
- Category Budget
- Property Budget
- Committed Spend
- Actual Spend
- Remaining Budget

## Budget Control

```text
Available Budget
      ↓
PO Commitment
      ↓
Remaining Budget
```

Support:

- Hard budget control
- Soft budget warning
- Budget override
- Emergency exception

---

# 38. Emergency Procurement

Emergency purchasing supports:

- Critical equipment failure
- Food shortage
- Guest safety
- Utility failure
- Security emergency
- Critical maintenance
- Regulatory requirements

Required information:

- Emergency reason
- Requester
- Approval
- Supplier
- Amount
- Supporting documentation
- Post-purchase review

## Emergency Flow

```text
Emergency Requirement
        ↓
Emergency PR
        ↓
Emergency Approval
        ↓
Approved Supplier
        ↓
Purchase
        ↓
Delivery
        ↓
Receiving
        ↓
Inventory
        ↓
Finance
        ↓
Post-Purchase Review
```

---

# 39. Direct Purchase

Direct purchasing can be allowed for:

- Low-value purchases
- Emergency purchases
- Approved suppliers
- Specialized items

Direct purchase thresholds are configurable.

---

# 40. Receiving Coordination

Procurement creates the Purchase Order.

Inventory & Stores performs the physical receiving.

```text
Purchase Order
      ↓
Supplier Delivery
      ↓
Receiving
      ↓
Quantity Check
      ↓
Quality Check
      ↓
Goods Receipt
      ↓
Inventory
```

Receiving supports:

- Full receipt
- Partial receipt
- Short delivery
- Over delivery
- Damaged goods
- Rejected goods
- Backorders

The Inventory & Stores Portal owns the final stock transaction.

---

# 41. Three-Way Matching

```text
Purchase Order
       +
Goods Receipt
       +
Supplier Invoice
       ↓
Three-Way Match
       ↓
Matched
       ↓
Finance Payment
```

Variance:

```text
Variance
   ↓
Exception
   ↓
Review
   ↓
Correction / Approval
```

---

# 42. Procurement Approvals

Approval types:

- Purchase Requisition
- RFQ Award
- Purchase Order
- Contract
- Supplier Activation
- Supplier Suspension
- Price Override
- Emergency Purchase
- Budget Exception

Approval routing is controlled by the centralized workflow engine.

---

# 43. Approval Conditions

Approval can depend on:

- Amount
- Department
- Property
- Category
- Cost Center
- Supplier
- Budget
- Purchase Type
- Emergency Status

---

# 44. Approval Delegation

Support:

- Temporary delegation
- Manager substitution
- Leave delegation
- Escalation
- Approval timeout
- Automatic reassignment

---

# 45. F&B Integration

The F&B Portal can provide:

- Forecast demand
- Recipe requirements
- Production requirements
- Menu requirements
- Event requirements
- Procurement requests

```text
Occupancy Forecast
       +
Restaurant Forecast
       +
Banquet Forecast
       ↓
F&B Demand
       ↓
Inventory Availability
       ↓
Procurement Requirement
```

The F&B Portal remains responsible for recipes, menu management, production, POS and KDS operations.

---

# 46. Housekeeping Integration

Requirements may include:

- Linen
- Towels
- Cleaning chemicals
- Guest amenities
- Laundry supplies
- Guest room supplies

Housekeeping owns operational consumption and room-related workflows.

---

# 47. Engineering & Maintenance Integration

Requirements may include:

- Spare parts
- Electrical components
- Plumbing components
- HVAC parts
- Tools
- Building materials
- Maintenance consumables

Engineering owns maintenance work orders and technical asset management.

---

# 48. Spa & Wellness Integration

Requirements may include:

- Massage oils
- Treatment products
- Beauty supplies
- Disposable products
- Retail products
- Towels

---

# 49. Banquet & Events Integration

Requirements may include:

- Event food
- Beverage
- Disposable supplies
- Decorations
- Event equipment
- Catering materials

Banquet event requirements should be generated from approved event plans/BEOs where applicable.

---

# 50. Transportation & Fleet Integration

Requirements may include:

- Vehicle spare parts
- Tires
- Lubricants
- Cleaning materials
- Fleet consumables

Fleet remains responsible for vehicle records, maintenance, dispatch and transportation operations.

---

# 51. HR Integration

HR-related procurement may include:

- Uniforms
- Employee supplies
- Training materials
- Staff facilities
- Recruitment supplies

HR remains responsible for employee records and payroll.

---

# 52. Security & Risk Integration

Security & Risk may request:

- Security equipment
- Safety equipment
- PPE
- Emergency supplies
- Compliance materials

Security and Risk remains responsible for security incidents, risk management and compliance controls.

---

# 53. Revenue Management Integration

Revenue Management provides:

- Occupancy forecasts
- Demand forecasts
- Seasonal forecasts
- Event forecasts

Procurement uses these forecasts for future demand planning.

---

# 54. Inventory & Stores Integration

Inventory sends:

- Reorder requirements
- Stock availability
- Minimum stock alerts
- Maximum stock information
- Procurement requirements

Procurement sends:

- Purchase Orders
- Supplier information
- Expected delivery dates
- Contract pricing

## Flow

```text
Inventory
   ↓
Reorder Requirement
   ↓
Procurement
   ↓
Purchase Requisition
   ↓
Purchase Order
   ↓
Supplier
   ↓
Delivery
   ↓
Inventory Receiving
```

---

# 55. Finance & Accounting Integration

Supply Chain & Procurement integrates with Finance for:

- Budget
- Purchase commitments
- Supplier master
- Purchase orders
- Goods receipts
- Supplier invoices
- Accounts payable
- Tax
- Payments

Finance remains the accounting system of record.

---

# 56. Executive BI Integration

Procurement provides:

- Spend
- Supplier performance
- Savings
- PO cycle time
- Price variance
- Category spend
- Budget utilization
- Supplier risk

Executive BI should consume procurement data without becoming the transactional system of record.

---

# 57. System Administration Integration

System Administration controls:

- Users
- Roles
- Permissions
- Approval thresholds
- Procurement workflows
- Supplier statuses
- Master data
- Configuration
- Audit
- Feature flags
- Property access
- Department access

---

# 58. Procurement Roles

## Procurement Officer

- Create RFQ
- Manage quotations
- Create PO
- Manage suppliers
- Track deliveries

## Buyer

- Sourcing
- Negotiation
- Supplier selection
- Purchase orders

## Procurement Manager

- Approvals
- Supplier management
- Contract management
- Procurement strategy

## Supply Chain Manager

- Demand planning
- Supplier strategy
- Inventory coordination
- Supply risk

## General Manager

- High-value approvals
- Strategic contracts
- Exception approvals

---

# 59. Department Roles

## Department Requester

- Create PR
- Track PR
- Confirm requirements

## Department Manager

- Review PR
- Approve PR
- Monitor department procurement

---

# 60. Finance Roles

Finance users may:

- View procurement commitments
- Verify budgets
- Review supplier information
- Match invoices
- Process payments

---

# 61. Supplier Portal

Optional external supplier access.

Suppliers can:

- Maintain company profile
- Submit documents
- Receive RFQs
- Submit quotations
- View POs
- Confirm POs
- Confirm delivery
- Submit shipping information
- View approved contract information

Suppliers must never access internal hotel information outside their authorized records.

---

# 62. Notifications

## Internal Notifications

- PR submitted
- PR approved
- PR rejected
- RFQ issued
- Quotation received
- Supplier awarded
- PO created
- PO approved
- PO sent
- PO delayed
- Contract expiring
- Supplier qualification expiring
- Budget exceeded

## Supplier Notifications

- RFQ invitation
- RFQ deadline
- Award notification
- PO issued
- PO amendment
- Delivery reminder

---

# 63. Reports

## Daily

- Open PR Report
- Pending Approval Report
- Open PO Report
- Late PO Report
- Pending Delivery Report
- Emergency Purchase Report

## Weekly

- Procurement Activity
- Supplier Performance
- PO Aging
- Price Variance
- Outstanding Orders

## Monthly

- Procurement Spend
- Category Spend
- Supplier Spend
- Savings Report
- Budget Utilization
- Contract Expiry
- Supplier Performance

## Executive

- Total Procurement Spend
- Procurement Savings
- Supplier Risk
- Supplier Concentration
- Price Trends
- Contract Exposure
- Procurement Cycle Time

---

# 64. Procurement Analytics

## Spend Analytics

Analyze by:

- Property
- Department
- Supplier
- Category
- Item
- Month
- Year

## Supplier Analytics

- Supplier Score
- Delivery Performance
- Quality
- Price Performance
- Compliance

## Purchasing Analytics

- PR Cycle Time
- PO Cycle Time
- RFQ Cycle Time
- Approval Time
- Delivery Time
- Purchase Price Variance

---

# 65. Procurement KPIs

## Procurement KPIs

- Total Spend
- Spend Under Contract
- Spend Under Management
- Procurement Savings
- PR Cycle Time
- PO Cycle Time
- Approval Cycle Time

## Supplier KPIs

- On-Time Delivery %
- Delivery Accuracy %
- Quality Acceptance %
- Supplier Score
- Supplier Concentration

## Financial KPIs

- Budget Utilization
- Purchase Price Variance
- Contract Savings
- Cost Avoidance

---

# 66. Procurement Risk Management

Risk categories:

```text
Supplier Risk
Financial Risk
Delivery Risk
Quality Risk
Compliance Risk
Price Risk
Concentration Risk
Contract Risk
Operational Risk
```

## Risk Scoring

```text
Likelihood × Impact = Risk Score
```

Levels:

- Low
- Medium
- High
- Critical

---

# 67. Sustainability

Optional sustainability capabilities:

- Local supplier
- Sustainable supplier
- Eco certification
- Sustainable packaging
- Ethical sourcing
- Environmental score
- Carbon information

---

# 68. Master Data

Managed centrally where appropriate:

- Procurement Categories
- Subcategories
- Units of Measure
- Purchase Types
- Supplier Types
- Supplier Statuses
- Payment Terms
- Delivery Terms
- Currency
- Tax Codes
- Approval Thresholds
- Procurement Policies
- Contract Types

---

# 69. Document Management

Documents include:

- RFQ
- Supplier quotation
- Purchase order
- Contract
- Supplier license
- Supplier certificate
- Delivery note
- Goods receipt
- Compliance document
- Supplier evaluation
- Approval evidence

Documents should support:

- Versioning
- Expiry
- Access control
- Audit trail

---

# 70. Audit Trail

Every important transaction must record:

- User
- Date
- Time
- Action
- Record ID
- Previous value
- New value
- Reason
- Approval information

Examples:

```text
PO Created
PO Approved
PO Modified
Supplier Activated
Supplier Suspended
Contract Renewed
Price Changed
Budget Override
Emergency Purchase Approved
```

---

# 71. Security

Security requirements:

- RBAC
- MFA
- Property-level permissions
- Department-level permissions
- Category-level permissions
- Approval segregation
- Supplier data protection
- Financial data protection
- Audit logging
- Session controls

---

# 72. Segregation of Duties

The system should prevent conflicts such as:

```text
Create Supplier
       X
Approve Own Supplier
```

```text
Create PO
       X
Approve Own PO
```

```text
Create Supplier
       X
Approve Supplier Payment
```

Segregation rules must be configurable.

---

# 73. Multi-Property Architecture

```text
Hotel Group
|
+-- Brand A
|   +-- Property 1
|   +-- Property 2
|
+-- Brand B
|   +-- Property 3
|   +-- Property 4
|
+-- Corporate Procurement
```

Procurement can operate at:

- Corporate
- Brand
- Property
- Department

---

# 74. Centralized Procurement

Corporate procurement can negotiate:

- Group contracts
- Volume discounts
- Preferred suppliers
- Standard pricing
- Framework agreements

Properties can issue POs against approved agreements.

---

# 75. Local Procurement

Properties can maintain:

- Local suppliers
- Local RFQs
- Local purchasing
- Local contracts

Subject to corporate procurement policies and approval limits.

---

# 76. Shared Supplier Master

The same supplier should not be unnecessarily duplicated.

```text
Supplier
   |
   +-- Property A
   +-- Property B
   +-- Property C
   +-- Corporate Contract
```

Support property-specific:

- Pricing
- Payment terms
- Delivery terms
- Contact persons
- Contract relationships

---

# 77. Procurement Lifecycle

```text
PLAN
  ↓
IDENTIFY DEMAND
  ↓
REQUISITION
  ↓
APPROVAL
  ↓
SOURCE
  ↓
RFQ / TENDER
  ↓
EVALUATE
  ↓
NEGOTIATE
  ↓
AWARD
  ↓
PURCHASE ORDER
  ↓
APPROVAL
  ↓
SUPPLIER
  ↓
DELIVERY
  ↓
RECEIVING
  ↓
INVENTORY
  ↓
INVOICE
  ↓
THREE-WAY MATCH
  ↓
PAYMENT
  ↓
SUPPLIER PERFORMANCE
```

---

# 78. Ownership Matrix

| Capability | Owner |
|---|---|
| Supplier Master | Supply Chain & Procurement |
| Supplier Qualification | Supply Chain & Procurement |
| RFQ | Supply Chain & Procurement |
| Quotation | Supply Chain & Procurement |
| Supplier Selection | Supply Chain & Procurement |
| Purchase Requisition | Requesting Department / Procurement |
| Purchase Order | Supply Chain & Procurement |
| Contract | Supply Chain & Procurement |
| Procurement Approval | Workflow / Authorized Managers |
| Goods Receipt | Inventory & Stores |
| Stock | Inventory & Stores |
| Stock Consumption | Inventory & Stores |
| Supplier Invoice | Finance |
| Accounts Payable | Finance |
| Supplier Payment | Finance |
| Procurement Budget | Finance + Procurement |
| Procurement Analytics | Procurement + Executive BI |

---

# 79. Data Ownership

```text
SUPPLIER
Supply Chain & Procurement

PURCHASE REQUISITION
Supply Chain & Procurement

RFQ
Supply Chain & Procurement

QUOTATION
Supply Chain & Procurement

PURCHASE ORDER
Supply Chain & Procurement

CONTRACT
Supply Chain & Procurement

GOODS RECEIPT
Inventory & Stores

STOCK
Inventory & Stores

CONSUMPTION
Inventory & Stores

SUPPLIER INVOICE
Finance

PAYMENT
Finance

GENERAL LEDGER
Finance
```

---

# 80. Recommended Navigation

```text
Dashboard

Procurement
├── Purchase Requisitions
├── RFQs
├── Quotations
├── Purchase Orders
└── Procurement Approvals

Sourcing
├── Sourcing Events
├── Supplier Comparison
├── Supplier Awards
└── Negotiations

Suppliers
├── Supplier Directory
├── Onboarding
├── Qualification
├── Performance
├── Risk
└── Documents

Contracts
├── Active Contracts
├── Expiring Contracts
├── Renewals
└── Contract Performance

Planning
├── Demand Forecast
├── Procurement Plan
├── Reorder Requests
└── Supply Forecast

Budget
├── Procurement Budget
├── Commitments
├── Utilization
└── Exceptions

Receiving
├── Expected Deliveries
├── Delayed Deliveries
├── Partial Deliveries
└── Receiving Exceptions

Analytics
├── Spend
├── Supplier
├── Savings
├── Price Variance
├── Budget
└── Procurement KPIs

Reports

Configuration
```

---

# 81. API Architecture

The portal should expose APIs for:

- Suppliers
- Purchase Requisitions
- RFQs
- Quotations
- Purchase Orders
- Contracts
- Procurement Approvals
- Delivery Status
- Procurement Spend

Example endpoints:

```text
GET    /api/procurement/suppliers
POST   /api/procurement/suppliers

GET    /api/procurement/requisitions
POST   /api/procurement/requisitions

GET    /api/procurement/rfqs
POST   /api/procurement/rfqs

GET    /api/procurement/quotations
POST   /api/procurement/quotations

GET    /api/procurement/purchase-orders
POST   /api/procurement/purchase-orders

GET    /api/procurement/contracts
POST   /api/procurement/contracts
```

---

# 82. Event Architecture

Important events:

```text
PurchaseRequisitionCreated
PurchaseRequisitionSubmitted
PurchaseRequisitionApproved
PurchaseRequisitionRejected

RFQCreated
RFQIssued
QuotationSubmitted
QuotationEvaluated
SupplierAwarded

PurchaseOrderCreated
PurchaseOrderApproved
PurchaseOrderSent
PurchaseOrderAcknowledged
PurchaseOrderAmended
PurchaseOrderCancelled

DeliveryExpected
DeliveryDelayed
GoodsReceived

ContractCreated
ContractExpiring
ContractRenewed

SupplierActivated
SupplierSuspended

BudgetExceeded
EmergencyPurchaseApproved
```

---

# 83. Integration Map

| Portal | Direction | Main Data |
|---|---|---|
| F&B | Bi-directional | Demand, recipe requirements, procurement |
| Inventory & Stores | Bi-directional | Reorder, PO, receiving |
| Finance & Accounting | Bi-directional | Budget, PO, invoices, payments |
| Housekeeping | Incoming | Procurement requirements |
| Engineering | Incoming | Spare parts requirements |
| Spa & Wellness | Incoming | Consumable requirements |
| Banquet & Events | Incoming | Event procurement |
| Transportation & Fleet | Incoming | Fleet procurement |
| HR & Payroll | Incoming | Staff-related procurement |
| Security & Risk | Bi-directional | Compliance and supplier risk |
| Revenue Management | Incoming | Forecast |
| Executive BI | Outgoing | Procurement analytics |
| System Administration | Bi-directional | Users, workflows, configuration |

---

# 84. End-to-End Hotel Procurement Example

```text
Forecast Occupancy
       ↓
F&B / Housekeeping / Engineering Demand
       ↓
Inventory Availability Check
       ↓
Procurement Requirement
       ↓
Purchase Requisition
       ↓
Department Approval
       ↓
Procurement Review
       ↓
RFQ
       ↓
Supplier Quotations
       ↓
Supplier Comparison
       ↓
Negotiation
       ↓
Supplier Award
       ↓
Purchase Order
       ↓
PO Approval
       ↓
Supplier Confirmation
       ↓
Delivery
       ↓
Inventory Receiving
       ↓
Goods Receipt
       ↓
Supplier Invoice
       ↓
Three-Way Match
       ↓
Finance Payment
       ↓
Supplier Performance Update
```

---

# 85. Final Portal Architecture

```text
                    SYSTEM ADMINISTRATION
                             |
                             v
               SUPPLY CHAIN & PROCUREMENT
                             |
      +----------------------+----------------------+
      |                      |                      |
      v                      v                      v
   DEMAND                 SUPPLIERS             CONTRACTS
      |                      |                      |
      +----------------------+----------------------+
                             |
                             v
                          SOURCING
                             |
              +--------------+--------------+
              |              |              |
              v              v              v
             RFQ        QUOTATIONS       TENDER
              |              |              |
              +--------------+--------------+
                             |
                             v
                       SUPPLIER AWARD
                             |
                             v
                      PURCHASE ORDER
                             |
                             v
                          SUPPLIER
                             |
                             v
                         DELIVERY
                             |
                             v
                    INVENTORY & STORES
                             |
          +------------------+------------------+
          |                  |                  |
          v                  v                  v
         F&B           HOUSEKEEPING      ENGINEERING
          |                  |                  |
          +------------------+------------------+
                             |
                             v
                          FINANCE
                             |
                             v
                      ACCOUNTS PAYABLE
                             |
                             v
                         PAYMENT
```

---

# 86. Final Portal Boundary

## Supply Chain & Procurement

> Acquire and manage external goods and services.

## Inventory & Stores

> Control physical stock, storage, receiving, movement, and consumption.

## Finance & Accounting

> Record financial liability, accounting entries, and payments.

## Hotel Departments

> Generate demand and consume resources.

---

# 87. Final Principle

The unified hotel ERP should follow:

```text
DEPARTMENTS
    |
    | What do we need?
    v
PROCUREMENT
    |
    | How / from whom / at what price?
    v
PURCHASING
    |
    | What was ordered?
    v
SUPPLIER
    |
    | What was delivered?
    v
INVENTORY
    |
    | What is physically available?
    v
CONSUMPTION
    |
    | What was used?
    v
FINANCE
    |
    | What is owed and paid?
    v
ACCOUNTING
```

This separation keeps Supply Chain & Procurement, Inventory & Stores, and Finance & Accounting independent while maintaining a single integrated hotel procurement lifecycle.

---

# 88. Final Recommended Structure

```text
SUPPLY CHAIN & PROCUREMENT
│
├── Executive Dashboard
├── Demand Planning
├── Procurement Planning
├── Purchase Requisitions
├── Sourcing
│   ├── RFQ
│   ├── Tender
│   ├── Quotations
│   ├── Comparison
│   ├── Negotiation
│   └── Supplier Award
│
├── Purchasing
│   ├── Purchase Orders
│   ├── PO Approvals
│   ├── PO Amendments
│   └── PO Tracking
│
├── Suppliers
│   ├── Supplier Directory
│   ├── Onboarding
│   ├── Qualification
│   ├── Evaluation
│   ├── Performance
│   ├── Risk
│   └── Documents
│
├── Contracts
│   ├── Active Contracts
│   ├── Renewals
│   ├── Expiring Contracts
│   └── Contract Performance
│
├── Budget
│   ├── Procurement Budget
│   ├── Commitments
│   ├── Utilization
│   └── Exceptions
│
├── Receiving Coordination
│   ├── Expected Deliveries
│   ├── Delayed Deliveries
│   ├── Partial Deliveries
│   └── Receiving Exceptions
│
├── Risk Management
│
├── Analytics
│   ├── Spend
│   ├── Supplier Performance
│   ├── Savings
│   ├── Price Variance
│   ├── Budget
│   └── KPIs
│
├── Reports
│
└── Configuration
```

---

# End of Unified Supply Chain & Procurement Portal Specification
