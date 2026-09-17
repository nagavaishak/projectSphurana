import { createFileRoute, redirect } from '@tanstack/react-router';

/** Moved to the shared editor route. Kept as a redirect for old links. */
export const Route = createFileRoute(
  '/_authed/dashboard/services/$serviceId/edit'
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/edit/$entity/$id',
      params: { entity: 'service', id: params.serviceId },
    });
  },
});
