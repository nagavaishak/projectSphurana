import { metaAdsPage } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  type ConversationMessagePair,
  MetaMessagingService,
} from '@borradh-workspace/integrations/meta-messaging';
import { MetaApiError } from '@borradh-workspace/integrations/shared';
import {
  createLogger,
  logError,
  trackedResult,
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
import {
  type FetchPageMessagesInput,
  fetchPageMessagesSchema,
} from './fetch-page-messages.schema.js';

const logger = createLogger('FetchPageMessages');

const fetchPageMessagesImpl = async (
  db: DbConnection,
  input: FetchPageMessagesInput
): Promise<Result<ConversationMessagePair[]>> => {
  const parsed = fetchPageMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { metaAdsPageId } = parsed.data;

  // Look up the page record to get the encrypted token
  const page = await db.query.metaAdsPage.findFirst({
    where: eq(metaAdsPage.id, metaAdsPageId),
  });

  if (!page) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Meta Ads page not found')
    );
  }

  if (!page.pageAccessToken) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Page has no access token. Please reconnect your Meta account.'
      )
    );
  }

  // Decrypt the page token
  let pageAccessToken: string;
  try {
    const decrypted = decryptCredentials<{ accessToken: string }>(
      page.pageAccessToken
    );
    pageAccessToken = decrypted.accessToken;
  } catch (error) {
    logError('voiceCloning.fetchPageMessages', error, {
      feature: 'voice-cloning',
      extra: { metaAdsPageId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt page token. Please reconnect your Meta account.'
      )
    );
  }

  // Fetch all conversations via the Meta API
  try {
    const messenger = new MetaMessagingService({
      pageAccessToken,
      pageId: page.pageId,
    });

    const pairs = await messenger.getAllPageConversations({ limit: 1000 });

    logger.info('Fetched page message pairs', {
      metaAdsPageId,
      pairCount: pairs.length,
    });

    return ok(pairs);
  } catch (error) {
    // Expected, org-side Meta states (dead token, blocked recipient, deleted
    // conversation, …) are not our fault. Log at warn and surface a distinct
    // EXTERNAL_SERVICE_ERROR code so the ingest worker can complete the job
    // quietly instead of throwing and paging Sentry. Genuinely unexpected
    // failures (transient/unknown/decrypt) stay INTERNAL_ERROR and page.
    if (error instanceof MetaApiError && error.isExpected) {
      logger.warn('Expected Meta error while fetching page messages', {
        metaAdsPageId,
        pageId: page.pageId,
        metaErrorCode: error.code,
        metaSubcode: error.subcode,
        metaCategory: error.category,
      });
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Expected Meta state while fetching page conversations'
        )
      );
    }
    logError('voiceCloning.fetchPageMessages', error, {
      feature: 'voice-cloning',
      extra: { metaAdsPageId, pageId: page.pageId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch page conversations from Meta'
      )
    );
  }
};

export const fetchPageMessages = (
  db: DbConnection,
  input: FetchPageMessagesInput
) =>
  trackedResult(
    'voiceCloning.fetchPageMessages',
    () => fetchPageMessagesImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaAdsPageId: input.metaAdsPageId,
      },
    }
  );

export type FetchPageMessagesResult = Awaited<
  ReturnType<typeof fetchPageMessages>
>;
