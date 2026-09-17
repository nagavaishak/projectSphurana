import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import { WhatsappPairingCard } from '@/features/assistant';

/**
 * `/dashboard/settings/claire-whatsapp` — pair the owner's personal WhatsApp
 * number so Claire can be used over WhatsApp. Same pairing card as the
 * deep-linked `/settings/claire/whatsapp` page, surfaced in the main settings
 * navigation.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/settings/claire-whatsapp'
)({
  component: ClaireWhatsappSettingsPage,
});

function ClaireWhatsappSettingsPage() {
  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Claire on WhatsApp | Borradh</title>

      <header className="space-y-1">
        <h2 className="font-semibold text-xl tracking-tight">
          Claire on WhatsApp
        </h2>
        <p className="text-muted-foreground text-sm">
          Connect your personal WhatsApp number to chat with Claire on the go.
        </p>
      </header>

      <WhatsappPairingCard />
    </PageShell>
  );
}
