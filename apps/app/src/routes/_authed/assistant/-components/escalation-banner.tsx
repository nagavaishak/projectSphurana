import { LifeBuoy, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openIntercomMessenger } from '@/lib/intercom';

/**
 * Banner shown above the composer when the active conversation has been
 * handed off to a live agent (status === 'escalated').
 *
 * The actual back-and-forth happens inside Intercom's native messenger,
 * so the banner's job is to (a) explain why the composer is read-only and
 * (b) give a one-tap way back into the support chat. We deliberately don't
 * try to mirror agent replies into the Claire UI — that's the point of the
 * separation.
 */
export function EscalationBanner() {
  return (
    <div className="border-t bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm">
          <LifeBuoy className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">You're talking to the team</p>
            <p className="text-xs text-muted-foreground">
              Reply in the support chat — Claire will be back when this is
              resolved.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void openIntercomMessenger();
          }}
          className="self-start sm:self-auto"
        >
          <MessageSquare className="size-4" />
          Open support chat
        </Button>
      </div>
    </div>
  );
}
