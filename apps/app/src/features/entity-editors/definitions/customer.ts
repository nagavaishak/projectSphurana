import { useCustomerEditor } from '@/features/leads/customer-form';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * The feature directory and the API say `leads`; the operator reads
 * "Customers" everywhere — the nav item, the page, the button and this URL.
 * The editor takes the name they read (`/create/customer`), while the list path
 * stays `BRANCH_PATHS.customers`.
 *
 * The `CreateLeadDialog` survives this registration deliberately: it is the
 * in-context quick-add fired from the till and the calendar, where navigating
 * away would lose a half-finished sale or booking. Both it and this editor
 * render `useCreateLeadForm` and the same field components, so the two surfaces
 * cannot drift — the same reason `lead-form` and `promotion` kept theirs.
 */
registerEntityEditor({
  slug: 'customer',
  listPath: BRANCH_PATHS.customers,
  use: ({ id }) => useCustomerEditor({ id }),
});
