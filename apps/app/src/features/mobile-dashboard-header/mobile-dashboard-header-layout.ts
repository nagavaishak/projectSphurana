import type { CSSProperties } from 'react';

/** Sticky layer — matches floating tab bar / SiteHeader. */
export const MOBILE_DASHBOARD_HEADER_Z_CLASS = 'z-[49]';

/** Gap below the safe-area inset and the floating bar. */
export const MOBILE_DASHBOARD_HEADER_TOP_OFFSET_PX = 12;

/** Inner row height inside the glass pill. */
export const MOBILE_DASHBOARD_HEADER_ROW_HEIGHT_PX = 52;

/** Extra space between page content and the floating header. */
export const MOBILE_DASHBOARD_HEADER_CLEARANCE_EXTRA_PX = 12;

/**
 * Top padding so scroll content passes under the floating header (blur shows through).
 * Keep in sync with offset + row height + extra + safe-area (Tailwind JIT).
 */
export const MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS =
  'pt-[calc(12px+52px+12px+max(12px,env(safe-area-inset-top)))]' as const;

/** Taller clearance when the header center slot includes avatar + title (conversation thread). */
export const MOBILE_DASHBOARD_HEADER_TALL_CLEARANCE_CLASS =
  'pt-[calc(12px+96px+12px+max(12px,env(safe-area-inset-top)))]' as const;

export function mobileDashboardHeaderTopOffsetStyle(): CSSProperties {
  return {
    paddingTop: `max(${MOBILE_DASHBOARD_HEADER_TOP_OFFSET_PX}px, env(safe-area-inset-top, 0px))`,
  };
}
