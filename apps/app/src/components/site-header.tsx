import { GlobalSearch } from '@/components/app/global-search';
import { UserSettingsDialog } from '@/components/app/user-settings/user-settings-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignOut } from '@/features/auth/use-sign-out';
import { NotificationBell } from '@/features/notifications';
import { stripBranchFromPath } from '@/features/organization-locations/branch-path';
import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization';
import { useIsMobile } from '@/hooks/use-mobile';
import { BRANCH_PATHS, ROUTES } from '@/lib/route-paths';
import { useSession } from '@/lib/session';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, LogOut, SearchIcon, Settings } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function HeaderUser() {
  const { data, isLoading } = useSession();
  const user = data?.user;
  const { signOut, isSigningOut } = useSignOut();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useIsMobile();

  if (isLoading) {
    return <Skeleton className="h-8 w-8 rounded-full" />;
  }

  if (!user) {
    return null;
  }

  const avatar = (
    <Avatar className="h-8 w-8 rounded-md">
      <AvatarImage
        className="rounded-md"
        src={user.image ?? undefined}
        alt={user.name ?? 'User'}
      />
      <AvatarFallback className="rounded-md">
        {getInitials(user.name)}
      </AvatarFallback>
    </Avatar>
  );

  // On mobile the avatar links to the dedicated personal-area page (no sidebar
  // there to expose account actions). Desktop keeps the existing dropdown.
  if (isMobile) {
    return (
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="Personal area"
      >
        <Link to="/dashboard/account">{avatar}</Link>
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full">
            {avatar}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" sideOffset={4}>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarImage
                  className="object-cover rounded-md"
                  src={user.image ?? undefined}
                  alt={user.name ?? 'User'}
                />
                <AvatarFallback className="rounded-md">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {user.name ?? 'User'}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut()} disabled={isSigningOut}>
            <LogOut className="mr-2 h-4 w-4" />
            {isSigningOut ? 'Signing out...' : 'Log out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UserSettingsDialog open={settingsOpen} setOpen={setSettingsOpen} />
    </>
  );
}

// Sidebar routes that map to a single top-level breadcrumb.
// Key = exact pathname, value = breadcrumb label (matches sidebar title).
const topLevelRoutes: Record<string, string> = {
  [BRANCH_PATHS.home]: 'Claire',
  [BRANCH_PATHS.contentVideos]: 'Videos',
  [BRANCH_PATHS.contentImages]: 'Images',
  [BRANCH_PATHS.content]: 'Gallery',
  [BRANCH_PATHS.contentCalendar]: 'Socials',
  [BRANCH_PATHS.customers]: 'Clients',
  [BRANCH_PATHS.clientsInbox]: 'Inbox',
  [BRANCH_PATHS.calendar]: 'Calendar',
  [BRANCH_PATHS.deposits]: 'Deposits',
  [BRANCH_PATHS.aiAssistant]: 'AI Assistant',
  [BRANCH_PATHS.advertising]: 'Advertising',
  [BRANCH_PATHS.services]: 'Services',
  '/dashboard/brand': 'Brand Style',
  '/dashboard/integrations': 'Integrations',
};

// Segments that are view-tabs (day/week/month), not child pages.
const viewSegments = new Set(['day', 'week', 'month', 'year', 'agenda']);

// Display names for path segments (used for non-sidebar pages)
const segmentLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  home: 'Claire',
  // ENG-647: "Clients" now means the unified patient profiles at /dashboard/
  // patients. The CRM pipeline under /dashboard/clients is "Leads" — matching
  // the sidebar, which was renamed but left these labels behind.
  'lead-management': 'Leads',
  leads: 'Leads',
  clients: 'Leads',
  patients: 'Clients',
  inbox: 'Inbox',
  calendar: 'Calendar',
  sales: 'Sales',
  catalog: 'Catalog',
  marketing: 'Marketing',
  gallery: 'Gallery',
  socials: 'Socials',
  team: 'Team',
  members: 'Members',
  appointments: 'Appointments',
  'booking-forms': 'Booking Links',
  content: 'Content',
  'content-calendar': 'Content Calendar',
  library: 'Library',
  ideas: 'Ideas',
  created: 'Created',
  uploaded: 'Uploaded',
  // Bulk messaging. Ad campaigns live under the `advertising` segment, which
  // keeps its own "Campaigns" wording — the two are different products.
  campaigns: 'Bulk Messaging',
  advertising: 'Advertising',
  chatbots: 'Chatbots',
  conversations: 'Conversations',
  integrations: 'Integrations',
  graphics: 'Graphics',
  'lead-forms': 'Lead Forms',
  settings: 'Settings',
  billing: 'Billing',
  ads: 'Ads',
  debug: 'Debug',
  new: 'New',
  edit: 'Edit',
  month: 'Month',
  week: 'Week',
  day: 'Day',
  year: 'Year',
  agenda: 'Agenda',
  brand: 'Brand Style',
  deposits: 'Deposits',
  services: 'Services',
};

function isIdSegment(segment: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(segment) || /^\d+$/.test(segment);
}

function formatSegment(segment: string): string {
  if (segmentLabels[segment]) return segmentLabels[segment];
  if (isIdSegment(segment)) return '';
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface BreadcrumbEntry {
  label: string;
  href: string;
}

function buildBreadcrumbs(rawPathname: string): BreadcrumbEntry[] {
  // The breadcrumb map is keyed by UN-PREFIXED pathnames — the crumb for the
  // calendar is "Calendar" at every branch. Normalise once here so the branch
  // segment never has to appear in the map, while `href` keeps the real
  // pathname so the crumb still links where the user actually is.
  const pathname = stripBranchFromPath(rawPathname);

  // 1. Exact match against known sidebar routes
  if (topLevelRoutes[pathname]) {
    return [{ label: topLevelRoutes[pathname], href: rawPathname }];
  }

  // 2. Check if last segment is a view-tab and the parent is a sidebar route
  //    e.g. /dashboard/appointments/day → "Appointments"
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (viewSegments.has(lastSegment)) {
    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    if (topLevelRoutes[parentPath]) {
      return [{ label: topLevelRoutes[parentPath], href: rawPathname }];
    }
  }

  // 3. Fallback: build breadcrumbs from path segments
  const crumbs: BreadcrumbEntry[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const href = `/${segments.slice(0, i + 1).join('/')}`;
    const label = formatSegment(segment);

    // Skip "dashboard" — it's a layout prefix, not a real page
    if (segment === 'dashboard') continue;

    // Show ID segments with a truncated label
    if (!label && isIdSegment(segment)) {
      crumbs.push({ label: `${segment.slice(0, 8)}…`, href });
      continue;
    }

    if (!label) continue;

    crumbs.push({ label, href });
  }

  return crumbs;
}

// Main mobile bottom-tab routes get a simplified header: large page title on
// the left, active-org logo on the right. No breadcrumb, search, or user
// avatar. Mirrors the five tabs in MobileBottomTabs.
interface MainTabHeader {
  title: string;
  matches: (pathname: string) => boolean;
}

const mainTabHeaders: MainTabHeader[] = [
  {
    title: 'Claire',
    matches: (p) =>
      p === ROUTES.dashboard ||
      p === `${ROUTES.dashboard}/` ||
      p.startsWith(BRANCH_PATHS.home),
  },
  {
    title: 'Content',
    matches: (p) =>
      p.startsWith(BRANCH_PATHS.content) ||
      p.startsWith(BRANCH_PATHS.contentCalendar) ||
      p.startsWith(BRANCH_PATHS.videos),
  },
  {
    title: 'Ads',
    matches: (p) =>
      p.startsWith(BRANCH_PATHS.advertising) || p.startsWith('/ads'),
  },
  {
    title: 'Inbox',
    matches: (p) => p.startsWith(BRANCH_PATHS.conversations),
  },
  {
    title: 'Bookings',
    matches: (p) => p.startsWith(BRANCH_PATHS.calendar),
  },
];

function getOrgInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function MobileMainTabHeader({ title }: { title: string }) {
  const { data: organization } = useGetActiveOrganization();
  const orgName = organization?.name ?? '';
  const orgLogo = organization?.logo ?? undefined;
  const orgInitials = orgName ? getOrgInitials(orgName) : 'O';

  return (
    <header className="relative z-[56] flex shrink-0 items-center justify-between px-4 pt-6 pb-4">
      <h1 className="font-bold text-3xl tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <Link
          to="/dashboard/account"
          aria-label="Personal area"
          className="rounded-full"
        >
          <Avatar className="size-10">
            <AvatarImage src={orgLogo} alt={orgName} className="object-cover" />
            <AvatarFallback>{orgInitials}</AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
}

export function SiteHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = useMemo(() => buildBreadcrumbs(pathname), [pathname]);
  const [searchOpen, setSearchOpen] = useState(false);
  const isMobile = useIsMobile();

  const mainTab = useMemo(
    () => mainTabHeaders.find((entry) => entry.matches(pathname)),
    [pathname]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (isMobile && mainTab) {
    return <MobileMainTabHeader title={mainTab.title} />;
  }

  if (isMobile) {
    const currentLabel =
      crumbs.length > 0 ? crumbs[crumbs.length - 1].label : '';
    return (
      <header className="bg-background sticky top-0 z-[56] flex h-(--header-height) shrink-0 items-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <span className="truncate font-medium">{currentLabel}</span>
      </header>
    );
  }

  return (
    <>
      <header className="bg-background sticky top-0 z-[56] flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
        <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                return (
                  <React.Fragment key={crumb.href}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link to={crumb.href}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hidden h-8 gap-2 px-2 sm:flex"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon className="size-4" />
              <span className="text-sm">Search</span>
              <kbd className="bg-muted text-muted-foreground pointer-events-none hidden select-none items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                <span>⌘</span>K
              </kbd>
            </Button>
            <NotificationBell />
            <HeaderUser />
          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
