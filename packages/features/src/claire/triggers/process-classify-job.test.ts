import { logError } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import { ErrorCodes } from '../../shared/index.js';

// Spy the SOURCE module — the `classify-business/index.js` barrel re-exports it
// as a live getter which cannot be redefined. A restored spy is installed at
// run time (load-order independent) and cannot leak across the shared worker
// module graph under `isolate: false`.
import * as classifyBusinessModule from '../services/classify-business/classify-business.service.js';

// `logError` comes from the canonical observability mock (vite.config.ts alias);
// drive it with vi.mocked() rather than a file-local `vi.mock` so it doesn't
// leak across the shared worker graph under `isolate: false`.
const mockLogError = vi.mocked(logError);

import { processClaireClassifyJob } from './process-classify-job.js';

const mockDb = {} as never;

describe('processClaireClassifyJob', () => {
  let mockClassifyBusiness: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClassifyBusiness = (
      vi.spyOn(
        classifyBusinessModule,
        'classifyBusiness'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
  });

  afterEach(() => {
    mockClassifyBusiness.mockRestore();
  });

  it('completes successfully when classifyBusiness succeeds', async () => {
    mockClassifyBusiness.mockResolvedValueOnce({
      success: true,
      data: { id: 'profile-1', classifierVersion: 1 },
    });

    await processClaireClassifyJob(mockDb, {
      organizationId: 'org-1',
      reason: 'services_changed',
    });

    expect(mockClassifyBusiness).toHaveBeenCalledWith(mockDb, {
      organizationId: 'org-1',
      force: false,
      reason: 'services_changed',
    });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('treats NOT_FOUND as a no-op (no Sentry log, no retry)', async () => {
    mockClassifyBusiness.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.NOT_FOUND, message: 'Organization not found' },
    });

    await processClaireClassifyJob(mockDb, {
      organizationId: 'org-deleted',
      reason: 'services_changed',
    });

    // NOT_FOUND should not escalate to Sentry — org was deleted between
    // enqueue and processing.
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('logs other error codes to Sentry', async () => {
    mockClassifyBusiness.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'classifier blew up' },
    });

    await processClaireClassifyJob(mockDb, {
      organizationId: 'org-1',
      reason: 'services_changed',
    });

    expect(mockLogError).toHaveBeenCalledWith(
      'claire.processClassifyJob',
      expect.any(Error),
      expect.objectContaining({ feature: 'claire' })
    );
  });
});
