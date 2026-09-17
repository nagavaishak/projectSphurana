import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

// Internal modules are driven with RESTORED spies, never `vi.mock`: this suite
// runs with `isolate: false`, so a file-local `vi.mock` persists on the shared
// module graph and silently replaces these exports for every later test file.
// See src/architecture/mock-boundaries.test.ts.
import * as campaigns from '../../../campaigns/index.js';
import * as incoming from '../handle-incoming-message/index.js';
import { handleInboundSms } from './handle-inbound-sms.service.js';

const mockDb = {} as never;
const base = { from: '+353859999999', to: '+353871111111', messageId: 'SM1' };

describe('handleInboundSms', () => {
  let consentSpy: MockInstance;
  let routeSpy: MockInstance;

  beforeEach(() => {
    consentSpy = vi.spyOn(campaigns, 'handleSmsWebhook');
    routeSpy = vi
      .spyOn(incoming, 'handleIncomingMessage')
      .mockResolvedValue({ success: true, data: {} } as never);
  });

  afterEach(() => {
    consentSpy.mockRestore();
    routeSpy.mockRestore();
  });

  const consentReturns = (action: string) =>
    consentSpy.mockResolvedValueOnce({
      success: true,
      data: { action },
    } as never);

  it('routes a normal reply into the shared inbound pipeline', async () => {
    consentReturns('ignored');

    const result = await handleInboundSms(mockDb, {
      ...base,
      body: 'I have acne scarring',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.routedToClaire).toBe(true);
    expect(routeSpy).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        platform: 'sms',
        // the receiving number routes, the sender identifies
        pageId: base.to,
        senderId: base.from,
        messageText: 'I have acne scarring',
      })
    );
  });

  it('consent runs before routing', async () => {
    consentReturns('ignored');

    await handleInboundSms(mockDb, { ...base, body: 'hello' });

    expect(consentSpy.mock.invocationCallOrder[0]).toBeLessThan(
      routeSpy.mock.invocationCallOrder[0]
    );
  });

  // A contact who just opted out must never reach Claire.
  it('does not route a STOP to Claire', async () => {
    consentReturns('opt_out');

    const result = await handleInboundSms(mockDb, { ...base, body: 'STOP' });

    expect(routeSpy).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.consentAction).toBe('opt_out');
      expect(result.data.routedToClaire).toBe(false);
    }
  });

  it('does not route a START to Claire', async () => {
    consentReturns('opt_in');

    await handleInboundSms(mockDb, { ...base, body: 'START' });

    expect(routeSpy).not.toHaveBeenCalled();
  });

  it('ignores an empty body', async () => {
    consentReturns('ignored');

    await handleInboundSms(mockDb, { ...base, body: '   ' });

    expect(routeSpy).not.toHaveBeenCalled();
  });

  // Twilio retries non-2xx, and a retry would re-deliver a message we already
  // recorded — so neither step may fail the webhook.
  it('still succeeds when consent handling fails', async () => {
    consentSpy.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    } as never);

    const result = await handleInboundSms(mockDb, { ...base, body: 'hi' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.consentAction).toBe('error');
    // An unknown consent outcome is not a consent keyword, so the reply is
    // still worth answering.
    expect(routeSpy).toHaveBeenCalled();
  });

  it('still succeeds when routing fails', async () => {
    consentReturns('ignored');
    routeSpy.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'no org' },
    } as never);

    const result = await handleInboundSms(mockDb, { ...base, body: 'hi' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.routedToClaire).toBe(false);
  });

  it('returns an error outcome for an invalid payload', async () => {
    const result = await handleInboundSms(mockDb, {
      from: '',
      to: '',
      body: 'hi',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.consentAction).toBe('error');
    expect(consentSpy).not.toHaveBeenCalled();
  });
});
