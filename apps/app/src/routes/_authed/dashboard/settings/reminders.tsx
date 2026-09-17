import { createFileRoute } from '@tanstack/react-router';

import { WfRemindersSettings } from '@/features/wireframes/growth/reminders-settings';

/**
 * Reminders and rebooking configuration, in Settings beside notifications and
 * message templates. Wireframe: static fixtures, no queries.
 */
export const Route = createFileRoute('/_authed/dashboard/settings/reminders')({
  component: WfRemindersSettings,
});
