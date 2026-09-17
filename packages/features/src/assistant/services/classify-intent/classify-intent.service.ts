import { createHash } from 'node:crypto';
import {
  createAnthropicClient,
  getAnthropicClient,
  isAnthropicClientInitialized,
} from '@borradh-workspace/ai';
import {
  logError,
  logWarning,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { sanitizeField } from '../../prompts/sanitize.js';
import {
  SKILL_REGISTRY_VERSION,
  getSkillById,
  skills,
} from '../../skills/index.js';
import {
  type ClassifyIntentInput,
  type ClassifyIntentOutput,
  classifyIntentSchema,
} from './classify-intent.schema.js';

/**
 * Anthropic Haiku 4.5 — D-2 in claire.md §6 resolves to "Haiku 4.5 first;
 * revisit if eval shows accuracy <90%".
 */
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;
const TEMPERATURE = 0;

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

/**
 * Threshold for the per-call latency-breach log. The brief targets 500ms p95;
 * 2× the budget on a single call is a clearer signal than alerting on the
 * 5% of calls that naturally fall above p50. Eval harness (C-04) computes
 * the rolling p95 separately.
 */
const LATENCY_WARN_MS = 1000;

const FALLBACK: ClassifyIntentOutput = { skillIds: ['default'], confidence: 0 };

interface CacheEntry {
  value: ClassifyIntentOutput;
  expiresAt: number;
}

// Insertion-ordered Map → simple LRU eviction. Refresh order on read so the
// hot keys live longest.
const cache = new Map<string, CacheEntry>();

let cachedSkillRegistryDigest: string | null = null;

function computeSkillRegistryDigest(): string {
  if (cachedSkillRegistryDigest) return cachedSkillRegistryDigest;
  const payload = skills.map((s) => [s.id, s.oneLineDescription]);
  const json = JSON.stringify([SKILL_REGISTRY_VERSION, payload]);
  cachedSkillRegistryDigest = createHash('sha256')
    .update(json)
    .digest('hex')
    .slice(0, 16);
  return cachedSkillRegistryDigest;
}

function buildCacheKey(userMessage: string): string {
  const messageDigest = createHash('sha256')
    .update(userMessage.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `${computeSkillRegistryDigest()}:${messageDigest}`;
}

function readCache(key: string): ClassifyIntentOutput | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeCache(key: string, value: ClassifyIntentOutput): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Reset the in-process cache and the cached skill-registry digest.
 *
 * Tests use this between cases. Production code may call this after a hot
 * skill-registry edit during local development; the digest will rebuild on
 * the next call.
 */
export function clearClassifyIntentCache(): void {
  cache.clear();
  cachedSkillRegistryDigest = null;
}

function buildSystemPrompt(): string {
  const lines = skills
    .map((s) => `- ${s.id}: ${s.oneLineDescription}`)
    .join('\n');
  return `You classify the user's first message in a conversation into one or more skill IDs.

Available skills:
${lines}

Return a JSON object with this exact shape:
{"skillIds": ["..."], "confidence": 0.0}

Rules:
- skillIds must be drawn ONLY from the IDs listed above.
- Use ["default"] when the message is small talk, a general question, or you're not confident.
- confidence is a number between 0 and 1.
- Return at most 3 skills, ordered by relevance.
- Output ONLY the JSON object. No prose, no code fences, no commentary.`;
}

function resolveAnthropicClient(): ReturnType<typeof getAnthropicClient> {
  if (isAnthropicClientInitialized()) {
    return getAnthropicClient();
  }
  return createAnthropicClient();
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  // Models sometimes wrap JSON in ```json ... ``` fences despite instructions.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch?.[1] ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normaliseClassification(raw: unknown): ClassifyIntentOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { skillIds?: unknown; confidence?: unknown };

  if (!Array.isArray(obj.skillIds) || obj.skillIds.length === 0) return null;

  // Reject the whole result on any unknown ID — partial filtering would
  // silently drop a skill the user wanted, which is worse than falling back
  // to default and letting the model recover via `load_skill`.
  const cleaned: string[] = [];
  for (const id of obj.skillIds) {
    if (typeof id !== 'string') return null;
    if (!getSkillById(id)) return null;
    cleaned.push(id);
  }

  const conf =
    typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? Math.min(Math.max(obj.confidence, 0), 1)
      : 0.5;

  return { skillIds: cleaned, confidence: conf };
}

const classifyIntentImpl = async (
  input: ClassifyIntentInput
): Promise<Result<ClassifyIntentOutput>> => {
  const parsed = classifyIntentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const sanitized = sanitizeField(parsed.data.userMessage, 4000);
  if (!sanitized) {
    return ok(FALLBACK);
  }

  const cacheKey = buildCacheKey(sanitized);
  const cached = readCache(cacheKey);
  if (cached) return ok(cached);

  let client: ReturnType<typeof getAnthropicClient>;
  try {
    client = resolveAnthropicClient();
  } catch (error) {
    logError('assistant.classifyIntent.clientUnavailable', error, {
      feature: 'assistant',
      extra: { organizationId: parsed.data.organizationId },
    });
    return ok(FALLBACK);
  }

  const startedAt = Date.now();
  let modelText = '';
  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: sanitized }],
    });
    if (Array.isArray(response.content)) {
      const block = response.content.find((b) => b.type === 'text');
      if (block && block.type === 'text') {
        modelText = block.text;
      }
    }
  } catch (error) {
    logError('assistant.classifyIntent.anthropic', error, {
      feature: 'assistant',
      extra: { organizationId: parsed.data.organizationId },
    });
    writeCache(cacheKey, FALLBACK);
    return ok(FALLBACK);
  }

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > LATENCY_WARN_MS) {
    // A budget breach is latency TELEMETRY, not a failure: the classification
    // succeeded and the caller is unaffected. Reported via logError it became
    // ~150 production Sentry "errors" that nobody could action, and — because
    // the elapsed ms is in the message — each distinct duration fingerprinted
    // as its OWN issue, so one slow model spread across dozens of groups.
    // logWarning keeps the signal (still reaches Sentry, at warning level)
    // with a stable message and the duration in structured context.
    logWarning(
      'assistant.classifyIntent.latencyBudgetExceeded',
      `classifyIntent exceeded its ${LATENCY_WARN_MS}ms budget`,
      {
        feature: 'assistant',
        extra: { organizationId: parsed.data.organizationId, elapsedMs },
      }
    );
  }

  const json = extractJsonObject(modelText);
  const normalised = json ? normaliseClassification(json) : null;
  const value = normalised ?? FALLBACK;

  writeCache(cacheKey, value);
  return ok(value);
};

export const classifyIntent = (input: ClassifyIntentInput) =>
  trackedResult('assistant.classifyIntent', () => classifyIntentImpl(input), {
    properties: { organizationId: input.organizationId },
  });

export type ClassifyIntentResult = Awaited<ReturnType<typeof classifyIntent>>;
