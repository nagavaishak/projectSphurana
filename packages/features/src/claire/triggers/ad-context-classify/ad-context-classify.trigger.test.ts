import { logError } from '@borradh-workspace/observability';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
// `mockQueue` is the stable shared object returned by every `new Queue(...)`
// from the canonical bullmq mock (aliased in vite.config.ts).
import { mockQueue } from '../../../__mocks__/bullmq.js';
import { triggerAdContextClassify } from './ad-context-classify.trigger.js';

const mockLogError = vi.mocked(logError);

describe('triggerAdContextClassify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues an immediate manual classify job with a stable per-org jobId', async () => {
    mockQueue.add.mockResolvedValueOnce({ id: 'job-1' });

    await triggerAdContextClassify('org-1');

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = mockQueue.add.mock.calls[0];
    expect(name).toBe('manual');
    expect(payload).toEqual({ organizationId: 'org-1', reason: 'manual' });
    // Stable jobId so a burst of widget reads collapses into one queued run,
    // and no `delay` so the recommendation surfaces without the debounce wait.
    expect(opts).toEqual({ jobId: 'claire-classify-org-1' });
  });

  it('swallows enqueue errors and logs them (read path must not 500)', async () => {
    mockQueue.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(triggerAdContextClassify('org-1')).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(
      'claire.triggerAdContextClassify',
      expect.any(Error),
      expect.objectContaining({ extra: { organizationId: 'org-1' } })
    );
  });
});
