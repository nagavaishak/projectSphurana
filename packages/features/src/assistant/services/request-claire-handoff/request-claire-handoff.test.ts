import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { requestClaireHandoff } from './request-claire-handoff.service.js';

const mockDb = createMockDatabase();

const baseInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  userId: 'user-1',
  reason: 'Owner asked to talk to a human.',
};

/** Stub the conversation row + escalate/message chains the service touches. */
function primeDbForHandoff() {
  mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce({
    id: 'conv-1',
    organizationId: 'org-1',
    userId: 'user-1',
    status: 'active',
    intercomConversationId: null,
  });
  // Transcript message query → no prior messages.
  mockDb.limit.mockResolvedValueOnce([]);
  // escalateConversation's update().returning() → one row.
  mockDb.returning.mockResolvedValueOnce([
    { id: 'conv-1', status: 'escalated' },
  ]);
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Build a fetch mock that records calls and responds per-endpoint. `search`
 * controls whether the contact-search leg finds an existing contact.
 */
function stubFetch(opts: {
  searchData?: Array<{ id: string }>;
  createContactStatus?: number;
  createContactId?: string;
}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ url, body });

    if (url.endsWith('/contacts/search')) {
      return new Response(JSON.stringify({ data: opts.searchData ?? [] }), {
        status: 200,
      });
    }
    if (url.endsWith('/contacts')) {
      const status = opts.createContactStatus ?? 200;
      return new Response(
        JSON.stringify(
          status === 200 ? { id: opts.createContactId ?? 'contact-new' } : {}
        ),
        { status }
      );
    }
    if (url.endsWith('/conversations')) {
      return new Response(JSON.stringify({ id: 'intercom-convo-1' }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('requestClaireHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the Intercom contact then opens the conversation against its id', async () => {
    primeDbForHandoff();
    const calls = stubFetch({ searchData: [], createContactId: 'contact-42' });

    const result = await requestClaireHandoff(
      mockDb as never,
      { ...baseInput, userEmail: 'owner@example.com', userName: 'Owner' },
      { accessToken: 'token' }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intercomConversationId).toBe('intercom-convo-1');
      expect(result.data.created).toBe(true);
    }

    // Contact created with our external id, then conversation opened against
    // the returned Intercom contact id — not the bare external id.
    const createCall = calls.find((c) => c.url.endsWith('/contacts'));
    expect(createCall?.body.external_id).toBe('user-1');
    const convoCall = calls.find((c) => c.url.endsWith('/conversations'));
    expect(convoCall?.body.from).toEqual({ type: 'user', id: 'contact-42' });
  });

  it('reuses an existing Intercom contact without creating a new one', async () => {
    primeDbForHandoff();
    const calls = stubFetch({ searchData: [{ id: 'existing-contact' }] });

    const result = await requestClaireHandoff(mockDb as never, baseInput, {
      accessToken: 'token',
    });

    expect(result.success).toBe(true);
    // No create-contact call when search already found one.
    expect(calls.some((c) => c.url.endsWith('/contacts'))).toBe(false);
    const convoCall = calls.find((c) => c.url.endsWith('/conversations'));
    expect(convoCall?.body.from).toEqual({
      type: 'user',
      id: 'existing-contact',
    });
  });

  it('falls back to the external id when contact resolution fails', async () => {
    primeDbForHandoff();
    // Search finds nothing AND create returns a hard error → no contact id.
    const calls = stubFetch({ searchData: [], createContactStatus: 500 });

    const result = await requestClaireHandoff(mockDb as never, baseInput, {
      accessToken: 'token',
    });

    expect(result.success).toBe(true);
    const convoCall = calls.find((c) => c.url.endsWith('/conversations'));
    expect(convoCall?.body.from).toEqual({ type: 'user', user_id: 'user-1' });
  });

  it('is a no-op when Intercom is not configured', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      organizationId: 'org-1',
      userId: 'user-1',
      status: 'active',
      intercomConversationId: null,
    });

    const result = await requestClaireHandoff(mockDb as never, baseInput, {
      accessToken: undefined,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('intercom_not_configured');
      expect(result.data.created).toBe(false);
    }
  });

  it('returns NOT_FOUND when the conversation does not exist', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await requestClaireHandoff(mockDb as never, baseInput, {
      accessToken: 'token',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
