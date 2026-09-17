import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import {
  type Database,
  and,
  eq,
  isNull,
  video,
} from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import type {
  SynthesisOverridesFrozenScript,
  TemplateDoc,
} from '@borradh-workspace/video-templates';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type OrgContext, getOrgContext } from '../../../shared/org-context.js';
import { getVariationById } from '../../templates/index.js';
import {
  type DiscoveredScriptSlot,
  type ScriptResponse,
  collectRequiredRoles,
  discoverScriptSlots,
  fillScriptSlots,
  flattenScriptForLegacyCompiler,
  scriptResponseSchema,
} from './script-parsing.js';
import { buildRepairMessage, buildScriptPrompt } from './script-prompt.js';
import type { SynthesizeTemplateInput } from './synthesize-template.schema.js';

export interface ResolvedScriptSlot {
  scriptText: string;
  response: ScriptResponse;
  filledDoc: TemplateDoc;
  discoveredSlots: DiscoveredScriptSlot[];
}

export interface ResolveScriptSlotContext {
  seed?: number;
  /**
   * v1→v2 backfill envelope. When set (typically from
   * video.synthesis_overrides on a converted v1 video), the Claude call is
   * skipped and the slot fill uses these role buckets verbatim. Missing roles
   * fall through to whatever the template declares (required roles missing
   * here will fail validation downstream).
   */
  frozenScript?: SynthesisOverridesFrozenScript;
}

export async function resolveScriptSlot(
  db: Database,
  input: SynthesizeTemplateInput,
  templateDoc: TemplateDoc,
  ctx: ResolveScriptSlotContext = {}
): Promise<Result<ResolvedScriptSlot>> {
  const discoveredSlots = discoverScriptSlots(templateDoc);
  const requiredRoles = collectRequiredRoles(discoveredSlots);

  const bodySlot = discoveredSlots.find(
    (s) => s.role === 'body' && s.valueShape === 'string-array'
  );

  const orgContext = await getOrgContext(
    db,
    input.organizationId,
    input.serviceId
  );
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // FAST PATH: frozenScript present (backfilled v1 video re-render). Build a
  // ScriptResponse directly from the frozen role buckets and skip the Claude
  // call entirely. Required-role validation still runs below — a frozen script
  // that's missing a required role surfaces the same VALIDATION_ERROR as a
  // model that returned no value.
  let response: ScriptResponse;
  if (ctx.frozenScript) {
    response = {
      hook: ctx.frozenScript.hook ?? '',
      body: ctx.frozenScript.body ?? [],
      cta: ctx.frozenScript.cta,
      disclaimer: ctx.frozenScript.disclaimer,
    };
  } else {
    const variationMatch = getVariationById(templateDoc.id);
    const scriptTemplate = variationMatch?.variation.scriptTemplate;
    const templateDescription = variationMatch?.variation.description;

    const initResult = ensureAIClient();
    if (!initResult.success) return initResult;

    const responseResult = await callForStructuredScript({
      orgContext,
      templateId: templateDoc.id,
      templateDescription,
      scriptTemplate,
      roles: requiredRoles.map((r) => ({
        role: r.role,
        required: r.required,
        bodyCount: bodySlot?.bodyCount,
        listCount: r.listCount,
      })),
      organizationId: input.organizationId,
      seed: ctx.seed,
    });
    if (!responseResult.success) return responseResult;

    response = responseResult.data;
  }
  const fillResult = fillScriptSlots(templateDoc, response);

  const declaredRequired = new Set(
    requiredRoles.filter((r) => r.required).map((r) => r.role)
  );
  const undeliveredRequired = fillResult.missingRequiredRoles.filter((r) =>
    declaredRequired.has(r)
  );
  if (undeliveredRequired.length > 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `script-text slot needs role(s) ${undeliveredRequired.join(', ')} but model returned no value`,
        { roles: undeliveredRequired }
      )
    );
  }

  const scriptText = flattenScriptForLegacyCompiler(response);

  await persistDraftScript(db, input.videoId, scriptText);

  return ok({
    scriptText,
    response,
    filledDoc: fillResult.filled,
    discoveredSlots,
  });
}

function ensureAIClient(): Result<true> {
  if (isAIClientInitialized()) return ok(true);
  return tryInitAIClient();
}

function tryInitAIClient(): Result<true> {
  try {
    const apiKeyResult = readApiKey();
    if (!apiKeyResult.success) return apiKeyResult;
    initAIClient({ apiKey: apiKeyResult.data });
    return ok(true);
  } catch (error) {
    logError('videos.synthesize.script.initAi', error, { feature: 'videos' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to init AI client')
    );
  }
}

function readApiKey(): Result<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'OpenAI API key not configured'
      )
    );
  }
  return ok(key);
}

interface CallForScriptInput {
  orgContext: OrgContext;
  templateId: string;
  templateDescription?: string;
  scriptTemplate?: string;
  roles: Array<{
    role: 'hook' | 'body' | 'cta' | 'disclaimer' | 'list';
    required: boolean;
    bodyCount?: [number, number];
    listCount?: number;
  }>;
  organizationId: string;
  seed?: number;
}

async function callForStructuredScript(
  input: CallForScriptInput
): Promise<Result<ScriptResponse>> {
  const { systemMessage, userMessage } = buildScriptPrompt({
    orgContext: input.orgContext,
    templateId: input.templateId,
    templateDescription: input.templateDescription,
    scriptTemplate: input.scriptTemplate,
    roles: input.roles,
  });

  const first = await runExtraction(userMessage, systemMessage, input.seed);
  if (first.kind === 'rate-limit') {
    return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
  }
  if (first.kind === 'success') return ok(first.data);

  const repair = buildRepairMessage(first.raw ?? '', first.error);
  const second = await runExtraction(
    repair.userMessage,
    repair.systemMessage,
    input.seed
  );
  if (second.kind === 'rate-limit') {
    return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
  }
  if (second.kind === 'success') return ok(second.data);

  logError(
    'videos.synthesize.script',
    new Error('Script generation failed after repair'),
    {
      feature: 'videos',
      extra: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        firstError: first.error,
        secondError: second.error,
        firstRaw: first.raw,
        secondRaw: second.raw,
      },
    }
  );

  return err(
    new FeatureError(
      ErrorCodes.VALIDATION_ERROR,
      'Generated script did not match required schema after retry'
    )
  );
}

type ExtractionOutcome =
  | { kind: 'success'; data: ScriptResponse }
  | { kind: 'parse-failure'; error: string; raw?: string }
  | { kind: 'rate-limit' };

async function runExtraction(
  userMessage: string,
  systemMessage: string,
  seed?: number
): Promise<ExtractionOutcome> {
  try {
    const result = await extractJson<ScriptResponse>(userMessage, {
      systemMessage,
      schema: scriptResponseSchema,
      temperature: 0.7,
      ...(seed !== undefined && { seed }),
    });

    if (result.success && result.data) {
      return { kind: 'success', data: result.data };
    }

    if (result.error === RATE_LIMIT_MESSAGE) {
      return { kind: 'rate-limit' };
    }

    return {
      kind: 'parse-failure',
      error: result.error ?? 'unknown extraction error',
      raw: result.raw,
    };
  } catch (error) {
    if (isRateLimitError(error)) return { kind: 'rate-limit' };
    return {
      kind: 'parse-failure',
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

async function persistDraftScript(
  db: Database,
  videoId: string,
  scriptText: string
): Promise<void> {
  const existing = await db.query.video.findFirst({
    where: (v, { and, eq, isNull }) =>
      and(eq(v.id, videoId), isNull(v.deletedAt)),
    columns: { draftConfig: true },
  });
  if (!existing?.draftConfig) return;
  const next = { ...existing.draftConfig, scriptText };
  await db
    .update(video)
    .set({ draftConfig: next })
    .where(and(eq(video.id, videoId), isNull(video.deletedAt)));
}
