import { createFileRoute } from '@tanstack/react-router';

import { OrganizationsTable } from '@/features/admin-terminal';

export const Route = createFileRoute('/_admin/admin/')({
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="container max-w-5xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Admin Terminal</h1>
        <p className="text-muted-foreground">
          Platform administration — browse organizations and impersonate users.
        </p>
      </div>
      <OrganizationsTable />
    </div>
  );
}
