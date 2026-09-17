import { createFileRoute, redirect } from '@tanstack/react-router';

/** Moved to the shared editor route. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/services/new')({
  beforeLoad: () => {
    throw redirect({ to: '/create/$entity', params: { entity: 'service' } });
  },
});
