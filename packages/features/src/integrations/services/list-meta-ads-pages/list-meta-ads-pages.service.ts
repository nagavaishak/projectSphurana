import {
  instagramIntegration,
  metaAdsPage,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isInstagramFlfbRoutingEnabled,
  ok,
} from '../../../shared/index.js';
import {
  type ListMetaAdsPagesInput,
  listMetaAdsPagesSchema,
} from './list-meta-ads-pages.schema.js';

/** Prefix for standalone Instagram virtual page IDs */
export const STANDALONE_IG_PREFIX = 'ig-standalone:';

export interface MetaAdsPageInfo {
  id: string;
  pageId: string;
  pageName: string | null;
  platform: 'facebook' | 'instagram';
  pixelId: string | null;
  pixelName: string | null;
  defaultLeadFormId: string | null;
  defaultLeadFormName: string | null;
  linkedInstagramAccountId: string | null;
  linkedInstagramUsername: string | null;
  linkedInstagramName: string | null;
  isChatbotActive: boolean;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
}

/**
 * Internal implementation of list Meta Ads pages
 *
 * Also includes standalone Instagram integration (if active) as a virtual page
 * entry so that all social page selectors can display it alongside Meta pages.
 */
const listMetaAdsPagesImpl = async (
  db: DbConnection,
  input: ListMetaAdsPagesInput
): Promise<Result<MetaAdsPageInfo[]>> => {
  const parsed = listMetaAdsPagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const allPages: MetaAdsPageInfo[] = [];

    // Fetch Meta Ads pages (if integration exists)
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
    });

    if (integration) {
      const pages = await db
        .select({
          id: metaAdsPage.id,
          pageId: metaAdsPage.pageId,
          pageName: metaAdsPage.pageName,
          platform: metaAdsPage.platform,
          pixelId: metaAdsPage.pixelId,
          pixelName: metaAdsPage.pixelName,
          defaultLeadFormId: metaAdsPage.defaultLeadFormId,
          defaultLeadFormName: metaAdsPage.defaultLeadFormName,
          linkedInstagramAccountId: metaAdsPage.linkedInstagramAccountId,
          linkedInstagramUsername: metaAdsPage.linkedInstagramUsername,
          linkedInstagramName: metaAdsPage.linkedInstagramName,
          isChatbotActive: metaAdsPage.isChatbotActive,
          isActive: metaAdsPage.isActive,
          createdAt: metaAdsPage.createdAt,
        })
        .from(metaAdsPage)
        .where(eq(metaAdsPage.metaAdsIntegrationId, integration.id));

      for (const page of pages) {
        allPages.push({
          ...page,
          isDefault: page.id === integration.defaultPageId,
        });
      }
    }

    // Include standalone Instagram integration as a virtual page.
    // Under FLfB routing (flag ON) Instagram runs on the page-linked account,
    // so the virtual entry is suppressed when a connected page already carries
    // that same IG account — otherwise selectors would show it twice. Orgs not
    // yet migrated (flag OFF, or IG not linked to any page) keep the entry.
    const igIntegration = await db.query.instagramIntegration.findFirst({
      where: and(
        eq(instagramIntegration.organizationId, organizationId),
        eq(instagramIntegration.isActive, true)
      ),
    });

    const igCoveredByPage =
      igIntegration?.instagramUserId != null &&
      allPages.some(
        (p) => p.linkedInstagramAccountId === igIntegration.instagramUserId
      ) &&
      (await isInstagramFlfbRoutingEnabled(organizationId));

    if (igIntegration && !igCoveredByPage) {
      allPages.push({
        id: `${STANDALONE_IG_PREFIX}${igIntegration.id}`,
        pageId: igIntegration.instagramUserId || igIntegration.id,
        pageName: igIntegration.name || igIntegration.username || 'Instagram',
        platform: 'instagram',
        pixelId: null,
        pixelName: null,
        defaultLeadFormId: null,
        defaultLeadFormName: null,
        linkedInstagramAccountId: igIntegration.instagramUserId || null,
        linkedInstagramUsername: igIntegration.username || null,
        linkedInstagramName: igIntegration.name || null,
        isChatbotActive: igIntegration.chatbotEnabled,
        isActive: true,
        isDefault: false,
        createdAt: igIntegration.createdAt,
      });
    }

    return ok(allPages);
  } catch (error) {
    logError('integrations.listMetaAdsPages', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list Meta Ads pages'
      )
    );
  }
};

/**
 * List Meta Ads pages for an organization
 */
export const listMetaAdsPages = (
  db: DbConnection,
  input: ListMetaAdsPagesInput
) =>
  trackedResult(
    'integrations.listMetaAdsPages',
    () => withOrgScope((tx) => listMetaAdsPagesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListMetaAdsPagesResult = Awaited<
  ReturnType<typeof listMetaAdsPages>
>;
