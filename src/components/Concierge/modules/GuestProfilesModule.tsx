/**
 * Guest Profiles Module
 *
 * Renders the shared Front Office guest-profiles experience (list, search,
 * filters, detail tabs, edit/create/merge/export) so concierge staff see the
 * exact same UI and data as /erp/frontoffice/guest-profiles.
 *
 * The FO module drives selection via ?guestId= in the URL. Concierge deep
 * links (e.g. from the Service Center) arrive as the `selectedGuestId` prop,
 * which the FO module syncs into the URL itself.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import FrontOfficeGuestProfiles from '../../FrontOffice/modules/GuestProfiles';

interface GuestProfilesModuleProps {
  selectedGuestId?: string;
  onClearSelectedGuestId?: () => void;
  onSelectGuestId?: (guestId: string) => void;
}

const GuestProfilesModule: React.FC<GuestProfilesModuleProps> = ({
  selectedGuestId,
  onClearSelectedGuestId,
}) => {
  const [searchParams] = useSearchParams();
  const clearRef = useRef(onClearSelectedGuestId);
  clearRef.current = onClearSelectedGuestId;

  // Once the FO view is back on the list (?guestId removed), release the
  // parent's cross-module selection so re-entering this tab does not reopen
  // a stale profile.
  useEffect(() => {
    if (selectedGuestId && !searchParams.get('guestId')) {
      clearRef.current?.();
    }
  }, [selectedGuestId, searchParams]);

  // `.concierge-fo-scope` remaps the FO component's hardcoded blue-* accents
  // to the concierge portal's indigo scheme (see index.css).
  return (
    <div className="concierge-fo-scope">
      <FrontOfficeGuestProfiles selectedGuestId={selectedGuestId} />
    </div>
  );
};

export default GuestProfilesModule;
