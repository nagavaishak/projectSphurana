import {
  getAccountSettingsHeaderTitle,
  useAccountDrillDownHeader,
} from '@/features/account';
import {
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router';

export const Route = createFileRoute('/_authed/dashboard/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });
  // The settings secondary nav is rendered by AppSidebar's Tier-2 panel;
  // mobile uses the account drill-down header set here.
  useAccountDrillDownHeader(getAccountSettingsHeaderTitle(pathname));

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <Outlet />
    </div>
  );
}
