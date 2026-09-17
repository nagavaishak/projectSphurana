import { DashboardPage } from '@/components/app/dashboard-page';
import { CampaignComposer } from '@/features/campaigns';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/campaigns/new/'
)({
  component: NewCampaignPage,
});

/**
 * The bulk-message composer, on the shared `DashboardPage`. The composer is
 * already a single one-screen form (audience → message → channels → send), so
 * the phone needs no second component — it gets the same shell at full width.
 */
function NewCampaignPage() {
  return (
    <>
      <title>New Message | Borradh</title>
      <DashboardPage
        description="Write your message once. We deliver it by email and WhatsApp."
        title="New message"
      >
        <CampaignComposer />
      </DashboardPage>
    </>
  );
}
