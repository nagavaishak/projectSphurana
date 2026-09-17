import { CampaignList } from '@/features/campaigns';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/campaigns/'
)({
  component: CampaignsIndexPage,
});

/**
 * Bulk Messaging index. The page IS the list: `CampaignList` renders on the
 * shared `ListPage`, which owns the header, the search row, the primary action
 * and the phone layout — so there is no `useIsMobile` branch and no second
 * mobile component here any more.
 */
function CampaignsIndexPage() {
  return <CampaignList />;
}
