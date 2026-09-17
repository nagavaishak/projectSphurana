import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// `@borradh-workspace/database`, `@borradh-workspace/observability` and
// `drizzle-orm` are aliased to canonical shared mocks in vite.config.ts — never
// vi.mock them here (a file-local mock leaks across files under `isolate:false`).
// Canonical provides `withOrgScope` (passthrough), the real `assistantConversation`
// table object, `trackedResult` (passthrough), `logError` (vi.fn) and real drizzle
// operators.

import { ErrorCodes } from '../../../shared/index.js';
import { getWhatsappConversationTarget } from './get-whatsapp-conversation-target.service.js';

const mockDb = {
  query: { assistantConversation: { findFirst: vi.fn() } },
};

const validInput = { conversationId: 'conv-1', organizationId: 'org-1' };

describe('getWhatsappConversationTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the paired phone + owner when the conversation exists', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      userId: 'user-1',
      whatsappPhoneE164: '353871234567',
    });

    const result = await getWhatsappConversationTarget(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        conversationId: 'conv-1',
        userId: 'user-1',
        phoneE164: '353871234567',
      });
    }
  });

  it('returns phoneE164 null when the link was revoked', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      userId: 'user-1',
      whatsappPhoneE164: null,
    });

    const result = await getWhatsappConversationTarget(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phoneE164).toBeNull();
  });

  it('returns NOT_FOUND when the conversation is missing', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await getWhatsappConversationTarget(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await getWhatsappConversationTarget(mockDb as never, {
      conversationId: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.assistantConversation.findFirst).not.toHaveBeenCalled();
  });
});
