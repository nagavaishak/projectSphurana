'use client';

/**
 * §14 — automated client journey sequences.
 *
 * ## Two audiences, so two screens
 *
 * The clinic gets a LIST: five sequences installed by default, each either
 * running or paused, with the only two numbers that matter — how many patients
 * are in it and how many came back because of it. The clinic cannot add or
 * reorder steps in V1.
 *
 * The BUILDER is a Borradh-team surface. Putting both on one page behind a
 * toggle made the clinic's page carry a step palette it is not allowed to use.
 * They are separate screens reached by opening a sequence, which is also how it
 * will work when the builder is opened up.
 *
 * ## A delay is an edge, not a card
 *
 * The spec's timeline has no branching, so "wait 30 days" is a property of the
 * step below it. Rendering delays as nodes makes a three-message sequence read
 * as six things to review.
 */

import { ArrowLeftIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  BUILDER_STEPS,
  PALETTE_EXTRAS,
  SEQUENCES,
  SEQUENCE_TRIGGERS,
  STEP_PALETTE,
  type WfSequenceSummary,
  type WfStepKind,
} from './mock';

type ViewId = 'library' | 'builder';

const VIEWS = [
  { id: 'library', label: 'Clinic view' },
  { id: 'builder', label: 'Builder (Borradh only)' },
];

const KIND_LABEL: Record<WfStepKind, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  task: 'Task',
};

export function WfSequences() {
  const [view, setView] = useState<ViewId>('library');
  const [open, setOpen] = useState<WfSequenceSummary>(
    SEQUENCES.find((s) => s.id === 'seq-winback') ?? SEQUENCES[0]
  );

  return (
    <WfFrame
      name="Sequences"
      location="Growth › Sequences"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="The clinic list and the builder are different screens">
            V1 lets a clinic pause a sequence and edit an offer, nothing more. A
            step palette on the clinic’s own page advertises an ability it does
            not have.
          </WfPoint>
          <WfPoint title="Two numbers per sequence">
            How many patients are in it now, and how many rebooked. Sent,
            delivered, read and clicked belong on the step inside the builder,
            where you are deciding whether a particular message works.
          </WfPoint>
          <WfPoint title="Delays are edges">
            “Wait 30 days” sits on the line between two cards. As a card it
            doubled the length of every sequence for no added meaning.
          </WfPoint>
          <WfPoint title="Only two sequences expose an offer">
            Win-back and Birthday. The others have nothing a clinic may safely
            change, so they get a switch and no editor.
          </WfPoint>
          <WfPoint title="Prerequisite">
            The backend exists but is dead code — no controller, one caller, and
            nothing reads it back. Before any of this renders for real, a
            sequence has to be readable.
          </WfPoint>
        </>
      }
    >
      {view === 'library' ? (
        <Library
          onOpen={(sequence) => {
            setOpen(sequence);
            setView('builder');
          }}
        />
      ) : (
        <Builder sequence={open} onBack={() => setView('library')} />
      )}
    </WfFrame>
  );
}

/* --------------------------------------------------------------- library -- */

function Library({
  onOpen,
}: {
  onOpen: (sequence: WfSequenceSummary) => void;
}) {
  return (
    <DashboardPage
      title="Sequences"
      description="Five journeys run in the background. Pause one and Claire stops mid-sequence for everybody in it."
    >
      <div className="divide-y rounded-xl border">
        {SEQUENCES.map((sequence) => (
          <div
            key={sequence.id}
            className="flex flex-wrap items-center gap-4 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {sequence.name}
                {sequence.paused ? (
                  <Badge variant="outline" className="ml-2 align-middle">
                    Paused
                  </Badge>
                ) : null}
              </p>
              <p className="text-muted-foreground text-sm">
                {sequence.trigger} · {sequence.steps} steps
              </p>
              {/* The one thing a clinic may change without us. */}
              {sequence.offer ? (
                <p className="mt-1 text-sm">Offer: {sequence.offer}</p>
              ) : null}
            </div>

            <div className="w-32 text-right">
              <p className="font-semibold tabular-nums">{sequence.active}</p>
              <p className="text-muted-foreground text-xs">in it now</p>
            </div>
            <div className="w-32 text-right">
              <p className="font-semibold tabular-nums">
                {sequence.bookedFrom.replace(' rebooked', '')}
              </p>
              <p className="text-muted-foreground text-xs">rebooked</p>
            </div>

            <Switch
              defaultChecked={!sequence.paused}
              aria-label={`${sequence.name} running`}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpen(sequence)}
            >
              Open
            </Button>
          </div>
        ))}
      </div>
    </DashboardPage>
  );
}

/* --------------------------------------------------------------- builder -- */

function Builder({
  sequence,
  onBack,
}: {
  sequence: WfSequenceSummary;
  onBack: () => void;
}) {
  return (
    <DashboardPage
      title={sequence.name}
      description={`${sequence.active} patients in this sequence · ${sequence.completed}`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
          <Button size="sm">Publish</Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border px-5 py-4">
            <span className="font-medium text-muted-foreground text-sm">
              Starts when
            </span>
            <Select defaultValue={SEQUENCE_TRIGGERS[3]}>
              <SelectTrigger className="w-[240px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEQUENCE_TRIGGERS.map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {trigger}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {BUILDER_STEPS.map((step) => (
            <div key={step.id}>
              {/* The edge chip. Sits on the line, indented, so it reads as a
                  gap between cards rather than another card. */}
              {step.delay ? (
                <div className="flex items-center gap-3 py-1 pl-5">
                  <span className="h-6 w-px bg-border" />
                  <span className="text-muted-foreground text-xs">
                    {step.delay}
                  </span>
                </div>
              ) : null}

              <div className="rounded-xl border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{step.title}</p>
                  <Badge variant="secondary">{KIND_LABEL[step.kind]}</Badge>
                </div>
                <p className="mt-2.5 text-muted-foreground text-sm leading-relaxed">
                  {step.preview}
                </p>
                {step.stats ? (
                  <p className="mt-3 text-muted-foreground text-xs tabular-nums">
                    {step.stats}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="font-medium text-muted-foreground text-sm">
            Add a step
          </p>
          {[
            ...STEP_PALETTE.map((entry) => ({
              id: entry.kind,
              label: entry.label,
              hint: entry.hint,
            })),
            ...PALETTE_EXTRAS,
          ].map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="w-full rounded-lg border px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                <PlusIcon className="size-3.5 opacity-60" />
                {entry.label}
              </span>
              <span className="mt-0.5 block text-muted-foreground text-xs">
                {entry.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </DashboardPage>
  );
}
