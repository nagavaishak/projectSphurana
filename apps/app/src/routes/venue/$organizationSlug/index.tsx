import { createFileRoute, redirect } from '@tanstack/react-router';

import { micrositeVenueUrl } from '@/lib/microsite-url';

/**
 * The public venue page MOVED to the marketing app, with booking and the
 * portal — it is public, indexable and customer-facing, and a customer had no
 * business being sent to the dashboard host to read a clinic's address.
 *
 * `app.borradh.io/venue/*` 301s at the edge (vercel.json), which covers links
 * already in the wild. This covers everything the edge rule cannot: previews
 * and localhost, where the host is not `app.borradh.io`, and an in-app
 * navigation that never reaches the edge at all.
 */
export const Route = createFileRoute('/venue/$organizationSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: micrositeVenueUrl(params.organizationSlug) });
  },
});
