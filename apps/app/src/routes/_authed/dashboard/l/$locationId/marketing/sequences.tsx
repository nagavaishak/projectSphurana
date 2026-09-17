import { createFileRoute } from '@tanstack/react-router';

import { WfSequences } from '@/features/wireframes/growth/sequences';

/**
 * Journey sequences, under Marketing beside campaigns and socials.
 *
 * NOTE: `sequences` is dead code today — nine live write endpoints against a
 * feature nobody uses. Mounting it here is how the IA gets judged, not a
 * commitment to build it. See README.md, domain 7.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/sequences'
)({
  component: WfSequences,
});
