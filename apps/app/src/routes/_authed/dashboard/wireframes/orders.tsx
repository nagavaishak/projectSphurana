import { createFileRoute } from '@tanstack/react-router';

import { WfOrders } from '@/features/wireframes/clinic/orders';

export const Route = createFileRoute('/_authed/dashboard/wireframes/orders')({
  component: WfOrders,
});
