'use client';

/**
 * The comparison view (§8.6) — full screen, because the clinical value is
 * entirely in how large the two images are.
 *
 * It was a dashboard page: sidebar, page header, a card per image, a delta
 * table and three explanatory paragraphs. The images ended up postcard-sized,
 * which is exactly the condition under which nobody can see the change they
 * opened the screen to see.
 *
 * Now: two frames filling the viewport, and a single bar of controls. The delta
 * strip is real content rather than furniture, so it stays — but folded, behind
 * one button, because it answers a question asked after looking, not before.
 *
 * Mode is a state, so exactly one renders. Wipe and blink stacked under
 * side-by-side made three copies of the same two photographs.
 */

import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, EyeIcon } from 'lucide-react';
import { useState } from 'react';

import {
  DedicatedLayout,
  DedicatedLayoutContent,
  DedicatedLayoutHeader,
  DedicatedLayoutHeaderLeft,
  DedicatedLayoutHeaderRight,
} from '@/components/app/full-screen-dedicated-layout';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { COMPARE_DELTAS, COMPARE_SIDES, PATIENT } from './mock';
import { WfPhotoFrame } from './wf-consultation-shell';

const MODES = [
  { id: 'side', label: 'Side by side' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'blink', label: 'Blink' },
];

export function CompareWireframe() {
  const [mode, setMode] = useState('side');
  const [wipe, setWipe] = useState([50]);
  const [blinkRight, setBlinkRight] = useState(false);
  const [deltas, setDeltas] = useState(false);

  return (
    <WfFrame
      name="Compare"
      location="Full screen · face map"
      states={MODES}
      activeState={mode}
      onState={setMode}
      notes={
        <>
          <WfPoint title="Synced zoom and pan, always on">
            Two images at different scales cannot be compared, so pan and zoom
            are locked together by default rather than offered as an option.
          </WfPoint>
          <WfPoint title="Blink is the one that finds change">
            Press and hold swaps the two in place. The eye detects a change
            between two frames at the same position far better than it compares
            two images side by side — which is why it is a mode and not a toggle
            buried in a menu.
          </WfPoint>
          <WfPoint title="The deltas fold away">
            Dose and zone changes are content, but they answer a question asked
            after looking. One button, closed by default, so the photographs get
            the viewport first.
          </WfPoint>
          <WfPoint title="Alignment comes from capture">
            These line up because both were shot against the same guide with the
            earlier photo ghosted underneath (§8.2). Comparison is only as good
            as the capture discipline that fed it.
          </WfPoint>
        </>
      }
    >
      <DedicatedLayout>
        <DedicatedLayoutHeader className="border-b">
          <DedicatedLayoutHeaderLeft className="min-w-0">
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link to="/dashboard/wireframes/photos">
                <ArrowLeftIcon className="size-4" />
                <span className="sr-only">Back to the client record</span>
              </Link>
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-sm">{PATIENT.name}</p>
              <p className="truncate text-muted-foreground text-xs">
                {COMPARE_SIDES.left.date} → {COMPARE_SIDES.right.date} · 4
                months
              </p>
            </div>
          </DedicatedLayoutHeaderLeft>

          <DedicatedLayoutHeaderRight>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeltas((d) => !d)}
            >
              Changes ({COMPARE_DELTAS.length})
            </Button>
            <Button variant="ghost" size="sm">
              <EyeIcon className="size-4" />
              Annotations
            </Button>
          </DedicatedLayoutHeaderRight>
        </DedicatedLayoutHeader>

        <DedicatedLayoutContent className="flex flex-col bg-muted/30">
          <div className="min-h-0 flex-1 p-4">
            {mode === 'side' ? <SideBySide /> : null}
            {mode === 'wipe' ? <Wipe value={wipe[0]} /> : null}
            {mode === 'blink' ? <Blink showRight={blinkRight} /> : null}
          </div>

          <div className="shrink-0 space-y-3 px-4 pb-24">
            {mode === 'wipe' ? (
              <div className="mx-auto max-w-md">
                <Slider
                  value={wipe}
                  onValueChange={setWipe}
                  aria-label="Wipe position"
                />
              </div>
            ) : null}

            {mode === 'blink' ? (
              <div className="flex justify-center">
                <Button
                  size="lg"
                  variant="outline"
                  onPointerDown={() => setBlinkRight(true)}
                  onPointerUp={() => setBlinkRight(false)}
                  onPointerLeave={() => setBlinkRight(false)}
                >
                  Hold to see{' '}
                  {blinkRight
                    ? COMPARE_SIDES.left.date
                    : COMPARE_SIDES.right.date}
                </Button>
              </div>
            ) : null}

            {deltas ? (
              <div className="flex flex-wrap justify-center gap-2">
                {COMPARE_DELTAS.map((d) => (
                  <span
                    key={d.zone}
                    className="rounded-full border bg-background px-3 py-1 text-sm"
                  >
                    {d.zone}{' '}
                    <span className="text-muted-foreground">
                      {d.from} → {d.to}
                    </span>{' '}
                    <span className="font-medium tabular-nums">{d.change}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </DedicatedLayoutContent>
      </DedicatedLayout>
    </WfFrame>
  );
}

/* --------------------------------------------------------------- modes -- */

function Caption({ side }: { side: 'left' | 'right' }) {
  const s = COMPARE_SIDES[side];
  return (
    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-background/90 px-3 py-1 font-medium text-sm shadow-sm backdrop-blur">
      {s.caption} · {s.date} · {s.botox}
    </span>
  );
}

function SideBySide() {
  return (
    <div className="grid h-full gap-4 md:grid-cols-2">
      {(['left', 'right'] as const).map((side) => (
        <div key={side} className="relative h-full">
          <WfPhotoFrame aspect="h-full w-full" className="h-full" />
          <Caption side={side} />
        </div>
      ))}
    </div>
  );
}

function Wipe({ value }: { value: number }) {
  return (
    <div className="relative mx-auto h-full max-w-3xl">
      <WfPhotoFrame aspect="h-full w-full" className="h-full" />
      {/* The later photo is clipped to the wipe position; both sit in the same
          box so a difference in position reads as a difference in the face. */}
      <div
        className="absolute inset-0 overflow-hidden rounded-xl"
        style={{ clipPath: `inset(0 0 0 ${value}%)` }}
      >
        <WfPhotoFrame aspect="h-full w-full" className="h-full bg-muted/70" />
      </div>
      <div
        className="absolute inset-y-0 w-px bg-foreground/60"
        style={{ left: `${value}%` }}
      />
      <Caption side={value > 50 ? 'left' : 'right'} />
    </div>
  );
}

function Blink({ showRight }: { showRight: boolean }) {
  return (
    <div className="relative mx-auto h-full max-w-3xl">
      <WfPhotoFrame
        aspect="h-full w-full"
        className={cn('h-full transition-colors', showRight && 'bg-muted/70')}
      />
      <Caption side={showRight ? 'right' : 'left'} />
    </div>
  );
}
