import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import { StripeConnectPanel } from '@/features/stripe-connect';

export const Route = createFileRoute('/_authed/dashboard/settings/payments')({
  component: PaymentsSettingsPage,
});

function PaymentsSettingsPage() {
  return (
    <>
      <title>Payments | Borradh</title>
      <PageShell maxWidth="max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Set up how you take payments.
          </p>
        </div>
        <StripeConnectPanel />
      </PageShell>
    </>
  );
}
