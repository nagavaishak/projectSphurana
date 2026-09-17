import { createFileRoute } from '@tanstack/react-router';

import { PageShell } from '@/components/app/page-shell';
import { ContentLibrary, GalleryMobilePage } from '@/features/content-studio';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/gallery/library'
)({
  component: LibraryPage,
});

function LibraryPage() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <title>Content Library | Borradh</title>
        <GalleryMobilePage heading="Content library" mode="library" />
      </>
    );
  }

  return (
    <>
      <title>Content Library | Borradh</title>
      <PageShell>
        <ContentLibrary />
      </PageShell>
    </>
  );
}
