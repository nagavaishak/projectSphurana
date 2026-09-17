import { useLocationEditor } from '@/features/organization-locations/location-form';
import { ROUTES } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * Registers BOTH `/create/location` and `/edit/location/:id`.
 *
 * Edit resolves the record from the cached locations list rather than a
 * get-by-id endpoint (there isn't one, and the list is already loaded wherever
 * the branch switcher renders), and loads the branch's explicit catalogue
 * assignments alongside it.
 *
 * `listPath` is the ORG-level locations page, not a branch-prefixed one: you
 * come here to add or edit a branch, so the destination cannot itself require a
 * branch to already be selected.
 */
registerEntityEditor({
  slug: 'location',
  listPath: ROUTES.locations,
  use: ({ id }) => useLocationEditor({ id }),
});
