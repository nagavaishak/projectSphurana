import { useStockOrderEditor } from '@/features/inventory/editors';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { registerEntityEditor } from '../registry';

/**
 * Stock orders are create-only here: an existing order is receipted or
 * cancelled from its detail sheet, not re-edited field by field.
 */
registerEntityEditor({
  slug: 'stock-order',
  listPath: BRANCH_PATHS.inventoryStockOrders,
  use: () => useStockOrderEditor(),
});
