import React from 'react';
import SalesDashboard from './SalesDashboard';
import CRM from './CRM';
import GuestProfiles from './GuestProfiles';
import CorporateAccountMaster from './CorporateAccountMaster';
import TravelAgents from './TravelAgents';
import SalesPipeline from './SalesPipeline';
import OpportunityManagement from './OpportunityManagement';
import ProposalContract from './ProposalContract';
import ContractsAgreements from './ContractsAgreements';
import SalesActivities from './SalesActivities';
import AccountManagement from './AccountManagement';
import MarketingCampaigns from './MarketingCampaigns';
import EmailMarketing from './EmailMarketing';
import SMSMessaging from './SMSMessaging';
import LoyaltyManagement from './LoyaltyManagement';
import PromotionsOffers from './PromotionsOffers';
import GiftCardsVouchers from './GiftCardsVouchers';
import ReputationManagement from './ReputationManagement';
import GuestFeedback from './GuestFeedback';
import CustomerSegmentation from './CustomerSegmentation';
import CommunicationCenter from './CommunicationCenter';
import SalesReports from './SalesReports';
import SalesConfiguration from './SalesConfiguration';
import SalesStaffManagement from './SalesStaffManagement';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';
import PropertyPublicProfile from '../Admin/modules/PropertyPublicProfile';

const SalesPortal: React.FC<{ activeTab?: string }> = ({ activeTab = 'dashboard' }) => {
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 animate-fade-in">
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'dashboard' && <SalesDashboard />}
        {activeTab === 'crm' && <CRM />}
        {activeTab === 'guest-profiles' && <GuestProfiles />}
        {activeTab === 'corporate-accounts' && <CorporateAccountMaster />}
        {activeTab === 'travel-agents' && <TravelAgents />}
        {activeTab === 'leads' && <SalesPipeline />}
        {activeTab === 'opportunities' && <OpportunityManagement />}
        {activeTab === 'proposals' && <ProposalContract />}
        {activeTab === 'contracts' && <ContractsAgreements />}
        {activeTab === 'sales-activities' && <SalesActivities />}
        {activeTab === 'account-management' && <AccountManagement />}
        {activeTab === 'campaigns' && <MarketingCampaigns />}
        {activeTab === 'email-marketing' && <EmailMarketing />}
        {activeTab === 'sms-messaging' && <SMSMessaging />}
        {activeTab === 'loyalty' && <LoyaltyManagement />}
        {activeTab === 'promotions' && <PromotionsOffers />}
        {activeTab === 'gift-cards' && <GiftCardsVouchers />}
        {activeTab === 'reputation' && <ReputationManagement />}
        {activeTab === 'public-profile' && <PropertyPublicProfile />}
        {activeTab === 'guest-feedback' && <GuestFeedback />}
        {activeTab === 'segmentation' && <CustomerSegmentation />}
        {activeTab === 'communication' && <CommunicationCenter />}
        {activeTab === 'requisitions' && <DepartmentRequisitionForm department="Sales" />}
        {activeTab === 'staff' && <SalesStaffManagement />}
        {activeTab === 'reports' && <SalesReports />}
        {activeTab === 'configuration' && <SalesConfiguration />}
      </div>
    </div>
  );
};

export default SalesPortal;
