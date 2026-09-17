import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getExperimentMetrics } from './get-experiment-metrics.service.js';

/**
 * Regression coverage for `getExperimentMetrics`.
 *
 * Bug families pinned:
 *  - Validation gap: empty `experimentKey` → VALIDATION_ERROR, not an
 *    unhandled throw (schema guard at the top of the service).
 *  - Empty-state / no-data crash: an experiment that exists but has NO
 *    assignments and NO campaigns must yield cohorts with zero counts and a
 *    `bookingRate` of `null` (the div-by-zero guard at
 *    get-experiment-metrics.service.ts:197) — never NaN and never a throw.
 *    It must also NOT issue the conversation/booking count queries when a
 *    variant has no ads (the `variantAdIds.length === 0` short-circuit at
 *    get-experiment-metrics.service.ts:148).
 *  - NOT_FOUND: an unknown experiment key returns NOT_FOUND gracefully
 *    (get-experiment-metrics.service.ts:73).
 */

describe('getExperimentMetrics', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR for an empty experimentKey', async () => {
    await expectResult(
      getExperimentMetrics(mockDb as never, { experimentKey: '' })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
    // Never reaches the experiment lookup.
    expect(mockDb.query.experiment.findFirst).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the experiment does not exist', async () => {
    mockDb.query.experiment.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getExperimentMetrics(mockDb as never, { experimentKey: 'unknown_key' })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('returns zero-count cohorts with bookingRate=null for an experiment with no data', async () => {
    // Experiment exists with two declared variants, but there are no
    // assignments and no campaigns in this org yet — the classic "no data"
    // empty state that used to 500 on aggregate queries.
    mockDb.query.experiment.findFirst.mockResolvedValueOnce({
      id: 'exp-1',
      key: 'pricing_test',
      name: 'Pricing Test',
      status: 'running',
      variants: {
        control: { label: 'Control', weight: 50 },
        treatment: { label: 'Treatment', weight: 50 },
      },
    });
    mockDb.query.experimentAssignment.findMany.mockResolvedValueOnce([]);
    mockDb.query.metaCampaignConfig.findMany.mockResolvedValueOnce([]);

    const result = await getExperimentMetrics(mockDb as never, {
      experimentKey: 'pricing_test',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.experimentId).toBe('exp-1');
    expect(result.data.cohorts).toHaveLength(2);

    for (const cohort of result.data.cohorts) {
      expect(cohort.organizationCount).toBe(0);
      expect(cohort.campaignCount).toBe(0);
      expect(cohort.metaCampaignIds).toEqual([]);
      expect(cohort.conversationCount).toBe(0);
      expect(cohort.bookingCount).toBe(0);
      // Guard at :197 — must be null, never NaN (0 / 0).
      expect(cohort.bookingRate).toBeNull();
      expect(Number.isNaN(cohort.bookingRate as number)).toBe(false);
    }

    // No campaigns → no ad lookup, no per-variant conversation/booking queries.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('uses each declared variant as a cohort even with no assignments', async () => {
    mockDb.query.experiment.findFirst.mockResolvedValueOnce({
      id: 'exp-2',
      key: 'cta_test',
      name: 'CTA Test',
      status: 'running',
      variants: { a: { label: 'A', weight: 100 } },
    });
    mockDb.query.experimentAssignment.findMany.mockResolvedValueOnce([]);
    mockDb.query.metaCampaignConfig.findMany.mockResolvedValueOnce([]);

    const result = await getExperimentMetrics(mockDb as never, {
      experimentKey: 'cta_test',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cohorts.map((c) => c.variant)).toEqual(['a']);
    expect(result.data.cohorts[0].label).toBe('A');
  });
});
