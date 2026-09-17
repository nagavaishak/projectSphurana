/**
 * Fixtures for the agent tests. Test-only; not exported from the barrel.
 */

import type { Block } from '@borradh-workspace/web-shared';
import type { AgentMockDb } from './agent-mock-db.test-utils.js';
import { createTurnBudget } from './guardrails.js';
import type { MicrositeAgentSession, MicrositeToolContext } from './types.js';

export const ORG_ID = 'org-1';
export const OTHER_ORG_ID = 'org-2';
export const SITE_ID = 'site-1';
export const USER_ID = 'user-1';

export const SESSION: MicrositeAgentSession = {
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  userId: USER_ID,
};

export const THEME = {
  brand: {
    primary: '#2B8553',
    accent: '#B8D2CA',
    neutral: '#111111',
    surface: '#FFFFFF',
  },
  logo: { assetUrl: null },
  typography: { scale: 'default' as const },
  radius: 'md' as const,
  buttonStyle: 'solid' as const,
  density: 'comfortable' as const,
};

export const HERO: Block = {
  id: 'blk-hero',
  type: 'hero',
  variant: 'image-right',
  props: { headline: 'Book your appointment', subheadline: 'We are open' },
};

export const CTA: Block = {
  id: 'blk-cta',
  type: 'cta_booking',
  variant: 'band',
  props: { headline: 'Ready?', buttonLabel: 'Book now' },
};

export const RICH_TEXT: Block = {
  id: 'blk-about',
  type: 'rich_text',
  variant: 'prose',
  props: { markdown: 'We have been going since 2016.' },
};

export const homePageRow = (blocks: Block[] = [HERO, CTA]) => ({
  id: 'page-home',
  micrositeId: SITE_ID,
  organizationId: ORG_ID,
  path: '/',
  title: 'Home',
  seo: {},
  blocks,
  order: 0,
  isSystem: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

export const aboutPageRow = (blocks: Block[] = [RICH_TEXT]) => ({
  ...homePageRow(blocks),
  id: 'page-about',
  path: '/about',
  title: 'About',
  order: 1,
  isSystem: false,
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

/** Wire the mock so the draft reads as the given pages. */
export const givenDraft = (
  db: AgentMockDb,
  pages: ReturnType<typeof homePageRow>[] = [homePageRow()],
  site: Record<string, unknown> = {}
) => {
  db.query.microsite.findFirst.mockResolvedValue(micrositeRow(site));
  db.query.micrositePage.findMany.mockResolvedValue(pages);
};

export const toolContext = (
  db: AgentMockDb,
  overrides: Partial<MicrositeToolContext> = {}
): MicrositeToolContext => ({
  db: db as never,
  session: SESSION,
  budget: createTurnBudget(),
  confirmedActions: new Set<string>(),
  ...overrides,
});
