import { useProductEditorById } from '@/features/inventory/editors';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * Products are the one inventory entity with a real edit surface, so this
 * registers both `/create/product` and `/edit/product/:id`. Edit mode fetches
 * the record by id rather than relying on a cached list row — the URL is
 * shareable and reloadable.
 */
registerEntityEditor({
  slug: 'product',
  listPath: BRANCH_PATHS.catalogProducts,
  use: ({ id }) => useProductEditorById({ id }),
});
