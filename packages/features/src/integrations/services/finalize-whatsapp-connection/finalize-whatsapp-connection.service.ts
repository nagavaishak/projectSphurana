import {
  type WhatsAppAccount,
  whatsappAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import {
  WhatsAppOAuthService,
  type WhatsAppPhoneNumber,
} from '@borradh-workspace/integrations/whatsapp';
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
import { ensureFirstTouchTemplate } from './ensure-first-touch-template.js';
import {
  type FinalizeWhatsAppConnectionInput,
  finalizeWhatsAppConnectionSchema,
} from './finalize-whatsapp-connection.schema.js';

export interface FinalizeWhatsAppConnectionResultData {
  accounts: WhatsAppAccount[];
}

/** Convert Meta's human-formatted display number to clean E.164. */
const toE164 = (displayPhoneNumber: string): string => {
  const digits = displayPhoneNumber.replace(/[^0-9]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
};

const finalizeWhatsAppConnectionImpl = async (
  db: DbConnection,
  input: FinalizeWhatsAppConnectionInput
): Promise<Result<FinalizeWhatsAppConnectionResultData>> => {
  const parsed = finalizeWhatsAppConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, connectedById, wabaId, code } = parsed.data;
  const whatsappOAuth = new WhatsAppOAuthService();

  // 1. Exchange the short-lived code for a long-lived business token.
  let accessToken: string;
  let expiresIn: number;
  try {
    const token = await whatsappOAuth.exchangeCodeForToken(code);
    accessToken = token.accessToken;
    expiresIn = token.expiresIn;
  } catch (error) {
    logError('integrations.finalizeWhatsAppConnection.exchangeCode', error, {
      feature: 'integrations',
      extra: { organizationId, wabaId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to exchange WhatsApp authorization code'
      )
    );
  }

  // 2. Fetch phone numbers attached to the WABA.
  // Coexistence flows only return waba_id in the postMessage event, so we
  // discover the number(s) server-side. Embedded Signup guarantees at least
  // one number exists on the WABA at this point.
  let phones: WhatsAppPhoneNumber[];
  try {
    phones = await whatsappOAuth.getPhoneNumbers(wabaId, accessToken);
  } catch (error) {
    logError('integrations.finalizeWhatsAppConnection.getPhoneNumbers', error, {
      feature: 'integrations',
      extra: { organizationId, wabaId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch WhatsApp phone numbers from Meta'
      )
    );
  }

  if (phones.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No phone numbers found on the WhatsApp Business Account'
      )
    );
  }

  // 3. Subscribe our app to webhooks for this WABA.
  // Do NOT call /register — Coexistence / SMB-managed numbers are already
  // registered by Meta and /register returns
  // "Register endpoint is not available for SMB businesses."
  const subscribed = await whatsappOAuth.subscribeToWebhooks(
    wabaId,
    accessToken
  );
  if (!subscribed) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to subscribe to WhatsApp webhooks'
      )
    );
  }

  // 4. Persist one row per phone number on the WABA.
  const encryptedCreds = encryptCredentials({
    accessToken,
    tokenType: 'bearer',
    expiresIn,
  });
  // biSUATs from a config set to "Never" expire return expires_in = 0.
  // Use null in the DB to represent "does not expire".
  const tokenExpiresAt =
    expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

  try {
    const accounts = await db.transaction(async (tx) => {
      const persisted: WhatsAppAccount[] = [];
      for (const phone of phones) {
        const phoneNumber = toE164(phone.displayPhoneNumber);
        const existing = await tx.query.whatsappAccount.findFirst({
          where: and(
            eq(whatsappAccount.organizationId, organizationId),
            eq(whatsappAccount.phoneNumberId, phone.id)
          ),
        });

        if (existing) {
          const [updated] = await tx
            .update(whatsappAccount)
            .set({
              wabaId,
              phoneNumber,
              displayName: phone.verifiedName ?? existing.displayName,
              encryptedCredentials: encryptedCreds,
              tokenExpiresAt,
              tokenStatus: 'valid',
              isVerified: true,
              isActive: true,
              connectedById,
            })
            .where(eq(whatsappAccount.id, existing.id))
            .returning();
          persisted.push(updated);
        } else {
          const [inserted] = await tx
            .insert(whatsappAccount)
            .values({
              organizationId,
              connectedById,
              phoneNumberId: phone.id,
              wabaId,
              phoneNumber,
              displayName: phone.verifiedName ?? null,
              encryptedCredentials: encryptedCreds,
              tokenExpiresAt,
              tokenStatus: 'valid',
              isActive: true,
              isVerified: true,
            })
            .returning();
          persisted.push(inserted);
        }
      }
      return persisted;
    });

    // Get the opener template into Meta's approval queue now, so the wait
    // overlaps onboarding rather than starting at the first lead. Outside the
    // transaction and best-effort: it calls Meta, and must not be able to roll
    // back an otherwise completed connection.
    for (const account of accounts) {
      await ensureFirstTouchTemplate(db, {
        organizationId,
        accountId: account.id,
      });
    }

    return ok({ accounts });
  } catch (error) {
    logError('integrations.finalizeWhatsAppConnection.persist', error, {
      feature: 'integrations',
      extra: { organizationId, wabaId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to finalize WhatsApp connection'
      )
    );
  }
};

/**
 * Finalize the WhatsApp Embedded Signup flow.
 *
 * Called after the customer completes Meta's Embedded Signup popup on the
 * frontend. Exchanges the returned code for a biSUAT, fetches the WABA's
 * phone numbers, subscribes our app to WABA webhooks, and upserts one
 * `whatsappAccount` row per phone.
 *
 * Reconnect case: existing rows with the same `(organizationId,
 * phoneNumberId)` have their credentials refreshed and `tokenStatus` reset
 * to `valid` while keeping chatbot state.
 */
export const finalizeWhatsAppConnection = (
  db: DbConnection,
  input: FinalizeWhatsAppConnectionInput
) =>
  trackedResult(
    'integrations.finalizeWhatsAppConnection',
    () =>
      withOrgScope((tx) => finalizeWhatsAppConnectionImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type FinalizeWhatsAppConnectionResult = Awaited<
  ReturnType<typeof finalizeWhatsAppConnection>
>;
