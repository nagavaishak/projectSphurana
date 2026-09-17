import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getPlannableOrganicTemplates } from '../../../videos/templates/index.js';
import {
  type BuildBatchPlanInput,
  type ResolvedBuildBatchPlanInput,
  type Slot,
  buildBatchPlanSchema,
} from './build-batch-plan.schema.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Map of templateId -> default variationId (first variation on the template).
 * Built lazily so this module doesn't have to evaluate at import time.
 */
const buildVariationIdByTemplate = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const template of getPlannableOrganicTemplates()) {
    const first = template.variations[0];
    if (first) {
      map.set(template.id, first.id);
    }
  }
  return map;
};

/**
 * Resolve which calendar day inside the period each slot lands on.
 *
 * For `cadence > 1`: even spread via `floor(i * (periodDays - 1) / (cadence - 1)) + 1`.
 *   - 6/14 → days 1, 3, 6, 8, 11, 14
 *
 * For `cadence === 1`: a single slot lands on day 1 (anchored to startFromDate + 1d).
 */
const computeDayOffsets = (cadence: number, periodDays: number): number[] => {
  if (cadence === 1) return [1];
  const offsets: number[] = [];
  for (let i = 0; i < cadence; i += 1) {
    const offset = Math.floor((i * (periodDays - 1)) / (cadence - 1)) + 1;
    offsets.push(offset);
  }
  return offsets;
};

/**
 * Build a UTC Date for `startFromDate + dayOffset (days) + timeOfDayMinutes`.
 * Anchored to the START-OF-DAY (UTC) of startFromDate so the time-of-day is
 * deterministic regardless of when in the day startFromDate falls.
 */
const buildScheduledAt = (
  startFromDate: Date,
  dayOffset: number,
  timeOfDayMinutes: number
): Date => {
  // Normalize to UTC midnight of startFromDate so two calls on different
  // wall-clock times of the same UTC day produce the same slot times.
  const baseUtcMs = Date.UTC(
    startFromDate.getUTCFullYear(),
    startFromDate.getUTCMonth(),
    startFromDate.getUTCDate()
  );
  const dayMs = baseUtcMs + dayOffset * MS_PER_DAY;
  const totalMs = dayMs + timeOfDayMinutes * 60 * 1000;
  return new Date(totalMs);
};

/**
 * Simple, deterministic string hash (FNV-1a, 32-bit).
 * Used as a tie-breaker when several candidates have identical last-use index.
 */
const hashString = (input: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * Greedy max-gap assignment.
 *
 * For each slot, pick the candidate whose most-recent use is farthest in the
 * past (or never used). Ties broken deterministically by `(slotIndex + hash(candidate)) mod N`.
 * This produces a stable round-robin that also distributes ties across slots.
 *
 * With C candidates and S slots:
 *  - S ≤ C: every candidate used ≤ 1 time.
 *  - S > C: minimum gap between repeats ≈ C slots.
 */
const assignWithMaxGap = (
  candidates: string[],
  slotCount: number
): string[] => {
  const lastUsedAt = new Map<string, number>(); // -1 = never used
  for (const candidate of candidates) {
    lastUsedAt.set(candidate, -1);
  }

  const result: string[] = [];
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    // Find the smallest "last used" index (oldest).
    let bestLastUsed = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const lu = lastUsedAt.get(candidate) ?? -1;
      if (lu < bestLastUsed) bestLastUsed = lu;
    }

    // Collect all candidates tied at that oldest index.
    const tied = candidates.filter(
      (c) => (lastUsedAt.get(c) ?? -1) === bestLastUsed
    );

    // Deterministic tiebreak: pick the candidate whose
    // `(slotIndex + hash(candidate)) mod tied.length` is 0, sorted by hash.
    // Simpler: sort tied by hash deterministically, then index by slotIndex.
    const sorted = [...tied].sort((a, b) => {
      const ha = hashString(a);
      const hb = hashString(b);
      if (ha !== hb) return ha - hb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const pick = sorted[slotIndex % sorted.length];

    result.push(pick);
    lastUsedAt.set(pick, slotIndex);
  }

  return result;
};

const buildBatchPlanImpl = async (
  input: BuildBatchPlanInput
): Promise<Result<Slot[]>> => {
  const parsed = buildBatchPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const resolved: ResolvedBuildBatchPlanInput = parsed.data;
  const {
    cadence,
    periodDays,
    startFromDate,
    timeOfDayMinutes,
    templateIds,
    serviceIds,
  } = resolved;

  if (cadence > periodDays) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Cadence cannot exceed periodDays (one slot per calendar day max)',
        { cadence, periodDays }
      )
    );
  }

  // Resolve variationId per template (first variation). Templates we can't
  // resolve fall back to a synthetic variationId derived from the templateId
  // so the planner stays useful in tests where the templateIds aren't real
  // organic templates.
  const variationIdByTemplate = buildVariationIdByTemplate();
  const resolveVariationId = (templateId: string): string =>
    variationIdByTemplate.get(templateId) ?? `${templateId}-1`;

  const dayOffsets = computeDayOffsets(cadence, periodDays);
  const templateAssignments = assignWithMaxGap(templateIds, cadence);
  const serviceAssignments = assignWithMaxGap(serviceIds, cadence);

  const slots: Slot[] = dayOffsets.map((dayOffset, i) => ({
    scheduledAt: buildScheduledAt(startFromDate, dayOffset, timeOfDayMinutes),
    templateId: templateAssignments[i],
    variationId: resolveVariationId(templateAssignments[i]),
    serviceId: serviceAssignments[i],
  }));

  return ok(slots);
};

/**
 * Lay out a deterministic 2-week schedule of organic posts.
 *
 * Pure function (no DB, no LLM). Errors only on bad input — empty templateIds /
 * serviceIds, `cadence < 1`, or `cadence > periodDays`. Used by
 * `generateMonthlyBatch` to plan slots before the expensive idea + render
 * fan-out, so plan-time failures stay cheap.
 */
export const buildBatchPlan = (input: BuildBatchPlanInput) =>
  trackedResult(
    'contentBatches.buildBatchPlan',
    () => buildBatchPlanImpl(input),
    {
      properties: {
        cadence: input.cadence,
        periodDays: input.periodDays,
        templateCount: input.templateIds?.length,
        serviceCount: input.serviceIds?.length,
      },
    }
  );

export type BuildBatchPlanResult = Awaited<ReturnType<typeof buildBatchPlan>>;
