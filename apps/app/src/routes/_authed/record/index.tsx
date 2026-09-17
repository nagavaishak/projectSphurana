import { ROUTES } from '@/lib/route-paths';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_authed/record/')({
  beforeLoad: () => {
    throw redirect({ to: ROUTES.dashboard });
  },
});
