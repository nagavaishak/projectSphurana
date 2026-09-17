import { createHmac } from 'node:crypto';

// WHY THIS EXISTS
// ---------------
// The connected-chatbot e2e specs drive the Claire pipeline through
// SeedHelper.simulateWebhook, which calls handleIncomingMessage DIRECTLY — it
// never touches this controller or the webhook registry. So a routing
// regression in the rewritten controller (a valid inbound message classified
// as unknown, dropped by a disposition change, or a signature bypass) would
// pass every e2e suite while the chatbot silently stopped answering real
// customers. This test closes that gap: it POSTs a signed Messenger payload
// through the REAL controller + REAL registry (@borradh-workspace/integrations/
// webhooks is deliberately NOT mocked) and asserts the message reaches
// handleIncomingMessage. Only the heavy leaf services (DB, feature services)
// are stubbed — the routing itself is the thing under test.

// Literal, not a const reference — jest hoists jest.mock() above the module
// body, so the factory cannot close over a top-level const.
jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: { META_APP_SECRET: 'test-app-secret' },
}));

const APP_SECRET = 'test-app-secret';

// withSystemScope must EXECUTE its callback so the routed handler actually
// calls the (mocked) feature service — otherwise the dispatch would look green
// without proving the call landed.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
  withSystemScope: (fn: (conn: unknown) => unknown) => fn({}),
}));

const handleIncomingMessage = jest.fn();
const recordEchoMessage = jest.fn();
const handleStandaloneReferral = jest.fn();
jest.mock('@borradh-workspace/features/conversations', () => ({
  handleIncomingMessage: (...args: unknown[]) => handleIncomingMessage(...args),
  recordEchoMessage: (...args: unknown[]) => recordEchoMessage(...args),
  handleStandaloneReferral: (...args: unknown[]) =>
    handleStandaloneReferral(...args),
}));

const handleMetaLeadWebhook = jest.fn();
jest.mock('@borradh-workspace/features/lead-forms', () => ({
  handleMetaLeadWebhook: (...args: unknown[]) => handleMetaLeadWebhook(...args),
  verifyLeadWebhookChallenge: jest.fn(),
}));
jest.mock('@borradh-workspace/features/integrations', () => ({
  handleMetaDeletionCallback: jest.fn(),
}));
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
}));

import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { MetaSignatureGuard } from '../../common/guards/webhooks/meta-signature.guard.js';
import { MetaWebhooksController } from './meta-webhooks.controller.js';

const sign = (raw: string): string =>
  `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

const post = (controller: MetaWebhooksController, payload: unknown) => {
  const raw = JSON.stringify(payload);
  const req = { rawBody: Buffer.from(raw) } as never;
  return controller.handleMessagingWebhook(req);
};

/**
 * Signature verification now lives in `MetaSignatureGuard`, which runs BEFORE
 * the handler. Drive the guard directly with the same request shape Nest would
 * hand it, so "a bad signature never reaches dispatch" stays asserted here.
 */
const guardFor = (payload: unknown, sig?: string) => {
  const raw = JSON.stringify(payload);
  const req = {
    rawBody: Buffer.from(raw),
    headers: { 'x-hub-signature-256': sig ?? sign(raw) },
  };
  return () =>
    new MetaSignatureGuard().canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext);
};

const PAGE_ID = 'page-123';
const SENDER_PSID = 'psid-456';

const messagingPayload = (message: Record<string, unknown>) => ({
  object: 'page',
  entry: [
    {
      id: PAGE_ID,
      time: 1_700_000_000_000,
      messaging: [
        {
          sender: { id: SENDER_PSID },
          recipient: { id: PAGE_ID },
          timestamp: 1_700_000_000_000,
          message,
        },
      ],
    },
  ],
});

describe('MetaWebhooksController — messaging routing', () => {
  let controller: MetaWebhooksController;

  beforeEach(() => {
    jest.clearAllMocks();
    handleIncomingMessage.mockResolvedValue({
      success: true,
      data: { conversationId: 'conv-1', messageId: 'msg-1' },
    });
    controller = new MetaWebhooksController();
  });

  it('routes a signed inbound text message to handleIncomingMessage', async () => {
    const result = await post(
      controller,
      messagingPayload({ mid: 'mid.abc', text: 'I want to book' })
    );

    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
    // pageId is the RECIPIENT (the Page), senderId is the SENDER (the customer).
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pageId: PAGE_ID,
        senderId: SENDER_PSID,
        messageText: 'I want to book',
        platform: 'facebook_messenger',
      })
    );
    expect(result).toEqual({ success: true, processedCount: 1 });
  });

  it('records an echo but does NOT treat it as an inbound message', async () => {
    const result = await post(
      controller,
      messagingPayload({ mid: 'mid.echo', text: 'our reply', is_echo: true })
    );

    expect(recordEchoMessage).toHaveBeenCalledTimes(1);
    expect(handleIncomingMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processedCount: 0 });
  });

  // The `page` topic has ONE callback URL for every field it carries, and in
  // both prod and staging that URL is the leadgen path. So a Messenger echo
  // does NOT arrive at the messaging endpoint in production — it arrives here,
  // and only reaches the echo handler because the leadgen dispatcher forwards
  // anything carrying `entry[].messaging`. ENG-813: the tests above would stay
  // green even if that forward were removed, which would silently kill agent
  // takeover again.
  it('routes an echo posted to the page topic callback (leadgen path) to recordEchoMessage', async () => {
    const raw = JSON.stringify(
      messagingPayload({
        mid: 'mid.echo.leadgen',
        text: 'Shaheen replying',
        is_echo: true,
      })
    );
    const result = await controller.handleLeadgenWebhook(
      { rawBody: Buffer.from(raw) } as never,
      sign(raw)
    );

    expect(recordEchoMessage).toHaveBeenCalledTimes(1);
    expect(recordEchoMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalMessageId: 'mid.echo.leadgen',
        platform: 'facebook_messenger',
      })
    );
    expect(handleMetaLeadWebhook).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processedCount: 0 });
  });

  it("acknowledges Meta's synthetic message_echoes changes payload without dispatching", async () => {
    // Meta's webhook test tool ships `message_echoes` as a CHANGES entry,
    // unlike real traffic. Declared `deliveredAs`, so it is logged and skipped
    // rather than surfacing as an undeclared-event or handler-mismatch error.
    const raw = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          time: 1_700_000_000_000,
          changes: [{ field: 'message_echoes', value: { page_id: PAGE_ID } }],
        },
      ],
    });
    const result = await controller.handleLeadgenWebhook(
      { rawBody: Buffer.from(raw) } as never,
      sign(raw)
    );

    expect(handleMetaLeadWebhook).not.toHaveBeenCalled();
    expect(recordEchoMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processedCount: 0 });
  });

  it('rejects an invalid signature with 403 and never dispatches', () => {
    expect.assertions(2);
    try {
      guardFor(
        messagingPayload({ mid: 'mid.abc', text: 'hi' }),
        'sha256=dead'
      )();
    } catch (e) {
      expect((e as { getStatus: () => number }).getStatus()).toBe(
        HttpStatus.FORBIDDEN
      );
    }
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('rejects a missing signature with 403', () => {
    expect.assertions(2);
    try {
      guardFor(messagingPayload({ mid: 'mid.abc', text: 'hi' }), '')();
    } catch (e) {
      expect((e as { getStatus: () => number }).getStatus()).toBe(
        HttpStatus.FORBIDDEN
      );
    }
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('routes an Instagram DM (object=instagram) to handleIncomingMessage', async () => {
    const payload = {
      ...messagingPayload({ mid: 'mid.ig', text: 'hello from IG' }),
      object: 'instagram',
    };

    const result = await post(controller, payload);

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pageId: PAGE_ID,
        senderId: SENDER_PSID,
        messageText: 'hello from IG',
        platform: 'instagram_dm',
      })
    );
    expect(result).toEqual({ success: true, processedCount: 1 });
  });
});
