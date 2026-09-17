import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSendResendEmail = vi.fn();

vi.mock('./client.js', () => ({
  sendResendEmail: mockSendResendEmail,
}));

vi.mock('@borradh-workspace/env/email', () => ({
  emailEnv: {
    EMAIL_FROM_NAME: 'Borradh',
    SEQUENCE_FROM_ADDRESS: 'noreply@borradh.io',
  },
}));

describe('sendHtmlEmail', () => {
  beforeEach(() => {
    mockSendResendEmail.mockReset();
  });

  it('returns the message id on success', async () => {
    mockSendResendEmail.mockResolvedValueOnce({
      data: { id: 'msg_1' },
      error: null,
    });
    const { sendHtmlEmail } = await import('./send-html.js');

    const result = await sendHtmlEmail({
      to: 'lead@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });

    expect(result).toEqual({ messageId: 'msg_1' });
  });

  it('throws a ResendSendError carrying the provider error code on rate limit', async () => {
    mockSendResendEmail.mockResolvedValue({
      data: null,
      error: {
        name: 'rate_limit_exceeded',
        message: 'Too many requests. You can only make 10 requests per second.',
      },
    });
    const { sendHtmlEmail } = await import('./send-html.js');
    const { ResendSendError } = await import('./errors.js');

    await expect(
      sendHtmlEmail({
        to: 'lead@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      })
    ).rejects.toMatchObject({
      code: 'rate_limit_exceeded',
    });
    await expect(
      sendHtmlEmail({
        to: 'lead@example.com',
        subject: 'Hi',
        html: '<p>hi</p>',
      })
    ).rejects.toBeInstanceOf(ResendSendError);
  });

  it('throws with the non-rate-limit code for other provider rejections', async () => {
    mockSendResendEmail.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field.' },
    });
    const { sendHtmlEmail } = await import('./send-html.js');

    await expect(
      sendHtmlEmail({ to: 'not-an-email', subject: 'Hi', html: '<p>hi</p>' })
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});
