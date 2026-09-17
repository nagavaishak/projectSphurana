import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { BRANCH_PATHS, ROUTES } from '@/lib/route-paths';
import { Link, useRouterState } from '@tanstack/react-router';

function titleForPath(pathname: string): string {
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    return 'Dashboard';
  }
  if (pathname.startsWith(ROUTES.dashboard)) return 'Home';
  if (pathname.startsWith('/dashboard/marketing/gallery')) return 'Gallery';
  if (pathname.startsWith(BRANCH_PATHS.clientsInbox)) return 'Inbox';
  if (pathname.startsWith(BRANCH_PATHS.customers)) return 'Clients';
  if (pathname.startsWith(BRANCH_PATHS.calendar)) return 'Calendar';
  if (pathname.startsWith(BRANCH_PATHS.aiAssistant)) return 'AI Assistant';
  if (pathname.startsWith('/dashboard/marketing/advertising'))
    return 'Advertising';
  if (pathname.startsWith('/dashboard/marketing')) return 'Marketing';
  if (pathname.startsWith('/dashboard/sales')) return 'Sales';
  if (pathname.startsWith('/dashboard/catalog/services')) return 'Services';
  if (pathname.startsWith('/dashboard/catalog')) return 'Catalog';
  if (pathname.startsWith('/dashboard/team')) return 'Team';
  if (pathname.startsWith('/dashboard/integrations')) return 'Integrations';
  if (pathname.startsWith('/dashboard/settings/style')) return 'Brand Style';
  if (pathname.startsWith('/dashboard/settings')) return 'Settings';
  if (pathname.startsWith('/settings')) return 'Settings';
  if (pathname.startsWith('/billing')) return 'Billing';
  if (pathname.startsWith('/assistant')) return 'Assistant';
  return 'Borradh';
}

export function AuthedHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = titleForPath(pathname);

  return (
    <header className="sticky top-0 z-[56] flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
      <div className="flex flex-1 items-center justify-between">
        <Link
          to={ROUTES.dashboard}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {title}
        </Link>
      </div>
    </header>
  );
}
