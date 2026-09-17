import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveLocation } from '@/features/organization-locations';
import { useGetActiveOrganization } from '@/features/organization/api';
import { micrositeVenueUrl } from '@/lib/microsite-url';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { VenueEditor } from '../../-components/venue-editor';
import { VenuePhotoManager } from '../../-components/venue-photo-manager';

export const Route = createFileRoute('/_authed/dashboard/l/$locationId/venue')({
  component: VenueDashboardPage,
});

function VenueDashboardPage() {
  // The branch in the URL — no in-page picker. This route lives under
  // `/dashboard/l/:locationId/`, so the sidebar's location switcher already
  // decides which venue you are editing; a second selector inside the page
  // could disagree with the URL and silently edit a different branch.
  const { location: selected, isLoading } = useActiveLocation();
  const { data: organization } = useGetActiveOrganization();

  // Absolute, on the MARKETING host: the venue page moved there with booking
  // and the portal. An app-relative link kept opening it on the dashboard
  // origin, which no longer serves it.
  // Carries the BRANCH slug: without it every branch's "View public page"
  // opened the org's primary venue, which is the wrong address for every
  // branch but one. A branch with no slug (single-location orgs never need
  // one) falls back to the org-level URL, which resolves to the primary.
  const publicUrl = useMemo(() => {
    if (!organization?.slug || !selected) return null;
    return micrositeVenueUrl(organization.slug, selected.slug ?? undefined);
  }, [organization?.slug, selected]);

  return (
    <>
      <title>Booking page | Borradh</title>
      <DashboardPage
        actions={
          publicUrl && (
            <Button asChild variant="outline">
              <a href={publicUrl} rel="noopener noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                View public page
              </a>
            </Button>
          )
        }
        description="Manage the photos and about copy shown on your public booking page."
        title="Booking page"
      >
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !selected ? (
          <Card>
            <CardHeader>
              <CardTitle>No location yet</CardTitle>
              <CardDescription>
                Add a location to your organization to set up your public venue
                page.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            <VenuePhotoManager locationId={selected.id} />
            <VenueEditor location={selected} />
          </div>
        )}
      </DashboardPage>
    </>
  );
}
