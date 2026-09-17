import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { buildBrandCorpus } from './build-brand-corpus.service.js';

describe('buildBrandCorpus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      buildBrandCorpus(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('propagates FORBIDDEN when the org has no connected sources', async () => {
    // fetchPageMedia resolves no FB + no IG → FORBIDDEN, which build surfaces.
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      buildBrandCorpus(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
    // No vision/describe calls should have fired.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
