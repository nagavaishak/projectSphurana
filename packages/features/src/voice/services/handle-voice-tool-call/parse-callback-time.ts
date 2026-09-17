/**
 * Parse natural language time strings into Date objects for callback scheduling.
 *
 * Supported formats:
 * - "7" → today at 7 PM (or tomorrow if past 7 PM)
 * - "7pm" / "7 PM" / "7PM" → same
 * - "7:30" → today at 7:30 PM (or tomorrow)
 * - "7:30pm" → same
 * - "tomorrow at 7" → tomorrow at 7 PM
 * - "in 2 hours" → now + 2 hours
 * - "in 30 minutes" → now + 30 minutes
 *
 * Times between 1-6 are assumed PM. Times 7-12 are assumed PM unless "am" is specified.
 *
 * @param timeStr - Natural language time string from the caller
 * @param timezone - IANA timezone string (e.g. "America/New_York"). Defaults to UTC.
 * @returns Date object or null if unparseable
 */
export function parseCallbackTime(
  timeStr: string,
  _timezone?: string
): Date | null {
  if (!timeStr || typeof timeStr !== 'string') return null;

  const input = timeStr.trim().toLowerCase();

  // Handle "in X hours/minutes" pattern
  const relativeMatch = input.match(
    /^in\s+(\d+)\s+(hour|hours|minute|minutes|min|mins)$/
  );
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = new Date();
    if (unit.startsWith('hour')) {
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    }
    return new Date(now.getTime() + amount * 60 * 1000);
  }

  // Check for "tomorrow" prefix
  const isTomorrow = input.includes('tomorrow');
  const timeOnly = input.replace('tomorrow', '').replace('at', '').trim();

  // Parse time component: "7", "7pm", "7:30", "7:30pm", "7 pm", etc.
  const timeMatch = timeOnly.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!timeMatch) return null;

  let hours = Number.parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3] as 'am' | 'pm' | undefined;

  if (hours > 23 || minutes > 59) return null;

  // Apply meridiem logic
  if (meridiem === 'am') {
    if (hours === 12) hours = 0;
  } else if (meridiem === 'pm') {
    if (hours !== 12) hours += 12;
  } else {
    // No explicit am/pm - assume PM for typical callback hours (1-11)
    // Hours 0 stays 0, 12 stays 12
    if (hours >= 1 && hours <= 11) {
      hours += 12;
    }
  }

  const now = new Date();
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);

  if (isTomorrow) {
    result.setDate(result.getDate() + 1);
  } else if (result <= now) {
    // If the time has already passed today, schedule for tomorrow
    result.setDate(result.getDate() + 1);
  }

  return result;
}
