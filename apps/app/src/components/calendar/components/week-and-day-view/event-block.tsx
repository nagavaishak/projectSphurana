import { parseISO } from 'date-fns';
import { useCallback, useEffect, useRef } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import { EventDetailsDialog } from '@/components/calendar/components/dialogs/event-details-dialog';
import { DraggableEvent } from '@/components/calendar/components/dnd/draggable-event';
import { EventBlockBody } from '@/components/calendar/components/week-and-day-view/event-block-body';
import { HOUR_PX, SLOT_PX } from '@/components/calendar/constants';

import { ImpactStyle, hapticImpact, hapticSelection } from '@/lib/haptics';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  event: IEvent;
  className?: string;
}

const PIXELS_PER_HOUR = HOUR_PX;
const SNAP_PX = SLOT_PX; // one 15-min slot
const MIN_DURATION_MS = 15 * 60_000;

interface ResizeState {
  edge: 'top' | 'bottom';
  startY: number;
  origStart: Date;
  origEnd: Date;
  lastNewStart: Date | null;
  lastNewEnd: Date | null;
  lastSnapStep: number;
}

/**
 * Snap a Date's minutes to the nearest 15-min slot boundary so a resize on
 * an off-grid source (e.g. an externally-synced 11:11 appointment) lands on
 * :00 / :15 / :30 / :45 instead of dragging the off-grid offset along.
 */
function snapToGrid(date: Date): Date {
  const minutes = date.getMinutes();
  const roundedMinutes = Math.round(minutes / 15) * 15;
  const result = new Date(date);
  if (roundedMinutes === 60) {
    result.setHours(date.getHours() + 1, 0, 0, 0);
  } else {
    result.setHours(date.getHours(), roundedMinutes, 0, 0);
  }
  return result;
}

export function EventBlock({ event, className }: IProps) {
  const { badgeVariant, setLocalEvents, config, visibleHours } = useCalendar();
  // Blocked time (and legacy unavailability) render as resizable grey blocks.
  const isTimeBlock =
    event.metadata?.type === 'blocked-time' ||
    event.metadata?.type === 'unavailability';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.click();
    }
  };

  const resizeStateRef = useRef<ResizeState | null>(null);

  const startResize = useCallback(
    (edge: 'top' | 'bottom', e: React.MouseEvent) => {
      // preventDefault on mousedown stops the parent draggable's HTML5
      // dragstart from firing; stopPropagation stops EventDetailsDialog's
      // DialogTrigger from opening on click.
      e.preventDefault();
      e.stopPropagation();

      const origStart = parseISO(event.startDate);
      const origEnd = parseISO(event.endDate);

      resizeStateRef.current = {
        edge,
        startY: e.clientY,
        origStart,
        origEnd,
        lastNewStart: null,
        lastNewEnd: null,
        lastSnapStep: 0,
      };

      // Visible-hours bounds anchored to the event's own day. `to === 24`
      // means midnight tomorrow; otherwise resolve to that hour today.
      const visibleStart = new Date(origStart);
      visibleStart.setHours(visibleHours.from, 0, 0, 0);
      const visibleEnd = new Date(origStart);
      visibleEnd.setHours(0, 0, 0, 0);
      if (visibleHours.to >= 24) {
        visibleEnd.setDate(visibleEnd.getDate() + 1);
      } else {
        visibleEnd.setHours(visibleHours.to, 0, 0, 0);
      }

      const handleMove = (ev: MouseEvent) => {
        const state = resizeStateRef.current;
        if (!state) return;

        const deltaY = ev.clientY - state.startY;
        const snapStep = Math.round(deltaY / SNAP_PX);
        const minutesMoved = ((snapStep * SNAP_PX) / PIXELS_PER_HOUR) * 60;

        let newStart = state.origStart;
        let newEnd = state.origEnd;
        if (state.edge === 'top') {
          // Snap the new start to a 15-min boundary so the result is always
          // on grid even if the source had an off-grid minute offset.
          newStart = snapToGrid(
            new Date(state.origStart.getTime() + minutesMoved * 60_000)
          );
          if (newStart.getTime() >= state.origEnd.getTime() - MIN_DURATION_MS) {
            newStart = new Date(state.origEnd.getTime() - MIN_DURATION_MS);
          }
          // Don't let a resize push the start past the visible-hours top.
          if (newStart.getTime() < visibleStart.getTime()) {
            newStart = visibleStart;
          }
        } else {
          newEnd = snapToGrid(
            new Date(state.origEnd.getTime() + minutesMoved * 60_000)
          );
          if (newEnd.getTime() <= state.origStart.getTime() + MIN_DURATION_MS) {
            newEnd = new Date(state.origStart.getTime() + MIN_DURATION_MS);
          }
          // Don't let a resize push the end past the visible-hours bottom.
          if (newEnd.getTime() > visibleEnd.getTime()) {
            newEnd = visibleEnd;
          }
        }

        // Only re-render and tick haptic when the snap actually changed.
        if (snapStep === state.lastSnapStep) return;
        state.lastSnapStep = snapStep;
        state.lastNewStart = newStart;
        state.lastNewEnd = newEnd;
        hapticSelection();

        const newStartIso = newStart.toISOString();
        const newEndIso = newEnd.toISOString();
        setLocalEvents((prev) =>
          prev.map((p) =>
            p.id === event.id
              ? { ...p, startDate: newStartIso, endDate: newEndIso }
              : p
          )
        );
      };

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        const state = resizeStateRef.current;
        resizeStateRef.current = null;
        if (!state || !state.lastNewStart || !state.lastNewEnd) return;

        const startChanged =
          state.lastNewStart.getTime() !== state.origStart.getTime();
        const endChanged =
          state.lastNewEnd.getTime() !== state.origEnd.getTime();
        if (!startChanged && !endChanged) return;

        hapticImpact(ImpactStyle.Light);

        const origStartIso = state.origStart.toISOString();
        const origEndIso = state.origEnd.toISOString();
        const newStartIso = state.lastNewStart.toISOString();
        const newEndIso = state.lastNewEnd.toISOString();

        Promise.resolve(
          config.onUpdateEvent?.({
            ...event,
            startDate: newStartIso,
            endDate: newEndIso,
          })
        ).catch(() => {
          // API failed — revert the optimistic resize.
          setLocalEvents((prev) =>
            prev.map((p) =>
              p.id === event.id
                ? { ...p, startDate: origStartIso, endDate: origEndIso }
                : p
            )
          );
        });
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    },
    [event, setLocalEvents, config, visibleHours]
  );

  // Restore body styles if the component unmounts mid-resize.
  useEffect(() => {
    return () => {
      if (resizeStateRef.current) {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
  }, []);

  return (
    <DraggableEvent event={event} snapY={SNAP_PX}>
      <EventDetailsDialog event={event}>
        <div className="relative">
          <EventBlockBody
            event={event}
            badgeVariant={badgeVariant}
            className={className}
            role="button"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          />
          {isTimeBlock && (
            <>
              <div
                onMouseDown={(e) => startResize('top', e)}
                className="absolute inset-x-2 top-0 z-10 h-1.5 cursor-ns-resize"
                aria-hidden="true"
              />
              <div
                onMouseDown={(e) => startResize('bottom', e)}
                className="absolute inset-x-2 bottom-0 z-10 h-1.5 cursor-ns-resize"
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </EventDetailsDialog>
    </DraggableEvent>
  );
}
