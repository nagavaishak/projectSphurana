import { createFileRoute, useParams } from '@tanstack/react-router';

import { FormTemplateEditor, getFormTemplate } from '@/features/form-templates';

export const Route = createFileRoute(
  '/_authed/dashboard/settings/form-templates/$formId'
)({
  component: FormTemplateEditorPage,
});

/**
 * One template. `formId === 'new'` is create mode — the same route serves both,
 * so the editor never has to exist twice.
 */
function FormTemplateEditorPage() {
  const { formId } = useParams({
    from: '/_authed/dashboard/settings/form-templates/$formId',
  });

  return (
    <>
      <title>
        {formId === 'new' ? 'New template' : 'Edit template'} | Borradh
      </title>
      <FormTemplateEditor
        template={formId === 'new' ? null : (getFormTemplate(formId) ?? null)}
      />
    </>
  );
}
