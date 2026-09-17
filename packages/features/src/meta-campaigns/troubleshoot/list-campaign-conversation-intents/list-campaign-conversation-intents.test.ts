import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// Mock only `getAttributedConversationSignals`; keep the real `describeHighIntent`
// so the per-conversation verdict + reasons reflect the actual predicate.
const getSignalsMock = vi.fn();

let listCampaignConversationIntents: typeof import(
  './list-campaign-conversation-intents.service.js'
).listCampaignConversationIntents;

describe('listCampaignConversationIntents', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../shared/index.js', async () => {
      const actual =
        await vi.importActual<typeof import('../shared/index.js')>(
          '../shared/index.js'
        );
      return {
        ...actual,
        getAttributedConversationSignals: (
          ...args: Parameters<typeof getSignalsMock>
        ) => getSignalsMock(...args),
      };
    });
    ({ listCampaignConversationIntents } = await import(
      './list-campaign-conversation-intents.service.js'
    ));
  });

  afterEach(() => {
    vi.doUnmock('../shared/index.js');
    vi.resetModules();
  });

  it('splits conversations into high vs low intent with reasons', async () => {
    getSignalsMock.mockResolvedValueOnce([
      {
        conversationId: 'c1',
        stage: 'booking',
        bookingInterest: false,
        userMessageCount: 1,
        lastActivityAt: new Date('2026-06-08T00:00:00.000Z'),
      },
      {
        conversationId: 'c2',
        stage: 'first_contact',
        bookingInterest: false,
        userMessageCount: 1,
        lastActivityAt: null,
      },
      {
        conversationId: 'c3',
        stage: 'enquiry',
        bookingInterest: false,
        userMessageCount: 4, // engagement arm
        lastActivityAt: null,
      },
    ]);

    const result = await listCampaignConversationIntents({} as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const d = result.data;
    expect(d.total).toBe(3);
    expect(d.highIntentCount).toBe(2); // c1 (booking) + c3 (engaged)
    expect(d.lowIntentCount).toBe(1); // c2
    const c1 = d.conversations.find((c) => c.conversationId === 'c1');
    expect(c1?.isHighIntent).toBe(true);
    expect(c1?.reasons).toContain('stage is "booking"');
    const c2 = d.conversations.find((c) => c.conversationId === 'c2');
    expect(c2?.isHighIntent).toBe(false);
    expect(c2?.reasons).toEqual([]);
  });

  it('returns an empty breakdown when nothing is attributed', async () => {
    getSignalsMock.mockResolvedValueOnce([]);
    const result = await listCampaignConversationIntents({} as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      total: 0,
      highIntentCount: 0,
      lowIntentCount: 0,
      conversations: [],
    });
  });

  it('returns VALIDATION_ERROR for a missing campaign id', async () => {
    const result = await listCampaignConversationIntents({} as never, {
      organizationId: 'org-1',
      metaCampaignId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(getSignalsMock).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the query throws', async () => {
    getSignalsMock.mockRejectedValueOnce(new Error('db down'));
    const result = await listCampaignConversationIntents({} as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
