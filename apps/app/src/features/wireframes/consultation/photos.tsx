'use client';

/**
 * Photos — the Clinical sub-tab, and now the hub for everything visual.
 *
 * ## Why this tab absorbed the funnel
 *
 * The earlier design routed photography through a multi-step consultation
 * wizard: consent, then capture, then review, then annotate, then sign off. It
 * was rejected, and rightly — a practitioner who wants to add a photo taken on
 * a phone two hours ago has no consultation open, and a wizard has no place to
 * put them. So the acts are separated and each lives where it is wanted:
 * uploading and annotating happen here, on the patient's photos; recording a
 * consultation happens on the appointment.
 *
 * ## Consent is a checkbox, not a gate
 *
 * It is two facts recorded once per patient, not a step to be walked through
 * before every photo. Marketing consent unticked does not stop the practitioner
 * working — it stops the export, and only the export, which is the single place
 * a clinical photo can leave the building.
 */

import { Link } from '@tanstack/react-router';
import {
  CameraIcon,
  LockIcon,
  PencilLineIcon,
  ShareIcon,
  UploadIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { PATIENT, PHOTO_VISITS } from './mock';

const STATES = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'upload', label: 'Upload' },
  { id: 'export', label: 'Export' },
  { id: 'refused', label: 'Consent refused' },
];

export function PhotosWireframe() {
  const [state, setState] = useState('gallery');

  return (
    <WfFrame
      name="Photos"
      location="Clients › record › Clinical › Photos"
      states={STATES}
      activeState={state}
      onState={setState}
      notes={
        <>
          <WfPoint title="The record around this is existing chrome">
            The header and the first ten tabs are copied from the live record
            and are inert here — context, not a proposal. The whole delta is the
            eleventh tab, Clinical, and the four sections under it.
          </WfPoint>
          <WfPoint title="This tab is the whole photo story">
            Adding photos and annotating them are one job done in one place. The
            funnel that used to own capture made the common case — a photo taken
            earlier, uploaded later — impossible to express.
          </WfPoint>
          <WfPoint title="Consent is recorded, not enforced by a wizard">
            Two checkboxes, answered once, with who asked and when. Clinical
            consent off empties the tab; marketing consent off blocks the export
            and nothing else.
          </WfPoint>
          <WfPoint title="The export gate is the control that matters">
            A clinical photo reaching a social post is the failure this screen
            exists to prevent. Export stays disabled unless <em>both</em>{' '}
            selected photos carry marketing consent, and it names the one that
            does not rather than greying out in silence.
          </WfPoint>
          <WfPoint title="Grouped by visit, not by date">
            A before and an after belong to the same appointment. Date grouping
            splits them the moment a visit crosses midnight or a photo is added
            late.
          </WfPoint>
          <WfPoint title="Marketing approval is shown, never assumed">
            The share glyph marks a photo cleared for marketing. Its absence is
            meaningful, so it is drawn only when true.
          </WfPoint>
        </>
      }
    >
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            7 photos across 3 visits
          </p>
          {state === 'gallery' ? (
            <Button size="sm" onClick={() => setState('upload')}>
              <UploadIcon className="size-4" />
              Add photos
            </Button>
          ) : null}
        </div>

        {state === 'gallery' ? <Gallery /> : null}
        {state === 'upload' ? <Upload /> : null}
        {state === 'export' ? <Export /> : null}
        {state === 'refused' ? <Refused /> : null}

        {/* Consent survives the refused state — unticking it is what produced
            that state, so hiding the control would leave no way back. */}
        {state === 'export' ? null : (
          <PhotoConsent refused={state === 'refused'} />
        )}
      </>
    </WfFrame>
  );
}

/* --------------------------------------------------------------- consent -- */

function PhotoConsent({ refused }: { refused: boolean }) {
  return (
    <section className="mt-4 rounded-xl border p-5">
      <h2 className="font-medium text-sm">Photo consent</h2>
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <Checkbox id="wf-consent-clinical" defaultChecked={!refused} />
          <Label htmlFor="wf-consent-clinical" className="font-normal">
            Photographs may be kept in the clinical record
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox id="wf-consent-marketing" />
          <Label htmlFor="wf-consent-marketing" className="font-normal">
            Photographs may be used in marketing
          </Label>
        </div>
      </div>
      <p className="mt-4 text-muted-foreground text-sm">
        Recorded by Dr. Aoife Byrne · 8 November 2025
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- gallery -- */

function Gallery() {
  return (
    <div className="space-y-8">
      {PHOTO_VISITS.map((visit) => (
        <section key={visit.date} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-medium">{visit.date}</h2>
            <span className="text-muted-foreground text-sm">
              {visit.treatment}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visit.photos.map((photo) => (
              <figure key={photo.id} className="group space-y-2">
                <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
                  {/* The tile opens the photo. Annotate is a sibling rather
                      than a child, because a link inside a button is not a
                      thing a browser can render. */}
                  <button
                    type="button"
                    className="absolute inset-0 size-full"
                    aria-label={`Open ${photo.stage} — ${photo.area}`}
                  />

                  {photo.marketing ? (
                    <span
                      className="absolute top-2 right-2 rounded-full bg-background/90 p-1"
                      title="Approved for marketing"
                    >
                      <ShareIcon className="size-3 text-muted-foreground" />
                    </span>
                  ) : null}

                  <Button
                    size="sm"
                    variant="secondary"
                    asChild
                    className="absolute inset-x-2 bottom-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <Link to="/wireframe-fullscreen/annotate">
                      <PencilLineIcon className="size-3.5" />
                      Annotate
                    </Link>
                  </Button>
                </div>
                <figcaption className="text-muted-foreground text-xs">
                  {photo.stage} · {photo.area}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- upload -- */

const STAGES = ['Before', 'During', 'After'] as const;

const AREAS = [
  'Face — frontal',
  'Face — left 45°',
  'Face — right 45°',
  'Lips',
  'Jawline',
];

const PENDING = [
  { id: 'u1', file: 'IMG_4471.HEIC', stage: 'Before', area: 'Face — frontal' },
  {
    id: 'u2',
    file: 'IMG_4472.HEIC',
    stage: 'Before',
    area: 'Face — left 45°',
  },
];

function Upload() {
  return (
    <div className="max-w-2xl space-y-6">
      {/* Camera sits beside the picker, not behind a flow of its own. On an
          iPad the two are the same act a second apart. */}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
        <p className="text-muted-foreground text-sm">Drag photos here, or</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button">
            <UploadIcon className="size-4" />
            Choose files
          </Button>
          <Button type="button" variant="outline">
            <CameraIcon className="size-4" />
            Take a photo
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {PENDING.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <div className="size-12 shrink-0 rounded bg-muted" />
            <span className="min-w-0 flex-1 truncate text-sm">{item.file}</span>

            <div className="flex rounded-md border p-0.5">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  className={cn(
                    'rounded px-2.5 py-1 text-xs transition-colors',
                    stage === item.stage
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {stage}
                </button>
              ))}
            </div>

            <Select defaultValue={item.area}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AREAS.map((area) => (
                  <SelectItem key={area} value={area}>
                    {area}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Button type="button">Add 2 photos to 14 March</Button>
    </div>
  );
}

/* ---------------------------------------------------------------- export -- */

function Export() {
  // One of the two selected photos is not cleared for marketing, which is the
  // state worth designing — the happy path needs no help.
  const blocked = true;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {['14 March 2026', '8 November 2025'].map((date, i) => (
          <figure key={date} className="space-y-2">
            <div className="aspect-[3/4] rounded-lg bg-muted" />
            <figcaption className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{date}</span>
              {i === 1 ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                >
                  Not cleared
                </Badge>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="space-y-2.5">
        {['Dates', 'Clinic logo', 'Treatment name'].map((option, i) => (
          <div key={option} className="flex items-center gap-3">
            <Checkbox id={`wf-opt-${option}`} defaultChecked={i < 2} />
            <Label htmlFor={`wf-opt-${option}`} className="font-normal">
              {option}
            </Label>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button type="button" disabled={blocked}>
          Download
        </Button>
        {blocked ? (
          <p className="text-muted-foreground text-sm">
            The November photo is not approved for marketing use.{' '}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Ask for consent
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- refused -- */

function Refused() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <LockIcon className="size-5 text-muted-foreground" />
      </span>
      <p className="mt-4 font-medium">
        {PATIENT.name} has not consented to clinical photography
      </p>
      <p className="mt-1 max-w-sm text-muted-foreground text-sm">
        No photos can be stored for this patient. Face mapping still works, on
        an anatomical template.
      </p>
    </div>
  );
}
