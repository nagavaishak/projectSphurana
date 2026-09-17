import { metaPendingConnection } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * Permissions the product cannot work without, checked against what the FLfB
 * configuration actually granted.
 *
 * Deliberately NO instagram_* scopes. Instagram is a separate product with a
 * separate review: the Login for Business family (`instagram_content_publish`)
 * was refused, while the Instagram Login family
 * (`instagram_business_content_publish`) is approved and is what actually
 * publishes. Listing the refused permission here would report a configuration
 * as broken for something Meta will not grant.
 */
export const REQUIRED_META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_manage_ads',
  'ads_management',
  'ads_read',
  'leads_retrieval',
] as const;

export interface PendingMetaConnection {
  id: string;
  metaUserName: string | null;
  /** Null means the credential never lapses — the expected case. */
  tokenExpiresAt: string | null;
  createdAt: string;
  pages: Array<{
    id: string;
    name: string;
    category: string | null;
    instagramUsername: string | null;
  }>;
  adAccounts: Array<{ id: string; name: string; currency: string | null }>;
  /** Required permissions the configuration did NOT grant. Empty is good. */
  missingScopes: string[];
}

/**
 * Connections authorised through the shareable link that nobody has attached
 * to a workspace yet.
 *
 * Never returns the token — only what an operator needs to RECOGNISE whose
 * connection this is, which is the Page name and who authorised it.
 */
const listPendingMetaConnectionsImpl = async (
  db: DbConnection
): Promise<Result<PendingMetaConnection[]>> => {
  try {
    const rows = await db
      .select({
        id: metaPendingConnection.id,
        metaUserName: metaPendingConnection.metaUserName,
        tokenExpiresAt: metaPendingConnection.tokenExpiresAt,
        createdAt: metaPendingConnection.createdAt,
        availablePages: metaPendingConnection.availablePages,
        availableAdAccounts: metaPendingConnection.availableAdAccounts,
        grantedScopes: metaPendingConnection.grantedScopes,
      })
      .from(metaPendingConnection)
      .where(eq(metaPendingConnection.isClaimed, false))
      .orderBy(desc(metaPendingConnection.createdAt));

    return ok(
      rows.map((row) => ({
        id: row.id,
        metaUserName: row.metaUserName,
        tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        pages: row.availablePages.map((page) => ({
          id: page.id,
          name: page.name,
          category: page.category,
          instagramUsername: page.instagramUsername,
        })),
        adAccounts: row.availableAdAccounts,
        missingScopes: REQUIRED_META_SCOPES.filter(
          (scope) => !row.grantedScopes.includes(scope)
        ),
      }))
    );
  } catch (error) {
    logError('integrations.listPendingMetaConnections', error, {
      feature: 'integrations',
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list pending Meta connections'
      )
    );
  }
};

/** Unclaimed self-serve Meta connections, newest first. */
export const listPendingMetaConnections = (db: DbConnection) =>
  trackedResult(
    'integrations.listPendingMetaConnections',
    () => listPendingMetaConnectionsImpl(db),
    { trackSuccess: false }
  );

export type ListPendingMetaConnectionsResult = Awaited<
  ReturnType<typeof listPendingMetaConnections>
>;
