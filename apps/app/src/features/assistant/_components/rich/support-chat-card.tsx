import { LifeBuoy, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openIntercomMessenger } from '@/lib/intercom';

interface SupportChatCardProps {
  /** One-line reason Claire summarised for the agent. Echoed back here so
   *  the owner can confirm what was sent on their behalf. */
  reason: string;
  /** True when a new Intercom conversation was just created. False when
   *  Claire was already handed off and we're showing the card again on a
   *  re-render — the button still works, it just reopens the existing
   *  thread. */
  created: boolean;
  /** True when Intercom credentials aren't wired up (e.g. local dev). The
   *  button is hidden and we show a fallback message. */
  notConfigured?: boolean;
}

/**
 * Renders the result of `requestSupportChat`. The actual conversation with
 * support happens in the native Intercom messenger — this card is the
 * one-tap entry into it from the Claire chat.
 */
export function SupportChatCard({
  reason,
  created,
  notConfigured,
}: SupportChatCardProps) {
  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-md">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LifeBuoy className="size-4" />
        {created
          ? 'I sent your conversation to the team'
          : "You're already talking to the team"}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Sent:</span> {reason}
      </p>

      {notConfigured ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          Support chat isn't configured on this environment.
        </p>
      ) : (
        <Button
          size="sm"
          className="mt-3 w-full sm:w-auto"
          onClick={() => {
            void openIntercomMessenger();
          }}
        >
          <MessageSquare className="size-4" />
          Open support chat
        </Button>
      )}
    </div>
  );
}
