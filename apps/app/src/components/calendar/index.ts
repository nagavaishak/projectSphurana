// Types
export type {
  TCalendarView,
  TEventColor,
  TBadgeVariant,
  TWorkingHours,
  TVisibleHours,
  TCalendarMode,
  TResolvedShift,
  TShiftInterval,
} from './types';

// Interfaces & Config
export type {
  IUser,
  IEvent,
  ICalendarCell,
  ICalendarConfig,
  ICalendarLocation,
} from './interfaces';
export { APPOINTMENTS_CONFIG, CONTENT_CONFIG } from './interfaces';

// Context
export { CalendarProvider, useCalendar } from './contexts/calendar-context';

// Helpers
export { eventBelongsToPractitioner, isTimeBlockEvent } from './helpers';

// Components
export { ClientContainer } from './components/client-container';
export { CalendarHeader } from './components/header/calendar-header';
