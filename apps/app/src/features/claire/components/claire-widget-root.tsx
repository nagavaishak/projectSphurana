import { shouldShowMobileAskAiDock } from '@/features/mobile-ask-ai';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRouterState } from '@tanstack/react-router';

import { isClaireHiddenOnPath } from '../lib/claire-widget-gate';
import { ClaireTourRunner } from '../tour-runner';
import { ClaireChatPanel } from './claire-chat-panel';
import { ClaireLauncher } from './claire-launcher';
import { ClaireRecommendationToast } from './claire-recommendation-toast';

/**
 * Top-level Claire widget mount. Rendered once in the protected layout,
 * lives for the lifetime of every dashboard page.
 *
 * Each child is self-gated (reads `useClaireWidgetState` / `useActiveRecommendations`)
 * and renders nothing when its condition isn't met, so order here is purely
 * visual stacking (later entries paint above earlier ones when both visible).
 *
 * Composition:
 *   - <ClaireLauncher />               — bottom-right circular icon (hidden on
 *     narrow viewports when the mobile Ask AI dock is shown; see
 *     `shouldShowMobileAskAiDock`)
 *   - <ClaireChatPanel />              — slides in from bottom-right when isOpen
 *     (same mobile / dashboard-shell gate as the launcher)
 *   - <ClaireRecommendationToast />    — Shadcn Alert above the launcher when an active rec exists
 *   - <ClaireTourRunner />             — invisible controller that driver.js hooks into for tour steps
 */
export function ClaireWidgetRoot() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMobile = useIsMobile();
  const hideLauncherAndPanel =
    shouldShowMobileAskAiDock(isMobile, pathname) ||
    isClaireHiddenOnPath(pathname);

  return (
    <>
      {!hideLauncherAndPanel ? <ClaireLauncher /> : null}
      {!hideLauncherAndPanel ? <ClaireChatPanel /> : null}
      <ClaireRecommendationToast />
      <ClaireTourRunner />
    </>
  );
}
