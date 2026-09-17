import { sendEmail } from '@borradh-workspace/email';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@borradh-workspace/observability` is mocked globally in `src/test-setup.ts`,
// and `@borradh-workspace/env/api` is canonically aliased in vite.config.ts —
// a per-file `vi.mock` of either races under `isolate: false`. We assert the
// dashboard URL against the canonical mock's `WEB_URL`.
// The app host: /dashboard is served by apps/app. A WEB_URL link hits the
// marketing site, which 301s to /dashboard/home and DISCARDS the conversation
// id — the agent lands on the wrong page rather than an obvious error.
const MOCK_APP_URL = 'https://mock-app.example.com';

import { ErrorCodes } from '../../../shared/index.js';
import { notifyFollowUpRequired } from './notify-follow-up-required.service.js';

const mockSendEmail = vi.mocked(sendEmail);

const validInput = {
  conversationId: 'conv-1',
  followUpReason: 'pricing inquiry',
};

const fakeConv = {
  id: 'conv-1',
  organizationId: 'org-1',
  externalUserName: 'Jane Doe',
  platform: 'whatsapp',
  metadata: {},
};

describe('notifyFollowUpRequired', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
    mockSendEmail.mockReset();
    mockDb.query.conversationMessage.findMany.mockResolvedValue([]);
    mockDb.query.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: null,
    });
  });

  // --- Validation ---

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await notifyFollowUpRequired(mockDb as never, {
      conversationId: '',
      followUpReason: 'reason',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing followUpReason', async () => {
    const result = await notifyFollowUpRequired(mockDb as never, {
      conversationId: 'conv-1',
      followUpReason: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // --- Not found ---

  it('returns NOT_FOUND when conversation does not exist', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  // --- Happy path: escalation email ---

  it('sends email to escalation email from chatbot settings', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: {
        escalationEmail: 'escalation@test.com',
        ownerName: 'Dr. Smith',
      },
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notified).toBe(true);
    }
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'escalation@test.com',
        subject: expect.stringContaining('Jane Doe'),
      })
    );
  });

  // --- Happy path: org owner fallback ---

  it('sends email to org owner when no escalation email', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: {},
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'owner',
    });
    mockDb.query.user.findFirst.mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      name: 'Owner Name',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notified).toBe(true);
    }
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@test.com',
      })
    );
  });

  // --- No recipient ---

  it('returns notified: false when no recipient email found', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: {},
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce(null);

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notified).toBe(false);
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns notified: false when owner has no email', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: {},
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'owner',
    });
    mockDb.query.user.findFirst.mockResolvedValueOnce({
      id: 'user-1',
      email: undefined,
      name: 'No Email Owner',
    });

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notified).toBe(false);
    }
  });

  // --- Email send error ---

  it('returns INTERNAL_ERROR when sendEmail throws', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: { escalationEmail: 'escalation@test.com' },
    });
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP connection failed'));

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  // --- Metadata update ---

  it('updates conversation metadata with followUpNotifiedAt after email', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      ...fakeConv,
      metadata: { name: 'Jane' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: { escalationEmail: 'test@test.com' },
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    await notifyFollowUpRequired(mockDb as never, validInput);

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: 'Jane',
          followUpNotifiedAt: expect.any(String),
        }),
      })
    );
  });

  // --- Message snippet ---

  it('includes last 6 messages in email snippet', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: { escalationEmail: 'test@test.com' },
    });
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([
      { role: 'bot', content: 'Hello!', createdAt: new Date() },
      { role: 'user', content: 'How much?', createdAt: new Date() },
    ]);
    mockSendEmail.mockResolvedValueOnce(undefined);

    await notifyFollowUpRequired(mockDb as never, validInput);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          conversationSnippet: expect.stringContaining('How much?'),
        }),
      })
    );
  });

  // --- Conversation without chatbot settings ---

  it('handles conversation without chatbot settings on org', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: null,
    });
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'owner',
    });
    mockDb.query.user.findFirst.mockResolvedValueOnce({
      id: 'user-1',
      email: 'owner@test.com',
      name: 'Owner',
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    const result = await notifyFollowUpRequired(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notified).toBe(true);
    }
  });

  // --- Dashboard URL ---

  it('includes dashboard URL in email props', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(fakeConv);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: { escalationEmail: 'test@test.com' },
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    await notifyFollowUpRequired(mockDb as never, validInput);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          // `?id=` — a SEARCH param. This assertion used to pin the PATH
          // shape (`/dashboard/conversations/conv-1`), which no route has
          // served since the branch move: it fell through the splat to
          // `/dashboard/l/:branch/conversations/conv-1` and 404'd. The test
          // passed the whole time because it only ever compared the string the
          // service built against the same string the service built.
          dashboardUrl: `${MOCK_APP_URL}/dashboard/conversations?id=conv-1`,
        }),
      })
    );
  });

  // --- Subject line ---

  it('includes customer name and follow-up reason in subject', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      ...fakeConv,
      metadata: { name: 'Alice' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      chatbotSettings: { escalationEmail: 'test@test.com' },
    });
    mockSendEmail.mockResolvedValueOnce(undefined);

    await notifyFollowUpRequired(mockDb as never, validInput);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('pricing inquiry'),
      })
    );
  });
});
