import { Link } from '@tanstack/react-router';
import { AlertCircle, ArrowUpRight, Clock, Sparkles } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAssistantUsage } from '@/features/assistant';
import {
  type UsageBannerState,
  getUsageBannerState,
} from './lib/usage-banner-state';

const UPGRADE_HREF = '/billing';

export function UsageBanner() {
  const { usage } = useAssistantUsage();
  const state = getUsageBannerState(usage);

  if (state.kind === 'hidden') return null;

  return (
    <div className="border-t px-4 py-2">{renderBannerForState(state)}</div>
  );
}

function renderBannerForState(state: UsageBannerState) {
  switch (state.kind) {
    case 'subtle':
      return (
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {state.used} / {state.limit} messages today
          </span>
        </div>
      );

    case 'warning':
      return (
        <Alert className="mx-auto max-w-3xl border-amber-500/50 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>
              Approaching your daily limit — {state.remaining} message
              {state.remaining === 1 ? '' : 's'} left.
            </span>
            <UpgradeButton variant="ghost" />
          </AlertDescription>
        </Alert>
      );

    case 'monthly-warning':
      return (
        <Alert className="mx-auto max-w-3xl border-amber-500/50 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>
              {state.remaining} message{state.remaining === 1 ? '' : 's'} left
              this month.
            </span>
            <UpgradeButton variant="ghost" />
          </AlertDescription>
        </Alert>
      );

    case 'daily-limit-paid':
      return (
        <Alert variant="destructive" className="mx-auto max-w-3xl">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              Daily limit hit. Resets at midnight.
            </span>
            <UpgradeButton variant="outline" />
          </AlertDescription>
        </Alert>
      );

    case 'monthly-limit-paid':
      return (
        <Alert variant="destructive" className="mx-auto max-w-3xl">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>Monthly limit hit. Upgrade for more headroom.</span>
            <UpgradeButton variant="outline" />
          </AlertDescription>
        </Alert>
      );

    case 'daily-limit-free':
    case 'monthly-limit-free':
      return (
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Upgrade to keep going — Claire lives in Starter and Pro.
          </span>
          <UpgradeButton variant="default" label="See plans" />
        </div>
      );

    case 'free-tier-active':
      return (
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Free tier — {state.remaining} message
            {state.remaining === 1 ? '' : 's'} left today.
          </span>
          <UpgradeButton variant="ghost" />
        </div>
      );

    case 'hidden':
      return null;
  }
}

function UpgradeButton({
  variant = 'outline',
  label = 'Upgrade',
}: {
  variant?: 'default' | 'outline' | 'ghost';
  label?: string;
}) {
  return (
    <Button variant={variant} size="sm" asChild>
      <Link to={UPGRADE_HREF}>
        {label}
        <ArrowUpRight className="ml-1 size-3" />
      </Link>
    </Button>
  );
}
