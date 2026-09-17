import { createFileRoute } from '@tanstack/react-router';

import { WhatsappPairingCard } from '@/features/assistant';

/**
 * `/settings/claire/whatsapp` — pair the owner's personal WhatsApp number so
 * Claire can be used over WhatsApp (WS-3).
 *
 * Backed by the NestJS assistant module:
 *   POST   /assistant/whatsapp-link/start
 *   POST   /assistant/whatsapp-link/verify   (normally driven by the webhook)
 *   GET    /assistant/whatsapp-link/status
 *   DELETE /assistant/whatsapp-link/:id
 */
export const Route = createFileRoute('/_authed/settings/claire/whatsapp')({
  component: ClaireWhatsappPage,
});

function ClaireWhatsappPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Claire on WhatsApp
        </h2>
        <p className="text-muted-foreground text-sm">
          Connect your personal WhatsApp number to chat with Claire on the go.
        </p>
      </header>

      <WhatsappPairingCard />
    </div>
  );
}
