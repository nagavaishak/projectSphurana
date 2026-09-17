import { useListServices } from '@/features/organization-services';
import { useServiceEditor } from '@/features/services-dashboard/service-editor';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

registerEntityEditor({
  slug: 'service',
  listPath: BRANCH_PATHS.services,
  use: ({ id }) => {
    // Edit mode resolves the record from the list the catalog already caches,
    // so opening the editor from the list is instant and does not refetch.
    const { services, isLoading } = useListServices({ limit: 100 });
    const service = id ? (services.find((s) => s.id === id) ?? null) : null;

    const editor = useServiceEditor({ service });

    return {
      ...editor,
      isLoading: Boolean(id) && isLoading,
      notFound: Boolean(id) && !isLoading && !service,
    };
  },
});
