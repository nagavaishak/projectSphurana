import { ResendSendError, sendHtmlEmail } from '@borradh-workspace/email';
import { buildChannelSenders } from './build-channel-senders.js';

jest.mock('@borradh-workspace/email', () => {
  class ResendSendError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'ResendSendError';
      this.code = code;
    }
  }
  return {
    ResendSendError,
    sendHtmlEmail: jest.fn(),
  };
});

jest.mock('@borradh-workspace/integrations', () => ({
  WhatsAppCloudService: jest.fn(),
}));
jest.mock('@borradh-workspace/integrations/sms', () => ({
  TwilioSMSService: jest.fn(),
}));

const mockSendHtmlEmail = sendHtmlEmail as jest.MockedFunction<
  typeof sendHtmlEmail
>;

describe('buildChannelSenders — email', () => {
  beforeEach(() => {
    mockSendHtmlEmail.mockReset();
  });

  it('marks a Resend rate-limit rejection as retryable', async () => {
    mockSendHtmlEmail.mockRejectedValueOnce(
      new ResendSendError(
        'Failed to send HTML email: Too many requests.',
        'rate_limit_exceeded'
      )
    );
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'lead@example.com',
      body: '<p>hi</p>',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBe(true);
  });

  it('marks a client-side rate-limit wait timeout as retryable', async () => {
    mockSendHtmlEmail.mockRejectedValueOnce(
      new ResendSendError(
        'Timed out after 15000ms waiting for a Resend rate-limit slot',
        'client_rate_limit_timeout'
      )
    );
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'lead@example.com',
      body: '<p>hi</p>',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBe(true);
  });

  it('marks an exhausted Resend processing failure as retryable', async () => {
    mockSendHtmlEmail.mockRejectedValueOnce(
      new ResendSendError(
        'Failed to send HTML email: Failed to process email sending',
        'application_error'
      )
    );
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'lead@example.com',
      body: '<p>hi</p>',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBe(true);
  });

  it('does not mark a non-rate-limit send failure as retryable', async () => {
    mockSendHtmlEmail.mockRejectedValueOnce(
      new ResendSendError(
        'Failed to send HTML email: Invalid `to` field.',
        'validation_error'
      )
    );
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'not-an-email',
      body: '<p>hi</p>',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBeFalsy();
  });

  it('does not mark a generic thrown error as retryable', async () => {
    mockSendHtmlEmail.mockRejectedValueOnce(new Error('network blip'));
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'lead@example.com',
      body: '<p>hi</p>',
    });

    expect(outcome.success).toBe(false);
    expect(outcome.retryable).toBeFalsy();
  });

  it('reports success without a retryable flag on a normal send', async () => {
    mockSendHtmlEmail.mockResolvedValueOnce({ messageId: 'msg_1' });
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    const outcome = await senders.email({
      to: 'lead@example.com',
      body: '<p>hi</p>',
    });

    expect(outcome).toEqual({ messageId: 'msg_1', success: true });
  });

  it('renders a plain-text body as HTML paragraphs + line breaks (escaped)', async () => {
    mockSendHtmlEmail.mockResolvedValueOnce({ messageId: 'msg_1' });
    const senders = buildChannelSenders({
      fromAddress: 'org@campaign.borradh.io',
    });

    await senders.email({
      to: 'lead@example.com',
      subject: 'Hi',
      body: 'Line one\nLine two\n\nNew paragraph <b>&',
    });

    const html = mockSendHtmlEmail.mock.calls[0]?.[0]?.html ?? '';
    // Blank line → separate <p>; single newline → <br>.
    expect(html).toContain('Line one<br/>Line two');
    expect((html.match(/<p /g) ?? []).length).toBe(2);
    // Raw markup is escaped, never passed through.
    expect(html).toContain('New paragraph &lt;b&gt;&amp;');
    expect(html).not.toContain('<b>');
  });
});
