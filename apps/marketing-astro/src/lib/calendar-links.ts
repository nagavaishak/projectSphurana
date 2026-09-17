export interface CalendarEvent {
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
}

/**
 * Format a Date to Google Calendar's required format: YYYYMMDDTHHmmSSZ
 */
function toGoogleCalendarDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Format a Date to ISO string without milliseconds for Outlook
 */
function toOutlookDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

/**
 * Generate a Google Calendar "Add Event" URL
 */
export function getGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toGoogleCalendarDate(event.startTime)}/${toGoogleCalendarDate(event.endTime)}`,
  });

  if (event.description) params.set('details', event.description);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate an Outlook Web "Add Event" URL
 */
export function getOutlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    rru: 'addevent',
    subject: event.title,
    startdt: toOutlookDate(event.startTime),
    enddt: toOutlookDate(event.endTime),
    path: '/calendar/action/compose',
  });

  if (event.description) params.set('body', event.description);
  if (event.location) params.set('location', event.location);

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

/**
 * Pad a number to 2 digits for ICS format
 */
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Format a Date to ICS DTSTART/DTEND format: YYYYMMDDTHHmmSS
 */
function toIcsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * Generate and trigger download of an .ics file
 */
export function downloadIcsFile(event: CalendarEvent): void {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@borradh`;
  const now = toIcsDate(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Borradh//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toIcsDate(event.startTime)}`,
    `DTEND:${toIcsDate(event.endTime)}`,
    `SUMMARY:${event.title}`,
  ];

  if (event.description)
    lines.push(`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`);
  if (event.location) lines.push(`LOCATION:${event.location}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '-')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
