import { createFileRoute } from '@tanstack/react-router';

import { CampaignList } from '@/features/meta-campaigns';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/advertising/'
)({
  component: AdvertisingIndexPage,
});

/**
 * The advertising campaigns index. `CampaignList` renders on the shared
 * `ListPage`, which owns the header, the search row and the phone layout — so
 * there is no `useIsMobile` branch and no parallel `CampaignMobileList` here
 * any more.
 */
function AdvertisingIndexPage() {
  return (
    <>
      <title>Advertising | Borradh</title>
      <CampaignList />
    </>
  );
}
