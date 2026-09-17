import { sendHtmlEmail } from '@borradh-workspace/email';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  type DomainMockDb,
  createDomainMockDb,
} from './domain-mock-db.test-utils.js';
import { handleDomainChanged } from './handle-domain-changed.service.js';
import { swapUrlHost } from './rewrite-ad-destinations.service.js';

const payload = {
  micrositeId: 'site-1',
  organizationId: 'org-1',
  domainId: 'dom-1',
  previousHost: 'acme.borradh.io',
  newHost: 'salon.com',
};

let db: DomainMockDb;

describe('swapUrlHost', () => {
  it('swaps the host and keeps the path and UTM query', () => {
    expect(
      swapUrlHost(
        'https://acme.borradh.io/book?utm_source=fb&utm_campaign=may',
        'acme.borradh.io',
        'salon.com'
      )
    ).toBe('https://salon.com/book?utm_source=fb&utm_campaign=may');
  });

  it('matches the www half of the old host too', () => {
    expect(
      swapUrlHost('https://www.old.com/book', 'old.com', 'salon.com')
    ).toBe('https://salon.com/book');
  });

  it('leaves a URL on some other host alone', () => {
    expect(
      swapUrlHost('https://facebook.com/acme', 'acme.borradh.io', 'salon.com')
    ).toBeNull();
  });

  it('upgrades http to https, since a custom domain is always on TLS', () => {
    expect(swapUrlHost('http://old.com/x', 'old.com', 'salon.com')).toBe(
      'https://salon.com/x'
    );
  });
});

describe('handleDomainChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createDomainMockDb();
    db.query.organization.findFirst.mockResolvedValue({ name: 'Acme Salon' });
  });

  it('rewrites the destination URL on live ads pointing at the old host', async () => {
    db.selectQueue.push(
      [
        { id: 'ad-1', destinationUrl: 'https://acme.borradh.io/book' },
        { id: 'ad-2', destinationUrl: 'https://partner.example.com/x' },
      ],
      [] // no admins to email
    );
    const updateAd = vi.fn(async () => ({ success: true as const, data: {} }));

    const result = await handleDomainChanged(db as never, payload, {
      updateAd: updateAd as never,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.adsRewritten).toBe(1);
    expect(updateAd).toHaveBeenCalledTimes(1);
    expect(updateAd).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        adId: 'ad-1',
        destinationUrl: 'https://salon.com/book',
      })
    );
  });

  it('keeps going when one ad fails, and reports it', async () => {
    db.selectQueue.push(
      [
        { id: 'ad-1', destinationUrl: 'https://acme.borradh.io/a' },
        { id: 'ad-2', destinationUrl: 'https://acme.borradh.io/b' },
      ],
      []
    );
    const updateAd = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'meta said no' },
      })
      .mockResolvedValueOnce({ success: true, data: {} });

    const result = await handleDomainChanged(db as never, payload, {
      updateAd: updateAd as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.adsRewritten).toBe(1);
    expect(result.data.adsFailed).toBe(1);
  });

  it('tells the admins to redo Meta domain verification and AEM for the new host', async () => {
    db.selectQueue.push(
      [], // no ads
      [{ userId: 'u1', name: 'Owner', email: 'owner@salon.com' }]
    );

    const result = await handleDomainChanged(db as never, payload, {
      updateAd: vi.fn() as never,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.metaNotified).toBe(1);
    expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
    const email = vi.mocked(sendHtmlEmail).mock.calls[0][0];
    expect(email.subject).toContain('salon.com');
    expect(email.html).toContain('Aggregated Event Measurement');
  });
});
