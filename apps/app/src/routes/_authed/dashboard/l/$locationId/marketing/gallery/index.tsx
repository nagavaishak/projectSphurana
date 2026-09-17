import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import {
  GalleryMobilePage,
  GalleryPageContent,
} from '@/features/content-studio';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/gallery/'
)({
  component: GalleryPage,
});

function GalleryPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <title>Gallery | Borradh</title>
        <GalleryMobilePage heading="Gallery" mode="both" />
      </>
    );
  }

  return (
    <>
      <title>Gallery | Borradh</title>
      <PageShell>
        <GalleryPageContent />
      </PageShell>
    </>
  );
}
