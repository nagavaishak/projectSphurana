/**
 * §1 OF THE INLINE EDIT CONTRACT, AS AN ASSERTION.
 *
 * "A published render must emit no `contenteditable`, no editor script,
 * nothing. A bug here lets a member of the public type into a tenant's
 * website."
 *
 * So this renders the real block components — every one of the eight, through
 * the real `BlockRenderer`, with a document that exercises every editable field
 * in §2 — and asserts on the HTML that comes out. Not on the source, not on a
 * flag: the bytes a visitor would receive.
 *
 * Each marker is asserted SEPARATELY rather than through one catch-all regex,
 * so a regression names which affordance came back.
 *
 * The `editable: true` half of the file is the control. Absence proves nothing
 * unless the same harness can be shown to produce the thing it is looking for.
 */
import type { Block } from '@borradh-workspace/web-shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import BlockRenderer from './BlockRenderer.astro';
import type { MicrositeData } from './data';

const DATA: MicrositeData = {
  assets: {
    hero_img: {
      id: 'hero_img',
      url: 'https://cdn.test/hero.jpg',
      width: 1200,
      height: 800,
    },
    shot_1: {
      id: 'shot_1',
      url: 'https://cdn.test/1.jpg',
      width: 800,
      height: 800,
    },
  },
  services: [
    {
      id: 'svc_1',
      name: 'Deluxe Facial',
      priceLabel: '€90',
      durationLabel: '60 min',
      description: 'A facial.',
    },
  ],
  practitioners: [
    { id: 'prac_1', name: 'Aoife Byrne', role: 'Therapist', bio: 'Ten years.' },
  ],
  locations: [
    {
      id: 'loc_1',
      name: 'Dublin',
      addressLines: ['12 Baggot Street', 'Dublin 2'],
      phone: '+353 1 555 0000',
      email: 'hello@glow.test',
      mapEmbedUrl: 'https://maps.test/embed?q=dublin',
      directionsUrl: 'https://maps.test/dir',
      openingHours: [{ label: 'Monday', intervals: ['09:00 – 17:00'] }],
    },
  ],
  gallery: [
    { id: 'shot_1', url: 'https://cdn.test/1.jpg', width: 800, height: 800 },
  ],
  bookingUrl: 'https://app.test/book/glow',
  businessName: 'Glow Clinic',
};

/** One block of every type, with every §2 field populated. */
const BLOCKS: Block[] = [
  {
    id: 'blk_hero',
    type: 'hero',
    variant: 'image-right',
    props: {
      headline: 'Glow Clinic',
      subheadline: 'Skin care in Dublin 2',
      imageAssetId: 'hero_img',
      ctaLabel: 'Book now',
      ctaHref: '/book',
    },
  },
  {
    id: 'blk_services',
    type: 'services',
    variant: 'cards',
    props: { title: 'Our services', intro: 'What we do', showPrices: true },
  },
  {
    id: 'blk_team',
    type: 'team',
    variant: 'grid',
    props: { title: 'Our team', intro: 'Who we are', showBios: true },
  },
  {
    id: 'blk_gallery',
    type: 'gallery',
    variant: 'grid',
    props: { title: 'Gallery' },
  },
  {
    id: 'blk_hours',
    type: 'opening_hours',
    variant: 'table',
    props: { title: 'Opening hours', showExceptions: false },
  },
  {
    id: 'blk_map',
    type: 'map_location',
    variant: 'split',
    props: { title: 'Find us', showAddress: true, showMap: true },
  },
  {
    id: 'blk_cta',
    type: 'cta_booking',
    variant: 'band',
    props: {
      headline: 'Ready?',
      subtext: 'Book online',
      buttonLabel: 'Book now',
    },
  },
  {
    id: 'blk_rich',
    type: 'rich_text',
    variant: 'prose',
    props: { markdown: '## About us\n\nWe are **open**.' },
  },
];

const render = async (editable: boolean): Promise<string> => {
  const container = await AstroContainer.create();
  const parts: string[] = [];
  for (const [index, block] of BLOCKS.entries()) {
    parts.push(
      await container.renderToString(BlockRenderer, {
        props: { block, data: DATA, index, editable },
      })
    );
  }
  return parts.join('\n');
};

describe('a PUBLISHED render carries no editing affordance', () => {
  let html = '';

  beforeAll(async () => {
    // Exactly how the published route calls it: `editable` left at its default.
    const container = await AstroContainer.create();
    const parts: string[] = [];
    for (const [index, block] of BLOCKS.entries()) {
      parts.push(
        await container.renderToString(BlockRenderer, {
          props: { block, data: DATA, index },
        })
      );
    }
    html = parts.join('\n');
  });

  it('rendered every block — otherwise the absences below are vacuous', () => {
    expect(html).toContain('Glow Clinic');
    expect(html).toContain('Our services');
    expect(html).toContain('Our team');
    expect(html).toContain('Gallery');
    expect(html).toContain('Opening hours');
    expect(html).toContain('Find us');
    expect(html).toContain('Ready?');
    expect(html).toContain('About us');
  });

  it('emits no contenteditable', () => {
    expect(html).not.toContain('contenteditable');
  });

  it('emits no plaintext-only hint', () => {
    expect(html).not.toContain('plaintext-only');
  });

  it('emits no data-ms-editable marker', () => {
    expect(html).not.toContain('data-ms-editable');
  });

  it('emits no data-ms-block address', () => {
    expect(html).not.toContain('data-ms-block');
  });

  it('emits no data-ms-field address', () => {
    expect(html).not.toContain('data-ms-field');
  });

  it('loads no editor script', () => {
    expect(html).not.toContain('EditMode');
    expect(html).not.toContain('ms-edit-config');
    expect(html).not.toContain('startMicrositeEditMode');
  });

  it('ships no <script> at all — the zero-client-JS budget', () => {
    expect(html).not.toMatch(/<script/i);
  });

  it('renders rich_text as HTML, not as editable markdown source', () => {
    expect(html).toContain('<h3>About us</h3>');
    expect(html).not.toContain('ms-rich__body--source');
  });
});

describe('the same harness DOES produce the affordance in edit mode', () => {
  // The control. Without this, every assertion above could be passing because
  // the fixture renders nothing at all.
  let html = '';

  beforeAll(async () => {
    html = await render(true);
  });

  it('marks up exactly the §2 fields', () => {
    const fields = html.match(/data-ms-field="([^"]+)"/g) ?? [];
    expect(fields.sort()).toEqual(
      [
        'data-ms-field="ctaLabel"',
        'data-ms-field="headline"',
        'data-ms-field="subheadline"',
        'data-ms-field="title"',
        'data-ms-field="intro"',
        'data-ms-field="title"',
        'data-ms-field="intro"',
        'data-ms-field="title"',
        'data-ms-field="title"',
        'data-ms-field="title"',
        'data-ms-field="headline"',
        'data-ms-field="subtext"',
        'data-ms-field="buttonLabel"',
        'data-ms-field="markdown"',
      ].sort()
    );
  });

  it('emits contenteditable and the block address', () => {
    expect(html).toContain('contenteditable="plaintext-only"');
    expect(html).toContain('data-ms-editable');
    expect(html).toContain('data-ms-block="blk_hero"');
  });

  it('gives data-bound content NO affordance', () => {
    // The service name, the practitioner's name and the hours are rendered,
    // and none of them is inside an editable node.
    expect(html).toContain('Deluxe Facial');
    expect(html).toContain('Aoife Byrne');
    expect(html).toContain('09:00 – 17:00');
    for (const value of [
      'Deluxe Facial',
      'Aoife Byrne',
      '09:00 – 17:00',
      '12 Baggot Street',
    ]) {
      const index = html.indexOf(value);
      const openTag = html.lastIndexOf('<', index);
      expect(html.slice(openTag, index)).not.toContain('data-ms-editable');
    }
  });

  it('edits rich_text as plain markdown source', () => {
    expect(html).toContain('ms-rich__body--source');
    expect(html).toContain('## About us');
  });
});
