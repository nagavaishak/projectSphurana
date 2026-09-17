import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type MockDb,
  createMockDb,
} from '../../services/shared/mock-db.test-utils.js';
import {
  ORG_ID,
  OTHER_ORG_ID,
  SITE_ID,
} from '../../services/shared/test-fixtures.test-utils.js';
import { setPrimaryDomain } from './set-primary-domain.service.js';

let db: MockDb;

const base = {
  domainId: 'dom-2',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
};

describe('setPrimaryDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it('clears the old primary and sets the new one in ONE transaction', async () => {
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce({
        id: 'dom-2',
        domain: 'salon.com',
        status: 'active',
        isPrimary: false,
      })
      .mockResolvedValueOnce({ id: 'dom-1', domain: 'old.com' });

    const result = await setPrimaryDomain(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.domain).toBe('salon.com');
    expect(result.data.previousPrimaryDomain).toBe('old.com');

    // Two primaries (or none) would make every booking link ambiguous.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenNthCalledWith(1, { isPrimary: false });
    expect(db.set).toHaveBeenNthCalledWith(2, { isPrimary: true });
  });

  it('refuses to promote a domain that is not live yet', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValueOnce({
      id: 'dom-2',
      domain: 'salon.com',
      status: 'pending_dns',
      isPrimary: false,
    });

    const result = await setPrimaryDomain(db as never, base);

    expect(result.success).toBe(false);
    if (result.success) return;
    // Promoting it would point every booking link at a host with no DNS.
    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(db.set).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a cross-org domain id', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);

    const result = await setPrimaryDomain(db as never, {
      ...base,
      organizationId: OTHER_ORG_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('reports no previous primary on a first promotion', async () => {
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce({
        id: 'dom-2',
        domain: 'salon.com',
        status: 'active',
        isPrimary: false,
      })
      .mockResolvedValueOnce(undefined);

    const result = await setPrimaryDomain(db as never, base);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.previousPrimaryDomain).toBeNull();
  });
});
