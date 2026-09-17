import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useMetaLoginForBusiness } from '@/features/integrations/hooks/use-meta-login-for-business';
import { cn } from '@/lib/utils';

import { OnboardingLaunchError, useLaunchCampaign } from '../api/index';
import { SlideShell } from '../components/index';
import type {
  OnboardingLaunchProgress,
  OnboardingLaunchStep,
  OnboardingSession,
  OnboardingSlide,
} from '../types';

export interface MetaConnectSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const LAUNCH_STEPS: { key: OnboardingLaunchStep; label: string }[] = [
  { key: 'create_campaign', label: 'Create campaign' },
  { key: 'sync_lead_form', label: 'Sync lead form' },
  { key: 'create_ads', label: 'Create ads' },
  { key: 'launch_ads', label: 'Launch' },
];

/** How many launch steps a persisted progress value has already completed. */
const completedSteps = (progress?: OnboardingLaunchProgress | null): number => {
  switch (progress) {
    case 'campaign_created':
      return 1;
    case 'lead_form_synced':
      return 2;
    case 'ads_created':
      return 3;
    case 'launched':
      return 4;
    default:
      return 0;
  }
};

const isPaymentError = (message: string): boolean =>
  /payment|funding|billing/i.test(message);

/**
 * Slide 11 — `meta_connect`. FLfB popup (launch() must be called
 * synchronously in the click handler — popup blockers), then the launch
 * orchestrator with a sequential step list. The orchestrator is idempotent
 * and resumes from persisted progress, so a failed step gets a Retry that
 * skips everything already done. REAL Meta spend starts here.
 */
export function MetaConnectSlide({
  session,
  onAdvance,
}: MetaConnectSlideProps) {
  const persistedProgress = session.stagedCampaign?.launchProgress;

  // Optimistic pointer: while the single /launch call runs we walk the step
  // list forward on a timer (the server doesn't stream progress). On failure
  // the error's step/launchProgress snaps the list to the truth.
  const [optimisticStep, setOptimisticStep] = useState(0);

  const {
    launchCampaign,
    launchError,
    isLaunching,
    isSuccess: launchSucceeded,
  } = useLaunchCampaign({
    onSuccess: () => onAdvance('campaign_live'),
  });

  const { launch, isReady, isBusy } = useMetaLoginForBusiness({
    onSuccess: () => launchCampaign(),
  });

  const startedRef = useRef(false);
  const hasStartedLaunch =
    startedRef.current || isLaunching || launchSucceeded || !!launchError;
  if (isLaunching) startedRef.current = true;

  useEffect(() => {
    if (!isLaunching) return;
    setOptimisticStep(completedSteps(persistedProgress));
    const timer = setInterval(() => {
      setOptimisticStep((s) => Math.min(s + 1, LAUNCH_STEPS.length - 1));
    }, 6000);
    return () => clearInterval(timer);
  }, [isLaunching, persistedProgress]);

  const stepError =
    launchError instanceof OnboardingLaunchError ? launchError : null;
  const paymentIssue = launchError
    ? isPaymentError(launchError.message)
    : false;

  // Per-step status for the list.
  const doneCount = stepError
    ? completedSteps(stepError.launchProgress ?? persistedProgress)
    : launchSucceeded
      ? LAUNCH_STEPS.length
      : isLaunching
        ? optimisticStep
        : completedSteps(persistedProgress);
  const failedKey = stepError?.step ?? (launchError ? undefined : undefined);

  // A previous attempt got partway (Meta already connected) — offer a resume
  // without re-opening the popup.
  const canResume = !hasStartedLaunch && completedSteps(persistedProgress) > 0;

  return (
    <SlideShell
      step={11}
      headline="**Connect your Meta** to launch."
      description="One login covers your Facebook Page, ad account and Instagram. As soon as you're connected I'll launch the campaign — real ads, real leads."
    >
      <div className="space-y-6">
        {!hasStartedLaunch && !canResume && (
          <Button
            type="button"
            size="lg"
            disabled={!isReady || isBusy}
            // launch() MUST run synchronously in the click handler — awaiting
            // anything first gets the popup blocked.
            onClick={() => launch()}
            className="gap-2"
          >
            {isBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Connecting…
              </>
            ) : (
              'Connect Meta'
            )}
          </Button>
        )}

        {canResume && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Your Meta is connected and the launch got partway — let's pick up
              where we left off.
            </p>
            <Button
              type="button"
              size="lg"
              onClick={() => launchCampaign()}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Resume launch
            </Button>
          </div>
        )}

        {(hasStartedLaunch || completedSteps(persistedProgress) > 0) && (
          <ol className="space-y-2">
            {LAUNCH_STEPS.map((step, index) => {
              const isDone = index < doneCount || launchSucceeded;
              const isFailed = failedKey === step.key;
              const isCurrent =
                !isDone && !isFailed && isLaunching && index === doneCount;

              return (
                <li
                  key={step.key}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
                    isDone && 'border-primary/30',
                    isFailed && 'border-destructive/40 bg-destructive/5',
                    !isDone && !isFailed && !isCurrent && 'opacity-50'
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {isDone ? (
                      <Check className="text-primary size-4" />
                    ) : isFailed ? (
                      <AlertTriangle className="text-destructive size-4" />
                    ) : isCurrent ? (
                      <Loader2 className="text-muted-foreground size-4 animate-spin" />
                    ) : (
                      <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
                    )}
                  </span>
                  <span className={cn(isFailed && 'text-destructive')}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {launchError && (
          <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-lg border p-4">
            <p className="text-destructive text-sm font-medium">
              {stepError?.step
                ? `The "${
                    LAUNCH_STEPS.find((s) => s.key === stepError.step)?.label ??
                    stepError.step
                  }" step failed.`
                : 'The launch hit a snag.'}
            </p>
            <p className="text-destructive/90 text-sm">{launchError.message}</p>
            {paymentIssue && (
              <p className="text-muted-foreground text-sm">
                This usually means your ad account has no payment method yet —
                add one in{' '}
                <a
                  href="https://www.facebook.com/ads/manager/account_settings/account_billing/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  Meta Ads Manager
                </a>
                , then retry. Everything already done is saved.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => launchCampaign()}
              disabled={isLaunching}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Retry launch
            </Button>
          </div>
        )}
      </div>
    </SlideShell>
  );
}
