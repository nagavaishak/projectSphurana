import { useStockTakeEditor } from '@/features/inventory/editors';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * Stocktakes are create-only: you start one, then count it on the list page.
 * `/edit/stock-take/:id` therefore has nothing to render, and nothing links to
 * it — the count sheet is the edit surface.
 */
registerEntityEditor({
  slug: 'stock-take',
  listPath: BRANCH_PATHS.inventoryStocktakes,
  use: () => useStockTakeEditor(),
});
