/**
 * Render a conflicting appointment's span for a CONFLICT message, in the
 * organization's timezone.
 *
 * The message is shown verbatim to a staff member deciding whether to
 * double-book (ENG-792), so "Fri 15 Mar, 14:00–15:00" on their own clock face
 * is the only useful form. An ISO string in UTC is both unreadable and, for
 * any org outside UTC, wrong-looking. Both createAppointment and
 * updateAppointment (drag-to-reschedule) raise this prompt, so they share one
 * renderer.
 */
export function formatConflictRange(
  start: Date,
  end: Date,
  timeZone: string
): string {
  const time = (date: Date) =>
    date.toLocaleTimeString('en-IE', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const day = start.toLocaleDateString('en-IE', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${day}, ${time(start)}–${time(end)}`;
}
