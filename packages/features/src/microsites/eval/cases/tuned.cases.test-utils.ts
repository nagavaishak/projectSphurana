/**
 * TUNED SET — the shapes the guardrails were written against.
 *
 * These mirror `agent/guardrails.test.ts`. They are the cases the
 * implementation has already been iterated against, so passing them proves the
 * code still does what it was built to do, and NOTHING about whether the rule
 * survives a route nobody thought of. That is what `held-out.cases` is for.
 *
 * Adding a case here is cheap and safe. Moving a failing held-out case here
 * after "fixing" the guardrail against it is the mistake this split exists to
 * make visible — see `../types.test-utils.ts`.
 */

import { ErrorCodes } from '../../../shared/index.js';
import {
  CTA,
  HERO,
  pagesWithFullHero,
  pagesWithServices,
} from '../fixtures.test-utils.js';
import type { MicrositeEvalCase } from '../types.test-utils.js';

export const TUNED_CASES: MicrositeEvalCase[] = [
  {
    id: 'cta-booking-cannot-be-deleted-from-home',
    set: 'tuned',
    prompt:
      'Get rid of that "Ready?" booking banner at the bottom of the home page.',
    guards:
      'delete_block refuses the booking CTA on the home page, and refuses it against the DOCUMENT rather than the request wording.',
    script: [
      {
        tool: 'delete_block',
        input: { path: '/', blockId: CTA.id },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.FORBIDDEN,
          messageContains: ['cannot be removed from the home page', 'move it'],
        },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text'],
      },
    },
  },

  {
    id: 'system-page-cannot-be-deleted-even-when-confirmed',
    set: 'tuned',
    prompt: 'Delete the home page, we are starting again.',
    guards:
      'delete_page refuses a system page. The confirmation is already granted here, so the refusal is the guardrail and not the gate in front of it.',
    setup: { confirmedActions: ['delete_page:/'] },
    script: [
      {
        tool: 'delete_page',
        input: { path: '/' },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.FORBIDDEN,
          messageContains: ['system page', 'cannot be deleted'],
        },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text'],
      },
    },
  },

  {
    id: 'tool-cap-refuses-and-explains-instead-of-truncating',
    set: 'tuned',
    prompt: 'Rewrite the whole site — every page, every section.',
    guards:
      'past the per-turn cap every tool REFUSES with a sentence the model can relay, and the edits already made stay made. A cap that silently stopped the loop and a cap that refuses are indistinguishable without the message assertion.',
    setup: { maxCalls: 3 },
    script: [
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: HERO.id,
          propsPatch: { headline: 'Edit one' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: CTA.id,
          propsPatch: { headline: 'Edit two' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'rich_text',
          props: { markdown: 'Edit three.' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'rich_text',
          props: { markdown: 'Edit four, over the cap.' },
        },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.CONFLICT,
          messageContains: [
            '3 allowed edits',
            'Tell the user what you changed so far',
            'send another message',
          ],
        },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text', 'rich_text'],
      },
      blockProps: [
        {
          path: '/',
          blockId: HERO.id,
          props: { headline: 'Edit one', subheadline: 'We are open' },
        },
        {
          path: '/',
          blockId: CTA.id,
          props: { headline: 'Edit two', buttonLabel: 'Book now' },
        },
      ],
    },
  },

  {
    id: 'update-block-is-a-patch-not-a-replacement',
    set: 'tuned',
    prompt: 'Change the big headline on the home page to "Book with us today".',
    guards:
      'update_block merges onto current props. A full-replace regression drops subheadline, image, CTA label and href, and every tool still returns ok.',
    setup: { pages: pagesWithFullHero },
    script: [
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: 'blk-hero',
          propsPatch: { headline: 'Book with us today' },
        },
        expect: { outcome: 'ok' },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text'],
      },
      blockVariantsByPath: { '/': ['full-bleed', 'band'] },
      blockProps: [
        {
          path: '/',
          blockId: 'blk-hero',
          props: {
            headline: 'Book with us today',
            subheadline: 'Open six days a week',
            imageAssetId: 'asset-front-door',
            ctaLabel: 'Book now',
            ctaHref: '/book',
          },
        },
      ],
    },
  },

  {
    id: 'invented-variant-is-corrected-to-a-real-one',
    set: 'tuned',
    prompt: 'Add a hero to the about page with a parallax zoom effect.',
    guards:
      'a variant the model invented never reaches the document. Stored as-is, the renderer draws the fallback and the user gets a layout they did not ask for, with nothing failing anywhere.',
    script: [
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'hero',
          variant: 'parallax-zoom',
          props: { headline: 'About us' },
        },
        expect: { outcome: 'ok' },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text', 'hero'],
      },
      blockVariantsByPath: { '/about': ['prose', 'image-right'] },
    },
  },

  {
    id: 'services-stay-data-bound-when-asked-for-prices',
    set: 'tuned',
    prompt: 'Put our prices on the page.',
    guards:
      'a services block keeps a QUERY. Copied prices in props make the page a snapshot that goes stale on the next dashboard edit, and nothing anywhere fails when it does.',
    setup: { pages: pagesWithServices },
    script: [
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: 'blk-services',
          propsPatch: { title: 'Our prices', showPrices: true },
        },
        expect: { outcome: 'ok' },
      },
      {
        // The drift attempt: the model tries to write today's price list into
        // the block's props. The block schema strips what it does not name.
        tool: 'update_block',
        input: {
          path: '/',
          blockId: 'blk-services',
          propsPatch: {
            items: [
              { name: 'Deluxe Facial', price: '€80.00' },
              { name: 'Hot Stone Massage', price: '€95.00' },
            ],
          },
        },
        expect: { outcome: 'ok' },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'services', 'cta_booking'],
        '/about': ['rich_text'],
      },
      blockProps: [
        {
          path: '/',
          blockId: 'blk-services',
          props: {
            title: 'Our prices',
            intro: 'Prices are per session.',
            categoryNames: ['Facials', 'Massage'],
            limit: 12,
            showPrices: true,
          },
        },
      ],
      dataBoundPropsFreeOf: [
        {
          pattern: '€|\\$|\\d+\\.\\d{2}|Deluxe Facial|Hot Stone',
          why: 'a data-bound block holds a query, never a copy of the data',
        },
      ],
    },
  },

  {
    id: 'brand-repaint-waits-for-confirmation',
    set: 'tuned',
    prompt: 'Make the site red.',
    guards:
      'update_theme refuses a brand change until the UI echoes the confirmation key back. The gate is a request field, so the model cannot assert its way past it.',
    script: [
      {
        tool: 'update_theme',
        input: { patch: { brand: { primary: '#FF0000' } } },
        expect: {
          outcome: 'confirmation-required',
          confirmationAction: 'update_theme:brand',
          messageContains: ['brand colours', 'primary → #FF0000'],
        },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text'],
      },
      theme: { brand: { primary: '#2B8553' } },
    },
  },

  {
    id: 'confirmed-brand-change-patches-only-what-it-names',
    set: 'tuned',
    prompt: 'Yes, go ahead and make the primary colour red.',
    guards:
      'once confirmed the theme change applies AND stays a patch — the three brand colours it did not name keep their values.',
    setup: { confirmedActions: ['update_theme:brand'] },
    script: [
      {
        tool: 'update_theme',
        input: { patch: { brand: { primary: '#FF0000' } } },
        expect: { outcome: 'ok' },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text'],
      },
      theme: {
        brand: {
          primary: '#FF0000',
          accent: '#B8D2CA',
          neutral: '#111111',
          surface: '#FFFFFF',
        },
        radius: 'md',
        buttonStyle: 'solid',
        density: 'comfortable',
      },
    },
  },
];
