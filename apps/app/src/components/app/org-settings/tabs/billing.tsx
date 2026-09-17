'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  useCreatePortalSession,
  useGetCreditBalance,
  useGetPlanInfo,
  useGetSubscription,
} from '@/features/billing';
import { Clock, TrendingUp } from 'lucide-react';

function TrialBanner({ trialEnd }: { trialEnd: string }) {
  const now = new Date();
  const end = new Date(trialEnd);
  const daysLeft = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-center gap-3 py-3">
        <Clock className="text-primary size-5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">Free Trial</p>
          <p className="text-muted-foreground text-sm">
            {daysLeft === 0
              ? 'Your trial ends today'
              : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining in your free trial`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BillingTab() {
  const { subscription, isLoading: isLoadingSubscription } =
    useGetSubscription();
  const { plan, isLoading: isLoadingPlan } = useGetPlanInfo();
  const { balance, isLoading: isLoadingBalance } = useGetCreditBalance();
  const { openPortal, isOpening } = useCreatePortalSession();

  const isLoading = isLoadingSubscription || isLoadingPlan || isLoadingBalance;

  if (isLoading) {
    return (
      <ScrollArea className="flex-1 px-6 pb-4">
        <div className="space-y-6 py-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </ScrollArea>
    );
  }

  const hasActiveSubscription =
    subscription?.status === 'active' || subscription?.status === 'trialing';

  // Calculate credit usage
  const creditsUsed = balance
    ? balance.includedMonthly - balance.creditsAvailable
    : 0;
  const usagePercent =
    balance && balance.includedMonthly > 0
      ? Math.round((creditsUsed / balance.includedMonthly) * 100)
      : 0;

  const renewDate = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <ScrollArea className="flex-1 px-6 pb-4">
      <div className="space-y-4 py-4">
        {/* Trial Banner */}
        {subscription?.status === 'trialing' && subscription.trialEnd && (
          <TrialBanner trialEnd={subscription.trialEnd} />
        )}

        {/* Current Plan Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">
                Current Plan
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">
                  <span className="font-medium">
                    {plan?.name || 'Pro Plan'}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {plan?.priceFormatted || '$399/month'}
                  </span>
                </p>
              </div>
              <Badge variant="outline">Monthly</Badge>
            </div>
            {renewDate && (
              <p className="text-sm text-muted-foreground">
                Your plan will renew on {renewDate}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => openPortal({ returnUrl: window.location.href })}
              disabled={isOpening}
            >
              {isOpening ? 'Opening...' : 'Edit Billing Details'}
            </Button>
          </CardContent>
        </Card>

        {/* Credit Usage Card */}
        {hasActiveSubscription && balance && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Credit Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  <span className="font-medium text-primary">
                    {creditsUsed} used
                  </span>{' '}
                  <span className="text-muted-foreground">
                    / {balance.includedMonthly} included
                  </span>
                </p>
                <Badge variant="secondary" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {usagePercent}% used
                </Badge>
              </div>
              <Progress value={usagePercent} className="h-2" />
              {renewDate && (
                <p className="text-sm text-muted-foreground">
                  Credits will reset on {renewDate}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invoices */}
        <Field orientation="horizontal" className="py-4">
          <div className="flex-1">
            <FieldLabel className="font-medium">Invoices</FieldLabel>
            <FieldDescription>
              Provide your full name for identification
            </FieldDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openPortal({ returnUrl: window.location.href })}
            disabled={isOpening}
          >
            See Invoices
          </Button>
        </Field>

        <Separator />

        {/* Auto-Purchase Credits */}
        <Field orientation="horizontal" className="py-4">
          <div className="flex-1">
            <FieldLabel className="font-medium">
              Auto-Purchase Credits
            </FieldLabel>
            <FieldDescription>
              Automatically purchase credits when you run out
            </FieldDescription>
          </div>
          <Switch defaultChecked />
        </Field>

        <Separator />

        <div className="flex gap-2 pt-4">
          <Button type="button" disabled>
            Submit
          </Button>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
