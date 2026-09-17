import { CampaignDetail } from '@/features/campaigns';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/campaigns/$id/'
)({
  component: CampaignDetailPage,
});

/**
 * One bulk message. `CampaignDetail` renders on the shared `DashboardPage`,
 * which is responsive — so there is no `useIsMobile` branch and no parallel
 * `CampaignDetailMobile` here any more.
 */
function CampaignDetailPage() {
  const { id } = Route.useParams();

  return (
    <>
      <title>Bulk Message | Borradh</title>
      <CampaignDetail campaignId={id} />
    </>
  );
}
