/**
 * Business Hours Utility
 *
 * Handles scheduling within business hours for AI calls.
 * Time is stored in minutes from midnight (0-1440).
 * Days are 0-6 (Sunday-Saturday).
 */

/**
 * Business hours configuration
 * Key: day of week (0 = Sunday, 6 = Saturday)
 * Value: { from: minutes from midnight, to: minutes from midnight }
 *
 * Example: Monday 9am-6pm = { 1: { from: 540, to: 1080 } }
 */
export interface BusinessHours {
  [day: number]: { from: number; to: number };
}

/**
 * Default business hours (Mon-Fri 9am-6pm)
 */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  0: { from: 0, to: 0 }, // Sunday - closed
  1: { from: 540, to: 1080 }, // Monday 9am-6pm
  2: { from: 540, to: 1080 }, // Tuesday
  3: { from: 540, to: 1080 }, // Wednesday
  4: { from: 540, to: 1080 }, // Thursday
  5: { from: 540, to: 1080 }, // Friday
  6: { from: 0, to: 0 }, // Saturday - closed
};

/**
 * Convert hours and minutes to minutes from midnight
 */
export function toMinutes(hours: number, minutes = 0): number {
  return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight to hours and minutes
 */
export function fromMinutes(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

/**
 * Get the current time as minutes from midnight
 */
function getTimeInMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Check if a given time is within business hours
 */
export function isWithinBusinessHours(
  date: Date,
  businessHours: BusinessHours
): boolean {
  const day = date.getDay();
  const hours = businessHours[day];

  if (!hours || hours.from >= hours.to) {
    return false; // Closed this day
  }

  const currentMinutes = getTimeInMinutes(date);
  return currentMinutes >= hours.from && currentMinutes < hours.to;
}

/**
 * Get the next available business hours time
 *
 * If current time is within hours, returns current time.
 * Otherwise, returns next business day opening time.
 *
 * @param date - The starting date/time
 * @param businessHours - Business hours configuration
 * @returns The next available business hours time
 */
export function getNextBusinessHoursTime(
  date: Date,
  businessHours: BusinessHours
): Date {
  // If already within business hours, return as-is
  if (isWithinBusinessHours(date, businessHours)) {
    return date;
  }

  const result = new Date(date);
  const currentDay = result.getDay();
  const currentMinutes = getTimeInMinutes(result);
  const todayHours = businessHours[currentDay];

  // Check if we can still catch today's business hours
  if (
    todayHours &&
    todayHours.from < todayHours.to &&
    currentMinutes < todayHours.from
  ) {
    // Set to today's opening time
    const { hours, minutes } = fromMinutes(todayHours.from);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  // Find the next working day
  for (let i = 1; i <= 7; i++) {
    const nextDay = (currentDay + i) % 7;
    const nextDayHours = businessHours[nextDay];

    if (nextDayHours && nextDayHours.from < nextDayHours.to) {
      // Found a working day
      result.setDate(result.getDate() + i);
      const { hours, minutes } = fromMinutes(nextDayHours.from);
      result.setHours(hours, minutes, 0, 0);
      return result;
    }
  }

  // No business hours configured at all - return original date
  // This shouldn't happen in practice but handle gracefully
  return date;
}

/**
 * Schedule a time within business hours
 *
 * If the desired time is outside hours, schedule for next opening.
 * Returns both the scheduled time and whether it was adjusted.
 *
 * @param desiredTime - The desired execution time
 * @param businessHours - Business hours configuration
 * @returns Object with scheduledTime and whether adjustment was made
 */
export function scheduleWithinBusinessHours(
  desiredTime: Date,
  businessHours: BusinessHours
): { scheduledTime: Date; wasAdjusted: boolean } {
  const scheduledTime = getNextBusinessHoursTime(desiredTime, businessHours);
  const wasAdjusted = scheduledTime.getTime() !== desiredTime.getTime();

  return { scheduledTime, wasAdjusted };
}

/**
 * Calculate the next action time with business hours constraint
 *
 * Used by sequence executor to schedule voice calls.
 *
 * @param currentTime - Current time
 * @param delayMinutes - Delay in minutes from current time
 * @param businessHours - Business hours configuration (optional)
 * @returns The scheduled time (adjusted for business hours if provided)
 */
export function calculateNextActionTime(
  currentTime: Date,
  delayMinutes: number,
  businessHours?: BusinessHours
): Date {
  const desiredTime = new Date(
    currentTime.getTime() + delayMinutes * 60 * 1000
  );

  if (!businessHours) {
    return desiredTime;
  }

  return getNextBusinessHoursTime(desiredTime, businessHours);
}

/**
 * Check if any business hours are configured
 */
export function hasBusinessHoursConfigured(
  businessHours?: BusinessHours
): boolean {
  if (!businessHours) return false;

  return Object.values(businessHours).some(
    (hours) => hours && hours.from < hours.to
  );
}
