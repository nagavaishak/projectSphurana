import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { toggleInstagramChatbot } from './toggle-instagram-chatbot.service.js';

describe('toggleInstagramChatbot', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => mockDb._resetMocks());

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: '',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid enabled type', async () => {
    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: 'yes' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when no active Instagram integration exists', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('enables chatbot on active integration', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: false,
    });

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotEnabled).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ chatbotEnabled: true });
  });

  it('disables chatbot on active integration', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: true,
    });

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotEnabled).toBe(false);
    }
    expect(mockDb.set).toHaveBeenCalledWith({ chatbotEnabled: false });
  });

  it('is idempotent — enabling already enabled integration succeeds', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: true,
    });

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotEnabled).toBe(true);
    }
  });

  it('is idempotent — disabling already disabled integration succeeds', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: false,
    });

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotEnabled).toBe(false);
    }
  });

  it('queries only active integrations for the given org', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: true,
    });

    expect(mockDb.query.instagramIntegration.findFirst).toHaveBeenCalledTimes(
      1
    );
  });

  it('updates the correct integration by id', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-99',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: false,
    });

    const result = await toggleInstagramChatbot(mockDb as never, {
      organizationId: 'org-1',
      enabled: true,
    });

    expect(result.success).toBe(true);
    expect(mockDb.where).toHaveBeenCalled();
  });
});
