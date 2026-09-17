import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface WizardShellProps {
  /** 0-based index of the current step. */
  stepIndex: number;
  totalSteps: number;
  isBusy: boolean;
  continueLabel: string;
  onBack: () => void;
  onSkip: () => void;
  onContinue: () => void;
  children: React.ReactNode;
}

/**
 * Chrome for the skippable self-onboarding wizard: a progress bar, a Back
 * affordance, a header "Skip" (every step is optional), and a bottom Continue.
 * Mobile-first single column; the action bar sticks to the bottom on small
 * screens.
 */
export function WizardShell({
  stepIndex,
  totalSteps,
  isBusy,
  continueLabel,
  onBack,
  onSkip,
  onContinue,
  children,
}: WizardShellProps) {
  const progress = ((stepIndex + 1) / totalSteps) * 100;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-4 pb-28 pt-4 sm:pb-8">
      <div className="flex items-center gap-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={onBack}
          disabled={stepIndex === 0 || isBusy}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <Progress value={progress} className="h-2 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={isBusy}
        >
          Skip
        </Button>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6">{children}</div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:static sm:border-0 sm:p-0">
        <Button
          type="button"
          className="h-12 w-full sm:h-10"
          onClick={onContinue}
          disabled={isBusy}
        >
          {isBusy ? 'Saving…' : continueLabel}
        </Button>
      </div>
    </div>
  );
}
