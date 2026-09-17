import { Check, Clock, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { QRCode } from '@/components/kibo-ui/qr-code';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

import { useRevokeWhatsappLink } from '../api/use-revoke-whatsapp-link';
import {
  type StartWhatsappLinkResult,
  useStartWhatsappLink,
} from '../api/use-start-whatsapp-link';
import { useWhatsappLinkStatus } from '../api/use-whatsapp-link-status';

function useCountdown(expiresAt: string | null) {
  const getRemaining = useCallback(() => {
    if (!expiresAt) return 0;
    return Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );
  }, [expiresAt]);

  const [remaining, setRemaining] = useState(getRemaining);

  useEffect(() => {
    setRemaining(getRemaining());
    const id = setInterval(() => setRemaining(getRemaining()), 1000);
    return () => clearInterval(id);
  }, [getRemaining]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return { remaining, label: `${mins}:${secs.toString().padStart(2, '0')}` };
}

/**
 * Settings card to pair the owner's personal WhatsApp number with Claire
 * (WS-3). Start → shows a wa.me button + the code; polls status while pending;
 * flips to "connected" with a disconnect action once verified.
 */
export function WhatsappPairingCard() {
  const [pending, setPending] = useState<StartWhatsappLinkResult | null>(null);
  const { remaining, label: countdownLabel } = useCountdown(
    pending?.codeExpiresAt ?? null
  );

  // Poll while we have an outstanding code OR the server reports a pending link.
  const { link, isLoading } = useWhatsappLinkStatus(pending != null);
  const isActive = link?.status === 'active';

  const { startLink, isStarting } = useStartWhatsappLink({
    onSuccess: setPending,
  });
  const { revokeLink, isRevoking } = useRevokeWhatsappLink({
    onSuccess: () => setPending(null),
  });

  // Once the poll detects an active link, clear the pending-code panel.
  useEffect(() => {
    if (isActive && pending) setPending(null);
  }, [isActive, pending]);

  // Auto-clear expired code so the user can request a fresh one.
  // Guard with a real-time check: on the first render after setPending,
  // `remaining` is still 0 (stale from before the countdown effect runs).
  useEffect(() => {
    if (
      pending &&
      remaining === 0 &&
      new Date(pending.codeExpiresAt).getTime() <= Date.now()
    ) {
      setPending(null);
    }
  }, [pending, remaining]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-36" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5" />
          Claire on WhatsApp
          {isActive && (
            <Badge variant="secondary" className="ml-1">
              <Check className="mr-1 size-3" />
              Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Pair your personal WhatsApp number to chat with Claire — create
          campaigns, review previews, and launch ads from your phone.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {isActive ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">
              Connected as{' '}
              <span className="text-foreground font-medium">
                {link?.phoneE164 ?? 'your WhatsApp number'}
              </span>
              .
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isRevoking}
              onClick={() => link && revokeLink(link.id)}
            >
              {isRevoking ? <Spinner /> : 'Disconnect'}
            </Button>
          </div>
        ) : pending ? (
          <div className="space-y-4">
            <p className="text-sm">
              Scan this QR code with your phone's camera — WhatsApp opens with
              your code pre-filled. Just send the message to connect.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <QRCode
                data={pending.waLink}
                className="size-44 rounded-md border p-2"
              />
              <div className="space-y-3">
                <div className="text-muted-foreground text-sm">
                  On your phone already? Open WhatsApp directly, or send this
                  code manually to the Claire number:
                </div>
                <div className="bg-muted inline-block rounded-md px-3 py-2 font-mono text-lg tracking-widest">
                  {pending.code}
                </div>
                <div>
                  <Button asChild variant="outline" size="sm">
                    <a href={pending.waLink} target="_blank" rel="noreferrer">
                      <MessageCircle className="mr-1 size-4" />
                      Open WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner />
                Waiting for your message…
              </span>
              {remaining > 0 && (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Clock className="size-3" />
                  {countdownLabel}
                </span>
              )}
            </div>
          </div>
        ) : (
          <Button disabled={isStarting} onClick={() => startLink()}>
            {isStarting ? <Spinner /> : 'Connect WhatsApp'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
