import { metaPendingConnection } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { MetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  type DbConnection,
  type OAuthRedirectResult,
  oauthRedirect,
} from '../../../shared/index.js';
import {
  type RegisterSelfServeMetaConnectionInput,
  registerSelfServeMetaConnectionSchema,
} from './register-self-serve-meta-connection.schema.js';

const logger = createLogger('integrations');

/** Public route — the prospect has no account, so it cannot sit behind auth. */
const DONE_ROUTE = '/connect/meta/done';
const CALLBACK_PATH = '/integrations/meta/self-serve/callback';

/**
 * Complete a Facebook Login for Business handshake that belongs to NO
 * organization yet.
 *
 * This is what makes a shareable Meta onboarding link possible. The in-app
 * popup cannot be it: it returns its code in-page and reads the organization
 * from the session, so it only works for someone who is already a customer,
 * signed in, looking at our app. Here a prospect can authorise during the
 * sales call, before anyone has created their workspace, and an operator
 * attaches the connection afterwards.
 *
 * The token is parked, never used, until that attach happens. Nothing is
 * published, read or subscribed on the strength of a row here.
 */
const registerSelfServeMetaConnectionImpl = async (
  db: DbConnection,
  input: RegisterSelfServeMetaConnectionInput
): Promise<OAuthRedirectResult> => {
  const parsed = registerSelfServeMetaConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return oauthRedirect(DONE_ROUTE, { status: 'error' });
  }

  const apiUrl = apiEnv.API_URL?.replace(/\/+$/, '');
  if (!apiUrl) {
    logError(
      'integrations.registerSelfServeMetaConnection',
      new Error('API_URL unset'),
      { feature: 'integrations' }
    );
    return oauthRedirect(DONE_ROUTE, { status: 'error' });
  }

  const meta = new MetaOAuthService();

  try {
    // Must byte-match the redirect_uri the dialog was built with.
    const token = await meta.exchangeFlfbRedirectCodeForToken(
      parsed.data.code,
      `${apiUrl}${CALLBACK_PATH}`
    );

    // A non-zero expiry means the FLfB configuration is issuing a USER token
    // rather than a system-user one. It would work today and die in ~60 days,
    // which is the exact failure this whole flow exists to avoid — so it is
    // recorded and surfaced rather than quietly accepted.
    const expiresAt =
      token.expiresIn && token.expiresIn > 0
        ? new Date(Date.now() + token.expiresIn * 1000)
        : null;

    const [user, pages, adAccounts, described] = await Promise.all([
      meta.getUserInfo(token.accessToken).catch(() => null),
      meta.getPages(token.accessToken).catch(() => []),
      meta.getAdAccounts(token.accessToken).catch(() => []),
      // The FLfB configuration cannot be read through the Graph API, so the
      // token it produced is the only evidence of what it actually grants.
      meta
        .describeToken(token.accessToken)
        .catch(() => null),
    ]);

    // Discovered up front so an operator can RECOGNISE whose connection this
    // is. The Page name is the identity, which is why this needs no claim
    // code the way an opaque Stripe acct_ id does.
    const [row] = await db
      .insert(metaPendingConnection)
      .values({
        encryptedCredentials: encryptCredentials({
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiresIn: token.expiresIn ?? 0,
        }),
        tokenExpiresAt: expiresAt,
        metaUserName: user?.name ?? null,
        grantedScopes: described?.scopes ?? [],
        availablePages: pages.map((page) => ({
          id: page.id,
          name: page.name,
          category: page.category ?? null,
          businessId: null,
          businessName: null,
          instagramUsername: page.instagramBusinessAccount?.username ?? null,
        })),
        availableAdAccounts: adAccounts.map((account) => ({
          id: account.id,
          name: account.name,
          currency: account.currency ?? null,
        })),
      })
      .returning();

    logger.info('Self-serve Meta connection parked', {
      pendingId: row?.id,
      pages: pages.length,
      neverExpires: expiresAt === null,
    });

    // Only the Page name rides on the URL, so the landing page can say which
    // business was connected. No id, no token: the row is claimed by a
    // platform admin, never by anything the prospect holds.
    return oauthRedirect(DONE_ROUTE, {
      status: 'connected',
      page: pages[0]?.name ?? '',
    });
  } catch (error) {
    logError('integrations.registerSelfServeMetaConnection', error, {
      feature: 'integrations',
    });
    return oauthRedirect(DONE_ROUTE, { status: 'error' });
  }
};

/**
 * Park an org-less Facebook Login for Business connection from a shared link.
 */
export const registerSelfServeMetaConnection = (
  db: DbConnection,
  input: RegisterSelfServeMetaConnectionInput
): Promise<OAuthRedirectResult> =>
  registerSelfServeMetaConnectionImpl(db, input);

export type RegisterSelfServeMetaConnectionResult = Awaited<
  ReturnType<typeof registerSelfServeMetaConnection>
>;
