/**
 * The block catalogue: the single list of valid variants, plus the one-line
 * description the agent sees when choosing a block.
 *
 * BOTH the renderer and the agent read this. If you add a variant to an Astro
 * component and not here, the agent will never emit it; if you add one here and
 * not to the component, the renderer falls back to `variants[0]`.
 *
 * `dataBound` is NOT hand-maintained. It is derived from the contract's
 * `DATA_BOUND_BLOCKS` by the type system (see `CatalogueEntry` below), so
 * promoting a block to data-bound in the contract makes THIS file fail to
 * compile until it is updated. Data-bound blocks hold a query, never a copy of
 * the data — that is the whole differentiator.
 */

import { BLOCK_VARIANTS } from '@borradh-workspace/web-shared';
import type {
  BlockType,
  DATA_BOUND_BLOCKS,
} from '@borradh-workspace/web-shared';

/**
 * Derived from the contract's `DATA_BOUND_BLOCKS` tuple. `import type` +
 * `typeof` gives us the exact member union with ZERO runtime import — which
 * matters because web-shared emits declarations only and would not resolve at
 * runtime in Node.
 */
export type DataBoundBlockType = (typeof DATA_BOUND_BLOCKS)[number];

export interface CatalogueEntry<T extends BlockType = BlockType> {
  type: T;
  /** One line, written for the AGENT to read when choosing a block. */
  description: string;
  /** First entry is the renderer's fallback for an unknown variant. */
  /** Compile-derived from the contract — never set this by judgement. */
  dataBound: T extends DataBoundBlockType ? true : false;
}

/**
 * `{ [T in BlockType]: CatalogueEntry<T> }` gives exhaustiveness (a new block
 * type in the contract = a missing-key error here) AND per-key correctness of
 * `dataBound`.
 */
type BlockCatalogue = { [T in BlockType]: CatalogueEntry<T> };

export const BLOCK_CATALOGUE = {
  hero: {
    type: 'hero',
    description:
      'Top-of-page banner with a headline, optional subheadline, image and a call-to-action button.',
    dataBound: false,
  },
  services: {
    type: 'services',
    description:
      "Live list of the business's active services with current prices — never goes stale, no republish needed after a price change.",
    dataBound: true,
  },
  team: {
    type: 'team',
    description:
      'Live list of the active practitioners, with photos and optional bios.',
    dataBound: true,
  },
  gallery: {
    type: 'gallery',
    description:
      'Photo gallery from the org photo library or an explicit set of assets; grid or carousel layout.',
    dataBound: false,
  },
  opening_hours: {
    type: 'opening_hours',
    description:
      "Live opening hours for one location, straight from the business's schedule.",
    dataBound: true,
  },
  map_location: {
    type: 'map_location',
    description:
      'Live address and map for one location — use once per page, near the bottom.',
    dataBound: true,
  },
  cta_booking: {
    type: 'cta_booking',
    description:
      'The primary conversion: a booking call-to-action. Every home page must have one.',
    dataBound: false,
  },
  rich_text: {
    type: 'rich_text',
    description:
      'A block of prose (sanitized markdown) for an about section, policy or anything without a dedicated block.',
    dataBound: false,
  },
} satisfies BlockCatalogue;

/** Every block type, in the order the agent should be offered them. */
export const BLOCK_TYPES = Object.keys(BLOCK_CATALOGUE) as BlockType[];

/** Whether a block renders live business data rather than authored copy. */
export const isDataBoundBlock = (type: BlockType): boolean =>
  BLOCK_CATALOGUE[type].dataBound;

/**
 * Valid variants for a block type, from the CONTRACT — not from a list held
 * here. This catalogue and the Astro renderer each invented their own list
 * once, and they disagreed on all eight blocks (`services` was
 * `grid|list|accordion` here and `cards|list|price-menu` there). The agent
 * would then emit a variant the renderer cannot draw, and the renderer would
 * silently fall back — a wrong layout on a live customer site, with nothing
 * failing anywhere. One list, in the contract, derived by both sides.
 */
export const variantsForBlock = (type: BlockType): readonly string[] =>
  BLOCK_VARIANTS[type];

/**
 * Re-exported from the contract so there is ONE fallback implementation shared
 * with the renderer. Unknown variants must NOT throw — a page written before a
 * variant was renamed still has to render.
 */
export { resolveVariant } from '@borradh-workspace/web-shared';
