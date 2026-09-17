import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * Integrations moved into Settings. Kept as a redirect so old links and the
 * Instagram OAuth return flow (which lands here with `?instagram=...`) still
 * work — search params are forwarded to the new location.
 */
const legacyIntegrationsSearchSchema = z.object({
  tab: z.string().optional(),
  instagram: z.string().optional(),
  message: z.string().optional(),
});

export const Route = createFileRoute('/_authed/dashboard/integrations')({
  validateSearch: legacyIntegrationsSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/dashboard/settings/integrations', search });
  },
});
