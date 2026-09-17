const HOUR_MS = 60 * 60 * 1000;

/**
 * The last instant a patient may still act on a booking online:
 * `startDate - noticeHours`.
 */
export const noticeDeadline = (startDate: Date, noticeHours: number): Date =>
  new Date(startDate.getTime() - noticeHours * HOUR_MS);

/**
 * Whether the notice window still permits acting NOW.
 *
 * BOUNDARY SEMANTICS (deliberate, mirrored by `canCancel`/`canReschedule` on
 * the list response): exactly AT the deadline is ALLOWED; only strictly past
 * it (`now > startDate - noticeHours`) is blocked. I.e. allowed iff
 * `now <= startDate - noticeHours`.
 */
export const isWithinNoticeWindow = (
  startDate: Date,
  noticeHours: number,
  now: Date = new Date()
): boolean => now.getTime() <= noticeDeadline(startDate, noticeHours).getTime();
