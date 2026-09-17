import { createFileRoute } from '@tanstack/react-router';

import { ViewShellOptions } from '@/features/wireframes/shell/view-shell-options';

export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/view-shell'
)({
  component: ViewShellOptions,
});
