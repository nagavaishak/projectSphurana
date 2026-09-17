import { createFileRoute } from '@tanstack/react-router';

import { CampaignMobileCreate } from '@/features/meta-campaigns/components/campaign-mobile/campaign-mobile-create';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/advertising/new'
)({
  component: CreateCampaignPage,
});

function CreateCampaignPage() {
  return (
    <>
      <title>Create Campaign | Borradh</title>
      <CampaignMobileCreate />
    </>
  );
}
