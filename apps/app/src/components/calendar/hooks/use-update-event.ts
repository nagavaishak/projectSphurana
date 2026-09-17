import { useCallback, useState } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import type { IEvent } from '@/components/calendar/interfaces';

export function useUpdateEvent() {
  const { setLocalEvents, config, events } = useCalendar();
  const [isUpdating, setIsUpdating] = useState(false);

  const updateEvent = useCallback(
    async (event: IEvent, updateOptions?: { isDragDrop?: boolean }) => {
      const newEvent: IEvent = {
        ...event,
        startDate: new Date(event.startDate).toISOString(),
        endDate: new Date(event.endDate).toISOString(),
      };

      // For drag-drop with a confirmation handler, ask before applying
      if (updateOptions?.isDragDrop && config.onConfirmDrop) {
        const originalEvent = events.find((e) => e.id === event.id);
        if (!originalEvent) return;

        const result = await config.onConfirmDrop({
          originalEvent,
          updatedEvent: newEvent,
        });

        if (!result.confirmed) return;

        // Apply optimistic update after confirmation
        setLocalEvents((prev) => {
          const index = prev.findIndex((e) => e.id === event.id);
          if (index === -1) return prev;
          return [...prev.slice(0, index), newEvent, ...prev.slice(index + 1)];
        });

        // Call update with any options from the confirmation dialog
        if (config.onUpdateEvent) {
          setIsUpdating(true);
          try {
            await config.onUpdateEvent(newEvent, result.options);
          } catch (error) {
            // Revert optimistic update on error
            setLocalEvents((prev) => {
              const index = prev.findIndex((e) => e.id === event.id);
              if (index === -1) return prev;
              return [
                ...prev.slice(0, index),
                originalEvent,
                ...prev.slice(index + 1),
              ];
            });
            throw error;
          } finally {
            setIsUpdating(false);
          }
        }
        return;
      }

      // Default behavior: optimistic update immediately
      setLocalEvents((prev) => {
        const index = prev.findIndex((e) => e.id === event.id);
        if (index === -1) return prev;
        return [...prev.slice(0, index), newEvent, ...prev.slice(index + 1)];
      });

      // If API callback is configured, call it
      if (config.onUpdateEvent) {
        setIsUpdating(true);
        try {
          await config.onUpdateEvent(newEvent);
        } catch (error) {
          // Revert optimistic update on error
          setLocalEvents((prev) => {
            const index = prev.findIndex((e) => e.id === event.id);
            if (index === -1) return prev;
            return [...prev.slice(0, index), event, ...prev.slice(index + 1)];
          });
          throw error;
        } finally {
          setIsUpdating(false);
        }
      }
    },
    [setLocalEvents, config, events]
  );

  return { updateEvent, isUpdating };
}
