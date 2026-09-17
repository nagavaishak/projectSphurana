import { createFileRoute } from '@tanstack/react-router';

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';

/** `/edit/:entity/:id` — the ONE edit page. See `create.$entity.tsx`. */
export const Route = createFileRoute('/_authed/edit/$entity/$id')({
  component: EditEntityPage,
});

function EditEntityPage() {
  const { entity, id } = Route.useParams();
  return <EntityEditorRoute id={id} mode="edit" slug={entity} />;
}
