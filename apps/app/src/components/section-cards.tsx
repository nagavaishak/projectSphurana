import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeadStats } from '@/features/leads/api';
import { useCoordinatedLoading } from '@/hooks/use-coordinated-loading';
import { CalendarCheck, Contact, TrendingUpIcon, Users } from 'lucide-react';

export function SectionCards() {
  const { stats, isLoading } = useLeadStats();
  const isPageReady = useCoordinatedLoading('lead-stats', isLoading);

  if (!isPageReady) {
    return (
      <div className="*:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="@container/card">
            <CardHeader>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1">
              <Skeleton className="h-4 w-32" />
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  }

  const totalLeads = stats?.totalLeads ?? 0;
  const newLeads = stats?.newLeads ?? 0;
  const bookedLeads = stats?.bookedLeads ?? 0;
  const conversionRate = stats?.conversionRate ?? 0;
  const contactedLeads = stats?.contactedLeads ?? 0;

  return (
    <div className="*:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Total Leads</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {totalLeads}
          </CardTitle>
          <div className="absolute right-4 top-4 text-muted-foreground">
            <Users className="size-5" />
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="text-muted-foreground">
            {newLeads} new &middot; {contactedLeads} contacted
          </div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>New Clients</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {newLeads}
          </CardTitle>
          <div className="absolute right-4 top-4 text-muted-foreground">
            <Contact className="size-5" />
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="text-muted-foreground">Awaiting first contact</div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Booked</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {bookedLeads}
          </CardTitle>
          <div className="absolute right-4 top-4 text-muted-foreground">
            <CalendarCheck className="size-5" />
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="text-muted-foreground">
            {bookedLeads} booked overall
          </div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader className="relative">
          <CardDescription>Conversion Rate</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {conversionRate}%
          </CardTitle>
          <div className="absolute right-4 top-4 text-muted-foreground">
            <TrendingUpIcon className="size-5" />
          </div>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="text-muted-foreground">
            {bookedLeads} booked /{' '}
            {contactedLeads > 0 ? contactedLeads : totalLeads}{' '}
            {contactedLeads > 0 ? 'contacted' : 'total'}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
