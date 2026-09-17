import { useGetPractitioner } from '@/features/practitioners';
import { useTeamMemberEditor } from '@/features/practitioners/components/team-member-editor';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

registerEntityEditor({
  slug: 'team-member',
  listPath: BRANCH_PATHS.teamMembers,
  use: ({ id }) => {
    // Fetched by id rather than picked out of the list cache: the editor needs
    // the full relations (services AND locations) to hydrate, and a deep link
    // into /edit/team-member/:id has no list cache to read from.
    const { practitioner, isLoading, isError } = useGetPractitioner({
      id: id ?? '',
    });

    const editor = useTeamMemberEditor({
      practitioner: id ? practitioner : null,
      isEditing: Boolean(id),
    });

    return {
      ...editor,
      isLoading: Boolean(id) && isLoading,
      notFound: Boolean(id) && !isLoading && (isError || !practitioner),
    };
  },
});
