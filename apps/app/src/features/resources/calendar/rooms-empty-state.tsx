import { Link } from '@tanstack/react-router';
import { DoorOpen, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useBranchRoutes } from '@/lib/use-routes';

/** Shown when the org has no resources at all — there are no columns to draw. */
export function RoomsEmptyState() {
  const routes = useBranchRoutes();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DoorOpen />
          </EmptyMedia>
          <EmptyTitle>See your rooms as calendar columns</EmptyTitle>
          <EmptyDescription>
            Add your treatment rooms and equipment, and every booking that needs
            one will show up here — one column per room.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to={routes.catalogResources}>
              <Settings2 />
              Set up rooms
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
