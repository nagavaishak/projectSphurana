import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useEffect } from 'react';

import { useResendVerification } from '@/features/auth/use-resend-verification';
import { useSession } from '@/lib/session';

import { SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface VerifyEmailSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Slide 2 — `verify_email`. The gate: it runs right after the intro and before
 * the website capture, so everything from there on happens with a verified
 * email (the analysis slide's apply-analysis step CREATES the org, and the
 * backend AuthGuard enforces verification there regardless).
 *
 * The slide polls the auth session every 3s and advances the moment the email
 * is verified (they click the link in another tab / on their phone).
 *
 * NOTE: renders PRE-email-verification — the /onboarding/session PATCH endpoint
 * is `@SkipEmailVerification`, so persisting `currentSlide` here works.
 */
// `session` is part of the shared slide prop contract but unused here — this
// slide reads the live auth session directly so it can poll for verification.
export function VerifyEmailSlide({ onAdvance }: VerifyEmailSlideProps) {
  const authSession = useSession();
  const emailVerified = Boolean(authSession.data?.user?.emailVerified);
  const email = authSession.data?.user?.email ?? '';

  const { resendVerification, isResending } = useResendVerification();

  // Poll the auth session so the slide unlocks the instant they click the link.
  useEffect(() => {
    if (emailVerified) return;
    const id = setInterval(() => authSession.refetch(), 3000);
    return () => clearInterval(id);
  }, [emailVerified, authSession]);

  // Verified — move straight on to the website capture.
  useEffect(() => {
    if (emailVerified) onAdvance('website');
  }, [emailVerified, onAdvance]);

  const handleResend = () => {
    if (!email || isResending) return;
    resendVerification({ email, callbackURL: '/welcome' });
  };

  const headline = emailVerified
    ? "You're **verified** — let's keep going."
    : 'First, verify your **email**.';

  const description = emailVerified
    ? "Great — let's build your brand…"
    : email
      ? `I sent a link to ${email}. Click it and I'll pick up right here.`
      : "I sent you a verification link. Click it and I'll pick up right here.";

  return (
    <SlideShell
      headline={headline}
      description={description}
      onSubmit={emailVerified ? () => onAdvance('website') : undefined}
      submitLabel="Continue"
    >
      <div className="border-input bg-muted/40 flex items-center gap-3 rounded-md border px-4 py-3">
        {emailVerified ? (
          <CheckCircle2 className="size-5 shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <Mail className="text-muted-foreground size-5 shrink-0" />
        )}
        <p className="text-muted-foreground text-sm">
          {emailVerified
            ? 'Email verified.'
            : 'Waiting for you to verify — check your inbox (and your spam folder).'}
        </p>
        {!emailVerified && (
          <Loader2 className="text-muted-foreground ml-auto size-4 shrink-0 animate-spin" />
        )}
      </div>

      {!emailVerified && (
        <button
          type="button"
          onClick={handleResend}
          disabled={isResending || !email}
          className="text-muted-foreground hover:text-foreground mt-4 text-sm underline underline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isResending ? 'Sending…' : "Didn't get it? Resend the link"}
        </button>
      )}
    </SlideShell>
  );
}
