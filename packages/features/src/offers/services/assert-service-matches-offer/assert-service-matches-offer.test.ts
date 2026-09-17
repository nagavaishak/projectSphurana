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
import { assertServiceMatchesOffer } from './assert-service-matches-offer.service.js';

describe('assertServiceMatchesOffer', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-1',
    offerId: 'offer-1',
    serviceId: 'service-1',
  };

  it('passes (ok) when the service is linked to the offer', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      offerServices: [{ serviceId: 'service-1' }, { serviceId: 'service-2' }],
    });

    const result = await assertServiceMatchesOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('rejects (VALIDATION_ERROR) when the service is NOT linked to the offer', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      offerServices: [{ serviceId: 'service-2' }, { serviceId: 'service-3' }],
    });

    await expectResult(
      assertServiceMatchesOffer(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('passes (ok) when the offer has no linked service rows', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer-1',
      offerServices: [],
    });

    const result = await assertServiceMatchesOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('passes (ok) when the offer is not found under the org', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(null);

    const result = await assertServiceMatchesOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for missing serviceId', async () => {
    await expectResult(
      assertServiceMatchesOffer(mockDb as never, {
        ...validInput,
        serviceId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
