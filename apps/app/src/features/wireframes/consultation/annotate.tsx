'use client';

/**
 * The annotation canvas (§8.4), opened from a photo.
 *
 * ## The canvas is the screen
 *
 * The first version gave the photo about a third of the width and spent the
 * rest on a tool column, a layers card, a pin list, a totals card and a legend.
 * A practitioner cannot place a pin on the glabella accurately in a third of an
 * iPad. So: an icon-only rail on the left, one rail on the right that shows
 * pins OR layers but never both, and a bottom bar of four controls.
 *
 * ## The pin popover is a popover
 *
 * It was an always-open panel in the right rail, which meant the product,
 * dosage and lot fields were on screen permanently whether or not a pin was
 * selected — and the pin they described was 900px away from them. Anchoring it
 * to the pin is what makes "Botox, 12 units, Lot C4821X" readable as a fact
 * about *that* spot on the face.
 *
 * ## Two behaviours the fixtures exist to prove
 *
 * Lot carries forward from the previous pin of the same product (one vial,
 * many pins), and an expired lot warns without blocking — the record has to
 * say what actually happened. Pin ④ is missing because deleting leaves a gap;
 * renumbering would silently corrupt a note that says "see pin 1".
 */

import { Link } from '@tanstack/react-router';
import {
  EraserIcon,
  LayersIcon,
  MapPinIcon,
  MousePointer2Icon,
  PenLineIcon,
  RedoIcon,
  ShapesIcon,
  TriangleAlertIcon,
  TypeIcon,
  UndoIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  DOSE_TOTALS,
  PATIENT,
  PINS,
  PRODUCT_OPTIONS,
  type WfPin,
} from './mock';
import {
  type SyncState,
  WfEditorShell,
  WfFaceGuide,
  WfSyncCycler,
} from './wf-consultation-shell';

const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2Icon },
  { id: 'pin', label: 'Pin', icon: MapPinIcon },
  { id: 'pen', label: 'Pen', icon: PenLineIcon },
  { id: 'zone', label: 'Zone', icon: ShapesIcon },
  { id: 'text', label: 'Text', icon: TypeIcon },
  { id: 'eraser', label: 'Eraser', icon: EraserIcon },
];

const LAYERS = ['Pins', 'Zones', 'Pen', 'Text', 'Previous session'];

export function AnnotateWireframe() {
  const [sync, setSync] = useState<SyncState>('syncing');
  const [tool, setTool] = useState('pin');
  const [rail, setRail] = useState<'pins' | 'layers' | null>('pins');
  const [selected, setSelected] = useState<number | null>(1);

  return (
    <WfFrame
      name="Annotation canvas"
      location="Clients › record › Photos › annotate"
      notes={
        <>
          <WfPoint title="The canvas gets the room">
            An icon rail, one right rail, four controls at the bottom. Layers,
            pins and totals were three simultaneous columns; they are now one
            rail with two modes, and it collapses entirely.
          </WfPoint>
          <WfPoint title="Anchored, not docked">
            The pin detail is a popover on the pin it describes. As a permanent
            right-rail panel it sat a screen's width away from the spot it
            documented, and it occupied the rail whether a pin was selected or
            not.
          </WfPoint>
          <WfPoint title="Lot carries forward">
            Pins ②③⑤⑥ inherit lot C4821X from pin ① — one vial, many pins. The
            hint is subtle and the field stays editable.
          </WfPoint>
          <WfPoint title="Expired lot warns, never blocks">
            Pin ⑦ used Juvéderm past its expiry. Blocking would produce a record
            that disagrees with what happened in the room.
          </WfPoint>
          <WfPoint title="Gaps in numbering are deliberate">
            Pin ④ was deleted. Renumbering would silently break every note that
            refers to a pin by number; offer renumbering as an explicit action
            instead.
          </WfPoint>
          <WfPoint title="Incomplete pins are flagged, not blocking">
            Pin ⑧ has no product and renders hollow. With the sign-off step gone
            it cannot gate anything, so it is surfaced on save and on the photo
            in the gallery instead.
          </WfPoint>
        </>
      }
    >
      <WfEditorShell
        title={`${PATIENT.name} — frontal, 14 Mar 2026`}
        subtitle="Annotating a photo from the client's Photos tab"
        backLabel="Back to photos"
        backTo="/dashboard/wireframes/photos"
        sync={sync}
        onSyncCycle={() => setSync(WfSyncCycler(sync))}
      >
        <div className="flex h-full">
          {/* Tool rail — icons only. Labels are tooltips in the real build. */}
          <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg transition-colors',
                  tool === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <t.icon className="size-5" />
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <Canvas selected={selected} onSelect={setSelected} />

            <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2">
              <Button variant="ghost" size="icon" aria-label="Undo">
                <UndoIcon className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Redo">
                <RedoIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRail(rail ? null : 'pins')}
              >
                <LayersIcon className="size-4" />
                {rail ? 'Hide' : 'Show'} rail
              </Button>
              <div className="ml-auto flex items-center gap-3 pr-40">
                <span className="text-muted-foreground text-sm">
                  1 pin incomplete
                </span>
                <Button asChild>
                  <Link to="/dashboard/wireframes/photos">Save</Link>
                </Button>
              </div>
            </div>
          </div>

          {rail ? (
            <Rail mode={rail} onMode={setRail} onPin={setSelected} />
          ) : null}
        </div>
      </WfEditorShell>
    </WfFrame>
  );
}

/* --------------------------------------------------------------- canvas -- */

function Canvas({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (n: number | null) => void;
}) {
  const pin = PINS.find((p) => p.n === selected) ?? null;

  return (
    <div className="relative min-h-0 flex-1 bg-muted/30">
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="relative aspect-[3/4] h-full max-h-full">
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30">
            <WfFaceGuide showMarkers={false} />
          </div>

          {PINS.map((p) => (
            <PinDot
              key={p.n}
              pin={p}
              active={p.n === selected}
              onClick={() => onSelect(p.n === selected ? null : p.n)}
            />
          ))}

          {/* Anchored to the canvas box; in the build it anchors to the pin
              element itself, which is why this is a Popover and not a Card. */}
          {pin ? (
            <Popover open onOpenChange={(o) => !o && onSelect(null)}>
              <PopoverAnchor
                className="pointer-events-none absolute size-0"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              />
              <PopoverContent side="right" align="start" className="w-80">
                <PinDetail pin={pin} />
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PinDot({
  pin,
  active,
  onClick,
}: {
  pin: WfPin;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pin ${pin.n} — ${pin.label}`}
      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
      className={cn(
        '-translate-x-1/2 -translate-y-1/2 absolute flex size-7 items-center justify-center rounded-full border-2 font-semibold text-xs tabular-nums transition-transform',
        pin.incomplete
          ? 'border-dashed border-muted-foreground bg-background text-muted-foreground'
          : 'border-primary bg-primary text-primary-foreground',
        active && 'scale-125 ring-2 ring-primary/40 ring-offset-2'
      )}
    >
      {pin.n}
    </button>
  );
}

function PinDetail({ pin }: { pin: WfPin }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs tabular-nums">
          {pin.n}
        </span>
        <Input
          defaultValue={pin.label}
          className="h-8"
          aria-label="Pin label"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`product-${pin.n}`}>Product</Label>
        <Select defaultValue={pin.product}>
          <SelectTrigger id={`product-${pin.n}`} className="w-full">
            <SelectValue placeholder="Choose a product" />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`dose-${pin.n}`}>Dose</Label>
          <Input
            id={`dose-${pin.n}`}
            defaultValue={pin.dose ?? ''}
            placeholder="units"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`lot-${pin.n}`}>Lot</Label>
          <Input
            id={`lot-${pin.n}`}
            defaultValue={pin.lot ?? ''}
            className="h-9"
          />
        </div>
      </div>

      {pin.lotFromPin ? (
        <p className="text-muted-foreground text-xs">
          Lot carried from pin {pin.lotFromPin}.
        </p>
      ) : null}

      {pin.expiredLot ? (
        <p className="flex items-start gap-1.5 text-destructive text-xs">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          Lot expired {pin.expiry}. Recorded as used.
        </p>
      ) : null}

      {pin.incomplete ? (
        <p className="text-muted-foreground text-xs">
          Needs a product before this consultation can be signed off.
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- rail -- */

function Rail({
  mode,
  onMode,
  onPin,
}: {
  mode: 'pins' | 'layers';
  onMode: (m: 'pins' | 'layers') => void;
  onPin: (n: number) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l">
      <div className="flex shrink-0 gap-1 border-b p-2">
        {(['pins', 'layers'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            className={cn(
              'flex-1 rounded-md py-1.5 font-medium text-sm capitalize transition-colors',
              m === mode
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'pins' ? (
        <>
          <div className="min-h-0 flex-1 divide-y overflow-y-auto">
            {PINS.map((p) => (
              <button
                key={p.n}
                type="button"
                onClick={() => onPin(p.n)}
                className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <span className="w-4 shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
                  {p.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {p.incomplete ? 'No product yet' : `${p.dose} · ${p.lot}`}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Totals are what gets copied into the sign-off summary, so they sit
              at the foot of the list rather than in a card of their own. */}
          <div className="shrink-0 space-y-1.5 border-t p-3">
            {DOSE_TOTALS.map((t) => (
              <div key={t.product} className="flex justify-between gap-2">
                <span className="truncate text-muted-foreground text-sm">
                  {t.product}
                </span>
                <span className="shrink-0 font-medium text-sm tabular-nums">
                  {t.total}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 divide-y">
          {LAYERS.map((layer) => (
            <div
              key={layer}
              className="flex items-center justify-between px-3 py-2.5"
            >
              <Label htmlFor={`layer-${layer}`} className="font-normal text-sm">
                {layer}
              </Label>
              <Switch
                id={`layer-${layer}`}
                defaultChecked={layer !== 'Previous session'}
              />
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
