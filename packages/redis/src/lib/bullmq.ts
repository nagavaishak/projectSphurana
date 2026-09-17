/**
 * Shared BullMQ Queue/Worker key prefix.
 *
 * Set BULLMQ_KEY_PREFIX in Fly preview app secrets (e.g. `pr-123`) to
 * namespace all queue keys for that PR on the shared Upstash instance.
 * Empty / unset on staging and prod, so production keys stay un-prefixed.
 *
 * Returns undefined when no prefix is configured so we don't pass an empty
 * string into BullMQ (which would otherwise produce keys like `:queue-name`).
 */
export function getBullMqPrefix(): string | undefined {
  const prefix = process.env.BULLMQ_KEY_PREFIX?.trim();
  return prefix && prefix.length > 0 ? prefix : undefined;
}
