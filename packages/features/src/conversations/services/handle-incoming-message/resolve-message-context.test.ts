import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import {
  resolveInstagramContext,
  resolveMessengerContext,
  resolveSmsContext,
  resolveWhatsAppChatbot,
} from './resolve-message-context.js';

const mockDb = {
  query: {
    instagramIntegration: { findFirst: vi.fn() },
    metaAdsPage: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
  },
};

describe('resolveInstagramContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns context when integration found with chatbot enabled', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      instagramUserId: 'ig-page-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: true,
      encryptedCredentials: 'encrypted-token',
      name: 'My IG Page',
      username: 'myigpage',
      profilePictureUrl: 'https://pic.url',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });

    const result = await resolveInstagramContext(mockDb as never, 'ig-page-1');

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(true);
    expect(result?.organizationId).toBe('org-1');
    expect(result?.metaAdsPageId).toBeNull();
    expect(result?.page).toEqual(
      expect.objectContaining({
        pageId: 'ig-page-1',
        platform: 'instagram',
        metaAdsIntegrationId: '',
      })
    );
  });

  it('returns context with isChatbotActive false when chatbot disabled', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      instagramUserId: 'ig-page-1',
      organizationId: 'org-1',
      isActive: true,
      chatbotEnabled: false,
      encryptedCredentials: 'encrypted-token',
      name: 'My IG Page',
      username: 'myigpage',
      profilePictureUrl: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });

    const result = await resolveInstagramContext(mockDb as never, 'ig-page-1');

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(false);
  });

  it('returns null when no integration found', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await resolveInstagramContext(
      mockDb as never,
      'unknown-page'
    );

    expect(result).toBeNull();
  });
});

describe('resolveMessengerContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns context for page with chatbot active', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-internal-1',
      pageId: 'meta-page-1',
      metaAdsIntegrationId: 'integration-1',
      platform: 'facebook',
      isActive: true,
      isChatbotActive: true,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'integration-1',
      organizationId: 'org-1',
    });

    const result = await resolveMessengerContext(
      mockDb as never,
      'meta-page-1'
    );

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(true);
    expect(result?.metaAdsPageId).toBe('page-internal-1');
    expect(result?.organizationId).toBe('org-1');
  });

  it('returns null when page not found', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

    const result = await resolveMessengerContext(
      mockDb as never,
      'unknown-page'
    );

    expect(result).toBeNull();
  });

  it('returns null when integration not found', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-internal-1',
      pageId: 'meta-page-1',
      metaAdsIntegrationId: 'integration-1',
      platform: 'facebook',
      isActive: true,
      isChatbotActive: false,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await resolveMessengerContext(
      mockDb as never,
      'meta-page-1'
    );

    expect(result).toBeNull();
  });

  it('returns context with isChatbotActive false when chatbot not active', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-internal-1',
      pageId: 'meta-page-1',
      metaAdsIntegrationId: 'integration-1',
      platform: 'facebook',
      isActive: true,
      isChatbotActive: false,
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'integration-1',
      organizationId: 'org-1',
    });

    const result = await resolveMessengerContext(
      mockDb as never,
      'meta-page-1'
    );

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(false);
  });

  it('does not query Instagram integrations', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

    await resolveMessengerContext(mockDb as never, 'some-page');

    expect(mockDb.query.instagramIntegration.findFirst).not.toHaveBeenCalled();
  });
});

describe('resolveWhatsAppChatbot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns context when account found with chatbot active', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      phoneNumberId: 'phone-1',
      organizationId: 'org-1',
      isChatbotActive: true,
    });

    const result = await resolveWhatsAppChatbot(mockDb as never, 'phone-1');

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(true);
    expect(result?.whatsappAccountId).toBe('wa-1');
    expect(result?.metaAdsPageId).toBeNull();
    expect(result?.page).toBeNull();
  });

  it('returns null when no WhatsApp account found', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await resolveWhatsAppChatbot(
      mockDb as never,
      'unknown-phone'
    );

    expect(result).toBeNull();
  });

  it('returns context with isChatbotActive false when chatbot not active', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      phoneNumberId: 'phone-1',
      organizationId: 'org-1',
      isChatbotActive: false,
    });

    const result = await resolveWhatsAppChatbot(mockDb as never, 'phone-1');

    expect(result).not.toBeNull();
    expect(result?.isChatbotActive).toBe(false);
  });
});

describe('resolveSmsContext', () => {
  const smsDb = {
    query: {
      orgSmsNumber: { findMany: vi.fn() },
      conversation: { findFirst: vi.fn() },
    },
  };

  beforeEach(() => vi.clearAllMocks());

  it('resolves the org when exactly one owns the receiving number', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
      {
        organizationId: 'org-2',
        phoneNumber: '+353872222222',
        isChatbotActive: true,
      },
    ]);

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    expect(result?.organizationId).toBe('org-1');
    expect(result?.isChatbotActive).toBe(true);
    // SMS has no page or platform account behind it.
    expect(result?.page).toBeNull();
    expect(result?.whatsappAccountId).toBeNull();
    expect(result?.metaAdsPageId).toBeNull();
  });

  it('matches the number regardless of formatting differences', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353 87 111 1111',
        isChatbotActive: true,
      },
    ]);

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    expect(result?.organizationId).toBe('org-1');
  });

  it('carries the number chatbot toggle through', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: false,
      },
    ]);

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    expect(result?.isChatbotActive).toBe(false);
  });

  it('returns null when no org owns the receiving number', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
    ]);

    const result = await resolveSmsContext(
      smsDb as never,
      '+353870000000',
      '+353859999999'
    );

    expect(result).toBeNull();
  });

  // The Irish launch puts several orgs behind one shared number, so `to` alone
  // cannot identify the clinic.
  it('attributes a shared number via the sender prior conversation', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
      {
        organizationId: 'org-2',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
    ]);
    smsDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      organizationId: 'org-2',
    });

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    expect(result?.organizationId).toBe('org-2');
  });

  it('returns null on a shared number when the sender has no prior conversation', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
      {
        organizationId: 'org-2',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
    ]);
    smsDb.query.conversation.findFirst.mockResolvedValueOnce(undefined);

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    // Dropping is recoverable; showing a lead's message to the wrong clinic is not.
    expect(result).toBeNull();
  });

  it('returns null on a shared number when the prior conversation belongs to a non-owner', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
      {
        organizationId: 'org-2',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
    ]);
    smsDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-9',
      organizationId: 'org-99',
    });

    const result = await resolveSmsContext(
      smsDb as never,
      '+353871111111',
      '+353859999999'
    );

    expect(result).toBeNull();
  });

  it('returns null on a shared number when the sender is unknown', async () => {
    smsDb.query.orgSmsNumber.findMany.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
      {
        organizationId: 'org-2',
        phoneNumber: '+353871111111',
        isChatbotActive: true,
      },
    ]);

    const result = await resolveSmsContext(smsDb as never, '+353871111111');

    expect(result).toBeNull();
    expect(smsDb.query.conversation.findFirst).not.toHaveBeenCalled();
  });
});
