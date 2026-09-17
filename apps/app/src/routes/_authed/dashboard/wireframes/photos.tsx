import { createFileRoute } from '@tanstack/react-router';

import { PhotosWireframe } from '@/features/wireframes/consultation/photos';

export const Route = createFileRoute('/_authed/dashboard/wireframes/photos')({
  component: PhotosRoute,
});

/** `/dashboard/wireframes/photos` — gallery, capture and the export gate (§9). */
function PhotosRoute() {
  return <PhotosWireframe />;
}
