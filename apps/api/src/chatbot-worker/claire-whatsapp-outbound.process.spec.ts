/**
 * Unit gate for the proactive outbound delivery worker process.
 *
 * Drives `processClaireWhatsappOutbound` with mocked feature services
 * (`getWhatsappConversationTarget`, `saveMessages`) and a capturing WhatsApp
 * service injected via `deps`. The real `deliverWhatsappSends` planner runs.
 */

jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }));
jest.mock('@borradh-workspace/observability', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
  logError: jest.fn(),
}));
jest.mock('@borradh-workspace/integrations/whatsapp', () => ({
  WhatsAppCloudService: class {},
}));

// Avoid pulling the turn process's heavy ESM imports; we inject the service.
jest.mock('./claire-whatsapp-turn.process.js', () => ({
  buildClaireWhatsappService: jest.fn(),
}));

const getWhatsappConversationTarget = jest.fn();
const saveMessages = jest.fn();
jest.mock('@borradh-workspace/features/assistant', () => ({
  getWhatsappConversationTarget: (...a: unknown[]) =>
    getWhatsappConversationTarget(...a),
  saveMessages: (...a: unknown[]) => saveMessages(...a),
}));

import {
  type ClaireWhatsappOutboundDeps,
  processClaireWhatsappOutbound,
} from './claire-whatsapp-outbound.process.js';

function captureService() {
  const sends: unknown[] = [];
  return {
    sends,
    service: {
      sendTextMessage: jest.fn(async (to: string, body: string) => {
        sends.push({ kind: 'text', to, body });
        return { messageId: 'm', success: true };
      }),
      sendMediaMessage: jest.fn(
        async (
          to: string,
          opts: { type: 'image' | 'video'; link: string; caption?: string }
        ) => {
          sends.push({ kind: 'media', to, ...opts });
          return { messageId: 'm', success: true };
        }
      ),
    } satisfies ClaireWhatsappOutboundDeps['whatsappService'],
  };
}

const PAYLOAD = {
  organizationId: 'org-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  messages: [
    {
      kind: 'media' as const,
      mediaType: 'video' as const,
      link: 'https://cdn.test/final.mp4',
      caption: 'Your video!',
    },
  ],
  recordAs: 'Delivered the finished video.',
  dedupeKey: 'video-ready:vid-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  saveMessages.mockResolvedValue({ success: true, data: {} });
});

describe('processClaireWhatsappOutbound', () => {
  it('delivers the video to the resolved phone and records the turn', async () => {
    getWhatsappConversationTarget.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-1', userId: 'user-1', phoneE164: '353871' },
    });

    const { service, sends } = captureService();
    const result = await processClaireWhatsappOutbound(PAYLOAD, {
      whatsappService: service,
    });

    expect(result.delivered).toBe(true);
    expect(sends).toEqual([
      {
        kind: 'media',
        to: '353871',
        type: 'video',
        link: 'https://cdn.test/final.mp4',
        caption: 'Your video!',
      },
    ]);
    // Recorded as an assistant turn (empty user row, mirroring proactive-nudges).
    expect(saveMessages).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        conversationId: 'conv-1',
        organizationId: 'org-1',
        userId: 'user-1',
        userMessageContent: '',
        assistantText: 'Delivered the finished video.',
      })
    );
  });

  it('skips delivery when the owner has no paired number', async () => {
    getWhatsappConversationTarget.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-1', userId: 'user-1', phoneE164: null },
    });

    const { service, sends } = captureService();
    const result = await processClaireWhatsappOutbound(PAYLOAD, {
      whatsappService: service,
    });

    expect(result.delivered).toBe(false);
    expect(result.skippedReason).toBe('no_phone');
    expect(sends).toEqual([]);
    expect(service.sendMediaMessage).not.toHaveBeenCalled();
    expect(saveMessages).not.toHaveBeenCalled();
  });

  it('throws when the conversation target cannot be resolved', async () => {
    getWhatsappConversationTarget.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Conversation not found' },
    });

    const { service } = captureService();
    await expect(
      processClaireWhatsappOutbound(PAYLOAD, { whatsappService: service })
    ).rejects.toThrow(/Failed to resolve outbound target/);
  });
});
