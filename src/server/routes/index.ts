/**
 * Composed API router — single mount point for all route files.
 *
 * Phase 2 of the route-driven migration (see ROUTE_DRIVEN_MIGRATION_PLAN.md).
 *
 * All 200 inline handlers that were in server.ts have been extracted into
 * route files and are mounted here. server.ts now only contains the health
 * endpoint and the Vite SPA middleware — all API routing goes through this
 * composed router.
 *
 * Backward compatibility: every URL that resolved before the migration
 * continues to resolve identically because the same handler code runs at
 * the same effective paths. Only the module location changed.
 */

import { Router } from 'express';
import { resolveTenant } from '../middleware/tenant';
import { installTenantScopeFilter } from '../services/tenantScope';

// Auto-scope every service-role query to the request's tenant (ALS context
// populated by resolveTenant/authenticate). No-op without tenant context.
installTenantScopeFilter();

import b2bRoutes from './b2b.routes';
import financeRoutes from './finance.routes';
import financeV1Routes from './v1/finance.routes';
import budgetingRoutes from './budgeting.routes';
import taxRoutes from './tax.routes';
import fpaRoutes from './fpa.routes';
import multipropertyRoutes from './multiproperty.routes';
import posRoutes from './pos.routes';
import kdsRoutes from './kds.routes';
import kitchenRoutes from './kitchen.routes';
import barRoutes from './bar.routes';
import unifiedInventoryRoutes from './unifiedInventory.routes';
import unifiedProductRoutes from './unifiedProduct.routes';
import productionPlanningRoutes from './productionPlanning.routes';
import outletTransferRoutes from './outletTransfer.routes';
import costVarianceRoutes from './costVariance.routes';
import posSyncRoutes from './posSync.routes';
import managerPinRoutes from './managerPin.routes';
import menuEnhancementsRoutes from './menuEnhancements.routes';
import hardwareRoutes from './hardware.routes';
import tableManagementRoutes from './tableManagement.routes';
import procurementRoutes from './procurement.routes';
import menuAnalyticsRoutes from './menuAnalytics.routes';
import fbGuestExperienceRoutes from './fbGuestExperience.routes';
import guestStaffRoutes from './guestStaff.routes';
import fbStaffOperationsRoutes from './fbStaffOperations.routes';
import fbQualityComplianceRoutes from './fbQualityCompliance.routes';
import fbFinancialControlRoutes from './fbFinancialControl.routes';
import fbAnalyticsRoutes from './fbAnalytics.routes';
import fbReportsRoutes from './fbReports.routes';
import onlineOrderingRoutes from './onlineOrdering.routes';
import operationsCommandCenterRoutes from './operationsCommandCenter.routes';
import operationsDailyBriefingRoutes from './operationsDailyBriefing.routes';
import operationsMorningMeetingRoutes from './operationsMorningMeeting.routes';
import operationsApprovalCenterRoutes from './operationsApprovalCenter.routes';
import operationsDutyManagerRoutes from './operationsDutyManager.routes';
import operationsCrossDeptTasksRoutes from './operationsCrossDeptTasks.routes';
import operationsCalendarRoutes from './operationsCalendar.routes';
import operationsVipGuestsRoutes from './operationsVipGuests.routes';
import operationsGuestRecoveryRoutes from './operationsGuestRecovery.routes';
import operationsServiceQualityRoutes from './operationsServiceQuality.routes';
import operationsRoomOpsRoutes from './operationsRoomOps.routes';
import operationsOccupancyForecastRoutes from './operationsOccupancyForecast.routes';
import operationsEventCoordinationRoutes from './operationsEventCoordination.routes';
import operationsEmergencyRoutes from './operationsEmergency.routes';
import operationsCommunicationRoutes from './operationsCommunication.routes';
import operationsEscalationsRoutes from './operationsEscalations.routes';
import operationsSopComplianceRoutes from './operationsSopCompliance.routes';
import operationsExecChecklistsRoutes from './operationsExecChecklists.routes';
import operationsFlashReportsRoutes from './operationsFlashReports.routes';
import operationsReportsRoutes from './operationsReports.routes';
import operationsConfigurationRoutes from './operationsConfiguration.routes';
import operationsDashboardRoutes from './operationsDashboard.routes';
import executiveRoutes from './executive.routes';
import housekeepingPortalRoutes from './housekeepingPortal.routes';
import engineeringPortalRoutes from './engineeringPortal.routes';
import securityPortalRoutes from './securityPortal.routes';
import financePortalRoutes from './financePortal.routes';
import rmsPortalRoutes from './rmsPortal.routes';
import unifiedInventoryPortalRoutes from './unifiedInventoryPortal.routes';
import hrPayrollPortalRoutes from './hrPayrollPortal.routes';
import hrOrganizationRoutes from './hrOrganization.routes';
import hrEmployeesRoutes from './hrEmployees.routes';
import hrRecruitmentRoutes from './hrRecruitment.routes';
import hrAtsRoutes from './hrAts.routes';
import hrOnboardingRoutes from './hrOnboarding.routes';
import hrEssRoutes from './hrEss.routes';
import hrMssRoutes from './hrMss.routes';
import hrAttendanceRoutes from './hrAttendance.routes';
import hrShiftsRoutes from './hrShifts.routes';
import hrLeaveRoutes from './hrLeave.routes';
import hrOvertimeRoutes from './hrOvertime.routes';
import hrPayrollRoutes from './hrPayroll.routes';
import hrCompensationRoutes from './hrCompensation.routes';
import hrPerformanceRoutes from './hrPerformance.routes';
import hrLearningRoutes from './hrLearning.routes';
import hrTrainingRoutes from './hrTraining.routes';
import hrCareerRoutes from './hrCareer.routes';
import hrHealthRoutes from './hrHealth.routes';
import hrRelationsRoutes from './hrRelations.routes';
import hrDocumentsRoutes from './hrDocuments.routes';
import hrWorkflowRoutes from './hrWorkflow.routes';
import hrAnalyticsRoutes from './hrAnalytics.routes';
import hrConfigurationRoutes from './hrConfiguration.routes';
import hrDashboardRoutes from './hrDashboard.routes';
import hrStaffRoutes from './hrStaff.routes';
import hrFinanceRoutes from './hrFinance.routes';
import hrLifecycleRoutes from './hrLifecycle.routes';
import transportDriversRoutes from './transportDrivers.routes';
import transportShuttlesTripsRoutes from './transportShuttlesTrips.routes';
import transportRequestsRoutes from './transportRequests.routes';
import transportVehiclesRoutes from './transportVehicles.routes';
import transportAirportTransfersRoutes from './transportAirportTransfers.routes';
import transportGuestTransportsRoutes from './transportGuestTransports.routes';
import transportCorporateRoutes from './transportCorporate.routes';
import transportRoutesRoutes from './transportRoutes.routes';
import transportScheduleRoutes from './transportSchedule.routes';
import transportGpsRoutes from './transportGps.routes';
import transportFuelRoutes from './transportFuel.routes';
import transportMaintenanceRoutes from './transportMaintenance.routes';
import transportContractorsRoutes from './transportContractors.routes';
import transportBillingRoutes from './transportBilling.routes';
import transportMessagesRoutes from './transportMessages.routes';
import transportReportsRoutes from './transportReports.routes';
import transportConfigRoutes from './transportConfig.routes';
import transportDashboardRoutes from './transportDashboard.routes';
import transportIncidentsRoutes from './transportIncidents.routes';
import transportPricingRoutes from './transportPricing.routes';
import notificationsRoutes from './notifications.routes';
import procurementPortalRoutes from './procurementPortal.routes';
import salesEventsPortalRoutes from './salesEventsPortal.routes';
import banquetEventsRoutes from './banquetEvents.routes';
import guestMobilePortalRoutes from './guestMobilePortal.routes';
import accountsPayableRoutes from './accountsPayable.routes';
import bankReconciliationRoutes from './bankReconciliation.routes';
import treasuryRoutes from './treasury.routes';
import revenueAccountingRoutes from './revenueAccounting.routes';
import expenseManagementRoutes from './expenseManagement.routes';
import costCenterAccountingRoutes from './costCenterAccounting.routes';
import budgetingAccountingRoutes from './budgetingAccounting.routes';
import fixedAssetsRoutes from './fixedAssets.routes';
import trialBalanceRoutes from './trialBalance.routes';
import financialStatementsRoutes from './financialStatements.routes';
import ercaVatRoutes from './ercaVat.routes';
import periodCloseRoutes from './periodClose.routes';
import foodBeverageRoutes from './foodBeverage.routes';
import menuCatalogRoutes from './menuCatalog.routes';
import conciergeRoutes from './concierge.routes';
import spaWellnessRoutes from './spaWellness.routes';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import adminControlRoutes from './adminControl.routes';
import adminReportsRoutes from './adminReports.routes';
import reservationsRoutes from './reservations.routes';
import frontOfficeRoutes from './frontOffice.routes';
import inventoryRoutes from './inventory.routes';
import publicRoutes from './public.routes';
import reportsRoutes from './reports.routes';
import standardReportsRoutes from './standardReports.routes';
import giftShopRoutes from './giftShop.routes';
import groupProfilesRoutes from './groupProfiles.routes';
// Phase 2: new route files extracted from server.ts inline handlers
import auditRoutes from './audit.routes';
import settingsRoutes from './settings.routes';
import propertiesRoutes from './properties.routes';
import billingRoutes from './billing.routes';
import guestsRoutes from './guests.routes';
import preRegistrationsRoutes from './preRegistrations.routes';
import loyaltyRoutes from './loyalty.routes';
import reservationSeriesRoutes from './reservationSeries.routes';
import shareReservationsRoutes from './shareReservations.routes';
import foliosRoutes from './folios.routes';
import invoicesRoutes from './invoices.routes';
import nightAuditRoutes from './nightAudit.routes';
import forecastsRoutes from './forecasts.routes';
import ratesRoutes from './rates.routes';
import cashierShiftsRoutes from './cashierShifts.routes';
import channelsRoutes from './channels.routes';
import hrRoutes from './hr.routes';
import salesRoutes from './sales.routes';

const apiRouter = Router();

// Resolve <tenant>.seledabet.com → tenants row (no-op on main/admin subdomains)
apiRouter.use(resolveTenant);

// ── B2B & Finance ────────────────────────────────────────────────────────
apiRouter.use('/b2b', b2bRoutes);
apiRouter.use('/finance', financeRoutes);
apiRouter.use('/v1/finance', financeV1Routes);
apiRouter.use('/finance/budgeting', budgetingRoutes);
apiRouter.use('/finance/tax', taxRoutes);
apiRouter.use('/finance/fpa', fpaRoutes);
apiRouter.use('/finance/multiproperty', multipropertyRoutes);

// ── POS & F&B ────────────────────────────────────────────────────────────
apiRouter.use('/pos', posRoutes);
apiRouter.use('/kds', kdsRoutes);
apiRouter.use('/fb/kitchen', kitchenRoutes);
apiRouter.use('/fb/bar', barRoutes);
apiRouter.use('/fb/unified-inventory', unifiedInventoryRoutes);
apiRouter.use('/fb/unified-products', unifiedProductRoutes);
apiRouter.use('/fb/production-planning', productionPlanningRoutes);
apiRouter.use('/fb/outlet-transfers', outletTransferRoutes);
apiRouter.use('/fb/cost-variance', costVarianceRoutes);
apiRouter.use('/fb/pos-sync', posSyncRoutes);
apiRouter.use('/fb/manager-pin', managerPinRoutes);
apiRouter.use('/fb/menu-enhancements', menuEnhancementsRoutes);
apiRouter.use('/fb/menu-catalog', menuCatalogRoutes);
apiRouter.use('/hardware', hardwareRoutes);
apiRouter.use('/fb/tables', tableManagementRoutes);
apiRouter.use('/fb/procurement', procurementRoutes);
apiRouter.use('/fb/menu-analytics', menuAnalyticsRoutes);
apiRouter.use('/fb/guest-experience', fbGuestExperienceRoutes);
apiRouter.use('/fb/guest-staff', guestStaffRoutes);
apiRouter.use('/fb/staff-operations', fbStaffOperationsRoutes);
apiRouter.use('/fb/quality-compliance', fbQualityComplianceRoutes);
apiRouter.use('/fb/financial-control', fbFinancialControlRoutes);
apiRouter.use('/fb/analytics', fbAnalyticsRoutes);
apiRouter.use('/fb/reports', fbReportsRoutes);
apiRouter.use('/fb/online-ordering', onlineOrderingRoutes);

// ── Operations ───────────────────────────────────────────────────────────
apiRouter.use('/ops-portal', operationsCommandCenterRoutes);
apiRouter.use('/ops-portal', operationsDailyBriefingRoutes);
apiRouter.use('/ops-portal', operationsMorningMeetingRoutes);
apiRouter.use('/ops-portal', operationsApprovalCenterRoutes);
apiRouter.use('/ops-portal', operationsDutyManagerRoutes);
apiRouter.use('/ops-portal', operationsCrossDeptTasksRoutes);
apiRouter.use('/ops-portal', operationsCalendarRoutes);
apiRouter.use('/ops-portal', operationsVipGuestsRoutes);
apiRouter.use('/ops-portal', operationsGuestRecoveryRoutes);
apiRouter.use('/ops-portal', operationsServiceQualityRoutes);
apiRouter.use('/ops-portal', operationsRoomOpsRoutes);
apiRouter.use('/ops-portal', operationsOccupancyForecastRoutes);
apiRouter.use('/ops-portal', operationsEventCoordinationRoutes);
apiRouter.use('/ops-portal', operationsEmergencyRoutes);
apiRouter.use('/ops-portal', operationsCommunicationRoutes);
apiRouter.use('/ops-portal', operationsEscalationsRoutes);
apiRouter.use('/ops-portal', operationsSopComplianceRoutes);
apiRouter.use('/ops-portal', operationsExecChecklistsRoutes);
apiRouter.use('/ops-portal', operationsFlashReportsRoutes);
apiRouter.use('/ops-portal', operationsReportsRoutes);
apiRouter.use('/ops-portal', operationsConfigurationRoutes);
apiRouter.use('/ops-portal', operationsDashboardRoutes);

// ── Portals ──────────────────────────────────────────────────────────────
apiRouter.use('/executive', executiveRoutes);
apiRouter.use('/hk-portal', housekeepingPortalRoutes);
apiRouter.use('/eng-portal', engineeringPortalRoutes);
apiRouter.use('/sec-portal', securityPortalRoutes);
apiRouter.use('/fin-portal', financePortalRoutes);
apiRouter.use('/rms-portal', rmsPortalRoutes);
apiRouter.use('/uinv-portal', unifiedInventoryPortalRoutes);
apiRouter.use('/hr-portal', hrPayrollPortalRoutes);
apiRouter.use('/hr-portal/organization', hrOrganizationRoutes);
apiRouter.use('/hr-portal/employees', hrEmployeesRoutes);
apiRouter.use('/hr-portal/recruitment', hrRecruitmentRoutes);
apiRouter.use('/hr-portal/ats', hrAtsRoutes);
apiRouter.use('/hr-portal/onboarding', hrOnboardingRoutes);
apiRouter.use('/hr-portal/ess', hrEssRoutes);
apiRouter.use('/hr-portal/mss', hrMssRoutes);
apiRouter.use('/hr-portal/attendance', hrAttendanceRoutes);
apiRouter.use('/hr-portal/shifts', hrShiftsRoutes);
apiRouter.use('/hr-portal/leave', hrLeaveRoutes);
apiRouter.use('/hr-portal/overtime', hrOvertimeRoutes);
apiRouter.use('/hr-portal/payroll', hrPayrollRoutes);
apiRouter.use('/hr-portal/compensation', hrCompensationRoutes);
apiRouter.use('/hr-portal/performance', hrPerformanceRoutes);
apiRouter.use('/hr-portal/learning', hrLearningRoutes);
apiRouter.use('/hr-portal/training', hrTrainingRoutes);
apiRouter.use('/hr-portal/career', hrCareerRoutes);
apiRouter.use('/hr-portal/health', hrHealthRoutes);
apiRouter.use('/hr-portal/relations', hrRelationsRoutes);
apiRouter.use('/hr-portal/documents', hrDocumentsRoutes);
apiRouter.use('/hr-portal/workflow', hrWorkflowRoutes);
apiRouter.use('/hr-portal/analytics', hrAnalyticsRoutes);
apiRouter.use('/hr-portal/configuration', hrConfigurationRoutes);
apiRouter.use('/hr-portal/dashboard', hrDashboardRoutes);
apiRouter.use('/hr-portal/staff', hrStaffRoutes);
apiRouter.use('/hr-portal/finance', hrFinanceRoutes);
apiRouter.use('/hr-portal/lifecycle', hrLifecycleRoutes);
apiRouter.use('/transport/drivers', transportDriversRoutes);
apiRouter.use('/transport/shuttles-trips', transportShuttlesTripsRoutes);
apiRouter.use('/transport/requests', transportRequestsRoutes);
apiRouter.use('/transport/vehicles', transportVehiclesRoutes);
apiRouter.use('/transport/airport-transfers', transportAirportTransfersRoutes);
apiRouter.use('/transport/guest-transports', transportGuestTransportsRoutes);
apiRouter.use('/transport/corporate', transportCorporateRoutes);
apiRouter.use('/transport/routes', transportRoutesRoutes);
apiRouter.use('/transport/schedule', transportScheduleRoutes);
apiRouter.use('/transport/gps', transportGpsRoutes);
apiRouter.use('/transport/fuel', transportFuelRoutes);
apiRouter.use('/transport/maintenance', transportMaintenanceRoutes);
apiRouter.use('/transport/contractors', transportContractorsRoutes);
apiRouter.use('/transport/billing', transportBillingRoutes);
apiRouter.use('/transport/messages', transportMessagesRoutes);
apiRouter.use('/transport/reports', transportReportsRoutes);
apiRouter.use('/transport/config', transportConfigRoutes);
apiRouter.use('/transport/dashboard', transportDashboardRoutes);
apiRouter.use('/transport/incidents', transportIncidentsRoutes);
apiRouter.use('/transport/pricing', transportPricingRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/proc-portal', procurementPortalRoutes);
apiRouter.use('/sales-events', salesEventsPortalRoutes);
apiRouter.use('/guest-portal', guestMobilePortalRoutes);

// ── Financial Accounting ─────────────────────────────────────────────────
apiRouter.use('/accounts-payable', accountsPayableRoutes);
apiRouter.use('/bank-reconciliation', bankReconciliationRoutes);
apiRouter.use('/treasury', treasuryRoutes);
apiRouter.use('/revenue-accounting', revenueAccountingRoutes);
apiRouter.use('/expense-management', expenseManagementRoutes);
apiRouter.use('/cost-center', costCenterAccountingRoutes);
apiRouter.use('/budgeting', budgetingAccountingRoutes);
apiRouter.use('/fixed-assets', fixedAssetsRoutes);
apiRouter.use('/trial-balance', trialBalanceRoutes);
apiRouter.use('/financial-statements', financialStatementsRoutes);
apiRouter.use('/erca-vat', ercaVatRoutes);
apiRouter.use('/period-close', periodCloseRoutes);
apiRouter.use('/food-beverage', foodBeverageRoutes);
apiRouter.use('/fb', foodBeverageRoutes); // also mount at /fb so /api/fb/menu-items etc. resolve

// ── Core ─────────────────────────────────────────────────────────────────
apiRouter.use('/concierge', conciergeRoutes);
apiRouter.use('/spa-wellness', spaWellnessRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin/control', adminControlRoutes);
apiRouter.use('/admin/reports', adminReportsRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/', reservationsRoutes); // root mount (was app.use('/api', reservationsRoutes))
apiRouter.use('/front-office', frontOfficeRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/public', publicRoutes);
apiRouter.use('/reports', reportsRoutes);
apiRouter.use('/standard-reports', standardReportsRoutes);
apiRouter.use('/gift-shop', giftShopRoutes);
apiRouter.use('/', groupProfilesRoutes); // root mount (was app.use('/api', groupProfilesRoutes))
// Legacy rms.routes.ts removed — superseded by rmsPortal.routes.ts mounted at /rms-portal above.

// ── Phase 2: routes extracted from server.ts inline handlers ─────────────
apiRouter.use('/audit', auditRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/properties', propertiesRoutes);
apiRouter.use('/billing', billingRoutes);
apiRouter.use('/guests', guestsRoutes);
apiRouter.use('/pre-registrations', preRegistrationsRoutes);
apiRouter.use('/loyalty', loyaltyRoutes);
apiRouter.use('/reservation-series', reservationSeriesRoutes);
apiRouter.use('/share-reservations', shareReservationsRoutes);
apiRouter.use('/folios', foliosRoutes);
apiRouter.use('/invoices', invoicesRoutes);
apiRouter.use('/night-audit', nightAuditRoutes);
apiRouter.use('/forecasts', forecastsRoutes);
apiRouter.use('/rates', ratesRoutes);
apiRouter.use('/cashier-shifts', cashierShiftsRoutes);
apiRouter.use('/channels', channelsRoutes);
apiRouter.use('/hr', hrRoutes);
apiRouter.use('/sales', salesRoutes);
apiRouter.use('/banquet-events', banquetEventsRoutes);

export default apiRouter;
