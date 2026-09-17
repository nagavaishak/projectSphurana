/**
 * Eval-local page builders, composed from the agent's OWN fixtures.
 *
 * Nothing new is invented here: `HERO`, `CTA`, `RICH_TEXT`, `THEME`,
 * `homePageRow` and `aboutPageRow` are the same objects
 * `agent/guardrails.test.ts` uses. These helpers only vary the props a case
 * needs (a hero with every optional field set, a services block with a full
 * query) so a patch assertion has something to drop.
 */

import type { Block } from '@borradh-workspace/web-shared';
import {
  CTA,
  HERO,
  RICH_TEXT,
  aboutPageRow,
  homePageRow,
} from '../agent/agent-fixtures.test-utils.js';
import type { EvalPageRow } from './draft-store.test-utils.js';

export { CTA, HERO, RICH_TEXT };

/** Home (hero + booking CTA) and About (rich text). The common starting point. */
export const defaultEvalPages = (): EvalPageRow[] => [
  homePageRow(),
  aboutPageRow(),
];

/** A hero with EVERY optional prop set — so a bad patch has something to drop. */
export const FULL_HERO: Block = {
  id: 'blk-hero',
  type: 'hero',
  variant: 'full-bleed',
  props: {
    headline: 'Book your appointment',
    subheadline: 'Open six days a week',
    imageAssetId: 'asset-front-door',
    ctaLabel: 'Book now',
    ctaHref: '/book',
  },
};

/** A data-bound services block carrying a full QUERY (never data). */
export const SERVICES: Block = {
  id: 'blk-services',
  type: 'services',
  variant: 'price-menu',
  props: {
    title: 'Our treatments',
    intro: 'Prices are per session.',
    categoryNames: ['Facials', 'Massage'],
    limit: 12,
    showPrices: true,
  },
};

export const pagesWithFullHero = (): EvalPageRow[] => [
  homePageRow([FULL_HERO, CTA]),
  aboutPageRow(),
];

export const pagesWithServices = (): EvalPageRow[] => [
  homePageRow([HERO, SERVICES, CTA]),
  aboutPageRow(),
];
