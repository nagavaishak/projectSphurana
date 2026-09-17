import { useGetLeadForm } from '@/features/lead-forms/api';
import { useLeadFormEditor } from '@/features/lead-forms/components/use-lead-form-editor';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

registerEntityEditor({
  slug: 'lead-form',
  listPath: BRANCH_PATHS.marketingLeadForms,
  use: ({ id }) => {
    // One registration covers both dialogs the page used to open: create vs
    // edit is nothing but whether an id came in on the URL.
    const { leadForm, isLoading, isError } = useGetLeadForm(id ?? '');

    const editor = useLeadFormEditor({
      leadForm: id ? leadForm : null,
      isEditing: Boolean(id),
    });

    return {
      ...editor,
      isLoading: Boolean(id) && isLoading,
      notFound: Boolean(id) && !isLoading && (isError || !leadForm),
    };
  },
});
