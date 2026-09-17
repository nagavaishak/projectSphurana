import { createFileRoute } from '@tanstack/react-router';

import { FormTemplatesPage } from '@/features/form-templates';

export const Route = createFileRoute(
  '/_authed/dashboard/settings/form-templates/'
)({
  component: FormTemplatesPage,
});
