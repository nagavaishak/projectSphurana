import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { pathTierLinkTarget } from '../../../shared/index.js';
import {
  buildCampaignDestinationUrl,
  campaignHasSiteDestination,
  resolveCampaignDestinationUrl,
} from './campaign-destination.js';

describe('buildCampaignDestinationUrl', () => {
  it('uses the tenant host when a custom domain is live', () => {
    const url = buildCampaignDestinationUrl(
      { organizationSlug: 'glow-salon', primaryDomain: 'salon.com' },
      'camp_1'
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe('salon.com');
    // No `/sites/{slug}` prefix on the tenant's own host — it would 404.
    expect(parsed.pathname).toBe('/book');
    expect(parsed.searchParams.get('utm_campaign')).toBe('camp_1');
    expect(parsed.searchParams.get('utm_source')).toBe('meta');
  });

  it('falls back to the path tier when no domain is live', () => {
    const url = buildCampaignDestinationUrl(
      pathTierLinkTarget('glow-salon'),
      'camp_1'
    );
    expect(url).toContain('/sites/glow-salon/book');
    expect(url).toContain('utm_campaign=camp_1');
    expect(url).not.toContain('salon.com');
  });

  it('tags with the campaign ID, so a rename cannot orphan the leads', () => {
    const url = buildCampaignDestinationUrl(
      { organizationSlug: 'glow-salon', primaryDomain: 'salon.com' },
      '120210000000000'
    );
    expect(new URL(url).searchParams.get('utm_campaign')).toBe(
      '120210000000000'
    );
  });
});

describe('resolveCampaignDestinationUrl', () => {
  const mockDb = (over: {
    org?: unknown;
    domain?: { domain: string } | null;
  }) => ({
    query: {
      organization: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            over.org === undefined
              ? { id: 'org_1', slug: 'glow-salon' }
              : over.org
          ),
      },
      micrositeDomain: {
        findFirst: vi.fn().mockResolvedValue(over.domain ?? null),
      },
    },
  });

  it('resolves the host through the domain table, never by composing it', async () => {
    const db = mockDb({ domain: { domain: 'salon.com' } });
    const url = await resolveCampaignDestinationUrl(db as never, {
      organizationId: 'org_1',
      metaCampaignId: 'camp_1',
    });
    expect(url).toBe(
      'https://salon.com/book?utm_source=meta&utm_medium=paid_social&utm_campaign=camp_1'
    );
  });

  it('uses the path tier when the tenant has no live domain', async () => {
    const db = mockDb({ domain: null });
    const url = await resolveCampaignDestinationUrl(db as never, {
      organizationId: 'org_1',
      metaCampaignId: 'camp_1',
    });
    expect(url).toContain('/sites/glow-salon/book');
  });

  it('returns null — not an error — when the org cannot be read', async () => {
    const db = mockDb({ org: null });
    const url = await resolveCampaignDestinationUrl(db as never, {
      organizationId: 'org_missing',
      metaCampaignId: 'camp_1',
    });
    expect(url).toBeNull();
  });
});

describe('campaignHasSiteDestination', () => {
  it('excludes campaign types that have no URL', () => {
    expect(campaignHasSiteDestination('chatbot')).toBe(false);
    expect(campaignHasSiteDestination('lead_form')).toBe(false);
    expect(campaignHasSiteDestination('email_only')).toBe(true);
    expect(campaignHasSiteDestination('sequence')).toBe(true);
  });
});
