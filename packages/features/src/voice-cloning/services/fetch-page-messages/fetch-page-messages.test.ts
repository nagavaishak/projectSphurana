import { metaAdsPage } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { MetaApiError } from '@borradh-workspace/integrations/shared';
import { logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { fetchPageMessages } from './fetch-page-messages.service.js';

// NOTE: this file deliberately has NO `vi.mock`. Under `isolate: false` the
// worker's module graph is SHARED across test files, so a file-local factory
// persists and poisons every later file that imports the same module. Each of
// the modules below is already canonically handled:
//   - `@borradh-workspace/database`  → src/__mocks__/database.ts (real schema)
//   - `.../integrations/encryption`  → src/__mocks__/integrations-encryption.ts
//   - `.../integrations/meta-messaging` → src/__mocks__/integrations-meta-messaging.ts
//   - `@borradh-workspace/observability` → src/__mocks__/observability.ts
//   - `drizzle-orm` is NOT mocked at all — the REAL operators are used (mocking
//     it stripped `and`/`asc`/`desc`/`sql`/... from the shared graph).
// Drive them with `vi.mocked()` / the exported stable instances instead.

describe('fetchPageMessages', () => {
  const db = {
    query: {
      metaAdsPage: {
        findFirst: vi.fn(),
      },
    },
  };

  const mockGetAllPageConversations = vi.mocked(
    mockMetaMessagingService.getAllPageConversations
  );

  beforeEach(() => {
    // mockReset (not clear) — queued `mock*Once` behaviour must not leak.
    mockGetAllPageConversations.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'page-token',
    });
    db.query.metaAdsPage.findFirst.mockResolvedValue({
      id: 'meta-page-row',
      pageId: 'page-123',
      pageAccessToken: 'encrypted-token',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not send expected Meta user-state errors to Sentry', async () => {
    const expectedMetaError = new MetaApiError({
      error: {
        message: 'This person is not available right now.',
        code: 551,
        error_subcode: 1893047,
      },
    });
    mockGetAllPageConversations.mockRejectedValue(expectedMetaError);

    const result = await fetchPageMessages(db as never, {
      organizationId: 'org-123',
      metaAdsPageId: 'meta-page-row',
    });

    expect(result.success).toBe(false);
    // Classify as EXTERNAL_SERVICE_ERROR so the ingest worker completes the job
    // quietly instead of throwing and paging Sentry (ENG-430).
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
    expect(logError).not.toHaveBeenCalled();
    // Row is looked up by its primary key via the REAL drizzle `eq`.
    expect(db.query.metaAdsPage.findFirst).toHaveBeenCalledWith({
      where: eq(metaAdsPage.id, 'meta-page-row'),
    });
  });

  it('logs and returns INTERNAL_ERROR for unexpected failures', async () => {
    mockGetAllPageConversations.mockRejectedValue(new Error('socket hang up'));

    const result = await fetchPageMessages(db as never, {
      organizationId: 'org-123',
      metaAdsPageId: 'meta-page-row',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    // Genuinely unexpected failures still page Sentry.
    expect(logError).toHaveBeenCalled();
  });
});
