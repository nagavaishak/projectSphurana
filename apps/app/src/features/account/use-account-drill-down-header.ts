import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { ROUTES } from '@/lib/route-paths';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * Mobile header for pages opened from `/dashboard/account` (back → account hub).
 * Matches the Services drill-down pattern.
 */
export function useAccountDrillDownHeader(heading: string) {
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    void navigate({ to: ROUTES.dashboardAccount });
  }, [navigate]);

  useMobileDashboardHeaderContent({
    heading,
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideTrailing: true,
    onBack: handleBack,
  });
}
