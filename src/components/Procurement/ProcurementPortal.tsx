import React from 'react';
import ProcurementDashboard from './ProcurementDashboard';
import RequisitionManagement from './RequisitionManagement';
import SupplierManagement from './SupplierManagement';
import RFQManagement from './RFQManagement';
import PurchaseOrderManagement from './PurchaseOrderManagement';
import GoodsReceiving from './GoodsReceiving';
import ContractManagement from './ContractManagement';
import BudgetControl from './BudgetControl';
import ApprovalCenter from './ApprovalCenter';
import DepartmentReportsModule from '../Shared/DepartmentReportsModule';
import DemandPlanning from './DemandPlanning';
import ProcurementRisk from './ProcurementRisk';
import ProcurementAnalytics from './ProcurementAnalytics';
import ProcurementConfig from './ProcurementConfig';
import ProcurementPlanning from './ProcurementPlanning';
import TenderManagement from './TenderManagement';
import NegotiationManagement from './NegotiationManagement';
import SupplierOnboardingModule from './SupplierOnboarding';
import SupplierQualificationModule from './SupplierQualification';
import SupplierDocumentsModule from './SupplierDocuments';
import SupplierEvaluationModule from './SupplierEvaluation';
import POTrackingModule from './POTracking';

const ProcurementPortal = ({ activeModule = 'dashboard' }: { activeModule?: string }) => {

  return (
    <div className="flex flex-col h-full font-sans">
      <div className="flex-1 min-w-0 px-1">
        {activeModule === 'dashboard' && <ProcurementDashboard />}
        {activeModule === 'demand-planning' && <DemandPlanning />}
        {activeModule === 'procurement-planning' && <ProcurementPlanning />}
        {activeModule === 'requisitions' && <RequisitionManagement />}
        {activeModule === 'rfq' && <RFQManagement />}
        {activeModule === 'tenders' && <TenderManagement />}
        {activeModule === 'negotiations' && <NegotiationManagement />}
        {activeModule === 'orders' && <PurchaseOrderManagement />}
        {activeModule === 'po-tracking' && <POTrackingModule />}
        {activeModule === 'approvals' && <ApprovalCenter />}
        {activeModule === 'suppliers' && <SupplierManagement />}
        {activeModule === 'onboarding' && <SupplierOnboardingModule />}
        {activeModule === 'qualification' && <SupplierQualificationModule />}
        {activeModule === 'evaluation' && <SupplierEvaluationModule />}
        {activeModule === 'documents' && <SupplierDocumentsModule />}
        {activeModule === 'contracts' && <ContractManagement />}
        {activeModule === 'budget' && <BudgetControl />}
        {activeModule === 'receiving' && <GoodsReceiving />}
        {activeModule === 'risk' && <ProcurementRisk />}
        {activeModule === 'analytics' && <ProcurementAnalytics />}
        {activeModule === 'reports' && <DepartmentReportsModule departmentName="Procurement" />}
        {activeModule === 'config' && <ProcurementConfig />}
      </div>
    </div>
  );
};

export default ProcurementPortal;
