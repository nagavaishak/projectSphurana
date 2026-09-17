import type {
  BusinessProfile,
  OrganizationService,
} from '@borradh-workspace/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ClassifyResult, VerticalConfig } from '../../verticals/types.js';

// ── Mock the vertical config registry ─────────────────────────────────
const mockClassifyResult: ClassifyResult = {
  effective: {
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
  },
  classifierUnconstrained: {
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    confidence: 0.9,
  },
  confidence: 0.9,
  reasoning: 'mock reasoning',
  verticalMetadata: {},
};

const mockConfig: VerticalConfig = {
  vertical: 'aesthetic_clinic',
  version: 'aesthetic_clinic@v1',
  classify: vi.fn(async () => mockClassifyResult),
  rankServices: vi.fn(() => [
    {
      serviceId: 'svc_1',
      rank: 1,
      score: 0.9,
      criteriaScores: {
        retentionFit: 0.9,
        barrierToEntry: 0.8,
        crossSell: 0.7,
        complianceRisk: 0,
      },
      marketPosition: 'at',
    },
  ]),
  pickOfferStrategy: vi.fn(() => ({
    strategy: 'price_visible_intro',
    suggestedIntroPrice: 100,
    reason: 'mock',
  })),
  renderServiceCopy: vi.fn(async () => ({ title: 'T', body: 'B' })),
  renderOfferCopy: vi.fn(async () => ({ title: 'OT', body: 'OB' })),
  objectionHandlers: {},
};

// `getVerticalConfig` is spied (not `vi.mock`'d) so the REAL registry is
// restored after this file. Under `isolate: false` a file-local `vi.mock` of
// this internal module would persist on the shared worker graph and make every
// later test's `getVerticalConfig` return this `mockConfig` (whose
// `rankServices` returns a fixed `svc_1`), corrupting unrelated ranking tests.
// The spy is restored in afterEach; we keep a handle and call `.mockRestore()`
// on it specifically rather than `vi.restoreAllMocks()`, which would also wipe
// the canonical boundary mocks' default implementations.
// See docs/plans/features-test-suite-speedup.md.
import * as verticalRegistry from '../../verticals/registry.js';

// composeRecommendation is reused as-is (it calls into mockConfig).

import { classifyBusiness } from './classify-business.service.js';

// ── Mock DB ───────────────────────────────────────────────────────────
type FakeProfile = BusinessProfile;
type FakeOrg = {
  id: string;
  name: string;
  chatbotSettings: null;
};

const makeService = (id: string): OrganizationService =>
  ({
    id,
    organizationId: 'org_1',
    name: `Service ${id}`,
    description: null,
    category: 'treatment',
    sortOrder: 0,
    isCustom: false,
    isActive: true,
    requiresDeposit: false,
    depositAmountCents: null,
    depositLink: null,
    stripePaymentLinkId: null,
    stripeProductId: null,
    painPoints: null,
    expectedResults: null,
    processDescription: null,
    targetArea: null,
    pricingDescription: '€100',
    appointmentDuration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as OrganizationService;

const buildMockDb = (params: {
  org: FakeOrg | null;
  services: OrganizationService[];
  existingProfile: FakeProfile | null;
  insertedReturning?: FakeProfile;
  updatedReturning?: FakeProfile;
  /**
   * The row a concurrent writer won the race with. When set, the insert is
   * treated as a no-op conflict and the service's re-read sees this row.
   */
  racedProfile?: FakeProfile;
}) => {
  const insertReturning = vi
    .fn()
    .mockResolvedValue(
      params.insertedReturning ? [params.insertedReturning] : []
    );
  const updateReturning = vi
    .fn()
    .mockResolvedValue(
      params.updatedReturning ? [params.updatedReturning] : []
    );
  // Hoisted so tests can assert on the exact column set written.
  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: updateReturning }),
  });

  return {
    query: {
      organization: { findFirst: vi.fn().mockResolvedValue(params.org) },
      organizationService: {
        findMany: vi.fn().mockResolvedValue(params.services),
      },
      businessProfile: {
        // First call is the pre-write read; when a race is simulated the
        // second call is the service re-reading what the winner wrote.
        findFirst: params.racedProfile
          ? vi
              .fn()
              .mockResolvedValueOnce(params.existingProfile)
              .mockResolvedValue(params.racedProfile)
          : vi.fn().mockResolvedValue(params.existingProfile),
      },
    },
    insert: vi.fn().mockReturnValue({
      // The service inserts with onConflictDoNothing so the losing writer in a
      // concurrent classify re-reads and reconciles instead of raising 23505.
      values: vi.fn().mockReturnValue({
        returning: insertReturning,
        onConflictDoNothing: vi.fn().mockReturnValue({
          // An empty array is what a swallowed conflict returns.
          returning: params.racedProfile
            ? vi.fn().mockResolvedValue([])
            : insertReturning,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: updateSet,
    }),
    _insertReturning: insertReturning,
    _updateReturning: updateReturning,
    _updateSet: updateSet,
  };
};

const makeProfile = (overrides: Partial<FakeProfile> = {}): FakeProfile =>
  ({
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.9,
    axesReasoning: 'mock',
    classifierAxes: {
      retentionModel: 'course_based',
      commitmentLevel: 'planned',
      marketPosition: 'at',
      confidence: 0.9,
      reasoning: 'mock',
    },
    overriddenAxes: null,
    disagreement: null,
    rankedServices: [],
    inputHash: 'stale-hash',
    classifiedAt: new Date(),
    classifierVersion: 'aesthetic_clinic@v1',
    verticalMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as FakeProfile;

describe('classifyBusiness', () => {
  let getVerticalConfigSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy AFTER clearAllMocks so the return value isn't cleared. Restored in
    // afterEach so the real registry is intact for every other test file.
    getVerticalConfigSpy = vi
      .spyOn(verticalRegistry, 'getVerticalConfig')
      .mockReturnValue(mockConfig);
    (mockConfig.classify as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockClassifyResult
    );
  });

  afterEach(() => {
    getVerticalConfigSpy.mockRestore();
  });

  describe('validation', () => {
    it('returns VALIDATION_ERROR for empty organizationId', async () => {
      const db = buildMockDb({
        org: null,
        services: [],
        existingProfile: null,
      });
      const result = await classifyBusiness(db as never, {
        organizationId: '',
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('organization lookup', () => {
    it('returns NOT_FOUND when org does not exist', async () => {
      const db = buildMockDb({
        org: null,
        services: [],
        existingProfile: null,
      });
      const result = await classifyBusiness(db as never, {
        organizationId: 'org_missing',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      }
    });
  });

  describe('first-time classification', () => {
    it('creates a profile row and returns it', async () => {
      const inserted = makeProfile({ inputHash: 'will-overwrite' });
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: null,
        insertedReturning: inserted,
      });

      const result = await classifyBusiness(db as never, {
        organizationId: 'org_1',
      });

      expect(mockConfig.classify).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.update).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('concurrent write race', () => {
    // `existing` is read outside a transaction, so a second run for the same
    // org can land a row in between. Everything this run computed assumed no
    // overrides existed: the classifier ran unconstrained and
    // computeDisagreement(_, null) returned null.
    it("does not clobber the winner's overrides with the unconstrained guess", async () => {
      // The winner persisted an owner override that contradicts the
      // classifier: the classifier says `course_based`, the owner says
      // `one_off`.
      const raced = makeProfile({
        id: 'bp_raced',
        retentionModel: 'one_off',
        overriddenAxes: {
          retentionModel: 'one_off',
        } as FakeProfile['overriddenAxes'],
        inputHash: 'winner-hash',
      });
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: null,
        racedProfile: raced,
        updatedReturning: raced,
      });

      const result = await classifyBusiness(db as never, {
        organizationId: 'org_1',
      });

      expect(result.success).toBe(true);
      expect(db.update).toHaveBeenCalledTimes(1);

      const written = db._updateSet.mock.calls[0][0];

      // The effective axes and the overrides themselves are the winner's to
      // keep — writing ours would leave a row whose axes ignore its overrides.
      expect(written).not.toHaveProperty('retentionModel');
      expect(written).not.toHaveProperty('commitmentLevel');
      expect(written).not.toHaveProperty('marketPosition');
      expect(written).not.toHaveProperty('overriddenAxes');

      // Leaving inputHash stale is what makes this self-healing: the next run
      // fails isUpToDate and recomputes under the real constraints.
      expect(written).not.toHaveProperty('inputHash');

      // The disagreement is recomputed against the overrides we now know
      // about, rather than left as the null we computed without them.
      expect(written.disagreement).not.toBeNull();
      expect(written.disagreement.axes).toEqual(['retentionModel']);
    });

    it('writes the full row when the winner carries no overrides', async () => {
      // No overrides on the winning row means our unconstrained run was the
      // correct computation after all, so nothing needs holding back.
      const raced = makeProfile({ id: 'bp_raced', overriddenAxes: null });
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: null,
        racedProfile: raced,
        updatedReturning: raced,
      });

      const result = await classifyBusiness(db as never, {
        organizationId: 'org_1',
      });

      expect(result.success).toBe(true);
      const written = db._updateSet.mock.calls[0][0];
      expect(written.retentionModel).toBe('course_based');
      expect(written.inputHash).toBeDefined();
    });
  });

  describe('idempotent re-run', () => {
    it('short-circuits when inputHash + classifierVersion match', async () => {
      // First call to compute the hash and grab what would be stored.
      const inserted = makeProfile();
      const db1 = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: null,
        insertedReturning: inserted,
      });
      await classifyBusiness(db1 as never, { organizationId: 'org_1' });
      const usedHash =
        db1.insert.mock.calls[0]?.[0] ??
        db1.insert.mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
      // Pull the actual hash from the insert call argument chain.
      const valuesCall = (
        db1.insert as unknown as {
          mock: {
            results: Array<{ value: { values: ReturnType<typeof vi.fn> } }>;
          };
        }
      ).mock.results[0]?.value.values.mock.calls[0]?.[0];
      const computedHash = valuesCall.inputHash;
      expect(computedHash).toMatch(/^[a-f0-9]{64}$/);

      // Now re-run with an existing profile that has the same hash + version.
      const existing = makeProfile({
        inputHash: computedHash,
        classifierVersion: 'aesthetic_clinic@v1',
      });
      const db2 = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: existing,
      });
      (mockConfig.classify as ReturnType<typeof vi.fn>).mockClear();

      const result = await classifyBusiness(db2 as never, {
        organizationId: 'org_1',
      });

      expect(mockConfig.classify).not.toHaveBeenCalled();
      expect(db2.insert).not.toHaveBeenCalled();
      expect(db2.update).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(existing.id);
      }
      void usedHash;
    });

    it('bypasses short-circuit with force: true', async () => {
      const existing = makeProfile({
        inputHash: 'matches-current-input',
        classifierVersion: 'aesthetic_clinic@v1',
      });
      const updated = makeProfile({ axesConfidence: 0.95 });
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: existing,
        updatedReturning: updated,
      });

      const result = await classifyBusiness(db as never, {
        organizationId: 'org_1',
        force: true,
      });

      expect(mockConfig.classify).toHaveBeenCalledTimes(1);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('disagreement detection', () => {
    it('sets disagreement when classifier disagrees with override at confidence >= 0.80', async () => {
      const existing = makeProfile({
        overriddenAxes: {
          retentionModel: 'rebooking',
          overriddenAt: '2026-01-01T00:00:00.000Z',
          overriddenBy: 'user_1',
        },
      });
      // Classifier says course_based (unconstrained), but override forced rebooking.
      (mockConfig.classify as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        effective: {
          retentionModel: 'rebooking',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        classifierUnconstrained: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
          confidence: 0.9,
        },
        confidence: 0.9,
        reasoning: 'mock',
        verticalMetadata: {},
      });

      const updated = makeProfile();
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: existing,
        updatedReturning: updated,
      });

      await classifyBusiness(db as never, {
        organizationId: 'org_1',
        force: true,
      });

      const updateCall = (
        db.update as unknown as {
          mock: {
            results: Array<{ value: { set: ReturnType<typeof vi.fn> } }>;
          };
        }
      ).mock.results[0]?.value.set.mock.calls[0]?.[0];
      expect(updateCall.disagreement).toEqual({
        axes: ['retentionModel'],
        classifierConfidence: 0.9,
        surfaced: false,
        surfacedAt: null,
        resolution: 'pending',
      });
    });

    it('does NOT set disagreement when confidence < 0.80', async () => {
      const existing = makeProfile({
        overriddenAxes: {
          retentionModel: 'rebooking',
          overriddenAt: '2026-01-01T00:00:00.000Z',
          overriddenBy: 'user_1',
        },
      });
      (mockConfig.classify as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        effective: {
          retentionModel: 'rebooking',
          commitmentLevel: 'planned',
          marketPosition: 'at',
        },
        classifierUnconstrained: {
          retentionModel: 'course_based',
          commitmentLevel: 'planned',
          marketPosition: 'at',
          confidence: 0.6,
        },
        confidence: 0.6,
        reasoning: 'mock',
        verticalMetadata: {},
      });

      const updated = makeProfile();
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: existing,
        updatedReturning: updated,
      });

      await classifyBusiness(db as never, {
        organizationId: 'org_1',
        force: true,
      });

      const updateCall = (
        db.update as unknown as {
          mock: {
            results: Array<{ value: { set: ReturnType<typeof vi.fn> } }>;
          };
        }
      ).mock.results[0]?.value.set.mock.calls[0]?.[0];
      expect(updateCall.disagreement).toBeNull();
    });

    it('does NOT set disagreement when classifier agrees with the override', async () => {
      const existing = makeProfile({
        overriddenAxes: {
          retentionModel: 'course_based',
          overriddenAt: '2026-01-01T00:00:00.000Z',
          overriddenBy: 'user_1',
        },
      });
      // Default mockClassifyResult already says course_based @ 0.9.
      const updated = makeProfile();
      const db = buildMockDb({
        org: { id: 'org_1', name: 'Test Clinic', chatbotSettings: null },
        services: [makeService('svc_1')],
        existingProfile: existing,
        updatedReturning: updated,
      });

      await classifyBusiness(db as never, {
        organizationId: 'org_1',
        force: true,
      });

      const updateCall = (
        db.update as unknown as {
          mock: {
            results: Array<{ value: { set: ReturnType<typeof vi.fn> } }>;
          };
        }
      ).mock.results[0]?.value.set.mock.calls[0]?.[0];
      expect(updateCall.disagreement).toBeNull();
    });
  });
});
