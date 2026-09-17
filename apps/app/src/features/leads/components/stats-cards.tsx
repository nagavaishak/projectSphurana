import { Loader2, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useLeadStats } from '../api';

interface StatCardData {
  title: string;
  value: string | number;
  description: string;
}

function StatsCard({ stat }: { stat: StatCardData }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {stat.title}
        </CardTitle>
        <Badge
          variant="outline"
          className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400"
        >
          <TrendingUp className="size-3" />
          Live
        </Badge>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-3xl font-bold">{stat.value}</div>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
          {stat.description}
        </p>
      </CardContent>
    </Card>
  );
}

function StatsCardSkeleton() {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-0">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-12" />
      </CardHeader>
      <CardContent className="px-4">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="mt-1 h-3 w-32" />
      </CardContent>
    </Card>
  );
}

export function StatsCards() {
  const { stats, isLoading, isError } = useLeadStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCardSkeleton />
        <StatsCardSkeleton />
        <StatsCardSkeleton />
        <StatsCardSkeleton />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground">
        <Loader2 className="size-4 mr-2" />
        Failed to load stats
      </div>
    );
  }

  const statsData: StatCardData[] = [
    {
      title: 'Clients',
      value: stats.totalLeads,
      description: 'All clients in your pipeline',
    },
    {
      title: 'New Clients',
      value: stats.newLeads,
      description: 'Awaiting first contact',
    },
    {
      title: 'Booked',
      value: stats.bookedLeads,
      description: 'Converted to customers',
    },
    {
      title: 'Conversion Rate',
      value: `${stats.conversionRate}%`,
      description: `${stats.bookedLeads} booked / ${stats.lostLeads} lost`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {statsData.map((stat) => (
        <StatsCard key={stat.title} stat={stat} />
      ))}
    </div>
  );
}
