import {
  differenceInCalendarDays,
  format,
  isToday,
  isYesterday,
} from 'date-fns';

/** WhatsApp-style day label: Today, Yesterday, weekday within a week, else full date. */
export function formatDayLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), date) < 7) {
    return format(date, 'EEEE');
  }
  return format(date, 'd MMMM yyyy');
}

/** Calendar-day key for grouping items by day. */
export function dayKey(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}

export function DaySeparatorBadge({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1.5">
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
