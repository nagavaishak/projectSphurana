import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { Card } from '@/components/ui/card';
import { branchHandle } from '@/features/organization-locations/branch-path';
import { useActiveLocation } from '@/features/organization-locations/use-active-location';
import {
  type DashboardNavItem,
  findDashboardNavSection,
  resolveNavUrl,
} from '@/lib/dashboard-nav';
import { ROUTES } from '@/lib/route-paths';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useCallback } from 'react';

export const Route = createFileRoute('/_authed/dashboard/more/$section')({
  component: MoreSectionPage,
});

/** Sub-navigation for one More section (Sales, Catalog, Marketing, …). */
function MoreSectionPage() {
  const { section: slug } = Route.useParams();
  const navigate = useNavigate();
  const section = findDashboardNavSection(slug);

  const goBack = useCallback(() => navigate({ to: ROUTES.more }), [navigate]);

  if (!section) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <p className="text-sm text-muted-foreground">
          That section doesn&apos;t exist.
        </p>
        <Link to={ROUTES.more} className="text-sm underline">
          Back to More
        </Link>
      </div>
    );
  }

  const items = section.items ?? [];

  return (
    <>
      <title>{`${section.title} | Borradh`}</title>
      <MobilePageShell
        contentClassName="px-4 pb-6"
        onBack={goBack}
        title={section.title}
      >
        <Card className="mx-auto w-full max-w-2xl gap-0 overflow-hidden py-0">
          <ul className="flex flex-col divide-y">
            {items.map((item) => (
              <MoreSectionRow item={item} key={item.url} />
            ))}
          </ul>
        </Card>
      </MobilePageShell>
    </>
  );
}

function MoreSectionRow({ item }: { item: DashboardNavItem }) {
  // The nav config holds branch destinations UN-PREFIXED (one config serves
  // every branch), so the branch has to be added at render. Linking `item.url`
  // raw sent every row on this page — Sales, Catalog, Marketing, Team,
  // Inventory — through the compatibility splat's redirect.
  const { location } = useActiveLocation();
  const to = resolveNavUrl(item, location ? branchHandle(location) : null);

  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 px-4 py-3.5 transition active:bg-accent/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-left text-sm">{item.title}</span>
          {item.mobileReady === false ? (
            <span className="block truncate text-xs text-muted-foreground">
              Best viewed on a larger screen
            </span>
          ) : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
