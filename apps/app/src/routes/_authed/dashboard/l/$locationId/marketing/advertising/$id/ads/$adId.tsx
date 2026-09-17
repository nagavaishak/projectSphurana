import { createFileRoute } from '@tanstack/react-router';

import { CampaignMobileAdDetail } from '@/features/meta-campaigns/components/campaign-mobile/campaign-mobile-ad-detail';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/advertising/$id/ads/$adId'
)({
  component: CampaignAdDetailPage,
});

function CampaignAdDetailPage() {
  const { id: campaignId, adId } = Route.useParams();

  return (
    <>
      <title>Ad Details | Borradh</title>
      <CampaignMobileAdDetail campaignId={campaignId} adId={adId} />
    </>
  );
}
