import { ROUTES } from '@/lib/route-paths';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { WebsiteEditor } from '@/features/website';

/**
 * The microsite editor. Deliberately NOT wrapped in `PageShell`: the editor is
 * a three-pane workspace that owns the full viewport height, and the shell's
 * padded, scrolling content column would give the canvas iframe no height to
 * fill.
 *
 * PREVIEW ONLY. The feature is finished but not being exposed to customers
 * yet, so it runs everywhere except production. The sidebar hides the tab
 * there too (`lib/dashboard-nav.ts`), but a nav filter is presentation: this
 * redirect is what stops a typed URL or a restored browser tab from opening
 * the editor. `beforeLoad` runs before the loader and before the editor's
 * chunks are fetched.
 *
 * The API enforces the same boundary independently
 * (`apps/api/src/common/guards/microsite-editor.guard.ts`), so a stale client
 * bundle cannot reach the endpoints either.
 */
export const Route = createFileRoute('/_authed/dashboard/website')({
  beforeLoad: () => {
    // Same read as lib/capgo.ts — `beforeLoad` is outside React, so the hook is
    // not available, and `window.__CONFIG__` is populated by
    // RuntimeConfigProvider before any route loads.
    const appEnv =
      typeof window !== 'undefined' && window.__CONFIG__
        ? (window.__CONFIG__ as { appEnv?: string }).appEnv
        : undefined;
    if (appEnv === 'production') {
      throw redirect({ to: ROUTES.dashboard });
    }
  },
  component: WebsitePage,
});

function WebsitePage() {
  return (
    <>
      <title>Website | Borradh</title>
      <main className="flex h-[calc(100svh-var(--header-height,3.5rem))] min-h-0 flex-1 flex-col">
        <WebsiteEditor />
      </main>
    </>
  );
}
