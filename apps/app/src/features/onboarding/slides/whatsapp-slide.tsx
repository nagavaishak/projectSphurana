import { useNavigate } from '@tanstack/react-router';
import { Check, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { QRCode } from '@/components/kibo-ui/qr-code';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  type StartWhatsappLinkResult,
  useStartWhatsappLink,
} from '@/features/assistant/api/use-start-whatsapp-link';
import { useWhatsappLinkStatus } from '@/features/assistant/api/use-whatsapp-link-status';

import { useCompleteOnboarding } from '../api/index';
import { SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface WhatsappSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Slide 16 — `whatsapp` (final). Reuses the WhatsApp pairing internals: a
 * pending link + one-time code is created automatically, the QR encodes the
 * `wa.me` deep link, and the status poll flips the slide to Connected once
 * the owner sends the code. Finish (or "Skip for now") completes the session
 * and lands in the dashboard.
 */
export function WhatsappSlide({ session: _session }: WhatsappSlideProps) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<StartWhatsappLinkResult | null>(null);
  const [expired, setExpired] = useState(false);

  // Poll while a code is outstanding so the slide flips to Connected on its own.
  const { link, isLoading } = useWhatsappLinkStatus(pending != null);
  const isActive = link?.status === 'active';

  const { startLink, isStarting } = useStartWhatsappLink({
    onSuccess: (result) => {
      setPending(result);
      setExpired(false);
    },
  });

  // Kick off pairing automatically once we know there's no active link yet.
  const startedRef = useRef(false);
  useEffect(() => {
    if (isLoading || isActive || pending || startedRef.current) return;
    startedRef.current = true;
    startLink();
  }, [isLoading, isActive, pending, startLink]);

  // Flag expired codes so the owner can mint a fresh one.
  useEffect(() => {
    if (!pending) return;
    const check = () => {
      if (new Date(pending.codeExpiresAt).getTime() <= Date.now()) {
        setExpired(true);
      }
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    if (isActive && pending) setPending(null);
  }, [isActive, pending]);

  const { completeOnboardingAsync, isCompleting } = useCompleteOnboarding();

  const finish = async () => {
    try {
      await completeOnboardingAsync();
    } catch {
      // Already-completed / transient failures shouldn't strand the user on
      // the last slide — the toast surfaced in the hook.
    } finally {
      void navigate({ to: '/dashboard' });
    }
  };

  return (
    <SlideShell
      step={16}
      headline="Scan to talk to me on **WhatsApp**."
      description="Message me anytime — new campaigns, content ideas, lead updates, straight from your phone."
      onSubmit={finish}
      submitLabel={isCompleting ? 'Finishing…' : 'Finish'}
      submitDisabled={isCompleting}
      skip={{ label: 'Skip for now', onSkip: () => void finish() }}
    >
      {isActive ? (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
            <Check className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">Connected</p>
            <p className="text-muted-foreground text-sm">
              You're paired as {link?.phoneE164 ?? 'your WhatsApp number'} — say
              hi whenever you like.
            </p>
          </div>
        </div>
      ) : pending && !expired ? (
        <div className="space-y-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <QRCode
              data={pending.waLink}
              className="size-44 rounded-md border p-2"
            />
            <div className="space-y-3">
              <p className="text-sm">
                Scan with your phone's camera — WhatsApp opens with your code
                pre-filled. Just hit send.
              </p>
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
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner />
            Waiting for your message…
          </p>
        </div>
      ) : expired ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            That code expired — grab a fresh one.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isStarting}
            onClick={() => startLink()}
          >
            {isStarting ? <Spinner /> : 'Get a new code'}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          Setting up your pairing code…
        </p>
      )}
    </SlideShell>
  );
}
