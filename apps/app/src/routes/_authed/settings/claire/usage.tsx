import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DailyTrendChart,
  MonthlyTrendChart,
  TopToolsList,
  useAssistantUsage,
  useAssistantUsageHistory,
} from '@/features/assistant';

/**
 * `/settings/claire/usage` — Claire usage dashboard: plan limits, daily +
 * monthly message trends, and top tools used.
 *
 * Backed by `GET /assistant/usage` + `GET /assistant/usage/history`.
 * Reachable only via deep-link from Claire surfaces (the usage banner's
 * "Upgrade" CTA, etc.).
 */
export const Route = createFileRoute('/_authed/settings/claire/usage')({
  component: ClaireUsagePage,
});

const UPGRADE_CTA_THRESHOLD = 0.8;

const formatToday = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
};

const formatPlanLabel = (planId: string): string => {
  if (planId === 'free') return 'Free';
  return planId.charAt(0).toUpperCase() + planId.slice(1);
};

const dailyTotal = (data: Array<{ count: number }>): number =>
  data.reduce((sum, d) => sum + d.count, 0);

function ClaireUsagePage() {
  const {
    history,
    isLoading: isHistoryLoading,
    isError: isHistoryError,
  } = useAssistantUsageHistory();
  const { usage, isLoading: isUsageLoading } = useAssistantUsage();

  if (isHistoryLoading || isUsageLoading) {
    return <UsageDashboardSkeleton />;
  }

  if (isHistoryError || !history || !usage) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load usage</AlertTitle>
        <AlertDescription>
          Try refreshing in a moment. If the problem keeps up, drop us a line.
        </AlertDescription>
      </Alert>
    );
  }

  const today = formatToday();
  const dailyRatio =
    usage.daily.limit > 0 ? usage.daily.used / usage.daily.limit : 0;
  const monthlyRatio =
    usage.monthly.limit > 0 ? usage.monthly.used / usage.monthly.limit : 0;

  const showUpgradeCta =
    !usage.hasAccess ||
    dailyRatio >= UPGRADE_CTA_THRESHOLD ||
    monthlyRatio >= UPGRADE_CTA_THRESHOLD;

  const last30Total = dailyTotal(history.daily);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            You&apos;re on the {formatPlanLabel(history.planId)} plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <UsageStat
            label="Today"
            used={usage.daily.used}
            limit={usage.daily.limit}
          />
          <UsageStat
            label="This month"
            used={usage.monthly.used}
            limit={usage.monthly.limit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily — last 30 days</CardTitle>
          <CardDescription>
            {last30Total === 0
              ? 'No messages in the last 30 days.'
              : `${last30Total.toLocaleString()} message${last30Total === 1 ? '' : 's'} over the last 30 days.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyTrendChart data={history.daily} highlightDate={today} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly — last 6 months</CardTitle>
          <CardDescription>Total messages per calendar month.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTrendChart data={history.monthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top tools used</CardTitle>
          <CardDescription>
            Which of Claire&apos;s tools you&apos;ve reached for most.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TopToolsList tools={history.topTools} />
        </CardContent>
      </Card>

      {showUpgradeCta ? (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Approaching your limit?</p>
              <p className="text-muted-foreground text-sm">
                Upgrade for more daily messages and monthly headroom.
              </p>
            </div>
            <Link
              to="/billing"
              className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              Upgrade <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

interface UsageStatProps {
  label: string;
  used: number;
  limit: number;
}

function UsageStat({ label, used, limit }: UsageStatProps) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const remaining = Math.max(0, limit - used);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="text-sm font-medium">
          {used.toLocaleString()}{' '}
          <span className="text-muted-foreground">
            / {limit.toLocaleString()}
          </span>
        </span>
      </div>
      <Progress value={ratio * 100} aria-label={`${label} usage`} />
      <p className="text-muted-foreground text-xs">
        {remaining.toLocaleString()} left
      </p>
    </div>
  );
}

function UsageDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[180px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[180px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
