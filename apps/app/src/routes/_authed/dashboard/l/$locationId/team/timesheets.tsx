import { createFileRoute } from '@tanstack/react-router';

import { TimesheetsPage } from '@/features/timesheets';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/team/timesheets'
)({
  component: TimesheetsPage,
});
