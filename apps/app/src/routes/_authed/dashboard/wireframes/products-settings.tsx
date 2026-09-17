import { createFileRoute } from '@tanstack/react-router';

import { WfProducts } from '@/features/wireframes/admin/wf-products';

export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/products-settings'
)({
  component: ProductsSettingsWireframe,
});

/**
 * §5.4 — the product list and its three missing clinical fields.
 *
 * No `DashboardPage`: `ListPage` renders its own, and nesting two would produce
 * two page headers.
 */
function ProductsSettingsWireframe() {
  return (
    <>
      <title>Products wireframe | Borradh</title>
      <WfProducts />
    </>
  );
}
