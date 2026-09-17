import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { PageShell } from '@/components/app/page-shell';
import { IntegrationsGrid } from '@/features/integrations-dashboard/components/integrations-grid';

const integrationsSearchSchema = z.object({
  /** Set by Instagram OAuth return flow (e.g. `connected`). */
  instagram: z.string().optional(),
  message: z.string().optional(),
});

export const Route = createFileRoute(
  '/_authed/dashboard/settings/integrations'
)({
  validateSearch: integrationsSearchSchema,
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <>
      <title>Integrations | Borradh</title>
      <PageShell>
        <IntegrationsGrid />
      </PageShell>
    </>
  );
}
