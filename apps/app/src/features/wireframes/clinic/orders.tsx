'use client';

/**
 * The order queue — shop orders between paid and handed over.
 *
 * ## Why this is a queue and not a report
 *
 * A paid order is unfinished work. Someone has to take a jar off a shelf, put
 * it in a bag with a name on it, and later hand it to the person who paid. That
 * is a task list, and it is the only screen in the shop that a clinic touches
 * every day.
 *
 * So the columns answer "what do I do next", not "what did we sell" — which is
 * the sales report's job and already exists.
 *
 * ## Three states, and the middle one earns its place
 *
 * Paid → picked → collected. It is tempting to collapse the middle: an order is
 * either outstanding or done. But "paid and picked" is what triggers the
 * message telling the customer to come in, and a clinic that marks orders
 * collected only when the customer arrives has no way to tell someone their
 * order is ready. The middle state IS the message.
 *
 * ## Waiting longest, first
 *
 * Default sort is oldest-paid, because the failure this screen prevents is an
 * order sitting unnoticed for a week. Sorting by newest would bury exactly the
 * row that needs attention.
 */

import { PackageIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { WfFrame, WfPoint } from '../wf-frame';

type OrderState = 'awaiting' | 'ready' | 'collected';

interface OrderRow {
  id: string;
  reference: string;
  customer: string;
  items: string;
  total: string;
  paid: string;
  waiting: string;
  state: OrderState;
  stale?: boolean;
}

const ORDERS: OrderRow[] = [
  {
    id: 'o1',
    reference: '#1043',
    customer: 'Sarah Whelan',
    items: '2 items',
    total: '€94.00',
    paid: '26 Aug',
    waiting: '7 days',
    state: 'awaiting',
    stale: true,
  },
  {
    id: 'o2',
    reference: '#1051',
    customer: 'Michael Okafor',
    items: '1 item',
    total: '€45.00',
    paid: '1 Sep',
    waiting: '1 day',
    state: 'awaiting',
  },
  {
    id: 'o3',
    reference: '#1052',
    customer: 'Aoife Ní Bhriain',
    items: '3 items',
    total: '€162.00',
    paid: '2 Sep',
    waiting: '2 hours',
    state: 'awaiting',
  },
  {
    id: 'o4',
    reference: '#1049',
    customer: 'James Kelly',
    items: '1 item',
    total: '€38.00',
    paid: '30 Aug',
    waiting: 'Ready since 31 Aug',
    state: 'ready',
  },
  {
    id: 'o5',
    reference: '#1046',
    customer: 'Priya Nair',
    items: '2 items',
    total: '€71.00',
    paid: '28 Aug',
    waiting: 'Ready since 29 Aug',
    state: 'ready',
  },
  {
    id: 'o6',
    reference: '#1038',
    customer: 'Tom Byrne',
    items: '1 item',
    total: '€52.00',
    paid: '22 Aug',
    waiting: 'Collected 24 Aug',
    state: 'collected',
  },
];

const TABS: { id: OrderState; label: string }[] = [
  { id: 'awaiting', label: 'To pick' },
  { id: 'ready', label: 'Ready to collect' },
  { id: 'collected', label: 'Collected' },
];

export function WfOrders() {
  const [state, setState] = useState<OrderState>('awaiting');

  const rows = useMemo(() => ORDERS.filter((o) => o.state === state), [state]);

  const columns: ListColumn<OrderRow>[] = [
    {
      id: 'reference',
      header: 'Order',
      mobile: 'primary',
      cell: (row) => (
        <span className="font-medium tabular-nums">{row.reference}</span>
      ),
    },
    { id: 'customer', header: 'Customer', cell: (row) => row.customer },
    {
      id: 'items',
      header: 'Items',
      cell: (row) => <span className="text-muted-foreground">{row.items}</span>,
    },
    {
      id: 'total',
      header: 'Paid',
      cell: (row) => <span className="tabular-nums">{row.total}</span>,
    },
    {
      id: 'waiting',
      header: state === 'collected' ? 'Collected' : 'Waiting',
      cell: (row) =>
        row.stale ? (
          // The whole point of the screen: an order nobody picked up on.
          <Badge
            variant="outline"
            className="border-amber-500/40 text-amber-700 dark:text-amber-400"
          >
            {row.waiting}
          </Badge>
        ) : (
          <span className="text-muted-foreground">{row.waiting}</span>
        ),
    },
    {
      id: 'action',
      header: '',
      cell: (row) =>
        row.state === 'awaiting' ? (
          <Button size="sm" variant="outline">
            Mark picked
          </Button>
        ) : row.state === 'ready' ? (
          <Button size="sm" variant="outline">
            Mark collected
          </Button>
        ) : null,
    },
  ];

  return (
    <WfFrame
      name="Order queue"
      location="Sales › Orders"
      notes={
        <>
          <WfPoint title="A task list, not a report">
            Every column answers “what do I do next”. What was sold is the sales
            report’s job and already exists.
          </WfPoint>
          <WfPoint title="“Picked” is a state because it is a message">
            Paid and picked is what tells a customer to come in. Collapsing it
            into done leaves no moment at which that message can be sent.
          </WfPoint>
          <WfPoint title="Oldest first, and ageing is flagged">
            The failure this screen prevents is an order sitting for a week. The
            newest-first default every other list uses would bury exactly the
            row that needs attention.
          </WfPoint>
          <WfPoint title="Delivery slots in here later">
            With <code>fulfilment_method = 'ship'</code> the tabs become To pick
            / To post / Dispatched and the action captures a tracking reference.
            Same queue, same states — which is why the column is worth adding
            before delivery is wanted.
          </WfPoint>
          <WfPoint title="Till sales never appear here">
            They are born collected. Only orders paid through the portal have
            work outstanding, so <code>fulfilment_status</code> is{' '}
            <code>not_applicable</code> on every existing row and this lands
            without a backfill.
          </WfPoint>
        </>
      }
    >
      <ListPage<OrderRow>
        config={{
          title: 'Orders',
          description: 'Shop orders paid online and waiting to be handed over.',
          rows,
          rowKey: (row) => row.id,
          columns,
          filters: (
            <Tabs
              onValueChange={(value) => setState(value as OrderState)}
              value={state}
            >
              <TabsList>
                {TABS.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ),
          empty: {
            icon: PackageIcon,
            title: 'Nothing to pick',
            description: 'Online orders appear here as soon as they are paid.',
          },
        }}
      />
    </WfFrame>
  );
}
