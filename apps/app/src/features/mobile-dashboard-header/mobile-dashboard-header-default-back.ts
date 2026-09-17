import { BRANCH_PATHS } from '@/lib/route-paths';

/**
 * Default mobile header back: history when possible, otherwise dashboard home.
 */
export function mobileDashboardHeaderDefaultBack(
  navigate: (opts: { to: string }) => void | Promise<void>
): void {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back();
    return;
  }
  void navigate({ to: BRANCH_PATHS.home });
}
