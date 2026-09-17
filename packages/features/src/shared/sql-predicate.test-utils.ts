/**
 * Renders a drizzle predicate to readable text so a test can assert on the SQL
 * SHAPE rather than on rows.
 *
 * This exists because `createMockDatabase()` does not execute SQL — it returns
 * whatever the test queued. So a test that queues a location-less row and
 * asserts it comes back proves nothing: it passes just as happily against a
 * WHERE clause that would have excluded it in Postgres. Asserting the predicate
 * is the only unit-level check of a filter that can actually fail.
 */
export function renderPredicate(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) renderPredicate(child, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.queryChunks)) {
    renderPredicate(record.queryChunks, out);
    return out;
  }
  // A drizzle StringChunk: the literal SQL text.
  if (Array.isArray(record.value)) {
    out.push((record.value as unknown[]).join(''));
    return out;
  }
  // A column reference.
  if (record.name && record.table) {
    out.push(`[col:${String(record.name)}]`);
    return out;
  }
  // A bound parameter.
  if ('value' in record) {
    out.push(`?${String(record.value)}`);
    return out;
  }
  return out;
}

/** The rendered predicate as one whitespace-normalised string. */
export function predicateSql(node: unknown): string {
  return renderPredicate(node).join(' ').replace(/\s+/g, ' ').trim();
}
