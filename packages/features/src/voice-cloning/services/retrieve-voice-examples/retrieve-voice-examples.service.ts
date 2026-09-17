import { sql } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { generateEmbedding } from '../../../assistant/knowledge/embed.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RetrieveVoiceExamplesInput,
  retrieveVoiceExamplesSchema,
} from './retrieve-voice-examples.schema.js';

export interface VoiceExample {
  customerMessage: string;
  businessReply: string;
  similarity: number;
}

const retrieveVoiceExamplesImpl = async (
  db: DbConnection,
  input: RetrieveVoiceExamplesInput
): Promise<Result<VoiceExample[]>> => {
  const parsed = retrieveVoiceExamplesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, customerMessage, limit } = parsed.data;

  try {
    const queryEmbedding = await generateEmbedding(customerMessage);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const results = await db.execute<{
      customer_message: string;
      business_reply: string;
      similarity: number;
    }>(sql`
      SELECT
        customer_message,
        business_reply,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM voice_embedding
      WHERE organization_id = ${organizationId}
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    return ok(
      results.map((r) => ({
        customerMessage: r.customer_message,
        businessReply: r.business_reply,
        similarity: Number(r.similarity),
      }))
    );
  } catch (error) {
    logError('voiceCloning.retrieveVoiceExamples', error, {
      feature: 'voice-cloning',
      extra: { organizationId, messageLength: customerMessage.length },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve voice examples'
      )
    );
  }
};

export const retrieveVoiceExamples = (
  db: DbConnection,
  input: RetrieveVoiceExamplesInput
) =>
  trackedResult(
    'voiceCloning.retrieveVoiceExamples',
    () => retrieveVoiceExamplesImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type RetrieveVoiceExamplesResult = Awaited<
  ReturnType<typeof retrieveVoiceExamples>
>;
