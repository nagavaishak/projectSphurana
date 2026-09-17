import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `sendEmail`'s undeliverable-recipient guard.
 *
 * This is a small function with a large blast radius. Scraped staff rows
 * (ENG-659) are created with an invented `<name>@scraped.invalid` address
 * because `practitioner.email` is NOT NULL and unique per org, and the whole
 * reason that is acceptable rather than reckless is THIS filter: nothing may
 * ever attempt to mail an address we made up for a real person. The team
 * invite that would otherwise go out has to die here, at the one chokepoint
 * every send in the product passes through.
 *
 * It is also the guard that stopped ~1k Sentry events from the E2E suite's
 * @example.com users. Neither guarantee had a test.
 */

const mockSendResendEmail = vi.fn();
vi.mock('./client.js', () => ({
  sendResendEmail: (...args: unknown[]) => mockSendResendEmail(...args),
  getDefaultFrom: () => 'test@borradh.io',
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn().mockResolvedValue('<p>rendered</p>'),
}));

import { sendEmail } from './send.js';

const Template = () => null;

const send = (to: string | string[]) =>
  sendEmail({
    to,
    subject: 'Subject',
    template: Template as never,
    props: {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockSendResendEmail.mockResolvedValue({
    data: { id: 'msg_1' },
    error: null,
  });
});

describe('sendEmail — undeliverable recipients', () => {
  it('never attempts a send to a scraped placeholder address', async () => {
    // The exact shape apply-website-analysis mints for a staff member whose
    // page publishes no address.
    const result = await send('anna.kelly@scraped.invalid');

    expect(mockSendResendEmail).not.toHaveBeenCalled();
    expect(result.messageId).toBe('skipped-undeliverable');
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(['anna.kelly@scraped.invalid']);
  });

  it.each([
    'someone@example.com',
    'someone@example.net',
    'someone@example.org',
    'someone@foo.test',
    'someone@foo.invalid',
    'someone@foo.example',
    'someone@foo.localhost',
  ])('skips the reserved address %s', async (address) => {
    await send(address);
    expect(mockSendResendEmail).not.toHaveBeenCalled();
  });

  it('drops only the undeliverable half of a mixed recipient list', async () => {
    // A real person on the same send must still be reached — the guard is a
    // filter, not an abort.
    await send(['real@clinic.ie', 'anna.kelly@scraped.invalid']);

    expect(mockSendResendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendResendEmail.mock.calls[0][0]).toEqual(
      expect.objectContaining({ to: ['real@clinic.ie'] })
    );
  });

  it('still sends to a real address', async () => {
    const result = await send('owner@clinic.ie');

    expect(mockSendResendEmail).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe('msg_1');
  });

  it('does not swallow a bad address at a REAL domain', async () => {
    // Skipping is for addresses that CANNOT receive mail. A typo at a live
    // domain is a genuine delivery failure and must still surface.
    await send('nosuchuser@gmail.com');
    expect(mockSendResendEmail).toHaveBeenCalledTimes(1);
  });
});
