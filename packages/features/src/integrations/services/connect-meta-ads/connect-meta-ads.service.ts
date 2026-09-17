import {
  type MetaAdsIntegration,
  type MetaAdsPage,
  metaAdsIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { encryptCredentials } from '@borradh-workspace/integrations';
import {
  type MetaAdAccountInfo,
  MetaOAuthService,
  type MetaPageInfo,
} from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import {
  createLogger,
  logError,
  trackOrgEvent,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { queueVoiceIngest } from '../../../voice-cloning/services/queue-voice-ingest/index.js';
import {
  type ConnectMetaAdsInput,
  type InitiateMetaOAuthInput,
  connectMetaAdsSchema,
  initiateMetaOAuthSchema,
} from './connect-meta-ads.schema.js';

const logger = createLogger('ConnectMetaAds');

/**
 * Result from initiateMetaOAuth - returns integration ID for the wizard
 */
export interface InitiateMetaOAuthResponse {
  integrationId: string;
  /**
   * Internal metaAdsPage.id rows persisted by the FLfB auto-configure branch.
   * Consumed by the wrapper to queue voice ingest AFTER the transaction
   * commits (queueing inside the org-scope transaction races the worker
   * against uncommitted page rows).
   */
  flfbPageRowIds?: string[];
}

/**
 * @deprecated Use InitiateMetaOAuthResponse instead
 * Legacy session type - kept for backwards compatibility during migration
 */
export interface MetaOAuthSession {
  accessToken: string;
  expiresIn: number;
  adAccounts: Array<{
    id: string;
    accountId: string;
    name: string;
    currency: string;
    accountStatus: number;
    businessName?: string;
  }>;
  pages: Array<{
    id: string;
    name: string;
    accessToken: string;
    category?: string;
    pictureUrl?: string;
  }>;
}

/**
 * Initiate Meta OAuth - exchanges code and saves integration to DB immediately
 * with pending_selection status. Stores available options for wizard.
 */
const initiateMetaOAuthImpl = async (
  db: DbConnection,
  input: InitiateMetaOAuthInput
): Promise<Result<InitiateMetaOAuthResponse>> => {
  const parsed = initiateMetaOAuthSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code, flfb } = parsed.data;

  // Track which flow step throws — the catch-all otherwise collapses every
  // provider failure into one indistinguishable error.
  let step = 'init';

  try {
    const metaOAuth = new MetaOAuthService();

    // FLFB popup is redirect-less and (with a System-user + Never config)
    // returns the non-expiring business token in a single call. The classic
    // redirect flow needs the short→long-lived two-step exchange. Both
    // branches yield a { accessToken, tokenType, expiresIn } token, so all
    // downstream asset-fetch and persistence code is identical.
    step = 'exchange_code';
    const longLivedToken = flfb
      ? await metaOAuth.exchangeFlfbCodeForToken(code)
      : await metaOAuth.exchangeForLongLivedToken(
          (await metaOAuth.exchangeCodeForToken(code)).accessToken
        );

    // Phase 1: Get user info and businesses in parallel
    step = 'fetch_user_and_businesses';
    const [userInfo, businesses] = await Promise.all([
      metaOAuth.getUserInfo(longLivedToken.accessToken),
      metaOAuth.getBusinesses(longLivedToken.accessToken),
    ]);

    // Phase 2: Fetch per-business assets (or fallback to me/* for personal accounts)
    let adAccounts: MetaAdAccountInfo[] = [];
    let pages: MetaPageInfo[] = [];

    step = 'fetch_assets';
    if (businesses.length > 0) {
      const results = await Promise.all(
        businesses.map(async (biz) => {
          const [bizAdAccounts, bizPages] = await Promise.all([
            metaOAuth.getBusinessAdAccounts(longLivedToken.accessToken, biz.id),
            metaOAuth.getBusinessPages(longLivedToken.accessToken, biz.id),
          ]);
          return { adAccounts: bizAdAccounts, pages: bizPages };
        })
      );
      // Flatten and deduplicate by id
      const seenAdAccounts = new Set<string>();
      const seenPages = new Set<string>();
      for (const r of results) {
        for (const acc of r.adAccounts) {
          if (!seenAdAccounts.has(acc.id)) {
            seenAdAccounts.add(acc.id);
            adAccounts.push(acc);
          }
        }
        for (const page of r.pages) {
          if (!seenPages.has(page.id)) {
            seenPages.add(page.id);
            pages.push(page);
          }
        }
      }

      // Merge token-scoped assets into the business-owned set as a UNION —
      // never an intersection. The business endpoints
      // (/{businessId}/owned_pages, /owned_ad_accounts) already returned
      // everything the business owns, WITH each asset's businessId. The
      // /me/accounts + /me/adaccounts calls respect the OAuth scope and can
      // surface personal assets the business endpoints miss. We keep ALL
      // business-owned assets and only ADD token-scoped assets that aren't
      // already present (deduped by id).
      //
      // Intersecting here was the bug: on the FLFB / system-user token path
      // /me/adaccounts is empty, so `filter(a => tokenIds.has(a.id))` wiped
      // every business-owned account and persisted availableAdAccounts: [].
      try {
        const [tokenPages, tokenAdAccounts] = await Promise.all([
          metaOAuth.getPages(longLivedToken.accessToken),
          metaOAuth.getAdAccounts(longLivedToken.accessToken),
        ]);

        const pageIds = new Set(pages.map((p) => p.id));
        for (const tp of tokenPages) {
          if (!pageIds.has(tp.id)) {
            pageIds.add(tp.id);
            pages.push(tp);
          }
        }

        const adAccountIds = new Set(adAccounts.map((a) => a.id));
        for (const ta of tokenAdAccounts) {
          if (!adAccountIds.has(ta.id)) {
            adAccountIds.add(ta.id);
            adAccounts.push(ta);
          }
        }
      } catch (error) {
        // A token-scoped fetch failure must NOT erase the business-owned
        // assets we already fetched. Log it and proceed with what we have.
        logError('integrations.initiateMetaOAuth.mergeTokenAssets', error, {
          feature: 'integrations',
          extra: {
            organizationId,
            step,
            businessCount: businesses.length,
            businessPages: pages.length,
            businessAdAccounts: adAccounts.length,
          },
        });
      }
    } else {
      // Fallback for personal accounts with no businesses
      // /me/accounts and /me/adaccounts already respect token scope
      [adAccounts, pages] = await Promise.all([
        metaOAuth.getAdAccounts(longLivedToken.accessToken),
        metaOAuth.getPages(longLivedToken.accessToken),
      ]);
    }

    // A partial permission grant (user unticked pages/ad accounts on
    // Facebook's consent screen) comes back as a perfectly valid token with
    // zero usable assets — OAuth "succeeds" but the connect step can never
    // complete, so users loop and eventually cancel with a Permissions
    // error. Make that fingerprint explicit and queryable per org.
    trackOrgEvent(
      organizationId,
      'integrations.meta_ads_connect.assets_granted',
      {
        pages: pages.length,
        adAccounts: adAccounts.length,
        businesses: businesses.length,
        flfb: flfb ?? false,
      }
    );
    if (pages.length === 0 || adAccounts.length === 0) {
      logger.warn('Meta OAuth token granted with missing assets', {
        organizationId,
        pages: pages.length,
        adAccounts: adAccounts.length,
        businesses: businesses.length,
        flfb: flfb ?? false,
      });
    }

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: longLivedToken.accessToken,
      tokenType: longLivedToken.tokenType,
      expiresIn: longLivedToken.expiresIn,
    });

    // Calculate token expiry (long-lived tokens are ~60 days)
    // Default to 60 days if expiresIn is not provided or invalid
    const DEFAULT_EXPIRES_IN_SECONDS = 60 * 24 * 60 * 60; // 60 days
    const parsedExpiresIn = Number(longLivedToken.expiresIn);
    const expiresInSeconds =
      Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0
        ? parsedExpiresIn
        : DEFAULT_EXPIRES_IN_SECONDS;
    // FLFB system-user tokens are non-expiring → store null (no refresh ever
    // needed). Classic long-lived tokens are ~60 days.
    const tokenExpiresAt = flfb
      ? null
      : new Date(Date.now() + expiresInSeconds * 1000);

    // Check if already connected - if so, update to pending_selection
    step = 'upsert_integration';
    // FLFB grants a system-user token covering ALL the business's pages + ad
    // accounts, so there's nothing to single-select — auto-configure and
    // persist every page below instead of dropping into the selection wizard.
    const configurationStatus = flfb
      ? ('configured' as const)
      : ('pending_selection' as const);
    const firstAdAccount = adAccounts[0];
    const existing = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    let integration: MetaAdsIntegration;

    if (existing) {
      // Update existing integration to pending_selection state
      // This allows re-auth flow while preserving the record
      [integration] = await db
        .update(metaAdsIntegration)
        .set({
          connectedById: userId,
          facebookUserName: userInfo.name || null,
          facebookUserEmail: userInfo.email || null,
          facebookUserPictureUrl: userInfo.pictureUrl || null,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          tokenStatus: 'valid',
          configurationStatus,
          connectionMethod: flfb ? ('flfb' as const) : ('classic' as const),
          adAccountId: flfb ? (firstAdAccount?.accountId ?? null) : undefined,
          adAccountName: flfb ? (firstAdAccount?.name ?? null) : undefined,
          availableBusinesses: businesses.length > 0 ? businesses : null,
          availableAdAccounts: adAccounts,
          availablePages: pages,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(metaAdsIntegration.organizationId, organizationId))
        .returning();
    } else {
      // Insert new integration with pending_selection status
      [integration] = await db
        .insert(metaAdsIntegration)
        .values({
          organizationId,
          connectedById: userId,
          facebookUserName: userInfo.name || null,
          facebookUserEmail: userInfo.email || null,
          facebookUserPictureUrl: userInfo.pictureUrl || null,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          configurationStatus,
          connectionMethod: flfb ? ('flfb' as const) : ('classic' as const),
          adAccountId: flfb ? (firstAdAccount?.accountId ?? null) : null,
          adAccountName: flfb ? (firstAdAccount?.name ?? null) : null,
          availableBusinesses: businesses.length > 0 ? businesses : null,
          availableAdAccounts: adAccounts,
          availablePages: pages,
          isActive: true,
        })
        .returning();
    }

    // FLFB auto-configure: persist EVERY page the system-user token can reach
    // (no single-select). Each page captures its linked Instagram account
    // (durable IG on the page token) and is subscribed to lead + messaging
    // webhooks. Chatbots stay off by default (per-page toggle).
    if (flfb) {
      let defaultPageRowId = integration.defaultPageId;
      const subscriptions: Promise<unknown>[] = [];
      const flfbPageRowIds: string[] = [];
      for (const page of pages) {
        const linkedIg = page.instagramBusinessAccount;
        const pageValues = {
          pageName: page.name || null,
          pagePictureUrl: page.pictureUrl || null,
          pageAccessToken: encryptCredentials({
            accessToken: page.accessToken,
          }),
          platform: 'facebook' as const,
          linkedInstagramAccountId: linkedIg?.id ?? null,
          linkedInstagramUsername: linkedIg?.username ?? null,
          linkedInstagramName: linkedIg?.name ?? null,
          defaultAdAccountId: firstAdAccount?.accountId ?? null,
          defaultAdAccountName: firstAdAccount?.name ?? null,
          defaultAdAccountCurrency: firstAdAccount?.currency ?? null,
          isActive: true,
        };
        const existingPage = await db.query.metaAdsPage.findFirst({
          where: (t, { and, eq: eqOp }) =>
            and(
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
        flfbPageRowIds.push(row.id);
        subscriptions.push(
          metaOAuth
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
      // Fire-and-forget: webhook subscriptions are external I/O and must not
      // block the connect response (or hold the request across Meta calls).
      void Promise.allSettled(subscriptions);

      return ok({ integrationId: integration.id, flfbPageRowIds });
    }

    return ok({ integrationId: integration.id });
  } catch (error) {
    logError('integrations.initiateMetaOAuth', error, {
      feature: 'integrations',
      extra: {
        organizationId,
        step,
        flfb,
        providerError: error instanceof Error ? error.message : String(error),
      },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to authenticate with Meta. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred during Meta authentication'
      )
    );
  }
};

/**
 * Initiate Meta OAuth flow - returns session data for wizard steps
 */
export const initiateMetaOAuth = (
  db: DbConnection,
  input: InitiateMetaOAuthInput
) =>
  trackedResult(
    'integrations.initiateMetaOAuth',
    async () => {
      const result = await withOrgScope(
        (tx) => initiateMetaOAuthImpl(tx, input),
        { db }
      );

      // Queue voice ingest for FLfB-persisted pages AFTER the org-scope
      // transaction commits — queueing inside it races the ingest worker
      // against uncommitted meta_ads_page rows. Best-effort: a queue failure
      // must never fail the connect.
      if (result.success && result.data.flfbPageRowIds?.length) {
        await Promise.allSettled(
          result.data.flfbPageRowIds.map((metaAdsPageId) =>
            queueVoiceIngest({
              organizationId: input.organizationId,
              metaAdsPageId,
              triggerReason: 'page_connect',
            })
          )
        );
      }

      return result;
    },
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Complete Meta Ads connection with wizard selections
 */
const connectMetaAdsImpl = async (
  db: DbConnection,
  input: ConnectMetaAdsInput
): Promise<Result<MetaAdsIntegration>> => {
  const parsed = connectMetaAdsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    userId,
    code,
    adAccountId,
    adAccountName,
    pageId,
    pageName,
    platform,
    pixelId,
    pixelName,
  } = parsed.data;

  try {
    const metaOAuth = new MetaOAuthService();

    // Exchange code for token
    const tokenResponse = await metaOAuth.exchangeCodeForToken(code);

    // Get long-lived token
    const longLivedToken = await metaOAuth.exchangeForLongLivedToken(
      tokenResponse.accessToken
    );

    // Fetch user info, ad accounts and pages in parallel to validate selections
    const [userInfoLegacy, adAccounts, pages] = await Promise.all([
      metaOAuth.getUserInfo(longLivedToken.accessToken),
      metaOAuth.getAdAccounts(longLivedToken.accessToken),
      metaOAuth.getPages(longLivedToken.accessToken),
    ]);

    // Validate ad account selection
    const selectedAdAccount = adAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    if (!selectedAdAccount) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Selected ad account is not available. Please reconnect your Meta account.'
        )
      );
    }

    // Validate ad account is in a usable state (status 1 = Active, 9 = Grace Period)
    if (
      selectedAdAccount.accountStatus !== 1 &&
      selectedAdAccount.accountStatus !== 9
    ) {
      const statusMessages: Record<number, string> = {
        2: 'This ad account has been disabled by Meta. Please check your Meta Business Settings.',
        3: 'This ad account has an unpaid balance. Please pay the outstanding balance in Meta Business Settings.',
        7: 'This ad account is under review by Meta. Please wait for the review to complete.',
        100: 'This ad account is being closed.',
        101: 'This ad account has been permanently closed.',
      };
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          statusMessages[selectedAdAccount.accountStatus] ||
            `This ad account is not active (status: ${selectedAdAccount.accountStatus}). Please choose a different account or resolve the issue in Meta Business Settings.`
        )
      );
    }

    // Get page access token
    const selectedPage = pages.find((p: MetaPageInfo) => p.id === pageId);

    if (!selectedPage) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Selected page not found')
      );
    }

    // Capture the page-linked Instagram Business Account so Instagram DMs +
    // publishing can run on the page's (FLfB system-user) token via
    // graph.facebook.com instead of a fragile standalone IG-Login user token.
    const linkedIg = selectedPage.instagramBusinessAccount;
    const linkedInstagramFields = {
      linkedInstagramAccountId: linkedIg?.id ?? null,
      linkedInstagramUsername: linkedIg?.username ?? null,
      linkedInstagramName: linkedIg?.name ?? null,
    };

    // Subscribe page to lead + messaging webhooks. The field list is DERIVED
    // from the webhook registry (every handled event, nothing else) — this used
    // to be a hand-typed 4-field array here and an 8-field array elsewhere.
    await metaOAuth.subscribePageToWebhooks(pageId, selectedPage.accessToken);

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: longLivedToken.accessToken,
      tokenType: longLivedToken.tokenType,
      expiresIn: longLivedToken.expiresIn,
    });

    // Calculate token expiry (long-lived tokens are ~60 days)
    // Default to 60 days if expiresIn is not provided or invalid
    const DEFAULT_EXPIRES_IN_SECONDS = 60 * 24 * 60 * 60; // 60 days
    const parsedExpiresIn = Number(longLivedToken.expiresIn);
    const expiresInSeconds =
      Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0
        ? parsedExpiresIn
        : DEFAULT_EXPIRES_IN_SECONDS;
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Encrypt page access token
    const encryptedPageToken = encryptCredentials({
      accessToken: selectedPage.accessToken,
    });

    // Check if already connected - if so, update
    const existing = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq }) => eq(t.organizationId, organizationId),
    });

    let integration: MetaAdsIntegration;
    let page: MetaAdsPage;

    if (existing) {
      // Update existing integration
      [integration] = await db
        .update(metaAdsIntegration)
        .set({
          connectedById: userId,
          facebookUserName: userInfoLegacy.name || null,
          facebookUserEmail: userInfoLegacy.email || null,
          facebookUserPictureUrl: userInfoLegacy.pictureUrl || null,
          adAccountId,
          adAccountName: adAccountName || null,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          tokenStatus: 'valid',
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(metaAdsIntegration.organizationId, organizationId))
        .returning();

      // Check if page already exists for this integration
      const existingPage = await db.query.metaAdsPage.findFirst({
        where: (t, { and, eq: eqOp }) =>
          and(
            eqOp(t.metaAdsIntegrationId, integration.id),
            eqOp(t.pageId, pageId)
          ),
      });

      if (existingPage) {
        // Update existing page
        [page] = await db
          .update(metaAdsPage)
          .set({
            pageName: pageName || null,
            pagePictureUrl: selectedPage.pictureUrl || null,
            pageAccessToken: encryptedPageToken,
            platform,
            ...linkedInstagramFields,
            pixelId: pixelId || null,
            pixelName: pixelName || null,
            defaultAdAccountId: selectedAdAccount.accountId,
            defaultAdAccountName: selectedAdAccount.name || null,
            defaultAdAccountCurrency: selectedAdAccount.currency || null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(metaAdsPage.id, existingPage.id))
          .returning();
      } else {
        // Create new page
        [page] = await db
          .insert(metaAdsPage)
          .values({
            metaAdsIntegrationId: integration.id,
            pageId,
            pageName: pageName || null,
            pagePictureUrl: selectedPage.pictureUrl || null,
            pageAccessToken: encryptedPageToken,
            platform,
            pixelId: pixelId || null,
            pixelName: pixelName || null,
            defaultAdAccountId: selectedAdAccount.accountId,
            defaultAdAccountName: selectedAdAccount.name || null,
            defaultAdAccountCurrency: selectedAdAccount.currency || null,
            isActive: true,
          })
          .returning();
      }
    } else {
      // Insert new integration
      [integration] = await db
        .insert(metaAdsIntegration)
        .values({
          organizationId,
          connectedById: userId,
          facebookUserName: userInfoLegacy.name || null,
          facebookUserEmail: userInfoLegacy.email || null,
          facebookUserPictureUrl: userInfoLegacy.pictureUrl || null,
          adAccountId,
          adAccountName: adAccountName || null,
          encryptedCredentials: encryptedCreds,
          tokenExpiresAt,
          isActive: true,
        })
        .returning();

      // Create the first page
      [page] = await db
        .insert(metaAdsPage)
        .values({
          metaAdsIntegrationId: integration.id,
          pageId,
          pageName: pageName || null,
          pagePictureUrl: selectedPage.pictureUrl || null,
          pageAccessToken: encryptedPageToken,
          platform,
          ...linkedInstagramFields,
          pixelId: pixelId || null,
          pixelName: pixelName || null,
          defaultAdAccountId: selectedAdAccount.accountId,
          defaultAdAccountName: selectedAdAccount.name || null,
          defaultAdAccountCurrency: selectedAdAccount.currency || null,
          isActive: true,
        })
        .returning();
    }

    // Set as default page if not already set
    if (!integration.defaultPageId) {
      [integration] = await db
        .update(metaAdsIntegration)
        .set({ defaultPageId: page.id })
        .where(eq(metaAdsIntegration.id, integration.id))
        .returning();
    }

    // Queue voice ingest for the connected page (non-blocking)
    try {
      await queueVoiceIngest({
        organizationId,
        metaAdsPageId: page.id,
        triggerReason: 'page_connect',
      });
    } catch {
      // Voice ingest queueing should never block page connection
    }

    return ok(integration);
  } catch (error) {
    logError('integrations.connectMetaAds', error, {
      feature: 'integrations',
      extra: { organizationId, adAccountId, pageId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Meta Ads. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Meta Ads'
      )
    );
  }
};

/**
 * Connect Meta Ads to an organization (wizard completion)
 */
export const connectMetaAds = (db: DbConnection, input: ConnectMetaAdsInput) =>
  trackedResult(
    'integrations.connectMetaAds',
    () => withOrgScope((tx) => connectMetaAdsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type InitiateMetaOAuthResult = Awaited<
  ReturnType<typeof initiateMetaOAuth>
>;
export type ConnectMetaAdsResult = Awaited<ReturnType<typeof connectMetaAds>>;
