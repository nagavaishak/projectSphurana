'use client';

/**
 * The persistent chrome for the consultation route (§8).
 *
 * The close control returns to the client record, because that is where the
 * funnel was entered from — a consultation that exits to a menu leaves the
 * practitioner to find their way back to the patient they were just treating.
 *
 * A full-screen route rather than a modal, so it survives a refresh, owns the
 * camera and works offline — which is why this is built on
 * `full-screen-dedicated-layout` and not on `DashboardPage`.
 *
 * Two pieces of it are load-bearing rather than decorative:
 *
 *  - the five-step stepper is ALWAYS visible, because a practitioner mid-visit
 *    needs to know how much is left before the patient's numbing wears off;
 *  - the sync indicator is ALWAYS visible, in all four states. §8.8 calls
 *    offline critical — treatment rooms have weak WiFi — and an indicator that
 *    only appears when something is wrong teaches nobody what "Saved locally"
 *    means before it matters.
 */

import { Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  CheckIcon,
  CloudOffIcon,
  LoaderIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  DedicatedLayout,
  DedicatedLayoutContent,
  DedicatedLayoutHeader,
  DedicatedLayoutHeaderLeft,
  DedicatedLayoutHeaderRight,
} from '@/components/app/full-screen-dedicated-layout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SyncState = 'local' | 'syncing' | 'synced' | 'failed';

const SYNC_COPY: Record<
  SyncState,
  { label: string; icon: typeof CheckIcon; className: string }
> = {
  local: {
    label: 'Saved locally',
    icon: CloudOffIcon,
    className: 'text-muted-foreground',
  },
  syncing: {
    label: 'Syncing…',
    icon: LoaderIcon,
    className: 'text-amber-600 dark:text-amber-400',
  },
  synced: {
    label: 'Synced',
    icon: CheckIcon,
    className: 'text-green-600 dark:text-green-400',
  },
  failed: {
    label: 'Sync failed — retry',
    icon: TriangleAlertIcon,
    className: 'text-destructive',
  },
};

/**
 * The sync chip. Clicking cycles the four states so a reviewer can see all of
 * them without us shipping four screenshots — in the real build the state is
 * owned by the sync queue, and the click is "retry".
 */
export function WfSyncIndicator({
  state,
  onCycle,
  pending,
}: {
  state: SyncState;
  onCycle: () => void;
  /** Long-press reveals this in the real build; shown inline for review. */
  pending?: string;
}) {
  const copy = SYNC_COPY[state];
  const Icon = copy.icon;

  return (
    <div className="flex items-center gap-2">
      {pending && state !== 'synced' ? (
        <span className="hidden text-muted-foreground text-xs sm:inline">
          {pending}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onCycle}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors hover:bg-muted',
          copy.className,
          state === 'failed' && 'border-destructive/40'
        )}
      >
        <Icon
          className={cn('size-3.5', state === 'syncing' && 'animate-spin')}
        />
        {copy.label}
      </button>
    </div>
  );
}

/**
 * The face outline drawn over the camera, and reused as the annotation canvas
 * backdrop. Inline SVG rather than an image so it inherits the theme tokens —
 * a hard-coded white outline vanishes on a light preview.
 */
export function WfFaceGuide({
  className,
  showMarkers = true,
  profile = false,
}: {
  className?: string;
  showMarkers?: boolean;
  profile?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 200 260"
      className={cn('h-full w-full', className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Face alignment guide</title>
      {profile ? (
        <path
          d="M130 30c25 22 28 62 22 92-4 22-14 34-14 46 0 10 8 12 8 20 0 14-22 22-46 22-18 0-32-6-40-14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
      ) : (
        <ellipse
          cx="100"
          cy="128"
          rx="62"
          ry="86"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
      )}
      {showMarkers ? (
        <>
          {/* eyes level */}
          <line
            x1="26"
            y1="104"
            x2="174"
            y2="104"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {/* nose centre */}
          <line
            x1="100"
            y1="42"
            x2="100"
            y2="214"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {/* chin cup */}
          <path
            d="M84 206a16 10 0 0 0 32 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The stand-in for a patient photo.
 *
 * Deliberately an empty framed panel with the guide in it, not a stock face:
 * a stock face makes every review about the model's skin, and there is no
 * consented image we could ship here anyway.
 */
export function WfPhotoFrame({
  label,
  className,
  children,
  profile,
  aspect = 'aspect-[3/4]',
}: {
  label?: string;
  className?: string;
  children?: ReactNode;
  profile?: boolean;
  aspect?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-muted/40',
        aspect,
        className
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center p-4 text-muted-foreground/40">
        <WfFaceGuide profile={profile} />
      </div>
      {label ? (
        <span className="absolute top-2 left-2 rounded-md bg-background/85 px-1.5 py-0.5 font-medium text-[11px]">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function WfSyncCycler(state: SyncState): SyncState {
  const order: SyncState[] = ['local', 'syncing', 'synced', 'failed'];
  return order[(order.indexOf(state) + 1) % order.length];
}

/**
 * Full-screen chrome for a clinical editor — the annotation canvas and the
 * comparison viewer.
 *
 * Replaces the old five-step funnel shell. There is no sequence any more:
 * annotation is reached by opening a photo from the client's Photos tab, so the
 * only chrome an editor needs is who the patient is, whether the work is saved,
 * and the way back to where you came from.
 *
 * Still full-screen and still outside `/dashboard` — a canvas the practitioner
 * draws on with a Pencil should not be sharing an iPad with a nav sidebar.
 */
export function WfEditorShell({
  title,
  subtitle,
  backLabel,
  backTo,
  sync,
  onSyncCycle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  backLabel: string;
  backTo: string;
  sync: SyncState;
  onSyncCycle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DedicatedLayout className="bg-background">
      <DedicatedLayoutHeader className="gap-3 border-b">
        <DedicatedLayoutHeaderLeft className="min-w-0">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link to={backTo}>
              <ArrowLeftIcon className="size-4" />
              <span className="sr-only">{backLabel}</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{title}</p>
            {subtitle ? (
              <p className="truncate text-muted-foreground text-xs">
                {subtitle}
              </p>
            ) : null}
          </div>
        </DedicatedLayoutHeaderLeft>
        <DedicatedLayoutHeaderRight className="gap-2">
          <WfSyncIndicator state={sync} onCycle={onSyncCycle} />
          {actions}
        </DedicatedLayoutHeaderRight>
      </DedicatedLayoutHeader>
      <DedicatedLayoutContent className="min-h-0 flex-1">
        {children}
      </DedicatedLayoutContent>
    </DedicatedLayout>
  );
}
