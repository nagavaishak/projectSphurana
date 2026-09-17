import { Link, createFileRoute } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/_authed/dashboard/wireframes/')({
  component: WireframesIndex,
});

/**
 * `/dashboard/wireframes` — index of the clinic-side wireframes.
 *
 * Companion to `/wireframes` in `apps/marketing-astro`, which holds the
 * patient-facing ones. Every page here is static: fixtures only, no queries, no
 * mutations, and nothing in the product links to any of them.
 *
 * Delete a page when its surface ships for real.
 */

interface WfLink {
  to: string;
  name: string;
  note: string;
  status: 'new' | 'extends' | 'stub';
}

const GROUPS: { title: string; blurb: string; pages: WfLink[] }[] = [
  {
    title: 'Consultation & clinical records',
    blurb:
      'iPad-primary. The annotation canvas is the largest single build in the spec, and the offline behaviour around it is not optional.',
    pages: [
      {
        to: '/wireframe-fullscreen/annotate',
        name: 'Annotation canvas',
        note: 'Tools, pin popover with product and lot, layers, totals.',
        status: 'new',
      },
      {
        to: '/wireframe-fullscreen/scribe',
        name: 'AI scribe',
        note: 'Record, transcribe, draft the note — reviewed and signed, never auto-filed.',
        status: 'new',
      },
      {
        to: '/wireframe-fullscreen/compare',
        name: 'Comparison view',
        note: 'Two consultations, synced zoom, side-by-side / wipe / blink.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/photos',
        name: 'Photos — a new Clinical tab',
        note: 'Gallery, upload, the consent checkboxes, and the marketing-consent export gate.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/skin-analysis',
        name: 'Skin analysis',
        note: 'Scan capture, the twelve-metric report, progress.',
        status: 'new',
      },
    ],
  },
  {
    title: 'Bookings & money',
    blurb:
      'The calendar itself is not being changed, and neither is the appointment side panel — it ships, on desktop and mobile, and the scribe is a button THERE rather than a new page. What remains is the deposits console, which replaces a Coming Soon stub sitting on a finished backend.',
    pages: [
      {
        to: '/dashboard/wireframes/walk-in',
        name: 'Walk-in',
        note: 'Three taps, not the six-step wizard.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/deposits',
        name: 'Deposits console',
        note: 'Replaces the stub. Charge card and no-show approval included.',
        status: 'stub',
      },
      {
        name: 'Order queue',
        note: 'Shop orders between paid and handed over. Delivery slots into the same queue later.',
        status: 'new',
        to: '/dashboard/wireframes/orders',
      },
    ],
  },
  {
    title: 'Retention & communication',
    blurb:
      'The message log is not in the spec and is needed on day one — it is the answer to "why did my patient not get a reminder".',
    pages: [
      {
        to: '/dashboard/wireframes/retention',
        name: 'Retention dashboard',
        note: 'Metric tiles, due-for-rebooking, treatment performance.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/reminders-settings',
        name: 'Reminders & rebooking',
        note: 'The 24h/2h schedule, reply handling, and rebooking intervals.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/reviews',
        name: 'Review management',
        note: 'Negative feedback queue, rating spread, Google routing.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/sequences',
        name: 'Journey sequences',
        note: 'Clinic read-and-pause list, plus the internal builder.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/notifications',
        name: 'Notification preferences',
        note: 'The type × channel matrix, recipients, digests.',
        status: 'new',
      },
    ],
  },
  {
    title: 'Reporting, search & settings',
    blurb:
      'Two accounting problems live here: profit is not computable from the data we hold, and deposits double-count.',
    pages: [
      {
        to: '/dashboard/wireframes/reports',
        name: 'Reports',
        note: 'Revenue, clients, treatments, marketing ROI.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/search',
        name: 'Search & client filters',
        note: 'Command palette incl. clients, and the filter panel.',
        status: 'extends',
      },
      {
        to: '/dashboard/wireframes/settings',
        name: 'Settings IA',
        note: 'Ten sub-pages, plus the new service and product fields.',
        status: 'extends',
      },
      {
        to: '/dashboard/wireframes/products-settings',
        name: 'Products',
        note: 'Type, default unit and lot tracking — what the pin popover needs.',
        status: 'extends',
      },
      {
        to: '/dashboard/wireframes/data-privacy',
        name: 'Data & privacy',
        note: 'Clinic export, and GDPR patient deletion.',
        status: 'new',
      },
      {
        to: '/wireframe-fullscreen/consent-kiosk',
        name: 'Kiosk consent fill',
        note: 'Full-screen, no nav. The only way out is a staff PIN.',
        status: 'new',
      },
      {
        to: '/dashboard/wireframes/consent-compliance',
        name: 'Re-consent queue',
        note: 'Whose consent has run out, ordered by who is booked in. The PIN-locked kiosk is a full-screen surface and needs its own route.',
        status: 'new',
      },
    ],
  },
];

const STATUS_LABEL: Record<WfLink['status'], string> = {
  new: 'New',
  extends: 'Extends live page',
  stub: 'Replaces a stub',
};

function WireframesIndex() {
  return (
    <>
      <title>Wireframes | Borradh</title>
      <DashboardPage
        title="Clinic wireframes"
        description="Static review pages for the new clinic-side surfaces. Fixtures only — no queries, no writes. The patient-facing set lives in the marketing app at /wireframes."
      >
        {GROUPS.map((group) => (
          <section key={group.title} className="space-y-3">
            <div>
              <h2 className="font-semibold text-lg">{group.title}</h2>
              <p className="max-w-prose text-muted-foreground text-sm">
                {group.blurb}
              </p>
            </div>
            <ul className="divide-y rounded-xl border bg-card">
              {group.pages.map((page) => (
                <li key={page.to}>
                  <Link
                    to={page.to}
                    className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{page.name}</span>
                      <span className="block text-muted-foreground text-sm">
                        {page.note}
                      </span>
                    </span>
                    <Badge
                      variant={page.status === 'new' ? 'default' : 'secondary'}
                      className="shrink-0"
                    >
                      {STATUS_LABEL[page.status]}
                    </Badge>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DashboardPage>
    </>
  );
}
