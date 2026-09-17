import {
  assistantWhatsappLink,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  ok,
} from '../../../shared/index.js';
import {
  type VerifyWhatsappLinkInput,
  type VerifyWhatsappLinkOutput,
  verifyWhatsappLinkSchema,
} from './verify-whatsapp-link.schema.js';

/**
 * Match an inbound pairing code to a pending, non-expired link and activate it.
 *
 * Cross-org by design (the inbound webhook has no org context), so it runs on
 * the SYSTEM scope. Stamps the sender's E.164 + `active` + `verifiedAt`.
 */
const verifyWhatsappLinkImpl = async (
  db: DbConnection,
  input: VerifyWhatsappLinkInput
): Promise<Result<VerifyWhatsappLinkOutput>> => {
  const parsed = verifyWhatsappLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { code, fromPhoneE164 } = parsed.data;

  try {
    return await withSystemScope(
      async (conn) => {
        const link = await conn.query.assistantWhatsappLink.findFirst({
          where: and(
            eq(assistantWhatsappLink.verificationCode, code),
            eq(assistantWhatsappLink.status, 'pending')
          ),
        });

        if (!link) {
          return err(
            new FeatureError(
              ErrorCodes.VALIDATION_ERROR,
              'Invalid or unknown verification code'
            )
          );
        }

        if (!link.codeExpiresAt || link.codeExpiresAt.getTime() < Date.now()) {
          return err(
            new FeatureError(
              ErrorCodes.VALIDATION_ERROR,
              'Verification code has expired'
            )
          );
        }

        // Reject if this phone is already linked to another ACTIVE row. The
        // UNIQUE constraint would also catch it, but we want a clean CONFLICT.
        const existingActive = await conn.query.assistantWhatsappLink.findFirst(
          {
            where: and(
              eq(assistantWhatsappLink.phoneE164, fromPhoneE164),
              eq(assistantWhatsappLink.status, 'active')
            ),
          }
        );
        if (existingActive) {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'This WhatsApp number is already linked to another account'
            )
          );
        }

        const [row] = await conn
          .update(assistantWhatsappLink)
          .set({
            phoneE164: fromPhoneE164,
            status: 'active',
            verifiedAt: new Date(),
            verificationCode: null,
            codeExpiresAt: null,
          })
          .where(eq(assistantWhatsappLink.id, link.id))
          .returning({
            id: assistantWhatsappLink.id,
            userId: assistantWhatsappLink.userId,
            organizationId: assistantWhatsappLink.organizationId,
          });

        // Durable audit trail: a successful pairing is a security-relevant
        // account event (an owner's personal WhatsApp number is now authorized
        // to drive their org's marketing). Recorded under the SYSTEM conn since
        // the webhook has no org scope. Only the last 4 phone digits are stored.
        // Fire-and-forget: a failed audit write must never fail the pairing
        // itself (matches logConversationEvent's fire-and-forget contract).
        try {
          await logAuditEvent(conn, {
            action: 'update',
            entityType: 'assistant_whatsapp_link',
            entityId: row.id,
            actorType: 'user',
            actorId: row.userId,
            organizationId: row.organizationId,
            metadata: {
              event: 'whatsapp_link_verified',
              phoneLast4: fromPhoneE164.slice(-4),
            },
          });
        } catch (auditError) {
          logError('assistant.verifyWhatsappLink.audit', auditError, {
            feature: 'assistant',
          });
        }

        return ok({
          id: row.id,
          userId: row.userId,
          organizationId: row.organizationId,
          phoneE164: fromPhoneE164,
        });
      },
      { db }
    );
  } catch (error) {
    logError('assistant.verifyWhatsappLink', error, {
      feature: 'assistant',
      extra: { fromPhoneE164 },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to verify WhatsApp link'
      )
    );
  }
};

export const verifyWhatsappLink = (
  db: DbConnection,
  input: VerifyWhatsappLinkInput
) =>
  trackedResult(
    'assistant.verifyWhatsappLink',
    () => verifyWhatsappLinkImpl(db, input),
    { properties: { fromPhoneE164: input.fromPhoneE164 } }
  );
