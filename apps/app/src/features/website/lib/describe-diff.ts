import type { MicrositeTurnDiff } from '../api/types';

/**
 * The diff card's one line: "+2 blocks, ~1 edited, theme unchanged".
 *
 * Built ONLY from the `done` event's `diff` (§4). The sidebar deliberately does
 * not compare documents client-side: the client sees the draft after the turn,
 * never before, so any client-side derivation would be a guess dressed up as a
 * fact — and a wrong "nothing changed" on a card whose Undo button is the
 * user's safety net is worse than no card at all.
 */
export function describeDiff(diff: MicrositeTurnDiff): string {
  const parts: string[] = [];

  if (diff.added > 0) {
    parts.push(`+${diff.added} ${diff.added === 1 ? 'block' : 'blocks'}`);
  }
  if (diff.edited > 0) {
    parts.push(`~${diff.edited} edited`);
  }
  if (diff.removed > 0) {
    parts.push(`-${diff.removed} removed`);
  }
  if (parts.length === 0) {
    parts.push('No block changes');
  }

  parts.push(diff.themeChanged ? 'theme changed' : 'theme unchanged');
  return parts.join(', ');
}

/** Whether a turn actually touched the draft — a no-op turn gets no Undo/Keep. */
export function isEmptyDiff(diff: MicrositeTurnDiff): boolean {
  return (
    diff.added === 0 &&
    diff.edited === 0 &&
    diff.removed === 0 &&
    !diff.themeChanged
  );
}
