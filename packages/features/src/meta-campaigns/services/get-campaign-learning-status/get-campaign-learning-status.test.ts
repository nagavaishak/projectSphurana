import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getCampaignLearningStatus } from './get-campaign-learning-status.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a mock db whose:
 *   - `query.metaCampaignConfig.findFirst` resolves to `config`
 *   - `select().from().where()` resolves to the delivery-aggregate row
 *     (`[{ totalImpressions }]`).
 *
 * `withOrgScope` passes the threaded db straight through to the impl when
 * RLS is disabled (the default under vitest), so we can mock `db` directly.
 */
function makeMockDb(config: unknown, totalImpressions: number) {
  const whereMock = vi.fn().mockResolvedValue([{ totalImpressions }]);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });

  return {
    query: {
      metaCampaignConfig: {
        findFirst: vi.fn().mockResolvedValue(config),
      },
    },
    select: selectMock,
  } as never;
}

const validInput = {
  organizationId: 'org-1',
  metaCampaignId: 'camp-1',
};

describe('getCampaignLearningStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns VALIDATION_ERROR for missing metaCampaignId', async () => {
    const db = makeMockDb(null, 0);
    await expectResult(
      getCampaignLearningStatus(db, {
        organizationId: 'org-1',
        metaCampaignId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the campaign config is missing', async () => {
    const db = makeMockDb(null, 0);
    await expectResult(
      getCampaignLearningStatus(db, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('is NOT in learning phase for a fresh campaign with no delivery', async () => {
    // Created just now, but no impressions recorded.
    const config = {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      createdAt: new Date(),
    };
    const db = makeMockDb(config, 0);

    const result = await getCampaignLearningStatus(db, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasStartedDelivering).toBe(false);
      expect(result.data.isInLearningPhase).toBe(false);
      expect(result.data.daysSinceLaunch).toBe(0);
    }
  });

  it('IS in learning phase for a delivering campaign within 10 days', async () => {
    // Created 3 days ago and has served impressions.
    const config = {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      createdAt: new Date(Date.now() - 3 * MS_PER_DAY),
    };
    const db = makeMockDb(config, 1500);

    const result = await getCampaignLearningStatus(db, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasStartedDelivering).toBe(true);
      expect(result.data.isInLearningPhase).toBe(true);
      expect(result.data.daysSinceLaunch).toBe(3);
    }
  });

  it('is NOT in learning phase for a delivering campaign older than 10 days', async () => {
    // Created 12 days ago, delivering — learning has already exited.
    const config = {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      createdAt: new Date(Date.now() - 12 * MS_PER_DAY),
    };
    const db = makeMockDb(config, 5000);

    const result = await getCampaignLearningStatus(db, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasStartedDelivering).toBe(true);
      expect(result.data.isInLearningPhase).toBe(false);
      expect(result.data.daysSinceLaunch).toBe(12);
    }
  });

  it('treats a null/absent aggregate sum as no delivery', async () => {
    // No insight rows → `sum` is null → coalesced to 0 → not delivering.
    const config = {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      createdAt: new Date(Date.now() - 2 * MS_PER_DAY),
    };
    const db = makeMockDb(config, 0);
    // Simulate `sum(...)` returning null (before coalesce) by overriding the row.
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ totalImpressions: null }]),
      }),
    });

    const result = await getCampaignLearningStatus(db, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasStartedDelivering).toBe(false);
      expect(result.data.isInLearningPhase).toBe(false);
    }
  });
});
