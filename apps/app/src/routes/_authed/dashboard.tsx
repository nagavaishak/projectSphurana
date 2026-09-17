import { StateError } from '@/components/app/state-error';
import { DashboardLayoutShell } from '@/components/dashboard/dashboard-layout-shell';
import {
  type ErrorComponentProps,
  createFileRoute,
  useRouter,
} from '@tanstack/react-router';

/**
 * Dashboard layout matches Next `(protected)/dashboard/layout.tsx`: primary
 * sidebar, optional conversations column, `SiteHeader`, then child routes.
 */
export const Route = createFileRoute('/_authed/dashboard')({
  component: DashboardLayout,
  errorComponent: DashboardRouteError,
});

function DashboardLayout() {
  return <DashboardLayoutShell />;
}

function DashboardRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <StateError
        className="w-full max-w-lg"
        message="We could not load the dashboard. Please try again."
        onRetry={retry}
      />
    </div>
  );
}
