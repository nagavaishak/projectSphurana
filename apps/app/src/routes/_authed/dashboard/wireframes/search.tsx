import { createFileRoute } from '@tanstack/react-router';

import { WfSearch } from '@/features/wireframes/admin/wf-search';

export const Route = createFileRoute('/_authed/dashboard/wireframes/search')({
  component: SearchWireframe,
});

/**
 * §20 — the ⌘K palette and the advanced client filter panel.
 *
 * No `DashboardPage` here: `ListPage` renders its own, and nesting two would
 * produce two page headers.
 */
function SearchWireframe() {
  return (
    <>
      <title>Search wireframe | Borradh</title>
      <WfSearch />
    </>
  );
}
