import { createFileRoute } from '@tanstack/react-router';

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';

/**
 * `/create/:entity` — the ONE create page, for every entity.
 *
 * Deliberately outside `/dashboard`, so it does not nest inside the dashboard
 * layout and no sidebar renders: an editor is a focused task, and the design
 * has no chrome on it. `_authed` still applies, so the auth guard is unchanged.
 */
export const Route = createFileRoute('/_authed/create/$entity')({
  component: CreateEntityPage,
});

function CreateEntityPage() {
  const { entity } = Route.useParams();
  return <EntityEditorRoute mode="create" slug={entity} />;
}
