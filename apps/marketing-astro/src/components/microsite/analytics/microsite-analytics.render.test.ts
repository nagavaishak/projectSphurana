import MicrositeShell from '@/layouts/MicrositeShell.astro';
/**
 * WHAT THE SHELL ACTUALLY EMITS.
 *
 * Two things are proved here that no unit test can prove:
 *
 * 1. A microsite with NO pixel renders exactly as it did before this feature
 *    existed — no banner, no analytics config node, no Meta origin anywhere in
 *    the bytes. Most tenants will be in that state for a long time.
 * 2. When there IS a pixel, the component emits the ids and attributes the
 *    runtime keys on — which is what stops `pixel-runtime.test.ts`'s fixture
 *    from drifting away from the real markup.
 *
 * The pixel-with-consent behaviour is asserted in `pixel-runtime.test.ts`; it
 * is a runtime behaviour and cannot be read off static HTML.
 */
import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveMicrositeAnalytics } from './consent';

const THEME: MicrositeTheme = {
  brand: {
    primary: '#111111',
    accent: '#2266cc',
    neutral: '#555555',
    surface: '#ffffff',
  },
  logo: { assetUrl: null },
  typography: { scale: 'default' },
  radius: 'md',
  buttonStyle: 'solid',
  density: 'comfortable',
};

const PIXEL_ID = '1234567890123456';
const EVENT_ID = '3f1a9e1c-6a2b-4f0e-9d33-1a2b3c4d5e6f';

const renderShell = async (props: Record<string, unknown>): Promise<string> => {
  const container = await AstroContainer.create();
  return container.renderToString(MicrositeShell, {
    props: { theme: THEME, title: 'Glow Clinic', ...props },
    slots: { default: '<main><h1>Glow Clinic</h1></main>' },
  });
};

describe('a microsite with NO pixel is untouched', () => {
  let html = '';

  beforeAll(async () => {
    html = await renderShell({});
  });

  it('rendered the page — otherwise the absences below are vacuous', () => {
    expect(html).toContain('Glow Clinic');
    expect(html).toContain('body class="microsite"');
  });

  it('emits no consent banner', () => {
    expect(html).not.toContain('ms-consent');
    expect(html).not.toContain('data-ms-consent-action');
    expect(html).not.toContain('Cookie settings');
  });

  it('emits no analytics config node', () => {
    expect(html).not.toContain('ms-analytics-config');
    expect(html).not.toContain('data-pixel-id');
    expect(html).not.toContain('data-event-id');
  });

  it('adds no banner CSS either — the styles ship inline, with the banner', () => {
    expect(html).not.toContain('.ms-consent');
    expect(html).not.toContain('ms-consent-reopen');
  });

  it('names no Meta origin anywhere in the bytes', () => {
    expect(html).not.toContain('facebook');
    expect(html).not.toContain('fbq');
  });

  it('is identical whether analytics is absent, null, or an unusable pixel', async () => {
    const asNull = await renderShell({ analytics: null });
    const asUnusable = await renderShell({
      analytics: resolveMicrositeAnalytics({ pixelId: 'not-a-pixel' }),
    });
    expect(asNull).toBe(html);
    expect(asUnusable).toBe(html);
  });
});

describe('a microsite WITH a pixel', () => {
  let html = '';

  beforeAll(async () => {
    html = await renderShell({
      analytics: resolveMicrositeAnalytics({
        pixelId: PIXEL_ID,
        pageViewEventId: EVENT_ID,
      }),
      businessName: 'Glow Clinic',
      privacyHref: '/privacy',
    });
  });

  it('hands the runtime the pixel id and the event id', () => {
    expect(html).toContain('id="ms-analytics-config"');
    expect(html).toContain(`data-pixel-id="${PIXEL_ID}"`);
    expect(html).toContain(`data-event-id="${EVENT_ID}"`);
  });

  it('renders the banner hidden — the runtime decides whether to show it', () => {
    const banner = html.slice(
      html.indexOf('id="ms-consent"'),
      html.indexOf('id="ms-consent"') + 400
    );
    expect(banner).toContain('hidden');
  });

  it('offers decline and accept as equal, one-click choices', () => {
    expect(html).toContain('data-ms-consent-action="decline"');
    expect(html).toContain('data-ms-consent-action="accept"');
    // Same element, same class — neither choice is the styled-down one.
    const buttons =
      html.match(
        /<button[^>]*data-ms-consent-action="(decline|accept)"[^>]*>/g
      ) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.includes('ms-consent__button'))).toBe(true);
  });

  it('carries its own styles inline, so they exist only on this response', () => {
    expect(html).toContain('.ms-consent__button');
  });

  it('offers a way back to the choice', () => {
    expect(html).toContain('id="ms-consent-reopen"');
    expect(html).toContain('data-ms-consent-action="reopen"');
  });

  it('requests NOTHING from Meta in the markup itself', () => {
    // No script tag, no preconnect, no pixel <img> fallback: every Meta request
    // is made by the runtime, after a click. A `<noscript>` <img> beacon — the
    // stock Meta snippet's second half — would fire with no consent possible,
    // so it is deliberately absent.
    expect(html).not.toContain('connect.facebook.net');
    expect(html).not.toContain('facebook.com/tr');
    expect(html).not.toContain('<noscript');
  });

  it('names the business and links the privacy policy', () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('Glow Clinic would like to use');
  });
});
