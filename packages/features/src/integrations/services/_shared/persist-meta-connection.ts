import {
  type MetaAdsIntegration,
  type MetaAdsPage,
  type WhatsAppAccount,
  metaAdsIntegration,
  metaAdsPage,
  whatsappAccount,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import {
  MetaOAuthService,
  type MetaPageInfo,
} from '@borradh-workspace/integrations/meta-ads';
import { WhatsAppOAuthService } from '@borradh-workspace/integrations/whatsapp';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/** Meta's human-formatted display number → clean E.164. */
const toE164 = (displayPhoneNumber: string): string => {
  const digits = displayPhoneNumber.replace(/[^0-9]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
};

export interface PersistMetaConnectionInput {
  db: DbConnection;
  organizationId: string;
  connectedById: string;
  /** The credential this workspace will act through, already validated. */
  accessToken: string;
  /**
   * How the credential was obtained. Read by `isFlfbIntegration()` and by the
   * token-refresh job to decide whether this row is ever renewed.
   */
  connectionMethod: 'flfb' | 'system_user';
  /** Null for a credential that never lapses — the expected case for both. */
  tokenExpiresAt: Date | null;
  pageIds: string[];
  adAccountId?: string;
  adAccountName?: string;
  wabaIds: string[];
  /** Operation name for error logs, so failures name the calling flow. */
  operation: string;
}

export interface PersistMetaConnectionResult {
  integrationId: string;
  pageIds: string[];
  pageRowIds: string[];
  whatsappNumbers: string[];
  whatsappSkipped: string[];
}

/**
 * Write a Meta connection onto an organization.
 *
 * Shared by the two ways a durable Meta credential reaches us — the operator
 * assigning assets to our system user, and a client authorising through
 * Facebook Login for Business. Everything downstream of "we hold a working,
 * non-expiring token for these Pages" is identical between them, and keeping
 * two copies of it is how the publishing path and the ads path drift.
 *
 * What differs is only what the caller passes: the token's provenance
 * (`connectionMethod`) and whether it lapses (`tokenExpiresAt`).
 *
 * Writes with the caller's connection and no org scope: both callers run from
 * the admin terminal, acting on an org the admin is not a member of.
 */
export const persistMetaConnection = async ({
  db,
  organizationId,
  connectedById,
  accessToken,
  connectionMethod,
  tokenExpiresAt,
  pageIds,
  adAccountId,
  adAccountName,
  wabaIds,
  operation,
}: PersistMetaConnectionInput): Promise<
  Result<PersistMetaConnectionResult>
> => {
  const meta = new MetaOAuthService();

  // Re-read the picked pages to get their page access tokens (discovery never
  // hands those to the browser) and to prove they are still reachable.
  let pages: MetaPageInfo[];
  try {
    const fetched = await Promise.all(
      pageIds.map((pageId) => meta.getPage(accessToken, pageId))
    );
    const unreachable = pageIds.filter((_, index) => !fetched[index]);
    if (unreachable.length > 0) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `This token cannot act on ${unreachable.length === 1 ? 'Page' : 'Pages'} ${unreachable.join(', ')}.`
        )
      );
    }
    pages = fetched.filter((page): page is MetaPageInfo => page !== null);
  } catch (error) {
    logError(`${operation}.getPages`, error, {
      feature: 'integrations',
      extra: { organizationId, pageIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Could not read those Pages from Meta. Please try again.'
      )
    );
  }

  const encryptedCreds = encryptCredentials({
    accessToken,
    tokenType: 'bearer',
    // 0 is how the rest of the codebase spells "no expiry" in a credentials
    // blob; a real expiry is carried through unchanged.
    expiresIn: tokenExpiresAt
      ? Math.max(0, Math.floor((tokenExpiresAt.getTime() - Date.now()) / 1000))
      : 0,
  });

  const pageRowIds: string[] = [];
  const whatsappNumbers: string[] = [];
  const whatsappSkipped: string[] = [];
  let integration: MetaAdsIntegration;

  try {
    const existing = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    const values = {
      connectedById,
      encryptedCredentials: encryptedCreds,
      // Null is the load-bearing value: it is what isFlfbIntegration() reads to
      // keep this row out of the token-refresh job forever. A non-null value
      // here means the credential DOES lapse and the refresh job must see it.
      tokenExpiresAt,
      tokenStatus: 'valid' as const,
      configurationStatus: 'configured' as const,
      connectionMethod,
      adAccountId: adAccountId ?? null,
      adAccountName: adAccountName ?? null,
      isActive: true,
      lastSyncAt: new Date(),
    };

    if (existing) {
      [integration] = await db
        .update(metaAdsIntegration)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(metaAdsIntegration.organizationId, organizationId))
        .returning();
    } else {
      [integration] = await db
        .insert(metaAdsIntegration)
        .values({ organizationId, ...values })
        .returning();
    }

    let defaultPageRowId = integration.defaultPageId;
    const subscriptions: Promise<unknown>[] = [];

    for (const page of pages) {
      const linkedIg = page.instagramBusinessAccount;
      const pageValues = {
        pageName: page.name || null,
        pagePictureUrl: page.pictureUrl || null,
        pageAccessToken: encryptCredentials({ accessToken: page.accessToken }),
        platform: 'facebook' as const,
        linkedInstagramAccountId: linkedIg?.id ?? null,
        linkedInstagramUsername: linkedIg?.username ?? null,
        linkedInstagramName: linkedIg?.name ?? null,
        defaultAdAccountId: adAccountId ?? null,
        defaultAdAccountName: adAccountName ?? null,
        isActive: true,
      };

      const existingPage = await db.query.metaAdsPage.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(
            eqOp(t.metaAdsIntegrationId, integration.id),
            eqOp(t.pageId, page.id)
          ),
      });

      let row: MetaAdsPage;
      if (existingPage) {
        [row] = await db
          .update(metaAdsPage)
          .set({ ...pageValues, updatedAt: new Date() })
          .where(eq(metaAdsPage.id, existingPage.id))
          .returning();
      } else {
        [row] = await db
          .insert(metaAdsPage)
          .values({
            metaAdsIntegrationId: integration.id,
            pageId: page.id,
            ...pageValues,
          })
          .returning();
      }

      if (!defaultPageRowId) defaultPageRowId = row.id;
      pageRowIds.push(row.id);
      subscriptions.push(
        meta
          // Fields are DERIVED from the webhook registry — never passed here.
          .subscribePageToWebhooks(page.id, page.accessToken)
          .catch(() => undefined)
      );
    }

    if (defaultPageRowId && defaultPageRowId !== integration.defaultPageId) {
      [integration] = await db
        .update(metaAdsIntegration)
        .set({ defaultPageId: defaultPageRowId })
        .where(eq(metaAdsIntegration.id, integration.id))
        .returning();
    }

    // Webhook subscriptions are external I/O: never hold the request (or a
    // database connection) open across them.
    void Promise.allSettled(subscriptions);
  } catch (error) {
    logError(`${operation}`, error, {
      feature: 'integrations',
      extra: { organizationId, pageIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to save the Meta connection'
      )
    );
  }

  // WhatsApp is attached from the same token: a WABA shared with our portfolio
  // is reachable by the same system user, so there is no second credential and
  // no Embedded Signup popup. Failures here are reported per-WABA rather than
  // failing the whole link — the Facebook/Instagram half is already saved and
  // is what most orgs came for.
  const whatsapp = new WhatsAppOAuthService();
  for (const wabaId of wabaIds) {
    try {
      const phones = await whatsapp.getPhoneNumbers(wabaId, accessToken);
      if (phones.length === 0) {
        whatsappSkipped.push(wabaId);
        continue;
      }

      const subscribed = await whatsapp.subscribeToWebhooks(
        wabaId,
        accessToken
      );
      if (!subscribed) {
        // Without a webhook subscription the number can send but never
        // receive, which looks like "Claire ignored my customer" rather than
        // like a broken connection. Skip it loudly instead.
        whatsappSkipped.push(wabaId);
        continue;
      }

      for (const phone of phones) {
        const phoneNumber = toE164(phone.displayPhoneNumber);
        const existingAccount = await db.query.whatsappAccount.findFirst({
          where: and(
            eq(whatsappAccount.organizationId, organizationId),
            eq(whatsappAccount.phoneNumberId, phone.id)
          ),
        });

        const accountValues = {
          wabaId,
          phoneNumber,
          displayName: phone.verifiedName ?? null,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          tokenStatus: 'valid' as const,
          isActive: true,
          isVerified: true,
          connectedById,
        };

        let account: WhatsAppAccount;
        if (existingAccount) {
          [account] = await db
            .update(whatsappAccount)
            .set(accountValues)
            .where(eq(whatsappAccount.id, existingAccount.id))
            .returning();
        } else {
          [account] = await db
            .insert(whatsappAccount)
            .values({
              organizationId,
              phoneNumberId: phone.id,
              ...accountValues,
            })
            .returning();
        }
        whatsappNumbers.push(account.phoneNumber);
      }
    } catch (error) {
      logError(`${operation}.whatsapp`, error, {
        feature: 'integrations',
        extra: { organizationId, wabaId },
      });
      whatsappSkipped.push(wabaId);
    }
  }

  return ok({
    integrationId: integration.id,
    pageIds: pages.map((page) => page.id),
    pageRowIds,
    whatsappNumbers,
    whatsappSkipped,
  });
};
