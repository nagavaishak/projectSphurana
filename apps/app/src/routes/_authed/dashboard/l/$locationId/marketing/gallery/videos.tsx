import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import {
  GalleryMobilePage,
  VideosPageContent,
} from '@/features/content-studio';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/gallery/videos'
)({
  component: VideosPage,
});

function VideosPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <title>Videos | Borradh</title>
        <GalleryMobilePage heading="Videos" mode="videos" />
      </>
    );
  }

  return (
    <>
      <title>Videos | Borradh</title>
      <PageShell>
        <VideosPageContent />
      </PageShell>
    </>
  );
}
