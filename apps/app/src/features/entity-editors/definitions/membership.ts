import { useListMembershipPlans } from '@/features/memberships/api';
import { useMembershipEditor } from '@/features/memberships/membership-form';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

registerEntityEditor({
  slug: 'membership',
  listPath: BRANCH_PATHS.catalogMemberships,
  use: ({ id }) => {
    // Edit mode resolves the record from the list the catalog already caches,
    // so opening the editor from the list is instant and does not refetch.
    const { plans, isLoading } = useListMembershipPlans();
    const plan = id ? (plans.find((p) => p.id === id) ?? null) : null;

    const editor = useMembershipEditor({ plan });

    return {
      ...editor,
      isLoading: Boolean(id) && isLoading,
      notFound: Boolean(id) && !isLoading && !plan,
    };
  },
});
