// Coverage for requestSupportChatTool. Same heavy-barrel mocking precedent as
// the ads / remember specs — features/database barrels pull cuid2 + t3-env
// (ESM-only) which swc-jest doesn't transform.
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { requestSupportChatTool, supportTools } from './index.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  conversationId?: string;
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch) as never,
    callCounter: createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

describe('support tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exports a single requestSupportChat tool', () => {
      expect(supportTools).toHaveLength(1);
      expect(supportTools[0]).toBe(requestSupportChatTool);
    });

    it('is non-destructive and uses the support_ factory name', () => {
      expect(requestSupportChatTool.name).toBe('support_requestSupportChat');
      expect(requestSupportChatTool.feature).toBe('support');
      expect(requestSupportChatTool.action).toBe('requestSupportChat');
      expect(requestSupportChatTool.destructive).toBe(false);
    });
  });

  describe('requestSupportChatTool', () => {
    it('POSTs the handoff endpoint and echoes the reason + created flag', async () => {
      const apiFetch = jest.fn(async () => ({
        conversationId: 'conv-1',
        intercomConversationId: 'ic-1',
        created: true,
      }));
      const result = await requestSupportChatTool.execute(
        { reason: 'Owner wants help with a billing dispute.' },
        buildCtx({ apiFetch: apiFetch as never, conversationId: 'conv-1' })
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('assistant/conversations/conv-1/handoff');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.body).toEqual({
        reason: 'Owner wants help with a billing dispute.',
      });

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.uiState).toBe('support-chat-opened');
        expect(result.data.reason).toBe(
          'Owner wants help with a billing dispute.'
        );
        expect(result.data.created).toBe(true);
        // The tool always emits a boolean (response.reason !== the sentinel),
        // so a healthy handoff reports notConfigured: false rather than omitting it.
        expect(result.data.notConfigured).toBe(false);
      }
    });

    it('flags notConfigured when Intercom is not set up', async () => {
      const apiFetch = jest.fn(async () => ({
        conversationId: 'conv-1',
        intercomConversationId: null,
        created: false,
        reason: 'intercom_not_configured',
      }));
      const result = await requestSupportChatTool.execute(
        { reason: 'Owner asked to talk to a human.' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.created).toBe(false);
        expect(result.data.notConfigured).toBe(true);
      }
    });

    it('rejects an empty reason via Zod (no apiFetch)', async () => {
      const apiFetch = jest.fn();
      const result = await requestSupportChatTool.execute(
        { reason: '' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('rejects a reason longer than 500 chars via Zod', async () => {
      const apiFetch = jest.fn();
      const result = await requestSupportChatTool.execute(
        { reason: 'x'.repeat(501) },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('soft-errors (factory sanitizes) when the handoff POST throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('handoff endpoint down');
      });
      const result = await requestSupportChatTool.execute(
        { reason: 'Owner needs a human.' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });
  });
});
