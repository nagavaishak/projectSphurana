'use client';

/**
 * AI skin analysis — capture, analysis, and the report (§19).
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * **One heat-map at a time.** Twelve overlays on one face is unreadable, so
 * selecting a metric row swaps the overlay rather than adding to it. The
 * selected row is the only one tinted, so the photo and the list always agree.
 *
 * **The disclaimer cannot be dismissed**, and it has to print on the shared PDF
 * too. §19.1 is explicit that this is decision support, not a diagnostic, and a
 * banner the practitioner can close is a banner the patient never sees.
 *
 * **Partial results are a real state.** The fixture returns nine of twelve
 * metrics on purpose — a set that always returns all twelve never gets the
 * "3 unavailable" row designed, and blanks would read as scores of zero.
 */

import {
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  PrinterIcon,
  SendIcon,
  ShieldAlertIcon,
  SparklesIcon,
  SunIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { WfSection } from '../wf-kit';
import {
  SKIN_METRICS,
  SKIN_PRODUCTS,
  SKIN_RECOMMENDATIONS,
  SKIN_UNAVAILABLE,
  type WfMetricRow,
} from './mock';

type Stage = 'capture' | 'analysing' | 'report';

export function SkinAnalysisWireframe() {
  const [stage, setStage] = useState<Stage>('report');
  const [selected, setSelected] = useState<string>(SKIN_METRICS[0].name);

  return (
    <WfFrame
      name="Skin analysis"
      location="Clients › record › Clinical › Skin"
      states={[
        { id: 'capture', label: 'Capture' },
        { id: 'analysing', label: 'Analysing' },
        { id: 'report', label: 'Report' },
      ]}
      activeState={stage}
      onState={(id) => setStage(id as Stage)}
      notes={
        <>
          <WfPoint title="One heat map at a time">
            Twelve overlays on one face is unreadable, so selecting a metric
            swaps the overlay rather than adding to it. The photo and the list
            always agree about what is being shown.
          </WfPoint>
          <WfPoint title="The disclaimer cannot be dismissed">
            §19.1 is explicit that this is decision support, not a diagnosis. A
            banner the practitioner can close is a banner the patient never
            sees, so it also prints on the shared report.
          </WfPoint>
          <WfPoint title="Nine of twelve, deliberately">
            The fixture returns a partial result. A set that always returns all
            twelve never gets the “3 unavailable” row designed, and blanks would
            read as scores of zero.
          </WfPoint>
          <WfPoint title="It needs a connection; face mapping does not">
            The two sit in the same shell, so a practitioner will assume they
            behave alike. Offline, the photo queues and the analysis runs later
            — said plainly rather than discovered.
          </WfPoint>
          <WfPoint title="Progress is the retention argument">
            “Your wrinkle score has gone from 7 to 4” is what brings someone
            back. The per-metric delta is the hero; the photos are support.
          </WfPoint>
        </>
      }
    >
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Scan of 2 September 2026
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <PrinterIcon className="size-4" />
              Print
            </Button>
            <Button size="sm">
              <SendIcon className="size-4" />
              Share with patient
            </Button>
          </div>
        </div>

        {stage === 'capture' ? <CaptureStage /> : null}
        {stage === 'analysing' ? <AnalysingStage /> : null}
        {stage === 'report' ? (
          <ReportStage selected={selected} onSelect={setSelected} />
        ) : null}
      </>
    </WfFrame>
  );
}

/* --------------------------------------------------------------- capture -- */

function CaptureStage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden">
        <div className="relative flex aspect-[4/3] items-center justify-center bg-neutral-900">
          {/* The face-fill guide is tighter than the consultation one — a scan
              needs the face to fill the frame consistently or the metrics are
              not comparable between visits. */}
          <div className="h-[78%] w-[46%] rounded-[50%] border-2 border-white/40 border-dashed" />
          <p className="absolute bottom-4 text-center text-sm text-white/70">
            Position the face inside the guide
          </p>
        </div>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          {/* Lighting is prominent here, unlike the consultation camera where it
              is only advisory — poor lighting does not just make a bad photo,
              it makes the scores wrong. */}
          <span className="flex items-center gap-2 font-medium text-amber-600 text-sm">
            <SunIcon className="size-4" />
            Lighting: acceptable — face a window if you can
          </span>
          <Button>
            <CameraIcon className="size-4" />
            Capture
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-medium">Before you scan</p>
          <ul className="space-y-2 text-muted-foreground text-sm">
            {[
              'No makeup',
              'Hair tied back',
              'Neutral expression',
              'Face a window, not a ceiling light',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
                {item}
              </li>
            ))}
          </ul>
          <Separator />
          <p className="text-muted-foreground text-xs">
            Clinical photo consent is required before a scan. It is captured
            once per consultation and reused here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- analysing -- */

function AnalysingStage() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
        <SparklesIcon className="size-8 animate-pulse text-primary" />
        <div>
          <p className="font-semibold text-lg">Analysing skin…</p>
          {/* 30–90s is a long time to show a spinner, so the elapsed counter and
              the rotating status line exist to make the wait legible rather than
              broken-looking. */}
          <p className="mt-1 text-muted-foreground text-sm">
            Detecting texture and pores · 38 seconds elapsed
          </p>
        </div>
        <progress
          className="block h-1.5 w-64 overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
          value={38}
          max={90}
          aria-label="Analysis progress"
        />
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <p className="max-w-sm text-muted-foreground text-xs">
          Cancelling keeps the photo on the record. Unlike face mapping, a scan
          needs a connection — offline, the photo queues and the analysis runs
          when you are back online.
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- report -- */

function ReportStage({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const metric = SKIN_METRICS.find((m) => m.name === selected);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* The photo carries ONE overlay, for the selected metric only. */}
        <Card className="overflow-hidden">
          <div className="relative flex aspect-[3/4] items-center justify-center bg-neutral-800">
            <span className="text-sm text-white/50">
              Face photo — heat map for
            </span>
            <span className="absolute bottom-14 font-medium text-sm text-white">
              {selected}
            </span>
            {metric ? (
              <span className="absolute right-3 bottom-3 rounded-md bg-black/60 px-2 py-1 text-white text-xs">
                {metric.areas}
              </span>
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="text-muted-foreground text-sm">
                  Overall skin score
                </p>
                <p className="font-semibold text-3xl tabular-nums">74 / 100</p>
              </div>
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                <TrendingUpIcon className="size-3" />
                +6 since 12 July
              </Badge>
            </CardContent>
          </Card>

          <div className="overflow-hidden rounded-xl border bg-card">
            {SKIN_METRICS.map((row) => (
              <MetricRow
                key={row.name}
                row={row}
                active={row.name === selected}
                onSelect={() => onSelect(row.name)}
              />
            ))}
            {/* Nine of twelve returned. Say so — blanks would read as zeros. */}
            <div className="flex items-start gap-2 border-t bg-muted/40 p-4 text-muted-foreground text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {SKIN_UNAVAILABLE.length} metrics unavailable for this scan:{' '}
                {SKIN_UNAVAILABLE.join(', ')}.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Non-dismissible, and it must print on the shared PDF too. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
        <p className="text-sm">
          <span className="font-semibold">
            Decision support, not a diagnosis.
          </span>{' '}
          These results guide the consultation and do not replace practitioner
          judgement. This notice also appears on the report shared with the
          patient.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <WfSection
          title="Recommended treatments"
          description="Mapped from concerns to this clinic's own service menu."
        >
          <div className="overflow-hidden rounded-xl border bg-card">
            {SKIN_RECOMMENDATIONS.map((rec) => (
              <div
                key={rec.service}
                className="flex items-center gap-3 border-b p-4 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{rec.service}</p>
                  <p className="text-muted-foreground text-sm">
                    Because: {rec.because}
                  </p>
                </div>
                <span className="font-medium tabular-nums">{rec.price}</span>
                <Button variant="outline" size="sm">
                  Book
                </Button>
              </div>
            ))}
          </div>
        </WfSection>

        <WfSection
          title="Recommended products"
          description="Only shown when the clinic sells retail and has mapped it."
        >
          <div className="overflow-hidden rounded-xl border bg-card">
            {SKIN_PRODUCTS.map((product) => (
              <div
                key={product.name}
                className="flex items-center gap-3 border-b p-4 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-muted-foreground text-sm">
                    Because: {product.because}
                  </p>
                </div>
                <span className="font-medium tabular-nums">
                  {product.price}
                </span>
                <Button variant="outline" size="sm">
                  Add to sale
                </Button>
              </div>
            ))}
          </div>
        </WfSection>
      </div>

      {/*
        Progress is the retention pitch — "your wrinkle score has gone from 7 to
        4 since we started your programme" — so the per-metric delta is the hero
        and the photos are secondary.
      */}
      <WfSection
        title="Progress since the last scan"
        description="12 July 2026 → 2 September 2026"
        action={
          <Button variant="outline" size="sm">
            Compare photos
            <ChevronRightIcon className="size-4" />
          </Button>
        }
      >
        <div className="overflow-hidden rounded-xl border bg-card">
          {SKIN_METRICS.filter((m) => m.previous != null).map((m) => {
            const delta = (m.previous as number) - m.score;
            return (
              <div
                key={m.name}
                className="flex items-center gap-4 border-b p-4 last:border-b-0"
              >
                <span className="min-w-0 flex-1 font-medium">{m.name}</span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {m.previous} → {m.score}
                </span>
                <span
                  className={cn(
                    'flex w-24 items-center justify-end gap-1 font-medium text-sm',
                    delta > 0 && 'text-green-600',
                    delta < 0 && 'text-destructive',
                    delta === 0 && 'text-muted-foreground'
                  )}
                >
                  {delta > 0 ? (
                    <>
                      <TrendingDownIcon className="size-3.5" />
                      improved
                    </>
                  ) : delta < 0 ? (
                    <>
                      <TrendingUpIcon className="size-3.5" />
                      worse
                    </>
                  ) : (
                    'no change'
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </WfSection>
    </div>
  );
}

function MetricRow({
  row,
  active,
  onSelect,
}: {
  row: WfMetricRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-4 border-b p-4 text-left transition-colors last:border-b-0',
        active ? 'bg-primary/5' : 'hover:bg-muted/50'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{row.name}</span>
        {active ? (
          <span className="mt-0.5 block text-muted-foreground text-sm">
            {row.explanation}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-muted-foreground text-sm">
        {row.severity}
      </span>
      <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
        {row.score}/10
      </span>
    </button>
  );
}
