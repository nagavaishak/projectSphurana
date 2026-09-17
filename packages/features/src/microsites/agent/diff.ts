/**
 * The turn diff the sidebar renders (contract §4).
 *
 * Computed SERVER-SIDE from the before/after documents and shipped on the
 * `done` event. The client must never re-derive it: the client does not hold
 * the "before" document (it holds whatever it last rendered, which may be
 * several turns stale), and two derivations of the same diff drift the moment
 * one of them learns about a new block type.
 *
 * Block identity is the block ID, which is stable across edits by contract. A
 * page that is deleted contributes its blocks as `removed`; a page that is
 * created contributes its blocks as `added` — the four keys in the contract
 * cover pages without needing a fifth.
 */

import type { Block, MicrositeDocument } from '@borradh-workspace/web-shared';
import { blockPrecis } from './document-summary.js';

export interface MicrositeDiffEntry {
  /** Page the block lives on (or lived on). */
  path: string;
  blockId: string;
  type: string;
  /** Human label for the diff card row. */
  label: string;
}

export interface MicrositeTurnDiff {
  added: MicrositeDiffEntry[];
  edited: MicrositeDiffEntry[];
  removed: MicrositeDiffEntry[];
  themeChanged: boolean;
}

export const EMPTY_MICROSITE_DIFF: MicrositeTurnDiff = {
  added: [],
  edited: [],
  removed: [],
  themeChanged: false,
};

const entryFor = (path: string, block: Block): MicrositeDiffEntry => ({
  path,
  blockId: block.id,
  type: block.type,
  label: blockPrecis(block),
});

/** Stable structural comparison — key order in jsonb is not meaningful. */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

interface IndexedBlock {
  path: string;
  index: number;
  block: Block;
}

const indexBlocks = (doc: MicrositeDocument): Map<string, IndexedBlock> => {
  const map = new Map<string, IndexedBlock>();
  for (const page of doc.pages) {
    page.blocks.forEach((block, index) => {
      map.set(block.id, { path: page.path, index, block });
    });
  }
  return map;
};

export const computeMicrositeDiff = (
  before: MicrositeDocument,
  after: MicrositeDocument
): MicrositeTurnDiff => {
  const beforeBlocks = indexBlocks(before);
  const afterBlocks = indexBlocks(after);

  const added: MicrositeDiffEntry[] = [];
  const edited: MicrositeDiffEntry[] = [];
  const removed: MicrositeDiffEntry[] = [];

  for (const [id, next] of afterBlocks) {
    const prev = beforeBlocks.get(id);
    if (!prev) {
      added.push(entryFor(next.path, next.block));
      continue;
    }
    const moved = prev.path !== next.path || prev.index !== next.index;
    const changed = stableStringify(prev.block) !== stableStringify(next.block);
    if (moved || changed) {
      edited.push(entryFor(next.path, next.block));
    }
  }

  for (const [id, prev] of beforeBlocks) {
    if (!afterBlocks.has(id)) removed.push(entryFor(prev.path, prev.block));
  }

  return {
    added,
    edited,
    removed,
    themeChanged:
      stableStringify(before.theme) !== stableStringify(after.theme),
  };
};

/** True when the turn changed nothing — no revision is written for those. */
export const isEmptyDiff = (diff: MicrositeTurnDiff): boolean =>
  diff.added.length === 0 &&
  diff.edited.length === 0 &&
  diff.removed.length === 0 &&
  !diff.themeChanged;

/** One-line label for the revision this turn produced. */
export const describeDiff = (diff: MicrositeTurnDiff): string => {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`added ${diff.added.length} block(s)`);
  if (diff.edited.length) parts.push(`edited ${diff.edited.length} block(s)`);
  if (diff.removed.length)
    parts.push(`removed ${diff.removed.length} block(s)`);
  if (diff.themeChanged) parts.push('updated the theme');
  if (parts.length === 0) return 'No changes';
  const sentence = parts.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};
