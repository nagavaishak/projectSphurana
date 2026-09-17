/**
 * content-items — a piece of content the owner decides on, and its cuts.
 *
 * The slot/attempt pair was built for monthly batch posts (#714) and lived
 * inside `content-batches`, which made a batch the only thing that could own an
 * item. It is the same shape wherever content comes from: one decision, one
 * schedule, a thread, and N attempts. A monthly plan is now one PRODUCER of
 * items; a Claire chat is another.
 *
 * Everything that writes `content_item` / `content_attempt` goes through here,
 * so "which cut is live" stays a fact rather than a rule each caller re-derives
 * — the exact conflation that made editing a post silently orphan its
 * conversation before the split.
 */
export * from './services/index.js';
