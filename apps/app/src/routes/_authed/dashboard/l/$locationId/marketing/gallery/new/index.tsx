import { useBranchRoutes } from '@/lib/use-routes';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useIsMobile } from '@/hooks/use-mobile';

import { ContentCreateMobileWizard } from './-components';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/gallery/new/'
)({
  component: CreateContentPage,
});

function CreateContentPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const routes = useBranchRoutes();

  // Mobile-only entry point. On desktop, content is created from the content
  // studio (the "Create Video" / template dialogs), so send the user there.
  useEffect(() => {
    if (!isMobile) {
      void navigate({ to: routes.content });
    }
  }, [isMobile, navigate, routes]);

  if (!isMobile) return null;

  return (
    <>
      <title>Create Content | Borradh</title>
      <ContentCreateMobileWizard />
    </>
  );
}
