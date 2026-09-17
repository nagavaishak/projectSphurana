import { apiEnv } from '@borradh-workspace/env/api';
import { describe, expect, it } from '@borradh-workspace/testing';
import type { MicrositeLinkTarget } from './microsite-host.js';
import { pathTierLinkTarget } from './microsite-host.js';
import {
  micrositeBookingBase,
  micrositeBookingUrl,
  micrositePortalBase,
  micrositeServiceBookingUrl,
} from './microsite-links.js';

// `packages/features/src/__mocks__/env-api.ts`. MARKETING is the marketing app
// (which serves microsites, booking and the portal); WEB is the dashboard,
// which serves NONE of them. They are separate hosts in the mock on purpose —
// see the `never builds on the dashboard host` test below.
const MARKETING = 'https://mock-marketing.example.com';
const WEB = 'https://mock-web.example.com';

const onDomain = (domain: string): MicrositeLinkTarget => ({
  organizationSlug: 'glow-clinic',
  primaryDomain: domain,
});

/**
 * Every assertion here pins a FULL url rather than a path fragment. The whole
 * class of bug this file exists to prevent (ENG-770) is a correct path on the
 * wrong host, which a `toContain('/book')` waves through.
 */
describe('microsite links — path tier (no live custom domain)', () => {
  const target = pathTierLinkTarget('glow-clinic');

  it('builds the booking base under /sites/{slug}', () => {
    expect(micrositeBookingBase(target)).toBe(
      `${MARKETING}/sites/glow-clinic/book`
    );
  });

  it('names the branch in the generic booking url when one is known', () => {
    // The shape the connected-chatbot spec pins. Claire resolves the
    // conversation's branch and quotes its prices, so the link she sends must
    // name that same branch and land the customer on the form directly.
    expect(micrositeBookingUrl(target, 'cork')).toBe(
      `${MARKETING}/sites/glow-clinic/l/cork/book`
    );
  });

  it('falls back to the un-branched entry when no branch is known', () => {
    // A multi-branch org whose conversation carries no branch signal. The
    // entry rules render the chooser; guessing a branch here would stamp a
    // real-looking one onto a conversation nobody has said anything about.
    expect(micrositeBookingUrl(target)).toBe(
      `${MARKETING}/sites/glow-clinic/book`
    );
    expect(micrositeBookingUrl(target, null)).toBe(
      `${MARKETING}/sites/glow-clinic/book`
    );
  });

  it('never emits the retired /book/l/ ordering, which only resolves via a 301', () => {
    expect(micrositeBookingUrl(target, 'cork')).not.toContain('/book/l/');
  });

  it('builds a per-service booking url under /sites/{slug}', () => {
    expect(micrositeServiceBookingUrl(target, 'svc-1')).toBe(
      `${MARKETING}/sites/glow-clinic/book/svc-1`
    );
  });

  it('carries the BRANCH when the caller knows one', () => {
    // Claire's case. She has already quoted THIS branch's price, so a
    // branch-less link asks the customer a question she has the answer to.
    expect(micrositeServiceBookingUrl(target, 'svc-1', 'cork')).toBe(
      `${MARKETING}/sites/glow-clinic/l/cork/book/svc-1`
    );
  });

  it('addresses a slug-less branch by id', () => {
    // `slug` is nullable and the backfill has not run, so pre-backfill this is
    // the ONLY form available for every real org.
    expect(micrositeServiceBookingUrl(target, 'svc-1', 'ib0go2zlh69el')).toBe(
      `${MARKETING}/sites/glow-clinic/l/ib0go2zlh69el/book/svc-1`
    );
  });

  it('percent-encodes the branch segment too', () => {
    expect(micrositeServiceBookingUrl(target, 'svc/1', 'st patrick/s')).toBe(
      `${MARKETING}/sites/glow-clinic/l/st%20patrick%2Fs/book/svc%2F1`
    );
  });

  it('falls back to the org-level form when there is no branch', () => {
    // SAFE, not wrong: that URL lands on the entry rules, so a multi-branch org
    // gets the chooser with the service carried through and a single-branch org
    // 302s to its one branch. Nobody is silently booked into the primary.
    for (const branch of [undefined, null, '']) {
      expect(micrositeServiceBookingUrl(target, 'svc-1', branch)).toBe(
        `${MARKETING}/sites/glow-clinic/book/svc-1`
      );
    }
  });

  it('builds the portal base under /sites/{slug}', () => {
    expect(micrositePortalBase(target)).toBe(
      `${MARKETING}/sites/glow-clinic/portal`
    );
  });

  it('percent-encodes the slug and the service id', () => {
    expect(micrositeServiceBookingUrl(pathTierLinkTarget('a/b'), 'svc/1')).toBe(
      `${MARKETING}/sites/a%2Fb/book/svc%2F1`
    );
  });

  it('never builds on the dashboard host — booking and the portal do not exist there', () => {
    // The regression this whole file exists for. `WEB_URL` is the dashboard
    // app; it served /book and /portal until they moved to marketing, so a
    // builder that reaches for it produces a URL that looks entirely plausible
    // and 404s for the customer.
    for (const url of [
      micrositeBookingBase(target),
      micrositeServiceBookingUrl(target, 'svc-1'),
      micrositePortalBase(target),
    ]) {
      expect(url).not.toContain(WEB);
      expect(url.startsWith(MARKETING)).toBe(true);
    }
  });
});

describe('microsite links — MARKETING_URL missing', () => {
  /**
   * The fallback exists because these builders sit on submitGeneralBooking,
   * every confirmation and consent email, patient magic links and every
   * chatbot reply. Throwing here does not degrade those — it 500s public
   * booking. So an unset variable must still produce a link, and must shout.
   */
  it('falls back to WEB_URL rather than throwing — booking must not 500 on a config gap', () => {
    // `vi.stubEnv` cannot reach this: the env module is mocked
    // (__mocks__/env-api.ts), so the builders read a fixed object rather than
    // process.env. Override the property and restore it — the suite runs with
    // isolate:false, so a leaked override would corrupt every later test.
    const mutable = apiEnv as { MARKETING_URL?: string };
    const original = mutable.MARKETING_URL;
    mutable.MARKETING_URL = undefined;
    try {
      expect(micrositeBookingBase(pathTierLinkTarget('glow-clinic'))).toBe(
        `${WEB}/sites/glow-clinic/book`
      );
    } finally {
      mutable.MARKETING_URL = original;
    }
  });

  it('restores MARKETING_URL afterwards — the fallback test must not leak', () => {
    expect(micrositeBookingBase(pathTierLinkTarget('glow-clinic'))).toBe(
      `${MARKETING}/sites/glow-clinic/book`
    );
  });
});

describe('microsite links — tenant host (live primary domain)', () => {
  const target = onDomain('glowaesthetics.ie');

  it('puts booking on the tenant host with NO /sites/ segment', () => {
    const url = micrositeBookingBase(target);
    expect(url).toBe('https://glowaesthetics.ie/book');
    expect(url).not.toContain('/sites/');
  });

  it('puts a per-service booking url on the tenant host', () => {
    const url = micrositeServiceBookingUrl(target, 'svc-1');
    expect(url).toBe('https://glowaesthetics.ie/book/svc-1');
    expect(url).not.toContain('/sites/');
  });

  it('puts the portal on the tenant host with NO /sites/ segment', () => {
    const url = micrositePortalBase(target);
    expect(url).toBe('https://glowaesthetics.ie/portal');
    expect(url).not.toContain('/sites/');
  });

  it('never mentions our host — that is the entire point of the feature', () => {
    for (const url of [
      micrositeBookingBase(target),
      micrositeServiceBookingUrl(target, 'svc-1'),
      micrositePortalBase(target),
    ]) {
      expect(url).not.toContain('mock-marketing.example.com');
    }
  });

  it('drops the slug entirely — the org is implied by the hostname', () => {
    // Same host, different slug: the url must not change.
    expect(
      micrositeBookingBase({
        organizationSlug: 'a-completely-different-slug',
        primaryDomain: 'glowaesthetics.ie',
      })
    ).toBe('https://glowaesthetics.ie/book');
  });
});
