'use client';

/**
 * The AI scribe (§8A) — full screen, because it runs inside the consultation
 * shell rather than beside a dashboard sidebar.
 *
 * ## The four stages are states, not sections
 *
 * Idle, recording, transcribing and review were previously rendered one under
 * another with a heading each, so the page read as documentation of a feature
 * rather than a design of one. Two of the four carry the weight — the recorder
 * and the review — and they are the two given room here.
 *
 * ## The level meter is the load-bearing element
 *
 * A consultation cannot be repeated. Elapsed time advances perfectly happily
 * while a dead microphone records silence, so the timer proves nothing and only
 * a moving level proves sound is arriving. It is therefore the largest thing on
 * the recording screen, and everything else on that screen is quiet.
 *
 * ## Review is two panes and a signature
 *
 * Transcript left, draft note right. Selecting a field highlights the transcript
 * it came from, because a practitioner who has to hunt for the source stops
 * checking — and an unchecked AI note is the failure mode the whole
 * review-then-sign safeguard exists to prevent.
 */

import { Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  CheckIcon,
  MicIcon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState } from 'react';

import {
  DedicatedLayout,
  DedicatedLayoutContent,
  DedicatedLayoutHeader,
  DedicatedLayoutHeaderLeft,
  DedicatedLayoutHeaderRight,
} from '@/components/app/full-screen-dedicated-layout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { PATIENT } from './mock';
import { NOTE_FIELDS, RECORDER_LEVELS, TRANSCRIPT } from './scribe-mock';

const STAGES = [
  { id: 'idle', label: 'Idle' },
  { id: 'recording', label: 'Recording' },
  { id: 'transcribing', label: 'Transcribing' },
  { id: 'review', label: 'Review' },
];

export function ScribeWireframe() {
  const [stage, setStage] = useState('recording');

  return (
    <WfFrame
      name="AI scribe"
      location="Full screen · launched from the appointment side panel"
      states={STAGES}
      activeState={stage}
      onState={setStage}
      notes={
        <>
          <WfPoint title="Not a step in the stepper">
            The practitioner annotates while recording. Making it a step would
            force a choice between the two, and both happen in the same three
            minutes with gloved hands — so in the product this docks into the
            consultation shell and survives navigating between steps.
          </WfPoint>
          <WfPoint title="The meter, not the timer">
            A dead microphone still advances a clock. Only a moving level proves
            audio is arriving, and a consultation cannot be recorded twice.
          </WfPoint>
          <WfPoint title="Transcription is online-only, and says so">
            Capture is local-first like photos; transcription needs a
            connection. Offline it reads "will transcribe when back online"
            rather than pretending — face mapping works offline and a
            practitioner will otherwise assume this does too.
          </WfPoint>
          <WfPoint title="Never auto-filed">
            Nothing reaches the record until the practitioner signs. Selecting a
            field highlights its source lines; the Photographs field has none,
            which is the honest way to show that the recording never covered it.
          </WfPoint>
          <WfPoint title="Doses are cross-checked, not transcribed">
            The face map says 36 units; the recording says 20. The pins are what
            was done and the transcript is what was said about it — the
            discrepancy is surfaced rather than silently resolved.
          </WfPoint>
          <WfPoint title="Retention">
            Audio deleted after 30 days by default, transcript and signed note
            kept. Same per-clinic key as photos, so an erasure crypto-shreds it.
          </WfPoint>
        </>
      }
    >
      <DedicatedLayout>
        <DedicatedLayoutHeader className="border-b">
          <DedicatedLayoutHeaderLeft className="min-w-0">
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link to="/wireframe-fullscreen/annotate">
                <ArrowLeftIcon className="size-4" />
                <span className="sr-only">Back to the face map</span>
              </Link>
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-sm">{PATIENT.name}</p>
              <p className="truncate text-muted-foreground text-xs">
                {PATIENT.treatment} · {PATIENT.date}
              </p>
            </div>
          </DedicatedLayoutHeaderLeft>

          <DedicatedLayoutHeaderRight>
            <span className="text-muted-foreground text-xs">
              Audio kept 30 days
            </span>
          </DedicatedLayoutHeaderRight>
        </DedicatedLayoutHeader>

        <DedicatedLayoutContent className="overflow-hidden">
          {stage === 'idle' ? (
            <Idle onStart={() => setStage('recording')} />
          ) : null}
          {stage === 'recording' ? (
            <Recording onStop={() => setStage('transcribing')} />
          ) : null}
          {stage === 'transcribing' ? <Transcribing /> : null}
          {stage === 'review' ? <Review /> : null}
        </DedicatedLayoutContent>
      </DedicatedLayout>
    </WfFrame>
  );
}

/* ------------------------------------------------------------ recorder -- */

function Idle({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">
        Record this consultation
      </h1>
      <p className="text-muted-foreground">
        Sarah agreed to be recorded at the consent step. Keep the iPad within
        arm's reach of you both.
      </p>
      <Button size="lg" className="h-14 px-8 text-base" onClick={onStart}>
        <MicIcon className="size-5" />
        Start recording
      </Button>
    </div>
  );
}

function Recording({ onStop }: { onStop: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 p-6">
      {/* The meter dominates. Bar heights come from the fixture; the stagger
          makes it read as live rather than as a static graphic. */}
      <div className="flex h-40 w-full max-w-2xl items-center justify-center gap-1.5">
        {RECORDER_LEVELS.map((level, i) => (
          <span
            key={`${level}-${i}`}
            className="w-2 animate-pulse rounded-full bg-primary sm:w-3"
            style={{
              height: `${level}%`,
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>

      <p className="font-semibold text-4xl tabular-nums">02:41</p>

      <Button
        size="lg"
        variant="outline"
        className="h-14 px-8 text-base"
        onClick={onStop}
      >
        <SquareIcon className="size-4 fill-current" />
        Stop
      </Button>
    </div>
  );
}

function Transcribing() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <Spinner className="size-8 text-muted-foreground" />
      <p className="font-medium text-lg">Transcribing 3 minutes of audio</p>
      <p className="text-muted-foreground text-sm">
        Saved on this iPad already. Leaving this screen will not lose it.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- review -- */

function Review() {
  const [field, setField] = useState(NOTE_FIELDS[0].id);
  const active = NOTE_FIELDS.find((f) => f.id === field) ?? NOTE_FIELDS[0];

  return (
    <div className="flex h-full">
      <div className="hidden min-h-0 w-[40%] shrink-0 flex-col border-r lg:flex">
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
          {TRANSCRIPT.map((line) => {
            const cited = active.sourceIds.includes(line.id);
            return (
              <p
                key={line.id}
                className={cn(
                  'rounded-md px-3 py-2 text-sm leading-relaxed transition-colors',
                  cited ? 'bg-primary/10' : 'text-muted-foreground'
                )}
              >
                <span className="mr-2 text-xs tabular-nums opacity-60">
                  {line.at}
                </span>
                <span className="font-medium">{line.speaker}</span> {line.text}
              </p>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6 pb-28">
          {NOTE_FIELDS.map((f) => (
            <div key={f.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={f.id}>{f.label}</Label>
                {f.sourceIds.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    Not covered in the recording
                  </span>
                ) : null}
              </div>
              <Textarea
                id={f.id}
                rows={f.rows}
                defaultValue={f.draft}
                onFocus={() => setField(f.id)}
                placeholder={
                  f.sourceIds.length === 0
                    ? 'Type this one yourself'
                    : undefined
                }
              />
              {f.id === 'products' ? (
                <p className="flex items-start gap-1.5 text-amber-600 text-xs dark:text-amber-400">
                  <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
                  The face map records 36 units; the recording says 20.
                </p>
              ) : null}
            </div>
          ))}

          <Button size="lg" className="w-full" asChild>
            <Link
              to="/dashboard/l/$locationId/calendar"
              params={{ locationId: 'loc-1' }}
            >
              <CheckIcon className="size-4" />
              Sign this note
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
