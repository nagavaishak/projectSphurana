import { useCallback } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { eventBelongsToPractitioner } from '@/components/calendar/helpers';

import type { IEvent, IUser } from '@/components/calendar/interfaces';

/**
 * Returns the predicate that decides whether an event belongs in a given
 * resource column/row (a staff member for appointments, a page for the
 * content planner). Uses the config's `eventFilter` when provided so the same
 * views work for any resource type; falls back to practitioner matching.
 */
export function useColumnMatcher() {
  const { config } = useCalendar();
  return useCallback(
    (event: IEvent, user: IUser) =>
      config.eventFilter
        ? config.eventFilter(event, user.id)
        : eventBelongsToPractitioner(event, user),
    [config]
  );
}
