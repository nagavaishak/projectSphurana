import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import { SocialPostPanel } from '@/features/social-posts';
import { SocialsMobilePostDetail } from '@/features/socials';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/post/$id'
)({
  component: PostDetailPage,
});

/**
 * Post detail. Mobile gets the full-screen funnel screen (with its own top
 * bar); desktop — which reaches this URL from a direct or shared link, since
 * the planner opens posts in a side panel — gets the same `SocialPostPanel`
 * body inside the normal dashboard shell rather than a phone screen.
 */
function PostDetailPage() {
  const { id } = Route.useParams();
  const isMobile = useIsMobile();

  return (
    <>
      <title>Post | Borradh</title>
      {isMobile ? (
        <SocialsMobilePostDetail postId={id} />
      ) : (
        <PageShell>
          <div className="mx-auto w-full max-w-3xl">
            <SocialPostPanel postId={id} />
          </div>
        </PageShell>
      )}
    </>
  );
}
