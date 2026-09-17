/**
 * Pick at most `limit` slots that represent the WHOLE of what is available
 * rather than just the earliest part of it.
 *
 * Every slot list in this feature was previously narrowed with `.slice(0, n)`,
 * which is the head of a chronologically sorted day. For a clinic open
 * 10:00-19:00 at 30-minute granularity that is 5 of ~18 slots, and the model
 * is told to offer ONLY what it was shown — so the clinic read to every
 * customer as one that shuts at noon, and "anything after 5?" was answered
 * with a morning-only list (ENG-814).
 *
 * Taking evenly spaced indices keeps the prompt (and the reply) short while
 * making morning, afternoon and evening all reachable. The first and last
 * slots are always included, so the customer can always see how late the
 * clinic actually goes.
 */
export function spreadSlots<T>(slots: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (slots.length <= limit) return slots;
  if (limit === 1) return [slots[0]];

  // `step > 1` because `slots.length > limit`, so the rounded indices are
  // strictly increasing and no slot is picked twice.
  const step = (slots.length - 1) / (limit - 1);
  const picked: T[] = [];
  for (let i = 0; i < limit; i++) {
    picked.push(slots[Math.round(i * step)]);
  }
  return picked;
}
