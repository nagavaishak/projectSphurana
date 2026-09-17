import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isChatbotEnabledForConversation } from './chatbot-enablement.js';

const mockDb = {
  query: {
    metaAdsPage: { findFirst: vi.fn() },
    instagramIntegration: { findFirst: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
  },
};

describe('isChatbotEnabledForConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('Meta Ads pages', () => {
    const conv = {
      metaAdsPageId: 'page-1',
      whatsappAccountId: null,
      platform: 'facebook',
      organizationId: 'org-1',
    };

    it('returns true when isChatbotActive is true', async () => {
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        isChatbotActive: true,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(true);
    });

    it('returns false when isChatbotActive is false', async () => {
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        isChatbotActive: false,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });

    it('returns false when page not found', async () => {
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });
  });

  describe('Standalone Instagram', () => {
    const conv = {
      metaAdsPageId: null,
      whatsappAccountId: null,
      platform: 'instagram_dm',
      organizationId: 'org-1',
    };

    it('returns true when chatbotEnabled is true', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
        chatbotEnabled: true,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(true);
    });

    it('returns false when chatbotEnabled is false', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
        chatbotEnabled: false,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });

    it('returns false when no integration found', async () => {
      mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });
  });

  describe('WhatsApp', () => {
    const conv = {
      metaAdsPageId: null,
      whatsappAccountId: 'wa-1',
      platform: 'whatsapp',
      organizationId: 'org-1',
    };

    it('returns true when isChatbotActive is true', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
        isChatbotActive: true,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(true);
    });

    it('returns false when isChatbotActive is false', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
        isChatbotActive: false,
      });

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });

    it('returns false when account not found', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });
  });

  describe('Unknown platforms', () => {
    it('returns false for unknown platform without metaAdsPageId or whatsappAccountId', async () => {
      const conv = {
        metaAdsPageId: null,
        whatsappAccountId: null,
        platform: 'sms',
        organizationId: 'org-1',
      };

      const result = await isChatbotEnabledForConversation(
        mockDb as never,
        conv
      );

      expect(result).toBe(false);
    });
  });
});
