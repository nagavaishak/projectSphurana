/**
 * Shared fixtures for the microsite service tests. Not exported from the
 * services barrel — test-only.
 */

import type { Block, MicrositeTheme } from '@borradh-workspace/web-shared';

export const ORG_ID = 'org-1';
export const OTHER_ORG_ID = 'org-2';
export const SITE_ID = 'site-1';

export const THEME: MicrositeTheme = {
  brand: {
    primary: '#2B8553',
    accent: '#B8D2CA',
    neutral: '#111111',
    surface: '#FFFFFF',
  },
  logo: { assetUrl: null },
  typography: { scale: 'default' },
  radius: 'md',
  buttonStyle: 'solid',
  density: 'comfortable',
};

export const HERO_BLOCK: Block = {
  id: 'blk-hero',
  type: 'hero',
  variant: 'image-right',
  props: { headline: 'Book your appointment' },
};

export const CTA_BLOCK: Block = {
  id: 'blk-cta',
  type: 'cta_booking',
  variant: 'band',
  props: { headline: 'Ready?', buttonLabel: 'Book now' },
};

/**
 * A block written by an older schema version: `hero` with no headline. The
 * column type says `Block`; postgres disagrees.
 */
export const LEGACY_BROKEN_BLOCK = {
  id: 'blk-legacy',
  type: 'hero',
  variant: 'image-right',
  props: { title: 'Old field name' },
};

export const pageRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-home',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  path: '/',
  title: 'Home',
  seo: {},
  blocks: [HERO_BLOCK],
  order: 0,
  isSystem: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const micrositeRow = (overrides: Record<string, unknown> = {}) => ({
  id: SITE_ID,
  organizationId: ORG_ID,
  slug: 'acme-salon',
  status: 'draft' as const,
  theme: THEME,
  publishedRevisionId: null,
  draftRevisionId: null,
  ...overrides,
});
