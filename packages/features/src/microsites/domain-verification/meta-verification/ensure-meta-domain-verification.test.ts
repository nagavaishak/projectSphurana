/**
 * The cases worth pinning are the ones that decide whether a person gets
 * involved, and whether a domain activation can be taken down by Meta:
 *
 *   - a domain the business already owns is SUCCESS (the poller retries, so
 *     this is the steady state, not the exception),
 *   - a domain owned by ANOTHER business surfaces as a conflict, once,
 *   - an unverified Business Manager is reported distinctly from a Meta
 *     outage, because the two need completely different human actions,
 *   - nothing here ever returns an error result.
 *
 * The Meta client is the canonical alias mock — no HTTP leaves this file.
 */

import { sendHtmlEmail } from '@borradh-workspace/email';
import {
  MetaOwnedDomainError,
  mockMetaOwnedDomainsService,
} from '@borradh-workspace/integrations/meta-domains';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../../../meta-ads/services/_shared/__fixtures__/shared-spies.js';
import {
  type DomainMockDb,
  createDomainMockDb,
} from '../domain-mock-db.test-utils.js';
import { ensureMetaDomainVerification } from './ensure-meta-domain-verification.service.js';
import { META_VERIFICATION_KEY } from './meta-verification.types.js';

const ORG_ID = 'org-1';
const HOST = 'salon.com';

const claimDomain = vi.mocked(mockMetaOwnedDomainsService.claimDomain);

const credentials = () => ({
  success: true as const,
  data: {
    credentials: {
      accessToken: 'tok',
      adAccountId: 'act_9',
      pageId: 'fb_1',
      appSecret: undefined,
    },
    integration: {
      id: 'int_1',
      adAccountId: 'act_9',
      availableAdAccounts: [{ id: 'act_9', businessId: 'biz_7' }],
    },
    resolvedPage: { id: 'page_1', pageId: 'fb_1', pageName: 'Salon' },
  },
});

const domainRow = (verification: unknown = null) => ({
  id: 'dom-1',
  domain: HOST,
  micrositeId: 'site-1',
  organizationId: ORG_ID,
  status: 'active',
  verification,
});

/** What was written into `microsite_domain.verification.meta`. */
const storedState = (db: DomainMockDb) => {
  const calls = db.set.mock.calls;
  const last = calls[calls.length - 1]?.[0] as
    | { verification?: Record<string, unknown> }
    | undefined;
  return last?.verification?.[META_VERIFICATION_KEY] as
    | Record<string, unknown>
    | undefined;
};

describe('ensureMetaDomainVerification', () => {
  let db: DomainMockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    metaAdsSharedMocks.getMetaCredentials.mockResolvedValue(credentials());
    db = createDomainMockDb();
    db.query.micrositeDomain.findFirst.mockResolvedValue(domainRow());
    db.selectQueue.push([
      { userId: 'u1', name: 'Owner', email: 'owner@salon.com' },
    ]);
  });

  afterEach(restoreMetaAdsSharedSpies);

  it('stores the verification token when the domain is claimed', async () => {
    claimDomain.mockResolvedValueOnce({
      outcome: 'claimed',
      ownedDomain: {
        id: 'od-1',
        domain: HOST,
        verificationStatus: 'NOT_VERIFIED',
        verificationToken: 'tok-abc',
      },
    });

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('claimed');
    expect(result.data.tokenStored).toBe(true);
    // The token itself never leaves in the result — only in the row.
    expect(storedState(db)?.token).toBe('tok-abc');
    expect(sendHtmlEmail).not.toHaveBeenCalled();
  });

  it('a domain the business already owns is SUCCESS, not an error', async () => {
    claimDomain.mockResolvedValueOnce({
      outcome: 'already_owned',
      ownedDomain: {
        id: 'od-1',
        domain: HOST,
        verificationStatus: 'VERIFIED',
        verificationToken: 'tok-abc',
      },
    });

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('verified');
    expect(result.data.needsHuman).toBe(false);
    expect(sendHtmlEmail).not.toHaveBeenCalled();
  });

  it('surfaces a domain owned by a DIFFERENT business as a human-actionable conflict', async () => {
    claimDomain.mockRejectedValueOnce(
      new MetaOwnedDomainError('already_owned_elsewhere', 'claimed elsewhere')
    );

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('conflict');
    expect(result.data.needsHuman).toBe(true);
    expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendHtmlEmail).mock.calls[0][0].html).toContain(
      'already claimed by a'
    );
  });

  it('emails once per reason, however many times the poller retries', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      domainRow({
        [META_VERIFICATION_KEY]: {
          outcome: 'conflict',
          notifiedOutcome: 'conflict',
        },
      })
    );
    claimDomain.mockRejectedValueOnce(
      new MetaOwnedDomainError('already_owned_elsewhere', 'claimed elsewhere')
    );

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    expect(sendHtmlEmail).not.toHaveBeenCalled();
  });

  it('reports an unverified Business Manager distinctly, with its own instructions', async () => {
    claimDomain.mockRejectedValueOnce(
      new MetaOwnedDomainError('business_not_verified', 'verify your business')
    );

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('business_unverified');
    expect(vi.mocked(sendHtmlEmail).mock.calls[0][0].html).toContain(
      'Business Verification'
    );
  });

  it('a Meta outage is transient: no email, no failure, and the stored token survives', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(
      domainRow({
        [META_VERIFICATION_KEY]: { outcome: 'verified', token: 'tok-old' },
      })
    );
    claimDomain.mockRejectedValueOnce(new Error('socket hang up'));

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.outcome).toBe('transient_failure');
    expect(result.data.needsHuman).toBe(false);
    expect(storedState(db)?.token).toBe('tok-old');
    expect(sendHtmlEmail).not.toHaveBeenCalled();
  });

  it("does not try to claim our own shared apex on the tenant's behalf", async () => {
    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: 'acme.borradh.io',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('shared_apex');
    expect(claimDomain).not.toHaveBeenCalled();
  });

  it('does nothing when the org has no Meta integration', async () => {
    metaAdsSharedMocks.getMetaCredentials.mockResolvedValue({
      success: false,
      error: { code: 'META_NOT_CONFIGURED', message: 'nope' },
    });

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('meta_not_configured');
    expect(claimDomain).not.toHaveBeenCalled();
  });

  it('refuses a host belonging to another org', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      ...domainRow(),
      organizationId: 'someone-else',
    });

    const result = await ensureMetaDomainVerification(db as never, {
      organizationId: ORG_ID,
      host: HOST,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outcome).toBe('unknown_host');
    expect(claimDomain).not.toHaveBeenCalled();
  });
});
