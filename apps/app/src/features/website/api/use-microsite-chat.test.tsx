import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMicrositeChat } from './use-microsite-chat';

vi.mock('@/lib/auth-token', () => ({ getAuthToken: () => 'test-token' }));
vi.mock('@/lib/resolve-api-url', () => ({
  resolveApiUrl: (path: string) => `https://api.test/${path}`,
}));

const CONFIRMATION = {
  action: 'delete_page:pg_pricing',
  prompt: 'Delete the Pricing page? This removes it from your website.',
};

function sseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      }
      controller.close();
    },
  });
}

function respondWith(events: unknown[]) {
  return {
    ok: true,
    status: 200,
    body: sseBody(events),
  } as unknown as Response;
}

const BLOCKED_TURN = [
  {
    type: 'tool',
    name: 'delete_page',
    summary: 'Wants to delete the Pricing page',
    requiresConfirmation: true,
    confirmation: CONFIRMATION,
  },
  {
    type: 'done',
    revisionId: 'rev_1',
    diff: { added: 0, edited: 0, removed: 0, themeChanged: false },
  },
];

const RAN_TURN = [
  { type: 'tool', name: 'delete_page', summary: 'Deleted the Pricing page' },
  {
    type: 'done',
    revisionId: 'rev_2',
    diff: { added: 0, edited: 0, removed: 1, themeChanged: false },
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup() {
  return renderHook(
    () =>
      useMicrositeChat({
        micrositeId: 'ms_1',
        draftRevisionId: 'rev_0',
        conversationId: null,
        onConversationId: vi.fn(),
      }),
    { wrapper }
  );
}

function bodyOf(call: number): Record<string, unknown> {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('useMicrositeChat — blocking destructive confirmation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends confirmedActions on every turn, empty by default', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      respondWith(RAN_TURN)
    );
    const { result } = setup();

    await act(async () => {
      await result.current.sendTurn('Tidy the homepage');
    });

    expect(bodyOf(0)).toMatchObject({
      prompt: 'Tidy the homepage',
      confirmedActions: [],
    });
  });

  it('re-sends the same prompt with the action key when the user confirms', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(respondWith(BLOCKED_TURN))
      .mockResolvedValueOnce(respondWith(RAN_TURN));

    const { result } = setup();

    await act(async () => {
      await result.current.sendTurn('Delete the pricing page');
    });

    const blocked = result.current.entries.at(-1);
    expect(blocked?.confirmationState).toBe('awaiting');
    expect(blocked?.pendingConfirmations).toEqual([CONFIRMATION]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.confirmTurn(
        result.current.entries.at(-1) as NonNullable<typeof blocked>
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1)).toMatchObject({
      prompt: 'Delete the pricing page',
      confirmedActions: [CONFIRMATION.action],
    });

    await waitFor(() => {
      // The blocked turn stops asking; the re-send did not echo a second copy
      // of the user's prompt into the transcript.
      const userTurns = result.current.entries.filter((e) => e.role === 'user');
      expect(userTurns).toHaveLength(1);
    });
  });

  it('sends nothing when the user cancels, and says the turn is not done', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(respondWith(BLOCKED_TURN));

    const { result } = setup();

    await act(async () => {
      await result.current.sendTurn('Delete the pricing page');
    });

    const blocked = result.current.entries.at(-1);
    act(() => {
      result.current.declineConfirmation(blocked?.id as string);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.entries.at(-1)?.confirmationState).toBe('declined');
  });

  it('will not confirm a turn twice', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(respondWith(BLOCKED_TURN))
      .mockResolvedValue(respondWith(RAN_TURN));

    const { result } = setup();
    await act(async () => {
      await result.current.sendTurn('Delete the pricing page');
    });

    const blocked = result.current.entries.at(-1) as NonNullable<
      (typeof result.current.entries)[number]
    >;
    await act(async () => {
      await result.current.confirmTurn(blocked);
    });
    await act(async () => {
      // The stale entry object still says `awaiting`; the hook must not resend.
      await result.current.confirmTurn(blocked);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
