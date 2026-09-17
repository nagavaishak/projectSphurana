'use client';

/**
 * §17.3 — the re-consent queue.
 *
 * ## One surface, not two behind a toggle
 *
 * This page used to carry the in-clinic kiosk as well, behind a pair of toggle
 * buttons. They are not two views of one screen: the queue is a dashboard page
 * with a sidebar, and the kiosk is a full-screen surface handed to a patient on
 * an iPad, which must never render the clinic's navigation. Drawing the kiosk
 * inside a mock iPad bezel on a dashboard page hid exactly the property that
 * matters about it. It now lives in `wf-consent-kiosk.tsx`.
 *
 * ## The queue is ordered by consequence, not by date
 *
 * An expired form on a patient booked in tomorrow stops a treatment going
 * ahead. A form expiring in 40 days on someone with nothing booked does not.
 * "Next booking" is therefore a first-class column rather than a detail, and
 * "Nothing booked" is written out — a blank cell reads as missing data.
 */

import { ShieldCheckIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { WfFrame, WfPoint } from '../wf-frame';
import { type ConsentState, RECONSENT_QUEUE, type ReconsentRow } from './mock';

const STATE_LABEL: Record<ConsentState, string> = {
  expired: 'Expired',
  expiring: 'Expiring',
  'due-soon': 'Due soon',
};

function expiryText(days: number): string {
  if (days < 0) {
    return `${Math.abs(days)} days ago`;
  }
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  return `In ${days} days`;
}

export function WfConsentCompliance({ embedded }: { embedded?: boolean } = {}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return RECONSENT_QUEUE;
    }
    return RECONSENT_QUEUE.filter(
      (row) =>
        row.patient.toLowerCase().includes(term) ||
        row.form.toLowerCase().includes(term)
    );
  }, [search]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  const columns: ListColumn<ReconsentRow>[] = [
    {
      id: 'select',
      width: 'w-[44px]',
      cell: (row) => (
        <Checkbox
          checked={selected.includes(row.id)}
          onCheckedChange={() => toggle(row.id)}
          aria-label={`Select ${row.patient}`}
        />
      ),
    },
    {
      id: 'patient',
      header: 'Patient',
      mobile: 'primary',
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.patient}</span>
          <span className="block text-muted-foreground text-xs">
            {row.patientSecondary}
          </span>
        </span>
      ),
    },
    {
      id: 'form',
      header: 'Form',
      mobile: 'secondary',
      width: 'w-[230px]',
      cell: (row) => (
        <span className="block">
          {row.form}
          <span className="block text-muted-foreground text-xs">
            Signed {row.signed}
          </span>
        </span>
      ),
    },
    {
      id: 'nextBooking',
      header: 'Next booking',
      cell: (row) =>
        row.nextBooking ?? (
          <span className="text-muted-foreground">Nothing booked</span>
        ),
    },
    {
      id: 'expiry',
      header: 'Expires',
      mobile: 'trailing',
      align: 'right',
      width: 'w-[130px]',
      cell: (row) => (
        <span className="inline-flex flex-col items-end gap-1">
          <Badge
            variant={row.state === 'expired' ? 'destructive' : 'secondary'}
          >
            {STATE_LABEL[row.state]}
          </Badge>
          <span className="text-muted-foreground text-xs tabular-nums">
            {expiryText(row.daysUntilExpiry)}
          </span>
        </span>
      ),
    },
  ];

  const queue = (
    <ListPage<ReconsentRow>
      config={{
        title: 'Re-consent queue',
        description:
          'Medical history is renewed every year. Treatment consent expires after 12 months, or when the treatment changes.',
        columns,
        rows,
        rowKey: (row) => row.id,
        search,
        onSearchChange: setSearch,
        searchPlaceholder: 'Search patients or forms',
        /* Only once something is ticked. Nothing is pre-selected, because
             the primary control on this page sends messages to real people. */
        filters:
          selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
              <span className="font-medium text-sm">
                {selected.length} selected
              </span>
              <Button size="sm">
                Send a renewal link to {selected.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <span className="text-muted-foreground text-xs">
                Anyone booked in within the hour is skipped — reception hands
                them the iPad instead.
              </span>
            </div>
          ) : undefined,
        footer: (
          <p className="text-muted-foreground text-sm">
            {RECONSENT_QUEUE.filter((row) => row.state === 'expired').length}{' '}
            already expired · {RECONSENT_QUEUE.length} in the queue
          </p>
        ),
        empty: {
          icon: ShieldCheckIcon,
          title: 'Everyone is up to date',
          description:
            'Every patient with a booking has current consent. The queue fills again 11 months after each form is signed.',
        },
      }}
    />
  );

  // Embedded inside Consent & privacy, the host owns the frame and the header.
  if (embedded) {
    return queue;
  }

  return (
    <WfFrame
      name="Re-consent queue"
      location="Clients › Consent"
      notes={
        <>
          <WfPoint title="The kiosk moved out of this page">
            It is a full-screen surface handed to a patient. Rendering it inside
            a dashboard page — sidebar and all, in a drawn iPad bezel — hid the
            one property that matters: there is no navigation on it. See{' '}
            <code>wf-consent-kiosk.tsx</code>, which needs a route outside{' '}
            <code>/dashboard</code>.
          </WfPoint>
          <WfPoint title="Ordered by consequence">
            An expired form on somebody booked in tomorrow stops a treatment. A
            form expiring in 40 days on somebody with nothing booked does not.
            Next booking is a column, not a detail.
          </WfPoint>
          <WfPoint title="Nothing pre-selected">
            The earlier version arrived with every expired row already ticked
            and a live “send to 4 patients” button. A bulk message to real
            patients should not be one mis-aimed click from a page load.
          </WfPoint>
          <WfPoint title="An empty queue is good news">
            “Everyone with a booking has current consent”, not an inbox icon and
            “no results”. This list being empty is the goal.
          </WfPoint>
          <WfPoint title="Prerequisite">
            Consent records need a signed date and an expiry rule per form type
            — annual for medical history, 12 months or a treatment-type change
            for treatment consent. Neither exists today.
          </WfPoint>
        </>
      }
    >
      {queue}
    </WfFrame>
  );
}
