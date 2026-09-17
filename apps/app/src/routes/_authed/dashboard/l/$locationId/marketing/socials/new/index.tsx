import { useBranchRoutes } from '@/lib/use-routes';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useIsMobile } from '@/hooks/use-mobile';

import { ContentMobileWizard } from './-components';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/new/'
)({
  component: CreateContentPage,
});

function CreateContentPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const routes = useBranchRoutes();

  // The full create-content experience on desktop lives in the content
  // calendar's `AddContentDialog`. This route is the mobile-only wizard, so on
  // desktop we send the user back to socials.
  useEffect(() => {
    if (!isMobile) {
      void navigate({ to: routes.socials });
    }
  }, [isMobile, navigate, routes]);

  if (!isMobile) return null;

  return (
    <>
      <title>Create Content | Borradh</title>
      <ContentMobileWizard />
    </>
  );
}
