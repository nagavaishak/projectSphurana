/**
 * Pure helpers for mobile Ask AI dock / Claire launcher gating (viewport + route).
 */
export function isAssistantPath(pathname: string): boolean {
  return pathname.startsWith('/assistant');
}

/** Main app chrome (`DashboardLayoutShell` + mobile tab bar) lives under `/dashboard`. */
export function isDashboardShellPath(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

/**
 * Ask AI dock + mobile bottom tabs only on `/dashboard/*` (sidebar shell).
 * Other `_authed` routes (billing, create-video, settings, assistant, …) stay full-bleed.
 */
export function shouldShowMobileAskAiDock(
  isMobile: boolean,
  pathname: string
): boolean {
  return isMobile && isDashboardShellPath(pathname);
}
