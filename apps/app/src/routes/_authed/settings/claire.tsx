import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router';

import { useMobileBottomTabBarClearanceClass } from '@/features/mobile-bottom-tabs';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
}

const navItems: NavItem[] = [
  { name: 'Usage', href: '/settings/claire/usage' },
  { name: 'Memories', href: '/settings/claire/memories' },
  { name: 'WhatsApp', href: '/settings/claire/whatsapp' },
];

// `/settings/claire/*` are reached only via deep-link from Claire surfaces
// (the usage banner's "Upgrade" CTA, memory pills, etc.) — they don't appear
// in the global app sidebar. Locked in 2026-04-26: "/settings/claire/* is
// reached only by deep-link from Claire surfaces. Avoids fragmenting the
// app's top-level navigation."
export const Route = createFileRoute('/_authed/settings/claire')({
  component: ClaireSettingsLayout,
});

function ClaireSettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mobileTabClearance = useMobileBottomTabBarClearanceClass();

  return (
    <div
      className={cn(
        'container mx-auto px-4 py-8 md:px-6 md:py-12',
        mobileTabClearance
      )}
    >
      <header className="mb-8 space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Claire settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage how you use Claire across Borradh.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[200px_1fr]">
        <nav aria-label="Claire settings navigation">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    to={item.href as never}
                    className={cn(
                      'text-muted-foreground hover:bg-muted block rounded-md px-3 py-2 text-sm transition-colors',
                      isActive && 'bg-muted text-foreground font-medium'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
