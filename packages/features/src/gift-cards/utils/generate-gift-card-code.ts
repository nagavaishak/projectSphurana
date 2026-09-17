import { randomInt } from 'node:crypto';
import type { DbConnection } from '../../shared/index.js';

/**
 * Gift card code alphabet — no O/0/I/1/L to avoid transcription mistakes.
 * Format: GC-XXXX-XXXX-XXXX (contract §1.2.4).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomGroup = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
};

export const generateGiftCardCode = (): string =>
  `GC-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`;

/**
 * Generate a gift-card code that is not already taken for this org.
 *
 * Pre-checking the code with a SELECT (rather than retrying an INSERT after a
 * unique violation) is deliberate: in Postgres the FIRST unique violation
 * aborts the surrounding transaction, so an in-transaction insert retry can
 * never succeed. Resolving the collision *before* the insert keeps the whole
 * issuance inside a single transaction while staying robust (contract §1.2.4
 * "retry on unique violation"). The remaining check-then-insert race is
 * astronomically unlikely given the ~31^12 code space and is still caught by
 * the DB unique constraint as a last resort.
 */
export const generateUniqueGiftCardCode = async (
  tx: DbConnection,
  organizationId: string,
  maxAttempts = 5
): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateGiftCardCode();
    const existing = await tx.query.giftCard.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.organizationId, organizationId), eqOp(t.code, code)),
    });
    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique gift card code');
};
