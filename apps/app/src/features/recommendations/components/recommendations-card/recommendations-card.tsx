import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useGetMetaIntegration } from '@/features/integrations/api';
import { useCoordinatedLoading } from '@/hooks/use-coordinated-loading';
import type {
  Recommendation,
  RecommendationPriority,
  RecommendationType,
} from '@borradh-workspace/api-client/types';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Flame,
  Lightbulb,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { useGetRecommendations } from '../../api';

const typeIcons: Record<RecommendationType, React.ReactNode> = {
  scale: <TrendingUp className="size-4 text-green-600" />,
  turn_off: <AlertTriangle className="size-4 text-red-600" />,
  learning: <Clock className="size-4 text-blue-600" />,
  burnout: <Flame className="size-4 text-orange-600" />,
  high_cpl: <AlertTriangle className="size-4 text-yellow-600" />,
  performing_well: <TrendingUp className="size-4 text-blue-600" />,
};

const priorityVariants: Record<
  RecommendationPriority,
  'destructive' | 'secondary' | 'outline' | 'default'
> = {
  critical: 'destructive',
  high: 'default',
  medium: 'secondary',
  low: 'outline',
};

const priorityLabels: Record<RecommendationPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function RecommendationItem({
  recommendation,
}: { recommendation: Recommendation }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        {typeIcons[recommendation.type]}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {recommendation.title}
          </span>
          <Badge
            variant={priorityVariants[recommendation.priority]}
            className="shrink-0"
          >
            {priorityLabels[recommendation.priority]}
          </Badge>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {recommendation.description}
        </p>
        <p className="text-xs text-muted-foreground">
          Ad: {recommendation.adName}
        </p>
      </div>
    </div>
  );
}

export function RecommendationsCard({ limit = 3 }: { limit?: number }) {
  const { isConnected, isLoading: isMetaLoading } = useGetMetaIntegration();
  const { recommendations, hasMetaIntegration, isLoading, isError } =
    useGetRecommendations({
      params: { limit, days: 7 },
      enabled: isConnected,
    });

  const isPageReady = useCoordinatedLoading(
    'recommendations',
    isLoading || isMetaLoading
  );

  if (!isPageReady || !isConnected || !hasMetaIntegration) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5" />
          Recommendations
        </CardTitle>
        <CardDescription>Based on your ad performance data</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Failed to load recommendations.
          </p>
        ) : recommendations.length === 0 ? (
          <Empty className="border-0 py-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Lightbulb />
              </EmptyMedia>
              <EmptyTitle>No recommendations yet</EmptyTitle>
              <EmptyDescription>
                Your ads are performing well, or there&apos;s not enough data
                yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-3">
            {recommendations.slice(0, limit).map((recommendation) => (
              <RecommendationItem
                key={recommendation.id}
                recommendation={recommendation}
              />
            ))}
            {recommendations.length > limit && (
              <Button variant="ghost" className="w-full" asChild>
                <a href="/dashboard/advertising/campaigns">
                  View all recommendations
                  <ArrowRight className="ml-2 size-4" />
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
