import { Outlet, createFileRoute } from '@tanstack/react-router';
import { ArrowUpRightIcon, Megaphone } from 'lucide-react';

import { PageShell } from '@/components/app/page-shell';
import { StateLoading } from '@/components/app/state-loading';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  useGetMetaIntegration,
  useInitiateMetaAdsAuth,
} from '@/features/integrations';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/advertising'
)({
  component: AdvertisingLayout,
});

/**
 * Advertising layout route. Gates the whole `/dashboard/advertising` tree on a
 * connected Meta Ads account, then renders the matched child route (the
 * campaign list at `index` or a campaign detail at `$id`) via `<Outlet />`.
 */
function AdvertisingLayout() {
  const { isConnected, isLoading: isMetaLoading } = useGetMetaIntegration();
  const { initiateAuth } = useInitiateMetaAdsAuth({
    returnTo: '/connect/meta-ads?returnTo=/dashboard/advertising',
  });

  if (isMetaLoading) {
    return (
      <>
        <title>Advertising | Borradh</title>
        <PageShell>
          <StateLoading />
        </PageShell>
      </>
    );
  }

  if (!isConnected) {
    return (
      <>
        <title>Advertising | Borradh</title>
        <PageShell>
          <div className="flex flex-1 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Megaphone />
                </EmptyMedia>
                <EmptyTitle>Connect Meta Ads</EmptyTitle>
                <EmptyDescription>
                  Connect your Meta Ads account to manage your advertising
                  campaigns, track leads, and monitor performance all in one
                  place.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={initiateAuth}>Connect Meta Ads</Button>
              </EmptyContent>
              <Button
                variant="link"
                asChild
                className="text-muted-foreground"
                size="sm"
              >
                <a
                  href="https://www.facebook.com/business/help/1492627900875762"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn More about Meta Ads <ArrowUpRightIcon />
                </a>
              </Button>
            </Empty>
          </div>
        </PageShell>
      </>
    );
  }

  return <Outlet />;
}
