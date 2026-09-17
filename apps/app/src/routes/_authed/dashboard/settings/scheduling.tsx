import { createFileRoute } from '@tanstack/react-router';
import { CalendarCog } from 'lucide-react';

import { PlaceholderPage } from '@/components/app/placeholder-page';

export const Route = createFileRoute('/_authed/dashboard/settings/scheduling')({
  component: () => (
    <PlaceholderPage
      description="Wage and auto-clock workspace defaults. Coming soon."
      icon={CalendarCog}
      title="Scheduling"
    />
  ),
});
