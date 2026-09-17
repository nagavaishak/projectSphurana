import { createFileRoute } from '@tanstack/react-router';
import { CalendarDays, List } from 'lucide-react';

import { PageShell } from '@/components/app/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BatchReviewBanner,
  BulkCreateButton,
  NewPostButton,
  PlannerCalendar,
  PlannerList,
  SocialsMobilePage,
} from '@/features/socials';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/'
)({
  component: PlannerPage,
});

function PlannerPage() {
  const isMobile = useIsMobile();

  return (
    <>
      <title>Planner | Borradh</title>
      {isMobile ? (
        // Mobile is list-only — no Calendar tab.
        <SocialsMobilePage />
      ) : (
        <PageShell>
          <BatchReviewBanner />
          <Tabs defaultValue="list" className="gap-6">
            <div className="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="list">
                  <List className="size-4" />
                  List
                </TabsTrigger>
                <TabsTrigger value="calendar">
                  <CalendarDays className="size-4" />
                  Calendar
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <BulkCreateButton />
                <NewPostButton />
              </div>
            </div>
            <TabsContent value="list">
              <PlannerList />
            </TabsContent>
            <TabsContent value="calendar">
              <PlannerCalendar />
            </TabsContent>
          </Tabs>
        </PageShell>
      )}
    </>
  );
}
