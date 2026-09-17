import { createFileRoute } from '@tanstack/react-router';

import { MetaPendingPanel } from '@/features/admin-terminal';

export const Route = createFileRoute('/_admin/admin/meta-connections')({
  component: MetaConnectionsPage,
});

function MetaConnectionsPage() {
  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Meta connections</h1>
        <p className="text-muted-foreground">
          Send a prospect the onboarding link, then attach their Facebook and
          Instagram to their workspace once they have authorised.
        </p>
      </div>
      <MetaPendingPanel />
    </div>
  );
}
