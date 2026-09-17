import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { Card } from '@/components/ui/card';
import { branchHandle } from '@/features/organization-locations/branch-path';
import { useActiveLocation } from '@/features/organization-locations/use-active-location';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import {
  type DashboardNavSection,
  dashboardNavSections,
  filterNavForBookingDestination,
  resolveNavUrl,
} from '@/lib/dashboard-nav';
import { ROUTES } from '@/lib/route-paths';
import { Link, createFileRoute } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Bell, User } from 'lucide-react';
import { useMemo } from 'react';

export const Route = createFileRoute('/_authed/dashboard/more/')({
  component: MorePage,
});

/**
 * Sections with their own first-class mobile surface: Home, Inbox and Calendar
 * are bottom tabs (Claire, Inbox, Bookings).
 */
const TAB_OWNED_SLUGS = new Set(['home', 'calendar', 'inbox']);

/**
 * The two personal destinations, kept OUT of `dashboardNavSections` on purpose.
 *
 * That config also drives the desktop sidebar, where Profile and Notifications
 * already live in the rail's footer — adding them there would list each one
 * twice on desktop to fix a mobile-only gap. They are mobile-only entries, so
 * they are declared where they are shown.
 *
 * They are here at all because the header's avatar and bell are gone: unlabelled
 * glass circles on every screen, replaced by two named cards in the one place a
 * phone user looks for "everything else".
 */
const PERSONAL_CARDS: { title: string; to: string; icon: LucideIcon }[] = [
  { title: 'Profile', to: ROUTES.dashboardAccount, icon: User },
  { title: 'Notifications', to: ROUTES.notifications, icon: Bell },
];

/**
 * The More tab: every dashboard destination the bottom tabs and header can't
 * fit. Sections with sub-navigation drill into `/dashboard/more/$section`;
 * the rest link straight to the page.
 */
function MorePage() {
  // Mirrors the desktop sidebar: hide the booking-system surface for orgs that
  // book elsewhere (ENG-500), so the two navigations cannot drift.
  const { data: organization } = useActiveOrganization();
  const sections = useMemo(
    () =>
      filterNavForBookingDestination(
        dashboardNavSections.filter(
          (section) => !TAB_OWNED_SLUGS.has(section.slug)
        ),
        organization?.bookingDestination
      ),
    [organization?.bookingDestination]
  );

  return (
    <>
      <title>More | Borradh</title>
      <MobilePageShell contentClassName="px-4 pb-6" tabRoot title="More">
        <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-3">
          {sections.map((section) => (
            <SectionCard key={section.slug} section={section} />
          ))}
          {PERSONAL_CARDS.map((card) => (
            <MoreCard
              icon={card.icon}
              key={card.to}
              slug={card.title.toLowerCase()}
              title={card.title}
              to={card.to}
            />
          ))}
        </div>
      </MobilePageShell>
    </>
  );
}

function SectionCard({ section }: { section: DashboardNavSection }) {
  const hasItems = (section.items?.length ?? 0) > 0;
  const Icon = section.icon;

  // A section WITH items drills into `/dashboard/more/:slug` (org-level, no
  // branch). One without items is a destination, and those are branch-scoped —
  // Home, Calendar, Customers, Inbox — so they need the branch adding.
  const { location } = useActiveLocation();
  const to = hasItems
    ? `/dashboard/more/${section.slug}`
    : resolveNavUrl(section, location ? branchHandle(location) : null);

  return (
    <MoreCard icon={Icon} slug={section.slug} title={section.title} to={to} />
  );
}

/** One card in the More grid — icon over label, the whole tile tappable. */
function MoreCard({
  icon: Icon,
  slug,
  title,
  to,
}: {
  icon: LucideIcon;
  slug: string;
  title: string;
  to: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <Link
        to={to}
        id={`more-card-${slug}`}
        data-testid={`more-card-${slug}`}
        className="flex h-full flex-col gap-3 p-4 transition active:bg-accent/50"
      >
        <Icon
          className="size-6 text-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        {/*
          `gap-3`, not `gap-6`. Twelve destinations at 100px a tile is five
          screens of scrolling to reach Team, and most of each tile was the
          empty band between the icon and its own label — which reads as a
          layout fault rather than as breathing room.
        */}
        <span className="font-medium text-[15px] leading-tight">{title}</span>
      </Link>
    </Card>
  );
}
