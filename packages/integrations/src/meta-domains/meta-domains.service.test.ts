/**
 * The cases that matter here are the three that decide whether a human gets
 * involved: already ours (silent success), already SOMEONE ELSE'S (permanent
 * conflict), and a Business Manager that has not completed Meta's business
 * verification (blocks the API entirely, unrelated to the domain).
 *
 * No real Meta calls: `fetch` is stubbed for every test in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaOwnedDomainError } from './meta-domains.errors.js';
import { MetaOwnedDomainsService } from './meta-domains.service.js';

const BUSINESS_ID = 'biz-1';

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const errorResponse = (message: string, code = 100): Response => {
  const body = { error: { message, type: 'OAuthException', code } };
  return {
    ok: false,
    status: 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
};

const listPayload = (domains: unknown[]) => jsonResponse({ data: domains });

describe('MetaOwnedDomainsService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: MetaOwnedDomainsService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = new MetaOwnedDomainsService({
      accessToken: 'tok',
      businessId: BUSINESS_ID,
      appSecret: 'app-secret-value',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const urlOf = (call: number) => String(fetchMock.mock.calls[call][0]);

  it('claiming a domain the business ALREADY owns is success, not an error', async () => {
    fetchMock.mockResolvedValueOnce(
      listPayload([
        {
          id: 'od-1',
          domain: 'salon.com',
          verification_status: 'VERIFIED',
          verification_code: 'abc123',
        },
      ])
    );

    const result = await service.claimDomain('Salon.com');

    expect(result.outcome).toBe('already_owned');
    expect(result.ownedDomain.verificationToken).toBe('abc123');
    // Read-first: no POST was ever issued.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('claims an unowned domain and returns the verification token', async () => {
    fetchMock.mockResolvedValueOnce(listPayload([])).mockResolvedValueOnce(
      jsonResponse({
        id: 'od-2',
        domain: 'salon.com',
        verification_status: 'NOT_VERIFIED',
        verification_code: 'tok-xyz',
      })
    );

    const result = await service.claimDomain('salon.com');

    expect(result.outcome).toBe('claimed');
    expect(result.ownedDomain.verificationToken).toBe('tok-xyz');
    expect(urlOf(1)).toContain(`/${BUSINESS_ID}/owned_domains`);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain(
      'domain_name=salon.com'
    );
  });

  it('sends appsecret_proof, never the app secret itself', async () => {
    fetchMock.mockResolvedValueOnce(listPayload([]));
    await service.getOwnedDomain('salon.com');

    expect(urlOf(0)).toContain('appsecret_proof=');
    expect(urlOf(0)).not.toContain('app-secret-value');
  });

  it('a domain claimed by a DIFFERENT business is a conflict a human must fix', async () => {
    fetchMock
      .mockResolvedValueOnce(listPayload([])) // not ours
      .mockResolvedValueOnce(
        errorResponse(
          'This domain has already been claimed by another business.'
        )
      )
      .mockResolvedValueOnce(listPayload([])); // re-read: still not ours

    await expect(service.claimDomain('salon.com')).rejects.toMatchObject({
      reason: 'already_owned_elsewhere',
    });
  });

  it('treats an already-claimed error as SUCCESS when the re-read shows it is ours', async () => {
    fetchMock
      .mockResolvedValueOnce(listPayload([])) // racing worker had not landed yet
      .mockResolvedValueOnce(errorResponse('Domain already owned'))
      .mockResolvedValueOnce(
        listPayload([
          { id: 'od-3', domain: 'salon.com', verification_status: 'PENDING' },
        ])
      );

    const result = await service.claimDomain('salon.com');
    expect(result.outcome).toBe('already_owned');
  });

  it('reports an unverified Business Manager distinctly from a transient failure', async () => {
    fetchMock
      .mockResolvedValueOnce(listPayload([]))
      .mockResolvedValueOnce(
        errorResponse(
          'Your business must be verified before you can claim a domain.',
          200
        )
      );

    const error = await service.claimDomain('salon.com').catch((e) => e);
    expect(error).toBeInstanceOf(MetaOwnedDomainError);
    expect(error.reason).toBe('business_not_verified');
    expect(error.isRetryable).toBe(false);
  });

  it('classifies an unrecognised Meta failure as transient so the poller retries', async () => {
    fetchMock
      .mockResolvedValueOnce(listPayload([]))
      .mockResolvedValueOnce(
        errorResponse('Please reduce the amount of data', 1)
      );

    const error = await service.claimDomain('salon.com').catch((e) => e);
    expect(error.reason).toBe('transient');
    expect(error.isRetryable).toBe(true);
  });

  it('falls back to the core field set when Meta rejects verification_code', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(
          '(#100) Tried accessing nonexisting field (verification_code)'
        )
      )
      .mockResolvedValueOnce(
        listPayload([
          { id: 'od-4', domain: 'salon.com', verification_status: 'VERIFIED' },
        ])
      );

    const found = await service.getOwnedDomain('salon.com');

    expect(found?.verificationStatus).toBe('VERIFIED');
    expect(found?.verificationToken).toBeUndefined();
    expect(urlOf(0)).toContain('verification_code');
    expect(urlOf(1)).not.toContain('verification_code');
  });

  it('follows pagination when the business owns many domains', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'a', domain: 'other.com' }],
          paging: { next: 'https://graph.facebook.com/next-page' },
        })
      )
      .mockResolvedValueOnce(listPayload([{ id: 'b', domain: 'salon.com' }]));

    const found = await service.getOwnedDomain('salon.com');
    expect(found?.id).toBe('b');
  });
});
