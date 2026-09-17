import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `fetchRemainingPages` reports every pagination failure through `logError`.
// Mock the whole observability surface so the assertions can read what was
// logged (and, critically, what was NOT — see the token-leak test).
const logError = vi.fn();
vi.mock('@borradh-workspace/observability', () => ({
  logError: (...args: unknown[]) => logError(...args),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { MetaOAuthService } = await import('./meta-oauth.service.js');

const TOKEN = 'EAAsecret-access-token';

/** A Graph list response: `data` rows plus an optional `paging.next` cursor. */
function pageResponse(data: unknown[], next?: string): Response {
  const body = { data, ...(next ? { paging: { next } } : {}) };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A Graph error response (400 — deliberately not 5xx, which fetchWithRetry retries). */
function errorResponse(message = 'boom', code = 100): Response {
  const body = { error: { message, type: 'OAuthException', code } };
  return {
    ok: false,
    status: 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A Graph cursor URL — the real ones carry the access token in the query. */
const cursor = (n: number, host = 'graph.facebook.com') =>
  `https://${host}/v21.0/me/adaccounts?access_token=${TOKEN}&after=cursor-${n}`;

const adAccountRow = (n: number) => ({
  id: `act_${n}`,
  account_id: `${n}`,
  name: `Account ${n}`,
  currency: 'EUR',
  account_status: 1,
});

describe('MetaOAuthService — Graph cursor pagination', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: InstanceType<typeof MetaOAuthService>;

  beforeEach(() => {
    logError.mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    service = new MetaOAuthService({ appId: 'app', appSecret: 'secret' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getAdAccounts', () => {
    it('walks every page and returns the union of all rows', async () => {
      // The bug this guards: reading only the first response silently
      // truncated every asset list at ~25 records ("missing ad accounts").
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], cursor(1)))
        .mockResolvedValueOnce(pageResponse([adAccountRow(2)], cursor(2)))
        .mockResolvedValueOnce(pageResponse([adAccountRow(3)]));

      const accounts = await service.getAdAccounts(TOKEN);

      expect(accounts.map((a) => a.id)).toEqual(['act_1', 'act_2', 'act_3']);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(logError).not.toHaveBeenCalled();
    });

    it('stops after the first page when there is no cursor', async () => {
      fetchMock.mockResolvedValueOnce(pageResponse([adAccountRow(1)]));

      await service.getAdAccounts(TOKEN);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(logError).not.toHaveBeenCalled();
    });

    it('carries businessId from the /me/adaccounts business edge', async () => {
      // /me/adaccounts does not group by business like /owned_ad_accounts, so
      // the `business{id}` field is what lets the connect-meta-ads union
      // preserve business attribution for token-scoped accounts.
      fetchMock.mockResolvedValueOnce(
        pageResponse([{ ...adAccountRow(1), business: { id: 'biz_9' } }])
      );

      const [account] = await service.getAdAccounts(TOKEN);

      expect(account.businessId).toBe('biz_9');
    });

    it('caps the walk at 20 pages and logs the truncation', async () => {
      // A self-referential cursor must not spin forever.
      fetchMock.mockResolvedValue(pageResponse([adAccountRow(0)], cursor(0)));

      const accounts = await service.getAdAccounts(TOKEN);

      // 1 first-page fetch + 20 paginated fetches.
      expect(fetchMock).toHaveBeenCalledTimes(21);
      expect(accounts).toHaveLength(21);
      const [operation, error] = logError.mock.calls.at(-1) as [
        string,
        Error,
        unknown,
      ];
      expect(operation).toBe('metaOAuth.fetchRemainingPages');
      expect(error.message).toMatch(/page cap/i);
    });

    it('stops at the wall-clock budget rather than spending minutes in the OAuth callback', async () => {
      // This walk runs inside the connect flow. A slow Graph must not turn
      // "connect your account" into a multi-minute spinner, so the budget
      // caps the WHOLE walk — well before the 20-page cap would.
      const realNow = Date.now();
      let tick = 0;
      // Each loop iteration reads the clock once; advance 9s per read so the
      // 20_000ms budget trips on the third check.
      vi.spyOn(Date, 'now').mockImplementation(() => realNow + 9_000 * tick++);
      fetchMock.mockResolvedValue(pageResponse([adAccountRow(0)], cursor(0)));

      const accounts = await service.getAdAccounts(TOKEN);

      // First page + 2 paginated pages, then the budget stops the walk.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(accounts).toHaveLength(3);
      const [operation, error] = logError.mock.calls.at(-1) as [string, Error];
      expect(operation).toBe('metaOAuth.fetchRemainingPages');
      expect(error.message).toMatch(/wall-clock budget/i);
      // Budget exhaustion is reported once, not also as a page-cap truncation.
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows already collected when a later page fails', async () => {
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], cursor(1)))
        .mockResolvedValueOnce(errorResponse('rate limited', 4));

      const accounts = await service.getAdAccounts(TOKEN);

      expect(accounts.map((a) => a.id)).toEqual(['act_1']);
      expect(logError).toHaveBeenCalledWith(
        'meta.getAdAccounts.pagination',
        expect.any(Error),
        expect.objectContaining({ feature: 'integrations' })
      );
      // An early bail is not a page-cap truncation — reporting it as one would
      // be a false signal on top of the failure already logged.
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows already collected when a later page throws', async () => {
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], cursor(1)))
        .mockRejectedValueOnce(new Error('socket hang up'));

      const accounts = await service.getAdAccounts(TOKEN);

      expect(accounts.map((a) => a.id)).toEqual(['act_1']);
      expect(logError).toHaveBeenCalledWith(
        'meta.getAdAccounts.pagination',
        expect.any(Error),
        expect.anything()
      );
    });

    it('still throws when the FIRST page fails (not a pagination failure)', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse('bad token', 190));

      await expect(service.getAdAccounts(TOKEN)).rejects.toThrow();
    });
  });

  describe('paging cursor host guard (SSRF)', () => {
    const stops = async (next: string) => {
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], next))
        .mockResolvedValue(pageResponse([adAccountRow(99)]));

      const accounts = await service.getAdAccounts(TOKEN);

      // Only the first-page fetch ran — the cursor was refused.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(accounts.map((a) => a.id)).toEqual(['act_1']);
      // Exactly one log: the refusal itself, not also a spurious page-cap
      // truncation (the loop bails with a cursor still pending).
      expect(logError).toHaveBeenCalledTimes(1);
    };

    it('refuses an unrelated host', async () => {
      await stops('https://evil.example.com/v21.0/me/adaccounts');
    });

    it('refuses a lookalike suffix host', async () => {
      // `graph.facebook.com.evil.com` must NOT satisfy the Graph-host check.
      await stops('https://graph.facebook.com.evil.com/v21.0/me/adaccounts');
    });

    it('refuses a prefixed lookalike host', async () => {
      await stops('https://notgraph.facebook.com.attacker.net/v21.0/x');
    });

    it('refuses an unparseable cursor without throwing', async () => {
      // `new URL()` throws on a relative/garbled cursor. That must log-and-stop
      // like any other pagination failure — no caller wraps this in try/catch.
      await stops('/v21.0/me/adaccounts?after=relative-cursor');
    });

    it('allows a graph.facebook.com cursor', async () => {
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], cursor(1)))
        .mockResolvedValueOnce(pageResponse([adAccountRow(2)]));

      const accounts = await service.getAdAccounts(TOKEN);

      expect(accounts.map((a) => a.id)).toEqual(['act_1', 'act_2']);
    });

    it('allows a facebook.com subdomain cursor', async () => {
      fetchMock
        .mockResolvedValueOnce(
          pageResponse([adAccountRow(1)], cursor(1, 'graph-video.facebook.com'))
        )
        .mockResolvedValueOnce(pageResponse([adAccountRow(2)]));

      const accounts = await service.getAdAccounts(TOKEN);

      expect(accounts.map((a) => a.id)).toEqual(['act_1', 'act_2']);
    });

    it('never puts the access token into the log payload of a refused host', async () => {
      await stops(`https://evil.example.com/x?access_token=${TOKEN}`);
      expectNoTokenLogged();
    });

    it('never puts the access token into the log payload of an unparseable cursor', async () => {
      // This is the leak path: a Graph `paging.next` carries the access token
      // in its query string, and Node attaches the whole offending string to
      // the URL-parse TypeError as `.input`. Anything downstream of `logError`
      // that serializes arbitrary error properties would publish the token.
      const bad = `not a url?access_token=${TOKEN}`;
      // Sanity-check the premise: Node really does attach the raw input.
      let parseError: unknown;
      try {
        new URL(bad);
      } catch (e) {
        parseError = e;
      }
      expect((parseError as { input?: string }).input).toContain(TOKEN);

      await stops(bad);
      expectNoTokenLogged();
    });

    const expectNoTokenLogged = () => {
      const serialized = JSON.stringify(
        logError.mock.calls.map(([operation, error, context]) => ({
          operation,
          message: (error as Error)?.message,
          stack: (error as Error)?.stack,
          input: (error as unknown as { input?: string })?.input,
          context,
        }))
      );
      expect(serialized).not.toContain(TOKEN);
    };
  });

  describe('the other paginated list fetchers', () => {
    it('paginates getPages', async () => {
      const pageRow = (n: number) => ({
        id: `page_${n}`,
        name: `Page ${n}`,
        access_token: `page-token-${n}`,
      });
      fetchMock
        .mockResolvedValueOnce(pageResponse([pageRow(1)], cursor(1)))
        .mockResolvedValueOnce(pageResponse([pageRow(2)]));

      const pages = await service.getPages(TOKEN);

      expect(pages.map((p) => p.id)).toEqual(['page_1', 'page_2']);
    });

    it('paginates getBusinesses', async () => {
      fetchMock
        .mockResolvedValueOnce(
          pageResponse([{ id: 'biz_1', name: 'One' }], cursor(1))
        )
        .mockResolvedValueOnce(pageResponse([{ id: 'biz_2', name: 'Two' }]));

      const businesses = await service.getBusinesses(TOKEN);

      expect(businesses.map((b) => b.id)).toEqual(['biz_1', 'biz_2']);
    });

    it('paginates getBusinessAdAccounts', async () => {
      fetchMock
        .mockResolvedValueOnce(pageResponse([adAccountRow(1)], cursor(1)))
        .mockResolvedValueOnce(pageResponse([adAccountRow(2)]));

      const accounts = await service.getBusinessAdAccounts(TOKEN, 'biz_1');

      expect(accounts.map((a) => a.id)).toEqual(['act_1', 'act_2']);
    });

    it('paginates getBusinessPages', async () => {
      const pageRow = (n: number) => ({
        id: `page_${n}`,
        name: `Page ${n}`,
        access_token: `page-token-${n}`,
      });
      fetchMock
        .mockResolvedValueOnce(pageResponse([pageRow(1)], cursor(1)))
        .mockResolvedValueOnce(pageResponse([pageRow(2)]));

      const pages = await service.getBusinessPages(TOKEN, 'biz_1');

      expect(pages.map((p) => p.id)).toEqual(['page_1', 'page_2']);
    });
  });
});
