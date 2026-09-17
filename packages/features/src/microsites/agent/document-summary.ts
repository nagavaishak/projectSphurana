/**
 * The COMPACT page structure the model gets at the top of every turn.
 *
 * Never full props. A microsite's props carry the whole marketing copy of the
 * business; putting them in the system context would (a) cost more per turn
 * than the edit is worth, (b) grow without bound as the site grows, and (c)
 * hand the model a large block of the ORG'S OWN TEXT as if it were instruction.
 * So each block is reduced to its id, type, variant and a ~15-word précis, and
 * the model calls `read_page` when it actually needs the detail.
 *
 * The précis is derived MECHANICALLY from the props (headline, title, first
 * words of markdown), never by a model call — a summary that costs a model call
 * per block per turn is not a summary.
 */

import type {
  Block,
  MicrositeDocument,
  MicrositePage,
} from '@borradh-workspace/web-shared';

/** Words kept in a block précis. Enough to recognise it, too few to quote it. */
const PRECIS_WORDS = 15;

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const precisWords = (value: string, words = PRECIS_WORDS): string => {
  const parts = squash(value).split(' ').filter(Boolean);
  if (parts.length <= words) return parts.join(' ');
  return `${parts.slice(0, words).join(' ')}…`;
};

/**
 * A one-line description of a block, from its own props.
 *
 * Data-bound blocks describe their QUERY, not their data — `services` renders
 * whatever the org's live services are, so "all services, with prices" is the
 * honest summary and a list of today's service names would be a lie by the
 * time the page is next viewed.
 */
export const blockPrecis = (block: Block): string => {
  switch (block.type) {
    case 'hero':
      return precisWords(block.props.headline);
    case 'services': {
      const scope = block.props.categoryNames?.length
        ? `categories: ${block.props.categoryNames.join(', ')}`
        : 'all active services';
      const limit = block.props.limit ? `, up to ${block.props.limit}` : '';
      return precisWords(
        `${block.props.title ?? 'Services'} — ${scope}${limit}, prices ${block.props.showPrices ? 'shown' : 'hidden'}`
      );
    }
    case 'team':
      return precisWords(
        `${block.props.title ?? 'Team'} — ${block.props.practitionerIds?.length ? `${block.props.practitionerIds.length} selected practitioners` : 'all active practitioners'}, bios ${block.props.showBios ? 'shown' : 'hidden'}`
      );
    case 'gallery':
      return precisWords(
        `${block.props.title ?? 'Gallery'} — ${block.props.assetIds?.length ? `${block.props.assetIds.length} chosen photos` : 'the org photo library'}`
      );
    case 'opening_hours':
      return precisWords(
        `${block.props.title ?? 'Opening hours'} — live hours${block.props.locationId ? ' for one location' : ''}`
      );
    case 'map_location':
      return precisWords(
        `${block.props.title ?? 'Find us'} — ${block.props.showAddress ? 'address' : 'no address'}, ${block.props.showMap ? 'map' : 'no map'}`
      );
    case 'cta_booking':
      return precisWords(
        `${block.props.headline} → "${block.props.buttonLabel}"`
      );
    case 'rich_text':
      return precisWords(block.props.markdown.replace(/[#*_>`[\]()]/g, ' '));
    default:
      return '';
  }
};

export interface BlockOutline {
  id: string;
  type: string;
  variant: string;
  precis: string;
}

export interface PageOutline {
  path: string;
  title: string;
  isSystem: boolean;
  blocks: BlockOutline[];
}

export const outlineBlock = (block: Block): BlockOutline => ({
  id: block.id,
  type: block.type,
  variant: block.variant,
  precis: blockPrecis(block),
});

export const outlinePage = (page: MicrositePage): PageOutline => ({
  path: page.path,
  title: page.title,
  isSystem: page.isSystem,
  blocks: page.blocks.map(outlineBlock),
});

export const outlineDocument = (doc: MicrositeDocument): PageOutline[] =>
  [...doc.pages]
    .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
    .map(outlinePage);

/**
 * The outline as the model reads it. Plain text rather than JSON: it is a third
 * of the tokens and the model never has to be told not to echo it back.
 */
export const renderOutline = (doc: MicrositeDocument): string => {
  const pages = outlineDocument(doc);
  if (pages.length === 0) return 'This website has no pages yet.';

  return pages
    .map((page) => {
      const header = `${page.path} — "${page.title}"${page.isSystem ? ' (system page, cannot be deleted)' : ''}`;
      if (page.blocks.length === 0) return `${header}\n  (no blocks yet)`;
      const blocks = page.blocks
        .map(
          (block, index) =>
            `  ${index}. [${block.id}] ${block.type}/${block.variant}: ${block.precis}`
        )
        .join('\n');
      return `${header}\n${blocks}`;
    })
    .join('\n\n');
};
