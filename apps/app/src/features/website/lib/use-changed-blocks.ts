import { type RefObject, useEffect, useRef, useState } from 'react';

import type { MicrositePage } from '../api/types';

/**
 * Block ids whose content changed since the last document we saw, held for a
 * moment so the outline can flash them.
 *
 * This DOES compare documents client-side — deliberately, and only for the
 * flash. The diff CARD is never built this way (§4: the server sends `diff`,
 * the sidebar renders it); but "which blocks lit up" is not in the diff, which
 * carries counts only, and a change the user cannot locate on screen may as
 * well not have been reported. So: counts come from the server, highlighting is
 * local, and the two never stand in for each other.
 *
 * `suppressedBlockIds` is how an inline canvas edit stays out of the flash
 * (inline-edit contract §5): the user just typed that text, so lighting it up
 * tells them nothing and makes the highlight stop meaning "something changed
 * that you did not do". Ids are consumed — suppressed for the first document
 * that carries their change, then dropped, so a later agent turn still flashes.
 */
export function useChangedBlocks(
  pages: MicrositePage[] | null,
  options: { ms?: number; suppressedBlockIds?: RefObject<Set<string>> } = {}
) {
  const { ms = 2200, suppressedBlockIds } = options;
  const previous = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!pages) return;

    const next = new Map<string, string>();
    for (const page of pages) {
      for (const block of page.blocks) {
        next.set(
          block.id,
          `${block.type}:${block.variant}:${JSON.stringify(block.props)}`
        );
      }
    }

    const before = previous.current;
    previous.current = next;
    // First load is not a change — everything would flash at once.
    if (!before) return;

    const suppressed = suppressedBlockIds?.current;
    const touched = new Set<string>();
    for (const [id, signature] of next) {
      if (before.get(id) === signature) continue;
      if (suppressed?.has(id)) {
        suppressed.delete(id);
        continue;
      }
      touched.add(id);
    }
    if (touched.size === 0) return;

    setChanged(touched);
    const timer = setTimeout(() => setChanged(new Set()), ms);
    return () => clearTimeout(timer);
  }, [pages, ms, suppressedBlockIds]);

  return changed;
}
