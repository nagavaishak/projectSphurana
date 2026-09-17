import type { TCalendarView } from '@/components/calendar/types';

/** Views shown in the header dropdown + staff popover, in order. */
export type TSwitchableView = 'day' | '3day' | 'week' | 'month';

export const SWITCHABLE_VIEWS: TSwitchableView[] = [
  'day',
  '3day',
  'week',
  'month',
];

export const VIEW_LABELS: Record<TSwitchableView, string> = {
  day: 'Day',
  '3day': '3 day',
  week: 'Week',
  month: 'Month',
};

/** Route slug for each view (3-day can't be a numeric path segment). */
export const VIEW_ROUTE_SLUGS: Record<TSwitchableView, string> = {
  day: 'day',
  '3day': 'three-day',
  week: 'week',
  month: 'month',
};

export function viewLabel(view: TCalendarView): string {
  return VIEW_LABELS[view as TSwitchableView] ?? 'Day';
}
