import { useCallback, useEffect, useRef, useState } from 'react';

const SLOT_PX = 18;
const PIXELS_PER_MINUTE = SLOT_PX / 15;
const DRAG_THRESHOLD_PX = 4;

interface PendingSelection {
  day: Date;
  startMinutes: number;
  endMinutes: number;
}

interface PendingTimes {
  startDate: Date;
  startTime: { hour: number; minute: number };
  endTime: { hour: number; minute: number };
}

interface DragInternal {
  day: Date;
  columnEl: HTMLElement;
  startY: number;
  anchorSlot: number;
  pointerId: number;
}

interface UseDragToCreateOptions {
  earliestEventHour: number;
  latestEventHour: number;
  /**
   * The user-configured visible-hours window. When a pre-existing event sits
   * outside `visibleHours`, `getVisibleHours` auto-expands the display range
   * (`earliestEventHour` / `latestEventHour`) to keep that event visible —
   * but new selections still need to be clamped to the configured window.
   */
  visibleHours: { from: number; to: number };
  enabled: boolean;
}

export function useDragToCreate({
  earliestEventHour,
  latestEventHour,
  visibleHours,
  enabled,
}: UseDragToCreateOptions) {
  const dragRef = useRef<DragInternal | null>(null);
  const isDraggingRef = useRef(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [pending, setPending] = useState<PendingTimes | null>(null);

  const totalSlots = Math.max(0, (latestEventHour - earliestEventHour) * 4);

  // Clamp window in absolute minutes-from-midnight. `to === 24` => 1440.
  const clampMinMinutes = visibleHours.from * 60;
  const clampMaxMinutes = (visibleHours.to >= 24 ? 24 : visibleHours.to) * 60;

  const yToSlot = useCallback(
    (y: number) => {
      const slot = Math.floor(y / SLOT_PX);
      return Math.min(Math.max(slot, 0), totalSlots - 1);
    },
    [totalSlots]
  );

  const slotToMinutes = useCallback(
    (slot: number) => earliestEventHour * 60 + slot * 15,
    [earliestEventHour]
  );

  const clampMinutes = useCallback(
    (minutes: number) =>
      Math.min(Math.max(minutes, clampMinMinutes), clampMaxMinutes),
    [clampMinMinutes, clampMaxMinutes]
  );

  const handlePointerDown = useCallback(
    (day: Date, e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (e.pointerType !== 'mouse') return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-event-block]')) return;
      if (target?.closest('[draggable="true"]')) return;

      const columnEl = e.currentTarget as HTMLDivElement;
      const rect = columnEl.getBoundingClientRect();
      const y = e.clientY - rect.top;
      dragRef.current = {
        day,
        columnEl,
        startY: y,
        anchorSlot: yToSlot(y),
        pointerId: e.pointerId,
      };
    },
    [enabled, yToSlot]
  );

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = drag.columnEl.getBoundingClientRect();
      const y = e.clientY - rect.top;

      if (!isDraggingRef.current) {
        if (Math.abs(y - drag.startY) < DRAG_THRESHOLD_PX) return;
        isDraggingRef.current = true;
        try {
          drag.columnEl.setPointerCapture(drag.pointerId);
        } catch {
          // Ignore — capture is best-effort.
        }
      }

      const currentSlot = yToSlot(y);
      const startSlot = Math.min(drag.anchorSlot, currentSlot);
      const endSlot = Math.max(drag.anchorSlot, currentSlot) + 1;
      const startMinutes = clampMinutes(slotToMinutes(startSlot));
      const endMinutes = clampMinutes(slotToMinutes(endSlot));
      // Drop the selection entirely if the clamp collapsed it to zero — the
      // user is dragging in a region that's outside the configured visible
      // hours (e.g. into auto-expanded space holding a pre-existing event).
      if (endMinutes <= startMinutes) {
        setSelection(null);
        return;
      }
      setSelection({
        day: drag.day,
        startMinutes,
        endMinutes,
      });
    };

    const onUp = () => {
      const drag = dragRef.current;
      const wasDragging = isDraggingRef.current;
      dragRef.current = null;
      if (!drag || !wasDragging) {
        setSelection(null);
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 0);
        return;
      }

      setSelection((current) => {
        if (current) {
          const startDate = new Date(current.day);
          startDate.setHours(0, 0, 0, 0);
          const startHour = Math.floor(current.startMinutes / 60);
          const startMin = current.startMinutes % 60;
          const endHour = Math.floor(current.endMinutes / 60);
          const endMin = current.endMinutes % 60;
          setPending({
            startDate,
            startTime: { hour: startHour, minute: startMin },
            endTime: { hour: endHour, minute: endMin },
          });
        }
        return null;
      });

      // Defer clearing so a synthesised click event after pointerup is
      // suppressed by handleClickCapture rather than opening the AddEvent
      // dialog on the underlying slot.
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [enabled, yToSlot, slotToMinutes, clampMinutes]);

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    []
  );

  const clearPending = useCallback(() => setPending(null), []);

  const getColumnProps = useCallback(
    (day: Date) => ({
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) =>
        handlePointerDown(day, e),
      onClickCapture: handleClickCapture,
    }),
    [handlePointerDown, handleClickCapture]
  );

  const selectionStyle = selection
    ? {
        top: `${(selection.startMinutes - earliestEventHour * 60) * PIXELS_PER_MINUTE}px`,
        height: `${(selection.endMinutes - selection.startMinutes) * PIXELS_PER_MINUTE}px`,
      }
    : null;

  return {
    getColumnProps,
    selection,
    selectionStyle,
    pending,
    clearPending,
  };
}

export function formatSelectionLabel(startMinutes: number, endMinutes: number) {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return `${fmt(startMinutes)} – ${fmt(endMinutes)}`;
}
