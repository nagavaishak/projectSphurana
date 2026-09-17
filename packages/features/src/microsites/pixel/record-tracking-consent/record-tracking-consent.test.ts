import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { TRACKING_CONSENT_METADATA_KEY } from '../tracking-consent.js';
import { recordTrackingConsent } from './record-tracking-consent.service.js';

const ORG_ID = 'org_123';

describe('recordTrackingConsent', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('merges the decision into existing lead metadata', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      organizationId: ORG_ID,
      metadata: { utm: { source: 'facebook' } },
    });

    const result = await recordTrackingConsent(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_1',
      ads: true,
      region: 'IE',
    });

    expect(result.success).toBe(true);
    const written = mockDb.set.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    // Whatever else the lead carried must survive the write.
    expect(written.metadata.utm).toEqual({ source: 'facebook' });
    expect(written.metadata[TRACKING_CONSENT_METADATA_KEY]).toMatchObject({
      ads: true,
      region: 'IE',
      source: 'banner',
    });
  });

  it('returns NOT_FOUND for a lead in another organization', async () => {
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await recordTrackingConsent(mockDb as never, {
      organizationId: ORG_ID,
      leadId: 'lead_other',
      ads: false,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
