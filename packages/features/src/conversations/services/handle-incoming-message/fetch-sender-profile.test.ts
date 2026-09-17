import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

const mockGetUserProfile = vi.mocked(mockMetaMessagingService.getUserProfile);
const mockGetConversationMessages = vi.mocked(
  mockMetaMessagingService.getConversationMessages
);

// Mock fetch for Instagram API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  fetchInstagramSenderName,
  fetchSenderName,
} from './fetch-sender-profile.js';

describe('fetchInstagramSenderName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
    mockGetUserProfile.mockResolvedValue({});
    mockGetConversationMessages.mockResolvedValue([]);
  });

  it('returns name from Instagram Graph API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: 'John Doe', username: 'johndoe' }),
    });

    const name = await fetchInstagramSenderName('encrypted-creds', 'sender-1');

    expect(name).toBe('John Doe');
    // Second arg is the init `fetchWithRetry` adds — it attaches the
    // per-attempt timeout signal. The URL is what this test is about.
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.instagram.com/v22.0/sender-1'),
      expect.anything()
    );
  });

  it('returns username when name is not available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ username: 'johndoe' }),
    });

    const name = await fetchInstagramSenderName('encrypted-creds', 'sender-1');

    expect(name).toBe('johndoe');
  });

  it('returns undefined when API response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const name = await fetchInstagramSenderName('encrypted-creds', 'sender-1');

    expect(name).toBeUndefined();
  });

  it('returns undefined when decryption fails', async () => {
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    const name = await fetchInstagramSenderName('bad-creds', 'sender-1');

    expect(name).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns undefined when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const name = await fetchInstagramSenderName('encrypted-creds', 'sender-1');

    expect(name).toBeUndefined();
  });
});

describe('fetchSenderName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
    mockGetUserProfile.mockResolvedValue({});
    mockGetConversationMessages.mockResolvedValue([]);
  });

  it('returns undefined when no access token', async () => {
    const name = await fetchSenderName(
      { pageAccessToken: null, pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBeUndefined();
  });

  it('returns full name from profile API (tier 1)', async () => {
    mockGetUserProfile.mockResolvedValueOnce({
      name: 'John Smith',
      firstName: 'John',
      lastName: 'Smith',
    });

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBe('John Smith');
  });

  it('builds name from first + last when full name missing', async () => {
    mockGetUserProfile.mockResolvedValueOnce({
      firstName: 'John',
      lastName: 'Smith',
    });

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBe('John Smith');
  });

  it('falls back to conversation history (tier 2) when profile fails', async () => {
    mockGetUserProfile.mockRejectedValueOnce(new Error('API error'));
    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'msg-1',
        from: { id: 'sender-1', name: 'Jane Doe' },
        message: 'Hi',
        created_time: '2024-01-01T00:00:00Z',
      },
    ]);

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBe('Jane Doe');
  });

  it('skips page messages in conversation history', async () => {
    mockGetUserProfile.mockResolvedValueOnce({});
    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'msg-1',
        from: { id: 'page-1', name: 'My Business' },
        message: 'Welcome',
        created_time: '2024-01-01T00:00:00Z',
      },
      {
        id: 'msg-2',
        from: { id: 'sender-1', name: 'Customer Name' },
        message: 'Hello',
        created_time: '2024-01-01T00:01:00Z',
      },
    ]);

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBe('Customer Name');
  });

  it('returns undefined when both tiers fail', async () => {
    mockGetUserProfile.mockResolvedValueOnce({});
    mockGetConversationMessages.mockResolvedValueOnce([]);

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBeUndefined();
  });

  it('returns undefined when decryption fails', async () => {
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    const name = await fetchSenderName(
      { pageAccessToken: 'encrypted-token', pageId: 'page-1' },
      'sender-1',
      'facebook_messenger'
    );

    expect(name).toBeUndefined();
  });
});
