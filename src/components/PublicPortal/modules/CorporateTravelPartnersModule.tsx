/**
 * Corporate & Travel Partners Module
 * Corporate accounts, travel agencies, and partner programs
 */

import { Building, Briefcase, Users, Handshake } from 'lucide-react';
import { ModuleHeader } from '../shared';

const CorporateTravelPartnersModule: React.FC = () => {
  const partnerTypes = [
    { id: '1', name: 'Corporate Accounts', icon: <Building size={32} />, description: 'Special rates for corporate clients' },
    { id: '2', name: 'Travel Agencies', icon: <Briefcase size={32} />, description: 'Partner with us for commission' },
    { id: '3', name: 'Tour Operators', icon: <Users size={32} />, description: 'Group booking benefits' },
    { id: '4', name: 'Event Planners', icon: <Handshake size={32} />, description: 'Venue partnership programs' }
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader title="Corporate & Travel Partners" subtitle="Partner with us for exclusive benefits and rates" gradient="from-blue-600 to-cyan-600" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {partnerTypes.map((partner) => (
          <div key={partner.id} className="bg-white dark:bg-stone-800 rounded-3xl p-6 shadow-sm border border-stone-200/70 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-4 text-blue-600">
              {partner.icon}
              <h3 className="text-xl font-bold text-stone-900 dark:text-white">{partner.name}</h3>
            </div>
            <p className="text-stone-600 dark:text-stone-400 mb-4">{partner.description}</p>
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-full font-semibold transition-colors">
              Apply Now
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CorporateTravelPartnersModule;