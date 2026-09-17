/**
 * Template rotation — stop every batch drawing the same handful of designs.
 *
 * Selection was `hash(graphicId) % poolSize` with `graphicId` a random UUID,
 * i.e. uniform random with no memory. With only six organic single templates
 * that produced two visible failures:
 *
 *   - WITHIN a batch: more than six singles guarantees repeated designs by
 *     pigeonhole, not bad luck.
 *   - ACROSS batches: a fresh random draw each time, so regenerating (the
 *     manual button sends `replace: true`) or generating again next week
 *     frequently lands on the same layouts. Owners describe this as "it looks
 *     like last month" even when the copy is entirely new.
 *
 * Fresh topics cannot fix that — the output LOOKS the same regardless of what
 * it says.
 *
 * `rotateTemplateSlugs` assigns by POSITION from a per-org offset:
 *
 *     index = (offset + position) % poolSize
 *
 * Deterministic, so it is computed once at plan time where every position is
 * known — no read-then-write race, unlike per-job selection in the worker.
 * Consecutive positions walk distinct designs until the pool is exhausted, and
 * the offset moves the whole sequence on for the next batch.
 */

/**
 * Assign a template to each position, walking the pool from `offset`.
 *
 * @param pool     available template slugs, in a stable order
 * @param count    how many templates to assign
 * @param offset   how many pieces this org has already generated — moves the
 *                 window on so the next batch doesn't reopen on the same design
 */
export function rotateTemplateSlugs(
  pool: string[],
  count: number,
  offset: number
): string[] {
  if (pool.length === 0 || count <= 0) return [];
  // Guard against a negative or non-finite offset reaching the modulo.
  const safeOffset = Number.isFinite(offset)
    ? Math.max(0, Math.trunc(offset))
    : 0;
  const assigned: string[] = [];
  for (let position = 0; position < count; position += 1) {
    assigned.push(pool[(safeOffset + position) % pool.length]);
  }
  return assigned;
}
