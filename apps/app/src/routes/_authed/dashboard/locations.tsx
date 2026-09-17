import { createFileRoute } from '@tanstack/react-router';

import { LocationsTab } from '@/components/app/org-settings/tabs';
import { PageShell } from '@/components/app/page-shell';

/**
 * Locations — the spine of the location-focused product.
 *
 * Until now the only way to manage branches was a tab inside the org-settings
 * DIALOG, which is why locations felt like a footnote rather than the thing the
 * product is organised around. This gives them a real, linkable page.
 *
 * Deliberately org-level (NOT under the `/dashboard/l/$locationId` prefix): you
 * come here to add or switch branches, so it cannot itself require a branch to
 * already be selected.
 *
 * A PAGE, not a layout. A five-step create funnel briefly lived at
 * `/dashboard/locations/new` (plan §8), which forced this route to become a
 * layout with an `<Outlet />` and pushed the branch list into a separate
 * `locations.index.tsx`. That funnel has been reverted: adding a branch goes
 * through `/create/location`, the same shared entity editor every other
 * create/edit surface uses. With no child route left, the layout/index split
 * had nothing to hold, so the list moved back here.
 */
export const Route = createFileRoute('/_authed/dashboard/locations')({
  component: LocationsPage,
});

function LocationsPage() {
  return (
    <PageShell>
      <div>
        <h1 className="font-semibold text-2xl">Locations</h1>
        <p className="text-muted-foreground text-sm">
          Every branch you operate. Practitioners, services, promotions and
          stock are assigned per location.
        </p>
      </div>
      <LocationsTab />
    </PageShell>
  );
}
