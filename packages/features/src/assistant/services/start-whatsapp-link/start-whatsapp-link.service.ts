import { randomInt } from 'node:crypto';
import {
  assistantWhatsappLink,
  withOrgScope,
} from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type StartWhatsappLinkInput,
  type StartWhatsappLinkOutput,
  startWhatsappLinkSchema,
} from './start-whatsapp-link.schema.js';

/** Pairing code TTL — short on purpose (single-use, owner pastes it immediately). */
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** 6-digit numeric code: easy to type/tap, short enough for a wa.me prefill. */
const CODE_MIN = 100000;
const CODE_MAX = 999999;

const generateCode = (): string => String(randomInt(CODE_MIN, CODE_MAX + 1));

const buildWaLink = (code: string): string => {
  const number = apiEnv.CLAIRE_WHATSAPP_NUMBER?.replace(/[^0-9]/g, '');
  // Prefill a friendly sentence rather than a bare code so the first message in
  // the thread reads naturally. The webhook extracts the 6-digit code from
  // anywhere in the text (see extractPairingCode in the whatsapp webhook).
  const text = encodeURIComponent(`Connect me to Claire — code ${code}`);
  if (!number) {
    // Dev fallback: no real number provisioned. The code is still returned so
    // the pairing flow is exercisable; the link is a clearly-fake placeholder.
    return `https://wa.me/0000000000?text=${text}`;
  }
  return `https://wa.me/${number}?text=${text}`;
};

const startWhatsappLinkImpl = async (
  db: DbConnection,
  input: StartWhatsappLinkInput
): Promise<Result<StartWhatsappLinkOutput>> => {
  const parsed = startWhatsappLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId } = parsed.data;
  const code = generateCode();
  const codeExpiresAt = new Date(Date.now() + CODE_TTL_MS);

  try {
    const id = await withOrgScope(
      async (tx) => {
        // Replace any existing pending link for this owner so a re-start always
        // yields a single fresh code. Active links are left untouched (the owner
        // must explicitly revoke to re-pair a number).
        await tx
          .delete(assistantWhatsappLink)
          .where(
            and(
              eq(assistantWhatsappLink.userId, userId),
              eq(assistantWhatsappLink.organizationId, organizationId),
              eq(assistantWhatsappLink.status, 'pending')
            )
          );

        const [row] = await tx
          .insert(assistantWhatsappLink)
          .values({
            userId,
            organizationId,
            phoneE164: null,
            verificationCode: code,
            codeExpiresAt,
            status: 'pending',
          })
          .returning({ id: assistantWhatsappLink.id });

        return row.id;
      },
      { db }
    );

    return ok({ id, code, waLink: buildWaLink(code), codeExpiresAt });
  } catch (error) {
    logError('assistant.startWhatsappLink', error, {
      feature: 'assistant',
      extra: { userId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start WhatsApp link'
      )
    );
  }
};

export const startWhatsappLink = (
  db: DbConnection,
  input: StartWhatsappLinkInput
) =>
  trackedResult(
    'assistant.startWhatsappLink',
    () => startWhatsappLinkImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
