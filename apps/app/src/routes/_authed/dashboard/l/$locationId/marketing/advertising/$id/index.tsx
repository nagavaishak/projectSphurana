import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { AdsTable } from '@/features/meta-campaigns/components/ads-table';
import { useIsMobile } from '@/hooks/use-mobile';
import { CreateAdDialog } from '@/routes/_authed/ads/new/-components/create-ad-dialog';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/advertising/$id/'
)({
  component: CampaignDetailPage,
});

/**
 * One advertising campaign: its ads, on the shared `ListPage` (which supplies
 * the page header, search and the phone rows). The only thing still branching
 * on viewport is WHERE the ad wizard opens.
 */
function CampaignDetailPage() {
  const { id } = Route.useParams();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [createAdOpen, setCreateAdOpen] = useState(false);

  // Mobile keeps the full-page wizard; desktop opens it in a dialog.
  const handleNewAd = () => {
    if (isMobile) {
      void navigate({ search: { campaignId: id }, to: '/ads/new' });
    } else {
      setCreateAdOpen(true);
    }
  };

  return (
    <>
      <title>Campaign Details | Borradh</title>
      <AdsTable campaignId={id} onNewAd={handleNewAd} />
      <CreateAdDialog
        campaignId={id}
        onOpenChange={setCreateAdOpen}
        open={createAdOpen}
      />
    </>
  );
}
