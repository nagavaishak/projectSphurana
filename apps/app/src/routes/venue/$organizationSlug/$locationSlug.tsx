import { createFileRoute, redirect } from '@tanstack/react-router';

import { micrositeVenueUrl } from '@/lib/microsite-url';

/** One branch of a clinic — moved to marketing. See `index.tsx`. */
export const Route = createFileRoute('/venue/$organizationSlug/$locationSlug')({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: micrositeVenueUrl(params.organizationSlug, params.locationSlug),
    });
  },
});
