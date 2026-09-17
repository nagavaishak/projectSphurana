import { ROUTES } from '@/lib/route-paths';
import { useResolvedRoutes } from '@/lib/use-routes';
import { Link, createFileRoute } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_authed/create-video/')({
  component: CreateVideoIndexPage,
});

/**
 * No source page exists in apps/web for `/create-video` — users arrive at
 * `/create-video/$templateId` from training hub or content calendar. This
 * shell exists so direct visits to `/create-video` land somewhere sensible
 * instead of a 404. The auth + active-org guard from apps/web's
 * `create-video/layout.tsx` is folded into `_authed.tsx` (2A handles
 * session; 2B will add the active-org check).
 */
function CreateVideoIndexPage() {
  const routes = useResolvedRoutes();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold">Pick a video template</h1>
      <p className="max-w-md text-muted-foreground">
        Open the before &amp; after wizard from the videos area, or head back
        home to get started.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="default">
          <Link to={ROUTES.dashboard}>Back to Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={routes.videosCreateFromClient}>Before / After Wizard</Link>
        </Button>
      </div>
    </main>
  );
}
