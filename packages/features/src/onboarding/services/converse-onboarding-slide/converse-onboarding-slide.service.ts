import { extractJson } from '@borradh-workspace/ai';
import { onboardingSession } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type AssistantContext,
  getAssistantContext,
} from '../../../assistant/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type OnboardingConversationTurn,
  type OnboardingSlideResponse,
  onboardingSlideResponseSchema,
} from '../../models/index.js';
import { ensureAiClient } from '../_shared/ensure-ai-client.js';
import {
  type ConversationalSlide,
  type ConverseOnboardingSlideInput,
  type ConverseOnboardingSlideOutput,
  converseOnboardingSlideSchema,
} from './converse-onboarding-slide.schema.js';

/**
 * Safe slide returned when the AI round-trip fails (parse/validation error).
 * The user is asked to retry instead of surfacing an error state — the slide
 * deck must never dead-end on a flaky completion.
 */
const FALLBACK_SLIDE: OnboardingSlideResponse = {
  headline: "Sorry, let's try that again",
  description: "I didn't quite catch that — tell me again in a few words.",
  options: [{ label: 'OK', value: 'ok' }],
  input: 'text',
};

/** What Claire is trying to achieve on each conversational slide. */
const SLIDE_GOALS: Record<ConversationalSlide, string> = {
  campaign_pitch:
    'You and the business owner are agreeing WHICH of their services to ' +
    'advertise in their very first campaign. Steer towards one concrete ' +
    'service; the options you return should move the decision forward ' +
    '(e.g. accept a service, pick a different one, ask about pricing).',
  intro_offer:
    'You and the business owner are adjusting the new-client INTRO OFFER ' +
    '(a get-in-the-door, first-visit-only price) for the service they ' +
    'chose to advertise. Steer towards a final price the owner is happy ' +
    "with; when a number is being negotiated, set input to 'price'.",
};

const buildSystemMessage = (
  slide: ConversationalSlide,
  context: AssistantContext,
  priorTurns: OnboardingConversationTurn[]
): string => {
  const services =
    context.services.length > 0 ? context.services.join(', ') : 'none listed';
  const brandVoice =
    context.brandVoice.length > 0 ? context.brandVoice.join(', ') : 'neutral';

  const priorLines =
    priorTurns.length > 0
      ? priorTurns
          .map(
            (turn) =>
              `Owner: ${turn.userText}\nClaire (headline): ${turn.response.headline}`
          )
          .join('\n')
      : '(none yet)';

  return [
    'You are Claire, the marketing assistant guiding a business owner through onboarding.',
    'The onboarding is a Typeform-style slide deck: every reply you give is rendered as a SLIDE, never as chat prose.',
    '',
    'Business context:',
    `- Name: ${context.name}`,
    `- Type: ${context.businessTypeLabel}`,
    `- Services: ${services}`,
    `- Brand voice: ${brandVoice}`,
    ...(context.targetAudienceDescription
      ? [`- Target audience: ${context.targetAudienceDescription}`]
      : []),
    '',
    `Current slide goal (${slide}):`,
    SLIDE_GOALS[slide],
    '',
    'Conversation so far on this slide:',
    priorLines,
    '',
    'The owner just typed the message given as the user prompt. Respond with ONLY a JSON object of this exact shape:',
    '{ "headline": string (you talking, short and warm), "description": string (optional, muted supporting line), "options": [{ "label": string, "value": string }] (1 to 4 tappable choices), "input": "text" | "price" | null (an inline input when free text or a price is needed, else null) }',
    'NEVER respond with free-form prose, markdown, or anything outside that JSON object.',
  ].join('\n');
};

const converseOnboardingSlideImpl = async (
  db: DbConnection,
  input: ConverseOnboardingSlideInput
): Promise<Result<ConverseOnboardingSlideOutput>> => {
  const parsed = converseOnboardingSlideSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, slide, userText } = parsed.data;

  try {
    const session = await db.query.onboardingSession.findFirst({
      where: eq(onboardingSession.userId, userId),
    });
    if (!session) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
      );
    }
    if (!session.organizationId) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Organization not created yet — complete the website analysis step first'
        )
      );
    }

    const contextResult = await getAssistantContext(db, {
      organizationId: session.organizationId,
    });
    if (!contextResult.success) {
      // `getAssistantContext` is trackedResult-wrapped, so its error is the
      // structural `{ code, message, details }` shape — re-wrap.
      return err(
        new FeatureError(
          contextResult.error.code,
          contextResult.error.message,
          contextResult.error.details
        )
      );
    }

    const priorTurns = (session.conversationTurns ?? []).filter(
      (turn) => turn.slide === slide
    );

    // extractJson throws if the AI client was never initialised (no
    // OPENAI_API_KEY) — init it here, and treat "can't init" as a parse
    // failure so the deck falls back instead of erroring.
    const extraction = ensureAiClient()
      ? await extractJson<OnboardingSlideResponse>(userText, {
          systemMessage: buildSystemMessage(
            slide,
            contextResult.data,
            priorTurns
          ),
          schema: onboardingSlideResponseSchema,
        })
      : ({ success: false, data: null } as const);

    // A parse/validation failure (or no AI client) falls back to the safe
    // retry slide rather than erroring the deck.
    const fallback = !(extraction.success && extraction.data);
    const response: OnboardingSlideResponse = fallback
      ? FALLBACK_SLIDE
      : (extraction.data as OnboardingSlideResponse);

    const turn: OnboardingConversationTurn = {
      slide,
      userText,
      response,
      at: new Date().toISOString(),
    };
    await db
      .update(onboardingSession)
      .set({ conversationTurns: [...(session.conversationTurns ?? []), turn] })
      .where(eq(onboardingSession.id, session.id));

    return ok({ slide, response, fallback });
  } catch (error) {
    logError('onboarding.converseOnboardingSlide', error, {
      feature: 'onboarding',
      extra: { userId, slide },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to process the slide conversation'
      )
    );
  }
};

export const converseOnboardingSlide = (
  db: DbConnection,
  input: ConverseOnboardingSlideInput
) =>
  trackedResult(
    'onboarding.converseOnboardingSlide',
    () => converseOnboardingSlideImpl(db, input),
    {
      properties: { userId: input.userId, slide: input.slide },
      internalErrorsOnly: true,
    }
  );

export type ConverseOnboardingSlideResult = Awaited<
  ReturnType<typeof converseOnboardingSlide>
>;
