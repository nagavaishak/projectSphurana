import type { ResourceWorkingHours } from '../api';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const; // Mon-first, the way a rota reads

/** minutes-from-midnight → "9am" / "5:30pm" (no leading zero, no dead ":00"). */
function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * One human sentence for a resource's availability, for the card meta line.
 *
 * The card is a glance surface: an owner scanning eight rooms wants "Mon–Fri
 * 9am–6pm", not a seven-row grid. The full editor lives in the dialog.
 *
 * `null` means ALWAYS AVAILABLE (inherits the clinic's own hours) — the single
 * most important thing to render unambiguously, because the alternative reading
 * ("no hours set, therefore never bookable") is the Boulevard footgun this
 * feature deliberately avoids.
 */
export function summariseResourceHours(
  hours: ResourceWorkingHours | null | undefined
): string {
  if (!hours) return 'Always available';

  const open = DAY_ORDER.filter((d) => hours[d]);
  if (open.length === 0) return 'No open days';

  // Every open day sharing one range is the overwhelmingly common case, and it
  // collapses to something readable: "Mon–Fri 9am–6pm".
  const first = hours[open[0]];
  const uniform = open.every(
    (d) => hours[d]?.from === first?.from && hours[d]?.to === first?.to
  );
  const range = first ? `${clock(first.from)}–${clock(first.to)}` : '';

  if (!uniform) {
    return `${open.map((d) => DAY_INITIALS[d]).join('')} · varies`;
  }

  // Contiguous run in Mon-first order → "Mon–Fri"; otherwise list initials.
  const positions = open.map((d) => DAY_ORDER.indexOf(d));
  const contiguous = positions.every(
    (p, i) => i === 0 || p === positions[i - 1] + 1
  );
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

  if (open.length === 7) return `Every day ${range}`;
  if (contiguous && open.length > 1) {
    return `${NAMES[open[0]]}–${NAMES[open[open.length - 1]]} ${range}`;
  }
  if (open.length === 1) return `${NAMES[open[0]]} ${range}`;
  return `${open.map((d) => NAMES[d]).join(', ')} ${range}`;
}
