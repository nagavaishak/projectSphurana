import { createFileRoute } from '@tanstack/react-router';

import { AuditLogTable } from '@/features/admin-terminal';

export const Route = createFileRoute('/_admin/admin/audit-log')({
  component: AuditLogPage,
});

function AuditLogPage() {
  return (
    <div className="container max-w-7xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground">
          View all soft-delete, restore, and mutation events across the
          platform.
        </p>
      </div>
      <AuditLogTable />
    </div>
  );
}
