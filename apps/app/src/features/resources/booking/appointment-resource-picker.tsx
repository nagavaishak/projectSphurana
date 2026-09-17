import { cn } from '@/lib/utils';
import type { Resource } from '@borradh-workspace/api-client/types';
import { AlertTriangleIcon, CheckIcon } from 'lucide-react';

/**
 * THE override control — one chip per required category, shared by the desktop
 * dialog, the mobile create funnel and the appointment side panel.
 *
 * It is a real `<button>` inside a `Popover`, not a div with an onClick: the
 * whole point of the chip is that the front desk can tab to it and hit Enter
 * mid-booking. Busy options carry an icon AND the word "Busy" — colour alone
 * would leave the state invisible to anyone who cannot see the amber.
 *
 * Busy options stay SELECTABLE. This is the Phorest model the backend already
 * implements: staff bookings warn, they do not block. A picker that refused
 * the only room the clinic has would be a worse lie than one that says "this
 * clashes" and lets a human decide.
 */

/** How the current assignment came about — drives the chip's suffix + tone. */
export type ResourceAssignmentKind =
  /** Predicted/auto-assigned by the allocator. */
  | 'auto'
  /** Explicitly chosen by a human. */
  | 'chosen'
  /** Nothing assigned — manual mode, or a category with nothing free. */
  | 'unassigned';

interface AppointmentResourceOptionsProps {
  candidates: Resource[];
  busy: Set<string>;
  selectedResourceId: string | null;
  onSelect: (resourceId: string) => void;
  emptyLabel: string;
}

/**
 * The option list, extracted so the chip's Popover and the toast's override
 * dialog present the SAME free/busy affordance. A second hand-rolled list
 * would be the obvious place for the two to drift.
 */
export function AppointmentResourceOptions({
  candidates,
  busy,
  selectedResourceId,
  onSelect,
  emptyLabel,
}: AppointmentResourceOptionsProps) {
  if (candidates.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <ul className="max-h-64 overflow-y-auto">
      {candidates.map((resource) => {
        const isBusy = busy.has(resource.id);
        const isSelected = resource.id === selectedResourceId;
        return (
          <li key={resource.id}>
            <button
              type="button"
              onClick={() => onSelect(resource.id)}
              // Busy is NOT disabled — see the component note. It is announced
              // through the accessible name so the state survives without
              // colour or sight.
              aria-label={
                isBusy ? `${resource.name} — busy` : `${resource.name} — free`
              }
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                isSelected && 'font-medium'
              )}
            >
              <CheckIcon
                className={cn('size-3.5 shrink-0', !isSelected && 'invisible')}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{resource.name}</span>
              {isBusy ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangleIcon className="size-3" aria-hidden />
                  Busy
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Free
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
