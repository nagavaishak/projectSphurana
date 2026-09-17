import { zonedWallTimeToUtc } from '@/lib/timezone';
import { parse } from 'date-fns';

/**
 * The single date/time → ISO conversion shared by every social-post write
 * builder. A surface supplies a `yyyy-MM-dd` date and an `HH:mm` time (the
 * shapes its form fields naturally hold); this turns them into the wire's
 * `scheduledAt` ISO instant.
 *
 * The wall-clock is interpreted in the BUSINESS timezone (`timeZone`), NOT the
 * viewer's device — a post scheduled for "09:00" must publish at 09:00 in the
 * org's zone whether the scheduler's laptop sits in Dublin, Los Angeles, or on
 * a plane (ENG-738). The previous `new Date(date).setHours(...)` read the
 * browser zone, so the stored instant drifted by the offset between the two.
 *
 * Every create/update surface funnels through here, so the zone is applied in
 * exactly one place and can't drift between surfaces.
 */
export function scheduledAtFromDateTime(
  date: string,
  time: string,
  timeZone: string
): string {
  const [hours, minutes] = time.split(':').map(Number);
  // Parse the calendar date to a local-midnight Date so its year/month/day
  // read back correctly; zonedWallTimeToUtc then re-anchors that wall-clock in
  // the business zone and returns the real UTC instant.
  const day = parse(date, 'yyyy-MM-dd', new Date());
  return zonedWallTimeToUtc(
    day,
    hours ?? 0,
    minutes ?? 0,
    timeZone
  ).toISOString();
}
