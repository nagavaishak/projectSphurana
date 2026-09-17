import { sendEmail } from '@borradh-workspace/email';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { sendInvitationEmail } from './send-invitation-email.js';

// `@borradh-workspace/email` and `@borradh-workspace/env/auth` are aliased to
// the canonical static mocks in vite.config.ts. NEVER `vi.mock` an aliased
// module — under `isolate: false` the factory persists on the shared worker
// graph and poisons later files.

const validInput = {
  invitationId: 'inv_123',
  email: 'newmember@example.com',
  organizationId: '550e8400-e29b-41d4-a716-446655440000',
  organizationName: 'My Organization',
  inviterName: 'A team member',
  role: 'member',
  firstName: null,
  expiresAt: new Date('2026-01-08T00:00:00Z'),
};

const lastInvitationUrl = () => {
  const call = vi.mocked(sendEmail).mock.calls[0]?.[0] as {
    props: { invitationUrl: string };
  };
  return call.props.invitationUrl;
};

describe('sendInvitationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendEmail).mockResolvedValue(undefined as never);
  });

  it('builds the invite link on the dashboard app, not the marketing site', async () => {
    // /accept-invitation only exists in the SPA (APP_URL). Building it from
    // WEB_URL — the marketing site in prod — 404s every invitee.
    await sendInvitationEmail(validInput);

    expect(lastInvitationUrl()).toBe(
      'https://mock-app.example.com/accept-invitation?token=inv_123'
    );
  });

  it('reports success when the mailer accepts the message', async () => {
    await expect(sendInvitationEmail(validInput)).resolves.toBe(true);
  });

  it('reports failure instead of throwing when delivery fails', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('mailer down'));

    await expect(sendInvitationEmail(validInput)).resolves.toBe(false);
  });
});
