/**
 * The "today" anchor for the customer chatbot prompt.
 *
 * The prompt carried NO current date. Every date the model saw — the
 * customer's ("Friday 4th of September") and the operator's free-text
 * directive ("no availability until September 2nd") — was an unanchored
 * string, so the model could not order them and had no idea which had already
 * passed.
 *
 * Observed cost (2026-08-27, "shine by s"): the clinic's directive said
 * availability resumed on 2 September. A customer asked for Friday 4
 * September. The model replied "there's no availability until September 2nd,
 * so Friday September 4th at 12pm isn't available" — having already offered
 * Thursday 3 September earlier in the same conversation. It refused the later
 * date and offered the earlier one. The booking was lost.
 *
 * The weekday matters as much as the date: customers say "next Friday" far
 * more often than they say a number, and a model that cannot name today's
 * weekday cannot resolve that either.
 */

/**
 * One line naming today in the org's timezone, plus the ordering rule the
 * model kept getting wrong.
 *
 * Timezone-correct by construction: formatting is done by `Intl` in
 * `timeZone`, never by reading the server's local clock. A clinic in
 * Europe/London must not be told it is still yesterday because the container
 * runs UTC.
 *
 * `now` is injectable so tests can pin it; production always passes the real
 * clock.
 */
const formatIn = (zone: string, now: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);

export function buildCurrentDateLine(timezone: string, now: Date = new Date()) {
  // Two distinct ways the org's zone can fail us, and BOTH must land on UTC.
  //
  //  - Absent or blank. `Intl` reads `timeZone: undefined` as "use the host
  //    default", which on a server is the container's clock. That is the exact
  //    bug this function exists to remove — a date that silently tracks
  //    wherever the process happens to run, differing between prod, a preview
  //    box and a laptop. `organization.timezone` is notNull today, so this is
  //    unreachable from the DB, but a caller that drops the field must get a
  //    stated UTC date rather than an ambient one.
  //  - Present but not a real IANA zone. `Intl` throws, which would take the
  //    whole reply down. A slightly-wrong date is bad; no reply at all is
  //    worse.
  //
  // Deliberately silent: UTC is a defined answer, not an error to report.
  const zone = timezone?.trim() ? timezone : 'UTC';
  let formatted: string;
  try {
    formatted = formatIn(zone, now);
  } catch {
    formatted = formatIn('UTC', now);
  }

  return `--- Today's Date ---
Today is ${formatted}.

Use this to resolve every date the customer mentions ("tomorrow", "next
Friday", "the 4th") and to judge whether a date has already passed.

If the clinic's instructions say there is no availability until a given date,
that date is the START of availability, not the end of it. Any date ON or
AFTER it is potentially bookable — never refuse a date for being before a
cutoff it actually falls after. Check the calendar rather than assuming.
`;
}
