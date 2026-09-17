import { createFileRoute } from '@tanstack/react-router';

import { SocialsMobilePostsList } from '@/features/socials';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/scheduled'
)({
  component: ScheduledPostsPage,
});

function ScheduledPostsPage() {
  return (
    <>
      <title>Scheduled Posts | Borradh</title>
      <SocialsMobilePostsList title="Scheduled Posts" variant="scheduled" />
    </>
  );
}
