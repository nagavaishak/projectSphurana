import { ClaireWidgetRoot } from '@/features/claire';

/**
 * Mounts the floating Claire widget (launcher, mini chat panel, recommendation
 * toast, tour runner) once for the lifetime of the authenticated tree.
 * Rendered inside `<ClaireWalkthroughProvider>` in `_authed.tsx`.
 *
 * Route-level hiding (home, assistant routes) happens in `_authed.tsx`.
 */
export function ClaireShell() {
  return <ClaireWidgetRoot />;
}
