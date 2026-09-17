import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { analyzeStyle } from '../analyze-style/index.js';
import { embedVoiceExamples } from '../embed-voice-examples/index.js';
import { fetchPageMessages } from '../fetch-page-messages/index.js';
import { filterMessages } from '../filter-messages/index.js';
import {
  type RunVoiceIngestInput,
  runVoiceIngestSchema,
} from './run-voice-ingest.schema.js';

const logger = createLogger('RunVoiceIngest');

const MIN_MESSAGES_FOR_STYLE = 10;
const STYLE_SAMPLE_SIZE = 100;

interface VoiceIngestResult {
  messagesFetched: number;
  messagesEmbedded: number;
  styleProfileGenerated: boolean;
}

const runVoiceIngestImpl = async (
  db: DbConnection,
  input: RunVoiceIngestInput
): Promise<Result<VoiceIngestResult>> => {
  const parsed = runVoiceIngestSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaAdsPageId } = parsed.data;

  // Step 1: Fetch page messages
  logger.info('Step 1: Fetching page messages', {
    organizationId,
    metaAdsPageId,
  });

  const fetchResult = await fetchPageMessages(db, {
    organizationId,
    metaAdsPageId,
  });

  if (!fetchResult.success) {
    return err(
      new FeatureError(fetchResult.error.code, fetchResult.error.message)
    );
  }

  const rawMessages = fetchResult.data;
  logger.info('Fetched raw messages', {
    organizationId,
    count: rawMessages.length,
  });

  // Step 2: Filter messages
  logger.info('Step 2: Filtering messages', { organizationId });

  const filteredMessages = filterMessages(rawMessages);
  logger.info('Filtered messages', {
    organizationId,
    rawCount: rawMessages.length,
    filteredCount: filteredMessages.length,
  });

  if (filteredMessages.length === 0) {
    return ok({
      messagesFetched: rawMessages.length,
      messagesEmbedded: 0,
      styleProfileGenerated: false,
    });
  }

  // Step 3: Analyze style if we have enough messages
  let styleProfileGenerated = false;

  if (filteredMessages.length >= MIN_MESSAGES_FOR_STYLE) {
    logger.info('Step 3: Analyzing communication style', {
      organizationId,
      availableMessages: filteredMessages.length,
    });

    // Sample ~100 diverse messages for style analysis
    // Pick every Nth message, biased toward longer messages
    const sorted = [...filteredMessages].sort(
      (a, b) => b.businessReply.length - a.businessReply.length
    );
    const step = Math.max(1, Math.floor(sorted.length / STYLE_SAMPLE_SIZE));
    const sampled: string[] = [];
    for (
      let i = 0;
      i < sorted.length && sampled.length < STYLE_SAMPLE_SIZE;
      i += step
    ) {
      sampled.push(sorted[i].businessReply);
    }

    const styleResult = await analyzeStyle(db, {
      organizationId,
      messages: sampled,
    });

    if (styleResult.success) {
      styleProfileGenerated = true;
      logger.info('Style analysis completed', {
        organizationId,
        sampledCount: sampled.length,
      });
    } else {
      // Log but don't fail the whole pipeline — embedding is more important
      logger.warn('Style analysis failed, continuing with embedding', {
        organizationId,
        errorCode: styleResult.error.code,
        errorMessage: styleResult.error.message,
      });
    }
  } else {
    logger.info('Step 3: Skipping style analysis (not enough messages)', {
      organizationId,
      filteredCount: filteredMessages.length,
      required: MIN_MESSAGES_FOR_STYLE,
    });
  }

  // Step 4: Embed voice examples
  logger.info('Step 4: Embedding voice examples', {
    organizationId,
    messageCount: filteredMessages.length,
  });

  const embedResult = await embedVoiceExamples(db, {
    organizationId,
    metaAdsPageId,
    messagePairs: filteredMessages,
  });

  if (!embedResult.success) {
    return err(
      new FeatureError(embedResult.error.code, embedResult.error.message)
    );
  }

  logger.info('Voice ingest pipeline completed', {
    organizationId,
    metaAdsPageId,
    messagesFetched: rawMessages.length,
    messagesEmbedded: embedResult.data.embeddedCount,
    styleProfileGenerated,
  });

  return ok({
    messagesFetched: rawMessages.length,
    messagesEmbedded: embedResult.data.embeddedCount,
    styleProfileGenerated,
  });
};

export const runVoiceIngest = (db: DbConnection, input: RunVoiceIngestInput) =>
  trackedResult(
    'voiceCloning.runVoiceIngest',
    () => runVoiceIngestImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaAdsPageId: input.metaAdsPageId,
        triggerReason: input.triggerReason,
      },
    }
  );

export type RunVoiceIngestResult = Awaited<ReturnType<typeof runVoiceIngest>>;
