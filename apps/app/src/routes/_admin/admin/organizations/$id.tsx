import { createFileRoute } from '@tanstack/react-router';

import { OrganizationDetail } from '@/features/admin-terminal';

export const Route = createFileRoute('/_admin/admin/organizations/$id')({
  component: AdminOrganizationDetailPage,
});

function AdminOrganizationDetailPage() {
  const { id } = Route.useParams();
  return (
    <div className="container max-w-5xl py-8">
      <OrganizationDetail organizationId={id} />
    </div>
  );
}
