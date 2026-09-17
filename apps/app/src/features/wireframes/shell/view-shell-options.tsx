'use client';

/**
 * The chosen entity-view shell (option C), rendered through the REAL component
 * at `components/app/entity-view` rather than a copy of it.
 *
 * Options A (left rail) and B (tabs, full width) were reviewed and rejected:
 * A puts a second vertical nav beside the app sidebar, and B leaves nowhere for
 * the facts you need *while* reading a tab. That reasoning lives in the shell's
 * own header so it survives this file being deleted.
 *
 * What this page is still for: proving one shell holds two entities with
 * different tab sets and different asides. Use the switcher.
 *
 * WIREFRAME. Static fixtures, no queries.
 */

import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  MailIcon,
  MoreHorizontalIcon,
  PhoneIcon,
} from 'lucide-react';
import { useState } from 'react';

import { EntityView, EntityViewAside } from '@/components/app/entity-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  APPOINTMENT,
  APPOINTMENT_OVERVIEW,
  APPOINTMENT_TABS,
  CLIENT,
  CLIENT_OVERVIEW,
  CLIENT_TABS,
} from './view-shell-mock';

type Entity = 'appointment' | 'client';

export function ViewShellOptions() {
  const [entity, setEntity] = useState<Entity>('appointment');
  const [tab, setTab] = useState('Overview');

  const isAppt = entity === 'appointment';
  const labels = isAppt ? APPOINTMENT_TABS : CLIENT_TABS;
  const tabs = labels.map((label) => ({ id: label, label }));

  return (
    <WfFrame
      name="Entity view shell"
      location="components/app/entity-view · appointment + client record"
      notes={
        <>
          <WfPoint title="This renders the real shell, not a mock of it">
            `components/app/entity-view`. Anything wrong here is wrong in the
            component, which is the point of reviewing it this way.
          </WfPoint>
          <WfPoint title="One shell, two entities">
            Six tabs and a payments-shaped aside for an appointment; eleven tabs
            and a contact-shaped aside for a client. Same header, same spacing,
            same tab idiom. Use the switcher.
          </WfPoint>
          <WfPoint title="The frame is the editor's, to the pixel">
            1079px column, 269px aside, 32px gap — Figma 3105:8141, the numbers
            `entity-editor` already uses. Create → view → edit does not shift.
          </WfPoint>
          <WfPoint title="The aside does not change with the tab">
            That is why it exists. Deposit, consent and balance stay on screen
            while you read the clinical note — what the side panel does well
            today and a full-width page throws away.
          </WfPoint>
          <WfPoint title="The header is identity, not a dashboard">
            Name, what this is, when, and the ONE status worth a badge. The
            shipping record header carries contact details and is ~160px tall
            before you read anything; those moved into Overview and the aside.
          </WfPoint>
          <WfPoint title="Tabs wrap rather than scroll">
            A hidden tab is a tab nobody finds. Eleven wrap onto two rows at
            narrow widths, which is ugly and honest.
          </WfPoint>
        </>
      }
    >
      {/* Review scaffolding, not part of the shell. */}
      <div className="mx-auto flex w-full max-w-[1079px] items-center gap-2 px-6 pt-4 md:px-0">
        <span className="text-muted-foreground text-xs">Showing:</span>
        {(['appointment', 'client'] as const).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => {
              setEntity(e);
              setTab('Overview');
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              entity === e
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted'
            )}
          >
            {e === 'appointment' ? 'Appointment' : 'Client record'}
          </button>
        ))}
      </div>

      <EntityView
        config={{
          identity: isAppt
            ? {
                // The entity is the APPOINTMENT, so the title says what it
                // is; the patient is who it is for. Titling it with her name
                // alone made the page read as a second client record.
                title: `${APPOINTMENT.service} (${APPOINTMENT.patient})`,
                initials: APPOINTMENT.initials,
                subtitle: `${APPOINTMENT.when} · ${APPOINTMENT.practitioner}`,
                status: (
                  <Badge className="gap-1.5 bg-emerald-600 hover:bg-emerald-600">
                    <ClockIcon className="size-3" />
                    {APPOINTMENT.status} — {APPOINTMENT.statusSince}
                  </Badge>
                ),
              }
            : {
                title: CLIENT.name,
                initials: CLIENT.initials,
                subtitle: `${CLIENT.since} · ${CLIENT.visits} visits`,
              },
          back: { label: isAppt ? 'Back to calendar' : 'Back to clients' },
          actions: (
            <>
              <Button variant="outline" size="sm">
                {isAppt ? 'Reschedule' : 'Book'}
              </Button>
              <Button size="sm">{isAppt ? 'Check out' : 'Message'}</Button>
              <Button variant="outline" size="icon" aria-label="More">
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </>
          ),
          tabs,
          activeTab: tab,
          onTabChange: setTab,
          aside: <AtAGlance entity={entity} />,
        }}
      >
        <Panel entity={entity} tab={tab} />
      </EntityView>
    </WfFrame>
  );
}

/* ----------------------------------------------------------------- panel -- */

function Panel({ entity, tab }: { entity: Entity; tab: string }) {
  if (tab !== 'Overview') {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-background/60">
        <p className="text-muted-foreground text-sm">
          {tab} — the shell is what is being reviewed, not this panel.
        </p>
      </div>
    );
  }

  const rows =
    entity === 'appointment' ? APPOINTMENT_OVERVIEW : CLIENT_OVERVIEW;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border bg-background">
        <div className="divide-y">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-4"
            >
              <span className="w-32 shrink-0 text-muted-foreground text-sm">
                {row.label}
              </span>
              <span className="min-w-0 flex-1 text-sm">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {entity === 'appointment' ? (
        <section className="rounded-xl border bg-background p-5">
          <h2 className="font-medium text-sm">Consultation</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            No note yet for this visit.
          </p>
          <Button variant="outline" size="sm" className="mt-4">
            Start recording
          </Button>
        </section>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- aside -- */

function AtAGlance({ entity }: { entity: Entity }) {
  const items =
    entity === 'appointment'
      ? [
          { icon: CheckIcon, label: 'Deposit', value: APPOINTMENT.deposit },
          { icon: CheckIcon, label: 'Consent', value: APPOINTMENT.consent },
          { icon: ClockIcon, label: 'Balance', value: APPOINTMENT.balance },
          { icon: CalendarIcon, label: 'Visit', value: APPOINTMENT.visitNo },
        ]
      : [
          { icon: CalendarIcon, label: 'Next', value: CLIENT.nextAppt },
          { icon: CheckIcon, label: 'Lifetime', value: CLIENT.lifetime },
          { icon: MailIcon, label: 'Email', value: CLIENT.email },
          { icon: PhoneIcon, label: 'Mobile', value: CLIENT.phone },
        ];

  return (
    <EntityViewAside>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <item.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{item.label}</p>
              <p className="break-words text-sm">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
      {entity === 'client' ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="text-amber-900 text-xs dark:text-amber-200">
            {CLIENT.outstanding}
          </p>
        </div>
      ) : null}
    </EntityViewAside>
  );
}
