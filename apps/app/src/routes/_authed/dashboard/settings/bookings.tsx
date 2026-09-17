import { createFileRoute } from '@tanstack/react-router';

import { BookingsTab } from '@/components/app/org-settings/tabs';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/_authed/dashboard/settings/bookings')({
  component: BookingsSettingsPage,
});

function BookingsSettingsPage() {
  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Bookings | Borradh</title>
      <Card>
        <CardContent className="p-0">
          <BookingsTab />
        </CardContent>
      </Card>
    </PageShell>
  );
}
