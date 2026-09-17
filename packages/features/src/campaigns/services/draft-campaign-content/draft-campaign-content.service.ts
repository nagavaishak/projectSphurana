import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CAMPAIGN_VOICE_RULES } from '../_shared/copy-voice.js';
import {
  type DraftCampaignContentInput,
  type DraftedCampaignContent,
  draftCampaignContentSchema,
} from './draft-campaign-content.schema.js';

const AI_MAX_TOKENS = 500;

function ensureAIClient(): void {
  if (!isAIClientInitialized()) {
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    initAIClient({ apiKey });
  }
}

// Personalisation token the campaign interpolation layer understands. The
// `|there` fallback avoids the dreaded "Hi ," when a recipient has no name.
const MERGE_FIELD = '{{firstName|there}}';

const SYSTEM_PROMPT = `You write short customer messages for a beauty and aesthetics clinic.
Open with a personal greeting using the literal token ${MERGE_FIELD} (keep it exactly, do not replace it with a name).
Use British English. No ALL CAPS. No exaggerated claims.

${CAMPAIGN_VOICE_RULES}

Always reply with a single JSON object and nothing else.`;

interface ChannelSpec {
  /** Extra instructions appended to the user prompt. */
  guidance: string;
  /** Whether the channel expects a subject line. */
  wantsSubject: boolean;
}

const CHANNEL_SPECS: Record<DraftCampaignContentInput['channel'], ChannelSpec> =
  {
    email: {
      wantsSubject: true,
      guidance: `Channel: EMAIL. Return JSON {"subject": string, "body": string}.
Subject: punchy, under 60 characters, no emojis.
Body: 2-4 short paragraphs, include a clear call to action.`,
    },
    sms: {
      wantsSubject: false,
      guidance: `Channel: SMS. Return JSON {"body": string}.
Body must be a single short message UNDER 300 characters including the ${MERGE_FIELD} token. One clear call to action. No subject.`,
    },
    whatsapp: {
      wantsSubject: false,
      guidance: `Channel: WHATSAPP. Return JSON {"body": string}.
Body: 1-3 short conversational sentences with one clear call to action. No subject.`,
    },
  };

const draftCampaignContentImpl = async (
  _db: DbConnection,
  input: DraftCampaignContentInput
): Promise<Result<DraftedCampaignContent>> => {
  const parsed = draftCampaignContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, channel, prompt, businessName } = parsed.data;
  const spec = CHANNEL_SPECS[channel];

  const userPrompt = [
    businessName ? `Business name: ${businessName}` : null,
    `Campaign brief: ${prompt}`,
    spec.guidance,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    ensureAIClient();
    const response = await chatCompletion(userPrompt, {
      maxTokens: AI_MAX_TOKENS,
      systemMessage: SYSTEM_PROMPT,
      jsonResponse: true,
      temperature: 0.7,
    });

    if (!response.content) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to draft content')
      );
    }

    let raw: { subject?: unknown; body?: unknown };
    try {
      raw = JSON.parse(response.content);
    } catch {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to draft content')
      );
    }

    const body = typeof raw.body === 'string' ? raw.body.trim() : '';
    if (!body) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to draft content')
      );
    }

    const draft: DraftedCampaignContent = { body };
    if (spec.wantsSubject) {
      const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
      draft.subject = subject;
    }

    return ok(draft);
  } catch (error) {
    logError('campaigns.draftCampaignContent', error, {
      feature: 'campaigns',
      extra: { organizationId, channel },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to draft campaign content'
      )
    );
  }
};

/**
 * Generate AI campaign copy for a single channel. This is an external LLM
 * call — it intentionally does NOT touch the database, so it must not be
 * wrapped in a transaction. Observability is automatic at the AI client level;
 * `trackedResult` adds the span + error tracking.
 */
export const draftCampaignContent = (
  db: DbConnection,
  input: DraftCampaignContentInput
) =>
  trackedResult(
    'campaigns.draftCampaignContent',
    () => draftCampaignContentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        channel: input.channel,
      },
    }
  );

export type DraftCampaignContentResult = Awaited<
  ReturnType<typeof draftCampaignContent>
>;
