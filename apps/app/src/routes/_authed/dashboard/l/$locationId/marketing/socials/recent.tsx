import { createFileRoute } from '@tanstack/react-router';

import { SocialsMobilePostsList } from '@/features/socials';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/recent'
)({
  component: RecentPostsPage,
});

function RecentPostsPage() {
  return (
    <>
      <title>Recent Posts | Borradh</title>
      <SocialsMobilePostsList title="Recent Posts" variant="recent" />
    </>
  );
}
