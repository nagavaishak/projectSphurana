'use client';

/**
 * §11 and §12 — reminders, pre/post-care and rebooking intervals.
 *
 * ## Settings pages get long, so this one has two of them
 *
 * The first version put four reminder editors, two care-note editors, the
 * interval table and two more message editors on one scroll — eleven textareas,
 * every one of them expanded. You could not see the shape of the automation for
 * the copy inside it.
 *
 * So the list only ever shows WHEN a message goes and whether it is switched
 * on. Editing the words is a separate screen. That is not a compromise: the two
 * jobs are done at different times by different people — the owner decides the
 * schedule once, and somebody rewrites a sentence six months later.
 *
 * ## Template approval is on the row, not in a banner
 *
 * A rejected WhatsApp template means that reminder silently does not send. It
 * belongs beside the switch that claims the reminder is on, because those two
 * facts contradict each other and the row is where you see it.
 */

import { ArrowLeftIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  LAPSED_MESSAGE,
  MERGE_FIELDS,
  POST_CARE,
  PRE_CARE,
  REBOOK_INTERVALS,
  REBOOK_MESSAGE,
  REMINDER_STEPS,
  type WfReminderStep,
  type WfTemplateApproval,
} from './mock';

type ViewId = 'reminders' | 'rebooking' | 'editor';

const VIEWS = [
  { id: 'reminders', label: 'Reminders' },
  { id: 'rebooking', label: 'Rebooking' },
  { id: 'editor', label: 'Editing a message' },
];

const APPROVAL_LABEL: Record<WfTemplateApproval, string> = {
  approved: 'Template approved',
  pending: 'Awaiting Meta approval',
  rejected: 'Rejected by Meta — will not send',
  'n/a': 'No template needed',
};

export function WfRemindersSettings() {
  const [view, setView] = useState<ViewId>('reminders');
  const [editing, setEditing] = useState<WfReminderStep>(REMINDER_STEPS[0]);

  const openEditor = (step: WfReminderStep) => {
    setEditing(step);
    setView('editor');
  };

  return (
    <WfFrame
      name="Reminders & rebooking"
      location="Settings › Messaging"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="Eleven textareas became one screen at a time">
            Scheduling and copywriting happen months apart. The list answers
            “what goes out and when”; the editor answers “what does it say”, and
            neither has to be read past to reach the other.
          </WfPoint>
          <WfPoint title="A rejected template contradicts its own switch">
            No-show recovery is switched on and cannot send, because Meta
            rejected <code>no_show_rebook_v2</code>. That belongs on the row
            beside the switch, not in a banner at the top of the page where it
            is attached to nothing.
          </WfPoint>
          <WfPoint title="Merge fields are chips, not documentation">
            Clicking one inserts it. A list of available placeholders printed
            under a textarea is a thing to copy by hand and mistype.
          </WfPoint>
          <WfPoint title="Intervals carry their patient count">
            Changing Botox from 90 to 120 days moves 184 people. The number is
            on the row so the consequence is visible while the change is being
            made.
          </WfPoint>
          <WfPoint title="Known collision">
            §12.3’s 30-day catch-all and §14’s win-back sequence both fire on
            the same lapsed patient. One of them has to yield — see §27.
          </WfPoint>
        </>
      }
    >
      {view === 'editor' ? (
        <MessageEditor step={editing} onBack={() => setView('reminders')} />
      ) : (
        <DashboardPage
          title="Reminders & rebooking"
          description="What Claire sends around an appointment, and when she asks a patient to come back."
        >
          {view === 'reminders' ? (
            <Reminders onEdit={openEditor} />
          ) : (
            <Rebooking onEdit={openEditor} />
          )}
        </DashboardPage>
      )}
    </WfFrame>
  );
}

/* ------------------------------------------------------------- reminders -- */

function Reminders({ onEdit }: { onEdit: (step: WfReminderStep) => void }) {
  return (
    <div className="space-y-8">
      <Section
        title="Around the appointment"
        description="Sent on WhatsApp, with SMS as the fallback when the 24-hour window has closed."
      >
        <div className="divide-y rounded-xl border">
          {REMINDER_STEPS.map((step) => (
            <div
              key={step.id}
              className="flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <Switch defaultChecked={step.enabled} aria-label={step.title} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{step.title}</p>
                <p className="text-muted-foreground text-sm">{step.offset}</p>
                {/* The one status that changes whether this works at all. */}
                {step.approval !== 'approved' ? (
                  <Badge
                    variant={
                      step.approval === 'rejected' ? 'destructive' : 'outline'
                    }
                    className="mt-1.5"
                  >
                    {APPROVAL_LABEL[step.approval]}
                  </Badge>
                ) : null}
              </div>
              <Button variant="outline" size="sm" onClick={() => onEdit(step)}>
                Edit message
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Care instructions"
        description="Set per service. These are the defaults for injectables."
      >
        <div className="divide-y rounded-xl border">
          {[
            { id: 'pre', label: 'Before the visit', body: PRE_CARE },
            { id: 'post', label: 'After the visit', body: POST_CARE },
          ].map((care) => (
            <div
              key={care.id}
              className="flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{care.label}</p>
                <p className="truncate text-muted-foreground text-sm">
                  {care.body}
                </p>
              </div>
              <Button variant="outline" size="sm">
                Edit
              </Button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- rebooking -- */

function Rebooking({ onEdit }: { onEdit: (step: WfReminderStep) => void }) {
  return (
    <div className="space-y-8">
      <Section
        title="How long between visits"
        description="When the interval passes, Claire asks the patient to book again."
      >
        <div className="divide-y rounded-xl border">
          {REBOOK_INTERVALS.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.treatment}</p>
                <p className="text-muted-foreground text-sm">
                  {row.patientsOnInterval} patients on this interval
                  {row.note ? ` · ${row.note}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={row.days}
                  className="w-20 text-right tabular-nums"
                  aria-label={`Days between ${row.treatment} visits`}
                />
                <span className="text-muted-foreground text-sm">days</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="What she says"
        description="Two messages: the one tied to the interval, and the catch-all for anyone who has gone quiet."
      >
        <div className="divide-y rounded-xl border">
          {[
            {
              id: 'rebook',
              title: 'Rebooking prompt',
              offset: 'When the interval above has passed',
              body: REBOOK_MESSAGE,
            },
            {
              id: 'lapsed',
              title: 'Lapsed catch-all',
              offset: '30 days with no visit, whatever the treatment',
              body: LAPSED_MESSAGE,
            },
          ].map((message) => (
            <div
              key={message.id}
              className="flex flex-wrap items-center gap-4 px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{message.title}</p>
                <p className="text-muted-foreground text-sm">
                  {message.offset}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onEdit({
                    id: message.id,
                    title: message.title,
                    offset: message.offset,
                    channel: 'WhatsApp, SMS fallback',
                    body: message.body,
                    approval: 'approved',
                    templateName: `${message.id}_prompt_v1`,
                    enabled: true,
                  })
                }
              >
                Edit message
              </Button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- editor -- */

function MessageEditor({
  step,
  onBack,
}: {
  step: WfReminderStep;
  onBack: () => void;
}) {
  return (
    <DashboardPage
      title={step.title}
      description={`${step.offset} · ${step.channel}`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
          <Button size="sm">Save</Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <Label htmlFor="reminder-body">Message</Label>
          <Textarea id="reminder-body" defaultValue={step.body} rows={7} />

          {/* Chips insert at the cursor. A printed list of placeholders is a
              thing to retype by hand and get wrong. */}
          <div className="flex flex-wrap gap-1.5">
            {MERGE_FIELDS.map((field) => (
              <Button key={field} type="button" variant="outline" size="sm">
                {field}
              </Button>
            ))}
          </div>

          <p className="text-muted-foreground text-sm">
            Template <code>{step.templateName}</code> ·{' '}
            {APPROVAL_LABEL[step.approval]}. Changing the words of an approved
            template sends it back to Meta for review, which takes up to 48
            hours.
          </p>
        </div>

        {/* The preview is why the editor gets its own screen: a 240-character
            body has to be judged at the width the patient reads it. */}
        <div className="space-y-2">
          <p className="font-medium text-muted-foreground text-sm">Preview</p>
          <div className="rounded-2xl border bg-muted/40 p-4">
            <div className="max-w-[280px] rounded-2xl rounded-bl-sm bg-background p-3.5 text-sm leading-relaxed shadow-sm">
              {step.body}
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              WhatsApp · Harley Aesthetics
            </p>
          </div>
        </div>
      </div>
    </DashboardPage>
  );
}

/* --------------------------------------------------------------- shared -- */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}
