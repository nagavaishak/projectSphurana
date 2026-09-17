import { format, parse } from 'date-fns';

/** 15-minute steps, full day — matches calendar grid granularity. */
export function generateMobileTimeOptions(
  stepMinutes = 15
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];

  for (
    let totalMinutes = 0;
    totalMinutes < 24 * 60;
    totalMinutes += stepMinutes
  ) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const parsed = parse(value, 'HH:mm', new Date());
    options.push({ value, label: format(parsed, 'h:mm a') });
  }

  return options;
}

export const MOBILE_TIME_OPTIONS = generateMobileTimeOptions();

export function formatMobileTimeLabel(timeStr: string): string {
  const parsed = parse(timeStr, 'HH:mm', new Date());
  return format(parsed, 'h:mm');
}

/** Snap arbitrary HH:mm to the nearest 15-minute option in the list. */
export function snapToMobileTime(timeStr: string): string {
  const parsed = parse(timeStr, 'HH:mm', new Date());
  const totalMinutes = parsed.getHours() * 60 + parsed.getMinutes();
  const snapped = Math.round(totalMinutes / 15) * 15;
  const capped = Math.min(Math.max(snapped, 0), 24 * 60 - 15);
  const hours = Math.floor(capped / 60);
  const minutes = capped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
