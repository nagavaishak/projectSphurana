import type { CSSProperties } from 'react';

/** Icon+label row height inside the bottom navbar. */
export const MOBILE_TAB_BAR_ROW_HEIGHT_PX = 72;

/**
 * The navbar is docked to the bottom edge (no floating offset). Kept as a
 * constant so the clearance maths below reads the same as it used to.
 */
export const MOBILE_TAB_BAR_BOTTOM_OFFSET_PX = 0;

/** Circular quick-add button — sits raised above the navbar row. */
export const MOBILE_TAB_BAR_AI_BUTTON_SIZE_PX = 56;

/** Space between Ask AI dock and the top of the tab bar when both are visible. */
export const MOBILE_DOCK_GAP_ABOVE_TAB_BAR_PX = 12;

/** Extra breathing room between page content and the navbar. */
export const MOBILE_TAB_BAR_CLEARANCE_EXTRA_PX = 12;

/**
 * Bottom padding for scroll areas so content clears the docked navbar.
 * Must stay in sync with the layout constants (Tailwind JIT needs a literal).
 *
 * bar height + extra gap + safe area (matches the nav's own `paddingBottom`).
 */
export const MOBILE_TAB_BAR_CLEARANCE_CLASS =
  'pb-[calc(72px+12px+env(safe-area-inset-bottom,0px))]' as const;

/** Safe-area padding inside the navbar so the row clears the home indicator. */
export function mobileTabBarBottomOffsetStyle(): CSSProperties {
  return {
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  };
}

export function mobileAskAiDockBottomWhenStacked(): CSSProperties {
  return {
    bottom: `calc(${MOBILE_TAB_BAR_ROW_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px) + ${MOBILE_DOCK_GAP_ABOVE_TAB_BAR_PX}px)`,
  };
}
