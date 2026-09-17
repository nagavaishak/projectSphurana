import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import {
  GalleryMobilePage,
  ImagesPageContent,
} from '@/features/content-studio';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/gallery/images'
)({
  component: ImagesPage,
});

function ImagesPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <title>Images | Borradh</title>
        <GalleryMobilePage heading="Images" mode="images" />
      </>
    );
  }

  return (
    <>
      <title>Images | Borradh</title>
      <PageShell>
        <ImagesPageContent />
      </PageShell>
    </>
  );
}
