import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import type { ChatbotSettings } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { z } from 'zod';
import type {
  Axes,
  AxisOverrides,
  ClassifierUnconstrainedAxes,
  ClassifyInput,
  ClassifyResult,
} from '../types.js';
import { taxonomiseService } from './service-taxonomy.js';

const logger = createLogger('AestheticClinicClassify');

const RETENTION_VALUES = [
  'course_based',
  'rebooking',
  'consideration_sale',
] as const;
const COMMITMENT_VALUES = ['impulse', 'planned', 'major'] as const;
const MARKET_VALUES = ['below', 'at', 'above', 'unknown'] as const;

const axesSchema = z.object({
  retentionModel: z.enum(RETENTION_VALUES),
  commitmentLevel: z.enum(COMMITMENT_VALUES),
  marketPosition: z.enum(MARKET_VALUES),
});

const classifierResponseSchema = z.object({
  effective: axesSchema,
  classifierUnconstrained: axesSchema.extend({
    confidence: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(800),
  verticalMetadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const MAX_TOKENS = 600;
const MAX_ATTEMPTS = 2;
// A classify job also runs service selection. Keep each provider request
// bounded so the two phase-level retries complete inside the worker's 120s
// renewable lock budget instead of layering the OpenAI SDK's 3×60s retries on
// top of this module's own fallback loop.
const REQUEST_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You classify aesthetic clinics for advertising decisions.

You emit one JSON object with three axes — \`retentionModel\`, \`commitmentLevel\`, \`marketPosition\` — plus an unconstrained classifier opinion, a confidence score, and short reasoning.

Axis definitions:

RETENTION MODEL — how often clients come back.
- course_based: 3+ session courses (microneedling, peels, skin boosters, laser).
- rebooking: single treatment with a scheduled return (filler, anti-wrinkle, profhilo).
- consideration_sale: high-ticket, infrequent (surgery, major procedures).

COMMITMENT LEVEL — decision weight for a first booking.
- impulse: booked in one scroll (facials, brows, lashes, head spa).
- planned: researched and scheduled (injectables, microneedling, body contouring).
- major: multi-step, consultation expected (surgery, surgical procedures).

MARKET POSITION — pricing vs local competitors.
- below | at | above | unknown.

If the owner has supplied overrides (constraints), evaluate them as soft constraints. Emit BOTH:
- \`effective\` — the answer that respects the constraints,
- \`classifierUnconstrained\` — your best guess if you ignored the constraints, with its own confidence.

If they differ AND your unconstrained confidence is high (≥ 0.80), the engine will treat that as a disagreement signal — so be honest, don't smooth it over.

\`verticalMetadata\` is for niche-specific flags that downstream code uses. For aesthetic clinics include any of:
- \`ownerQualification\`: free-text label (e.g. "nurse prescriber", "beauty therapist", "doctor", "surgeon", "aesthetician").
- \`isPrescriber\`: boolean — whether the owner can prescribe POMs.
- \`hasInjectables\`: boolean — menu includes any injectable treatment.
- \`hasBodyContouring\`: boolean — menu includes fat-dissolving / cavitation / RF / cryolipolysis / EMS.
- \`hasSurgical\`: boolean — menu includes any surgical procedure.

Output JSON only. No prose outside the JSON.`;

const buildUserPrompt = (input: ClassifyInput): string => {
  const services = input.services.slice(0, 30).map((s) => {
    const price = s.priceText ?? '—';
    return `- ${s.name} (${s.category}; price: ${price})`;
  });
  const servicesBlock = services.length
    ? services.join('\n')
    : 'No services imported yet.';

  const owner = renderOwnerSignals(input.chatbotSettings);
  const selfReport = renderSelfReport(input);
  const constraints = renderConstraints(input.constraints);

  return `Clinic: ${input.organizationName}.

Services:
${servicesBlock}

Owner signals:
${owner}

Owner self-report:
${selfReport}

Owner overrides (soft constraints):
${constraints}

Return a single JSON object matching the schema documented in the system prompt.`;
};

const renderOwnerSignals = (settings: ChatbotSettings | null): string => {
  if (!settings) return '- (no chatbot settings available)';
  const lines: string[] = [];
  if (settings.ownerName) lines.push(`- Name: ${settings.ownerName}`);
  if (settings.ownerCredentials)
    lines.push(`- Credentials: ${settings.ownerCredentials}`);
  if (settings.ownerAwards) lines.push(`- Awards: ${settings.ownerAwards}`);
  if (settings.differentiators) {
    const diffs = JSON.stringify(settings.differentiators);
    if (diffs && diffs !== '{}') lines.push(`- Differentiators: ${diffs}`);
  }
  return lines.length ? lines.join('\n') : '- (no owner-level signals)';
};

const renderSelfReport = (input: ClassifyInput): string => {
  const parts: string[] = [];
  if (input.ownerSelfReport?.vertical)
    parts.push(`- vertical: ${input.ownerSelfReport.vertical}`);
  if (input.ownerSelfReport?.marketPosition)
    parts.push(`- marketPosition: ${input.ownerSelfReport.marketPosition}`);
  return parts.length ? parts.join('\n') : '- (no self-report)';
};

const renderConstraints = (constraints: AxisOverrides | undefined): string => {
  if (!constraints) return '- (no overrides)';
  const parts: string[] = [];
  if (constraints.retentionModel)
    parts.push(`- retentionModel: ${constraints.retentionModel}`);
  if (constraints.commitmentLevel)
    parts.push(`- commitmentLevel: ${constraints.commitmentLevel}`);
  if (constraints.marketPosition)
    parts.push(`- marketPosition: ${constraints.marketPosition}`);
  return parts.length ? parts.join('\n') : '- (no overrides)';
};

// ============================================================================
// Heuristic fallback — used when LLM is unavailable or its output fails the
// schema. Encodes the 5-clinic-type → 3-axis mapping from the spec.
// ============================================================================

type ServiceFlags = {
  hasSurgical: boolean;
  hasInjectables: boolean;
  hasBodyContouring: boolean;
  courseBasedCount: number;
  impulseCount: number;
  hasBeautyTherapistServices: boolean;
};

const summariseServices = (input: ClassifyInput): ServiceFlags => {
  let hasSurgical = false;
  let hasInjectables = false;
  let hasBodyContouring = false;
  let courseBasedCount = 0;
  let impulseCount = 0;
  let hasBeautyTherapistServices = false;

  for (const s of input.services) {
    const entry = taxonomiseService(s);
    if (entry.isSurgical) hasSurgical = true;
    if (entry.canonical === 'filler' || entry.canonical === 'anti_wrinkle')
      hasInjectables = true;
    if (
      [
        'fat_dissolving',
        'cavitation',
        'rf_skin_tightening',
        'cryolipolysis',
        'ems_body',
      ].includes(entry.canonical)
    )
      hasBodyContouring = true;
    if (entry.cadence === 'course_based') courseBasedCount += 1;
    if (entry.cadence === 'impulse') {
      impulseCount += 1;
      hasBeautyTherapistServices = true;
    }
  }

  return {
    hasSurgical,
    hasInjectables,
    hasBodyContouring,
    courseBasedCount,
    impulseCount,
    hasBeautyTherapistServices,
  };
};

const inferOwnerQualification = (
  credentials: string | undefined
): { ownerQualification: string | null; isPrescriber: boolean } => {
  if (!credentials) return { ownerQualification: null, isPrescriber: false };
  const lower = credentials.toLowerCase();
  if (lower.includes('surgeon'))
    return { ownerQualification: 'surgeon', isPrescriber: true };
  if (
    lower.includes('doctor') ||
    lower.includes('dr.') ||
    lower.includes(' md')
  )
    return { ownerQualification: 'doctor', isPrescriber: true };
  if (
    lower.includes('nurse prescriber') ||
    lower.includes('non-medical prescriber') ||
    lower.includes('independent prescriber')
  )
    return { ownerQualification: 'nurse_prescriber', isPrescriber: true };
  if (lower.includes('nurse') || lower.includes('rn'))
    return { ownerQualification: 'nurse', isPrescriber: false };
  if (
    lower.includes('beauty therapist') ||
    lower.includes('aesthetician') ||
    lower.includes('cidesco')
  )
    return { ownerQualification: 'beauty_therapist', isPrescriber: false };
  return { ownerQualification: 'aesthetician', isPrescriber: false };
};

export const heuristicClassify = (input: ClassifyInput): ClassifyResult => {
  const flags = summariseServices(input);
  const ownerSig = inferOwnerQualification(
    input.chatbotSettings?.ownerCredentials
  );

  let retentionModel: Axes['retentionModel'] = 'course_based';
  let commitmentLevel: Axes['commitmentLevel'] = 'planned';

  if (flags.hasSurgical || ownerSig.ownerQualification === 'surgeon') {
    retentionModel = 'consideration_sale';
    commitmentLevel = 'major';
  } else if (
    flags.hasBeautyTherapistServices &&
    !flags.hasInjectables &&
    !flags.hasSurgical
  ) {
    retentionModel = 'course_based';
    commitmentLevel = 'impulse';
  } else if (flags.hasBodyContouring && !flags.hasInjectables) {
    retentionModel = 'course_based';
    commitmentLevel = 'planned';
  } else if (flags.hasInjectables && flags.courseBasedCount >= 3) {
    retentionModel = 'course_based';
    commitmentLevel = 'planned';
  } else if (flags.hasInjectables) {
    retentionModel = 'rebooking';
    commitmentLevel = 'planned';
  }

  const marketPosition = input.ownerSelfReport?.marketPosition ?? 'unknown';

  const unconstrained: ClassifierUnconstrainedAxes = {
    retentionModel,
    commitmentLevel,
    marketPosition,
    confidence: 0.4,
  };

  const effective = applyConstraints(unconstrained, input.constraints);

  return {
    effective,
    classifierUnconstrained: unconstrained,
    confidence: 0.4,
    reasoning:
      'Heuristic fallback — LLM unavailable or output failed validation. Derived from menu composition and owner credentials.',
    verticalMetadata: {
      ownerQualification: ownerSig.ownerQualification,
      isPrescriber: ownerSig.isPrescriber,
      hasInjectables: flags.hasInjectables,
      hasBodyContouring: flags.hasBodyContouring,
      hasSurgical: flags.hasSurgical,
      source: 'heuristic_fallback',
    },
  };
};

const applyConstraints = (
  base: Axes,
  constraints: AxisOverrides | undefined
): Axes => ({
  retentionModel: constraints?.retentionModel ?? base.retentionModel,
  commitmentLevel: constraints?.commitmentLevel ?? base.commitmentLevel,
  marketPosition: constraints?.marketPosition ?? base.marketPosition,
});

// ============================================================================
// LLM path
// ============================================================================

const ensureClientInitialised = (): boolean => {
  if (isAIClientInitialized()) return true;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;
  initAIClient({ apiKey });
  return true;
};

export const classify = async (
  input: ClassifyInput
): Promise<ClassifyResult> => {
  if (!ensureClientInitialised()) {
    logger.warn('OPENAI_API_KEY not set; using heuristic classifier fallback');
    return heuristicClassify(input);
  }

  const userPrompt = buildUserPrompt(input);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        systemMessage: SYSTEM_PROMPT,
        jsonResponse: true,
        timeoutMs: REQUEST_TIMEOUT_MS,
        // This loop owns retry and fallback policy. SDK retries here can make
        // one phase run for minutes, exceeding the worker's job budget.
        maxRetries: 0,
      });

      if (!response.content) {
        logger.warn('Classifier LLM returned empty content', { attempt });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(response.content);
      } catch {
        logger.warn('Classifier LLM returned non-JSON', { attempt });
        continue;
      }

      const parsed = classifierResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn('Classifier output failed schema check', {
          attempt,
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        });
        continue;
      }

      // Caller-supplied constraints are sacred — re-apply over the LLM's
      // `effective` block so the engine never silently drops them.
      const effective = applyConstraints(
        parsed.data.effective,
        input.constraints
      );

      return {
        effective,
        classifierUnconstrained: parsed.data.classifierUnconstrained,
        confidence: parsed.data.confidence,
        reasoning: parsed.data.reasoning,
        verticalMetadata: parsed.data.verticalMetadata ?? {},
      };
    } catch (error) {
      logger.warn('Classifier LLM call threw', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn('Classifier LLM exhausted retries; using heuristic fallback');
  return heuristicClassify(input);
};
