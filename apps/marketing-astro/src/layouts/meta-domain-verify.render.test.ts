import MicrositeShell from '@/layouts/MicrositeShell.astro';
/**
 * THE TAG IS EITHER IN THE HTML OR META NEVER VERIFIES THE DOMAIN.
 *
 * There is no retry and no error for getting this wrong: Meta crawls the
 * tenant's custom domain, finds no `facebook-domain-verify` tag, and the domain
 * stays unverified — which quietly makes the pixel near-useless for iOS
 * traffic. Plan §9.4's whole claim is that because WE render the page this is
 * automatic rather than a support ticket, so the tag's presence is asserted
 * against the real rendered bytes.
 */
import { META_DOMAIN_VERIFY_TAG_NAME } from '@borradh-workspace/web-shared';
import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

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

const TOKEN = 'k9f2h1a0b3c4d5e6f7g8h9i0j1k2l3';

const renderShell = async (props: Record<string, unknown>): Promise<string> => {
  const container = await AstroContainer.create();
  return container.renderToString(MicrositeShell, {
    props: { theme: THEME, title: 'Glow Clinic', ...props },
    slots: { default: '<main><h1>Glow Clinic</h1></main>' },
  });
};

describe('meta domain verification tag', () => {
  it('emits the tag in the head when the host has a token', async () => {
    const html = await renderShell({ metaDomainVerifyToken: TOKEN });

    expect(html).toContain('Glow Clinic'); // otherwise the assertion below is vacuous
    expect(html).toContain(
      `<meta name="${META_DOMAIN_VERIFY_TAG_NAME}" content="${TOKEN}">`
    );
    // Meta only reads the head.
    expect(html.indexOf(TOKEN)).toBeLessThan(html.indexOf('</head>'));
  });

  it('emits nothing when there is no token', async () => {
    // `{slug}.borradh.io` is OUR apex — a token there verifies nothing for the
    // tenant, so the server returns null and the head must stay clean.
    for (const props of [{}, { metaDomainVerifyToken: null }]) {
      const html = await renderShell(props);
      expect(html).toContain('Glow Clinic');
      expect(html).not.toContain(META_DOMAIN_VERIFY_TAG_NAME);
    }
  });
});
