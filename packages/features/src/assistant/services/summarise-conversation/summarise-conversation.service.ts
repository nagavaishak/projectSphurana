import {
  createAnthropicClient,
  getAnthropicClient,
  isAnthropicClientInitialized,
} from '@borradh-workspace/ai';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { sanitizeField } from '../../prompts/sanitize.js';
import { validateGeneratedCopy } from '../generate-recommendation-payload/d2b-validator.js';
import { getConversation } from '../get-conversation/get-conversation.service.js';
import { writeKnowledgeEntry } from '../write-knowledge-entry/write-knowledge-entry.service.js';
import {
  type SummariseConversationInput,
  type SummariseConversationOutput,
  summariseConversationSchema,
} from './summarise-conversation.schema.js';

/**
 * Sonnet 4.6 — claire.md §2 backend architecture lock for the assistant
 * default model. Summarisation is a small task; Sonnet is overkill on cost
 * but consistent with the rest of the assistant's calls and avoids cross-
 * model variance in the kinds of phrases that the d2b validator trips on.
 */
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 300;
const TEMPERATURE = 0.2;

/**
 * Cap the conversation excerpt sent to the model. Long conversations
 * (50+ tool messages) blow the prompt budget; we keep the most recent
 * 30 messages, which empirically captures the resolution of most threads.
 * Earlier turns get truncated wholesale rather than summarised — a
 * recursive rollup is overkill for v3.
 */
const MAX_MESSAGES = 30;
const MAX_CHARS_PER_MESSAGE = 1000;

/**
 * Don't summarise threads where there's effectively nothing to say.
 * Two messages = one user / one assistant exchange — anything thinner is
 * just a "hi" / "hi back" and burns OpenAI embedding cost for no value.
 */
const MIN_MESSAGES_TO_SUMMARISE = 2;

/**
 * Per-conversation rate limit window — once per hour per conversation.
 * The brief calls this out as a gotcha: every chat turn would otherwise
 * fire the summariser, paying for an Anthropic + OpenAI call each time.
 * Once-per-hour debounces over multi-turn troubleshooting sessions.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_ENTRIES = 1000;

interface RateLimitEntry {
  lastSummarisedAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Test-only helper to clear the in-process rate-limit map. Production code
 * never needs this; tests use it between cases.
 */
export function clearSummariseConversationRateLimit(): void {
  rateLimitMap.clear();
}

function isRateLimited(conversationId: string): boolean {
  const entry = rateLimitMap.get(conversationId);
  if (!entry) return false;
  return Date.now() - entry.lastSummarisedAt < RATE_LIMIT_WINDOW_MS;
}

function recordSummarised(conversationId: string): void {
  if (rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
    // Drop the oldest entry to keep the map bounded — insertion order in
    // a Map gives us a free FIFO without dragging in an LRU lib.
    const oldest = rateLimitMap.keys().next().value;
    if (oldest !== undefined) rateLimitMap.delete(oldest);
  }
  rateLimitMap.set(conversationId, { lastSummarisedAt: Date.now() });
}

const SUMMARY_SYSTEM_PROMPT = `You write a 2-3 sentence summary of an in-app chat between an operator and Claire (an AI assistant for a beauty / aesthetic clinic).

Capture in this order:
1. What the operator wanted (the goal of the conversation)
2. What got done (which tools fired, what they accomplished, or what guidance was given)
3. Any preferences or context the operator expressed that's worth remembering for later (e.g. "we don't run ads on Sundays", "I prefer a softer tone in captions")

Strict rules:
- Output the summary text only. No preamble, no headings, no markdown, no quotes around the text.
- Hard limit: 3 sentences. Brevity is the brand.
- Never include surgical or POM-medication pricing claims, even if the operator mentioned figures.
- Never include POM brand names (Botox, Aqualyx, Juvederm, etc.) — refer to "anti-wrinkle treatments", "fat-dissolving treatments", "dermal fillers" generically.
- Never invent outcome claims (X% improvement, before/after promises). Stick to what happened in the chat.
- If the conversation is small talk or off-topic, output the literal string "SKIP" and nothing else.`;

function buildConversationExcerpt(
  messages: Array<{ role: string; content: string | null }>
): string {
  // Keep the last MAX_MESSAGES; user/assistant only — tool message rows are
  // already represented by their assistant bubbles in this codebase, so we
  // don't duplicate them.
  const filtered = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      m.content &&
      m.content.trim().length > 0
  );
  const tail = filtered.slice(-MAX_MESSAGES);
  return tail
    .map((m) => {
      const role = m.role === 'user' ? 'Operator' : 'Claire';
      const text = (m.content ?? '').slice(0, MAX_CHARS_PER_MESSAGE);
      return `${role}: ${text}`;
    })
    .join('\n\n');
}

/**
 * Filter d2b validator failures down to the two hard-block categories the
 * c13-conversation-summaries brief specifies (`noFabricatedResultClaims` +
 * `noPomBrandNamesInAdCopy`).
 *
 * d2b's full failure set also flags any percent claim, which is too tight
 * for conversation summaries — operators and Claire legitimately discuss
 * "CPL up 40%" in passing and we don't want to drop those summaries. The
 * brief's gotcha "Hard-blocks reject too many legitimate summaries" is
 * what this filter answers: outcome claims + banned phrases ("guaranteed",
 * "proven", "miracle") + POM brand names block the write; bare percent
 * figures don't.
 */
function tripsConversationSummaryHardBlocks(summary: string): boolean {
  const failures = validateGeneratedCopy({ summary });
  return failures.some(
    (f) =>
      f.reason === 'outcome_claim' ||
      f.reason === 'banned_phrase' ||
      f.reason === 'pom_brand'
  );
}

function resolveAnthropicClient(): ReturnType<typeof getAnthropicClient> {
  if (isAnthropicClientInitialized()) {
    return getAnthropicClient();
  }
  return createAnthropicClient();
}

function buildTitle(summary: string): string {
  // Use the first 80 chars of the summary's first sentence as the title.
  // The HNSW index is on the embedding, not the title, so titles are for
  // human readability in the C-14 settings UI — short and stable wins.
  const firstSentence = summary.split(/[.!?]/)[0]?.trim() ?? summary.trim();
  if (firstSentence.length <= 80) return firstSentence;
  return `${firstSentence.slice(0, 77)}...`;
}

const summariseConversationImpl = async (
  db: DbConnection,
  input: SummariseConversationInput
): Promise<Result<SummariseConversationOutput>> => {
  const parsed = summariseConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, organizationId, userId } = parsed.data;

  // Rate-limit FIRST so we don't pay for the conversation read on a
  // throttled call. The brief is explicit: once per hour per conversation.
  if (isRateLimited(conversationId)) {
    return ok({ knowledgeEntryId: null, skipReason: 'rate_limited' });
  }

  // Pull the conversation + its messages. `getConversation` enforces the
  // (orgId, userId) scope at the DB layer, so cross-org / cross-user
  // summarisation is impossible — a mismatched userId returns NOT_FOUND.
  const convResult = await getConversation(db, {
    id: conversationId,
    organizationId,
    userId,
  });
  if (!convResult.success) {
    // NOT_FOUND is fine to bubble up — the caller (controller fire-and-forget)
    // ignores it. Anything else is a real internal error worth tracking.
    // `convResult.error` is the trackedResult ResultShape (flat
    // {code, message, details}); rebuild as a FeatureError so the public
    // surface is uniform.
    return err(
      new FeatureError(
        convResult.error.code,
        convResult.error.message,
        convResult.error.details
      )
    );
  }

  const messages = convResult.data.messages;
  const messageCount = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content
  ).length;
  if (messageCount < MIN_MESSAGES_TO_SUMMARISE) {
    return ok({ knowledgeEntryId: null, skipReason: 'too_few_messages' });
  }

  const excerpt = buildConversationExcerpt(messages);
  const sanitisedExcerpt = sanitizeField(excerpt, 16_000);
  if (!sanitisedExcerpt) {
    return ok({ knowledgeEntryId: null, skipReason: 'too_few_messages' });
  }

  let client: ReturnType<typeof getAnthropicClient>;
  try {
    client = resolveAnthropicClient();
  } catch (error) {
    logError('assistant.summariseConversation.clientUnavailable', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Anthropic client unavailable for conversation summary'
      )
    );
  }

  let summary = '';
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: sanitisedExcerpt }],
    });
    if (Array.isArray(response.content)) {
      const block = response.content.find((b) => b.type === 'text');
      if (block && block.type === 'text') {
        summary = block.text.trim();
      }
    }
  } catch (error) {
    logError('assistant.summariseConversation.anthropic', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to summarise conversation'
      )
    );
  }

  // Empty / SKIP responses are a deliberate model fallback for small talk
  // and off-topic threads. Don't write — but don't error either.
  if (!summary || summary.toUpperCase() === 'SKIP') {
    return ok({ knowledgeEntryId: null, skipReason: 'empty_summary' });
  }

  // Defense-in-depth: model is told not to include claims/brand names, but
  // we still validate before persisting anything.
  if (tripsConversationSummaryHardBlocks(summary)) {
    return ok({ knowledgeEntryId: null, skipReason: 'hard_block_tripped' });
  }

  const writeResult = await writeKnowledgeEntry(db, {
    organizationId,
    userId,
    type: 'conversation_summary',
    title: buildTitle(summary),
    content: summary,
    source: 'auto',
    confidence: 0.8,
    metadata: { sourceConversationId: conversationId },
  });

  if (!writeResult.success) {
    // Rebuild as a FeatureError — see comment on the convResult branch above.
    return err(
      new FeatureError(
        writeResult.error.code,
        writeResult.error.message,
        writeResult.error.details
      )
    );
  }

  // Only record the rate-limit timestamp on a successful write; failures
  // shouldn't lock out the next attempt for an hour.
  recordSummarised(conversationId);

  return ok({ knowledgeEntryId: writeResult.data.knowledgeEntryId });
};

export const summariseConversation = (
  db: DbConnection,
  input: SummariseConversationInput
) =>
  trackedResult(
    'assistant.summariseConversation',
    () => summariseConversationImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type SummariseConversationResult = Awaited<
  ReturnType<typeof summariseConversation>
>;
