import type { BusinessProfile } from '@borradh-workspace/database';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// Spy the SOURCE module — the `classify-business/index.js` barrel re-exports it
// as a live getter which cannot be redefined. A restored spy is load-order
// independent and cannot leak across the shared worker graph (`isolate: false`).
import * as classifyBusinessModule from '../classify-business/classify-business.service.js';

import { setAxisOverride } from './set-axis-override.service.js';

const makeProfile = (
  overrides: Partial<BusinessProfile> = {}
): BusinessProfile =>
  ({
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.9,
    axesReasoning: 'mock',
    classifierAxes: null,
    overriddenAxes: null,
    disagreement: null,
    rankedServices: [],
    inputHash: 'h',
    classifiedAt: new Date(),
    classifierVersion: 'aesthetic_clinic@v1',
    verticalMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as BusinessProfile;

const buildMockDb = (params: {
  existingProfile: BusinessProfile | null;
  updatedReturning?: BusinessProfile;
}) => {
  const updateReturning = vi
    .fn()
    .mockResolvedValue(
      params.updatedReturning ? [params.updatedReturning] : []
    );
  return {
    query: {
      businessProfile: {
        findFirst: vi.fn().mockResolvedValue(params.existingProfile),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: updateReturning }),
      }),
    }),
  };
};

describe('setAxisOverride', () => {
  let classifyBusinessMock: MockInstance;

  beforeEach(() => {
    classifyBusinessMock = (
      vi.spyOn(
        classifyBusinessModule,
        'classifyBusiness'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
  });

  afterEach(() => {
    classifyBusinessMock.mockRestore();
  });

  it('returns VALIDATION_ERROR when no axes are provided', async () => {
    const db = buildMockDb({ existingProfile: makeProfile() });
    const result = await setAxisOverride(db as never, {
      organizationId: 'org_1',
      userId: 'user_1',
      axes: {},
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when no profile exists yet', async () => {
    const db = buildMockDb({ existingProfile: null });
    const result = await setAxisOverride(db as never, {
      organizationId: 'org_1',
      userId: 'user_1',
      axes: { retentionModel: 'rebooking' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('writes overriddenAxes and re-runs classifyBusiness with force=true', async () => {
    const existing = makeProfile();
    const updated = makeProfile({
      overriddenAxes: {
        retentionModel: 'rebooking',
        overriddenAt: '2026-05-16T00:00:00.000Z',
        overriddenBy: 'user_1',
      },
    });
    const reclassified = makeProfile({ axesConfidence: 0.85 });
    classifyBusinessMock.mockResolvedValue({
      success: true,
      data: reclassified,
    });

    const db = buildMockDb({
      existingProfile: existing,
      updatedReturning: updated,
    });

    const result = await setAxisOverride(db as never, {
      organizationId: 'org_1',
      userId: 'user_1',
      axes: { retentionModel: 'rebooking' },
    });

    const setCall = (
      db.update as unknown as {
        mock: { results: Array<{ value: { set: ReturnType<typeof vi.fn> } }> };
      }
    ).mock.results[0]?.value.set.mock.calls[0]?.[0];
    expect(setCall.overriddenAxes).toMatchObject({
      retentionModel: 'rebooking',
      overriddenBy: 'user_1',
    });
    expect(setCall.overriddenAxes.overriddenAt).toEqual(expect.any(String));

    expect(classifyBusinessMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        force: true,
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.axesConfidence).toBe(0.85);
    }
  });

  it('merges new overrides on top of existing ones', async () => {
    const existing = makeProfile({
      overriddenAxes: {
        retentionModel: 'rebooking',
        overriddenAt: '2026-05-01T00:00:00.000Z',
        overriddenBy: 'user_old',
      },
    });
    classifyBusinessMock.mockResolvedValue({
      success: true,
      data: makeProfile(),
    });

    const db = buildMockDb({
      existingProfile: existing,
      updatedReturning: existing,
    });

    await setAxisOverride(db as never, {
      organizationId: 'org_1',
      userId: 'user_new',
      axes: { commitmentLevel: 'impulse' },
    });

    const setCall = (
      db.update as unknown as {
        mock: { results: Array<{ value: { set: ReturnType<typeof vi.fn> } }> };
      }
    ).mock.results[0]?.value.set.mock.calls[0]?.[0];
    expect(setCall.overriddenAxes.retentionModel).toBe('rebooking'); // preserved
    expect(setCall.overriddenAxes.commitmentLevel).toBe('impulse'); // new
    expect(setCall.overriddenAxes.overriddenBy).toBe('user_new');
  });
});
