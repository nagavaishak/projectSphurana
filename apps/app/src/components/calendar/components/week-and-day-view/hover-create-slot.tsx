import { Plus } from 'lucide-react';
import { forwardRef } from 'react';

import { SLOT_PX } from '@/components/calendar/constants';
import { cn } from '@/lib/utils';

import type { HTMLAttributes } from 'react';

interface HoverCreateSlotProps extends HTMLAttributes<HTMLDivElement> {
  /** Pixel offset of this slot within its hour cell. */
  top: number;
  /** Slot start hour (0-23), used for the hover label. */
  hour: number;
  /** Slot start minute (0/15/30/45), used for the hover label. */
  minute: number;
  /** Slot height in px. Defaults to one 15-minute interval (SLOT_PX). */
  height?: number;
}

/**
 * An empty calendar slot that reveals a "create appointment" block on hover.
 *
 * The block is locked to the column (`inset-x`) and snapped to the slot's
 * 15-minute interval (`top` / `height`), matching Fresha's ghost slot. It is
 * intended to be used as the trigger child of an add-appointment dialog, so it
 * forwards its ref and props to the root element (required by Radix `asChild`).
 */
export const HoverCreateSlot = forwardRef<HTMLDivElement, HoverCreateSlotProps>(
  function HoverCreateSlot(
    { top, hour, minute, height = SLOT_PX, className, style, ...props },
    ref
  ) {
    const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    return (
      <div
        ref={ref}
        // `role="button"` + a name + keyboard activation, because this IS a
        // button: it is used as a Radix dialog trigger (`asChild`), so Radix
        // puts `aria-haspopup="dialog"` and `aria-expanded` on it. Those
        // attributes are not allowed on a element with no role, and axe flagged
        // every one — 384 `critical` aria-allowed-attr nodes on a single day
        // view, one per 15-minute slot. It was also unreachable by keyboard: no
        // tabindex, no Enter/Space, and no accessible name.
        //
        // A real `<button>` would be the usual answer, but these are absolutely
        // positioned overlays stacked in their thousands inside the grid, and a
        // button's default sizing/reset fights the `inset-x-0` + `top`/`height`
        // placement. Role plus explicit key handling is the honest equivalent.
        aria-label={`Create appointment at ${label}`}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.currentTarget.click();
          }
          props.onKeyDown?.(event);
        }}
        // The slot's own wall-clock time, in the BUSINESS timezone. The label
        // it carries is decorative (`pointer-events-none`, hidden until hover),
        // so this is the only stable handle on "the 10:15 slot" — E2E drives
        // slot-click creation through it (calendar-timezone.spec.ts).
        data-slot-time={label}
        className={cn(
          'group/slot absolute inset-x-0 cursor-pointer',
          className
        )}
        style={{ top, height, ...style }}
        {...props}
      >
        <div className="pointer-events-none absolute inset-x-1 inset-y-px flex items-center gap-1 overflow-hidden rounded-md border border-primary/60 bg-primary/25 px-1.5 opacity-0 transition-opacity duration-75 group-hover/slot:opacity-100">
          <Plus className="size-3 shrink-0 text-primary" strokeWidth={2.5} />
          <span className="truncate text-[11px] font-medium leading-none text-primary">
            {label}
          </span>
        </div>
      </div>
    );
  }
);
