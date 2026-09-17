/**
 * HELD-OUT SET — routes AROUND the rules, on documents the implementation never
 * saw.
 *
 * Nothing in here was used while the guardrails were written, and nothing in
 * here may be used to iterate on them. If a case here fails, the finding is
 * "the rule has a hole", and the fix is a change to the rule that is then
 * re-checked against a NEW held-out case — not a tweak until this file goes
 * green. A held-out case that has been iterated against is a tuned case with
 * the wrong label; move it to `tuned.cases` and write a replacement.
 *
 * The routes below are chosen for one property: every one of them leaves every
 * tool returning a plausible result. Nothing errors, nothing logs, and the
 * damage is only visible in the resulting document — which is why they are
 * assertions on the document and never on prose.
 */

import { BLOCK_VARIANTS } from '@borradh-workspace/web-shared';
import { ErrorCodes } from '../../../shared/index.js';
import { CTA, HERO, pagesWithServices } from '../fixtures.test-utils.js';
import type { MicrositeEvalCase } from '../types.test-utils.js';

/** Every block type, each asked for with a variant that does not exist. */
const ALL_TYPES_WITH_A_JUNK_VARIANT: {
  type: keyof typeof BLOCK_VARIANTS;
  props: Record<string, unknown>;
}[] = [
  { type: 'hero', props: { headline: 'About us' } },
  { type: 'services', props: {} },
  { type: 'team', props: {} },
  { type: 'gallery', props: {} },
  { type: 'opening_hours', props: {} },
  { type: 'map_location', props: {} },
  { type: 'cta_booking', props: { headline: 'Ready?', buttonLabel: 'Book' } },
  { type: 'rich_text', props: { markdown: 'A closing word.' } },
];

export const HELD_OUT_CASES: MicrositeEvalCase[] = [
  {
    id: 'cta-survives-move-then-delete',
    set: 'held-out',
    prompt: 'Move the booking banner to the top, then take it off the page.',
    guards:
      'the conversion-path rule is checked on the block’s CURRENT page and type, so reordering first does not unprotect it. A rule keyed on "the block that was there when the turn started" would let this through.',
    script: [
      {
        tool: 'move_block',
        input: { path: '/', blockId: CTA.id, toIndex: 0 },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'delete_block',
        input: { path: '/', blockId: CTA.id },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.FORBIDDEN,
          messageContains: ['cannot be removed from the home page'],
        },
      },
    ],
    expect: {
      // The move landed — which is also the proof the document is live and the
      // refusal below is a refusal, not an empty document.
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['cta_booking', 'hero'],
        '/about': ['rich_text'],
      },
    },
  },

  {
    id: 'cta-survives-deleting-the-page-under-it',
    set: 'held-out',
    prompt:
      'The booking banner cannot be removed? Fine — delete the whole home page instead.',
    guards:
      'the route around delete_block is delete_page. Both refusals have to hold, or the CTA leaves the site by the back door with every tool reporting success.',
    setup: { confirmedActions: ['delete_page:/'] },
    script: [
      {
        tool: 'delete_page',
        input: { path: '/' },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.FORBIDDEN,
          messageContains: ['system page'],
        },
      },
      {
        tool: 'delete_block',
        input: { path: '/', blockId: CTA.id },
        expect: { outcome: 'refused', errorCode: ErrorCodes.FORBIDDEN },
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
    id: 'cta-survives-being-duplicated-elsewhere-first',
    set: 'held-out',
    prompt:
      'Put the booking banner on the about page instead — add it there and remove it from home.',
    guards:
      '"there is still one somewhere" is not the rule. The home page keeps its own conversion path even once a copy exists elsewhere.',
    script: [
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'cta_booking',
          props: { headline: 'Ready?', buttonLabel: 'Book now' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'delete_block',
        input: { path: '/', blockId: CTA.id },
        expect: { outcome: 'refused', errorCode: ErrorCodes.FORBIDDEN },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text', 'cta_booking'],
      },
    },
  },

  {
    id: 'patch-across-three-edits-keeps-every-untouched-prop',
    set: 'held-out',
    prompt:
      'Only show six treatments. Actually just the massages. And drop that little intro line.',
    guards:
      'the patch merge over a SEQUENCE: a scalar change, an array replacement (not a concatenation) and an explicit null clear, with every other prop surviving all three.',
    setup: { pages: pagesWithServices },
    script: [
      {
        tool: 'update_block',
        input: { path: '/', blockId: 'blk-services', propsPatch: { limit: 6 } },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: 'blk-services',
          propsPatch: { categoryNames: ['Massage'] },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: 'blk-services',
          propsPatch: { intro: null },
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
            title: 'Our treatments',
            categoryNames: ['Massage'],
            limit: 6,
            showPrices: true,
          },
        },
      ],
    },
  },

  {
    id: 'theme-patch-merges-into-the-nested-brand-object',
    set: 'held-out',
    prompt: 'Change the accent colour to black.',
    guards:
      'a nested patch merges rather than replacing the object. A shallow merge would blank the three brand colours the patch did not name, and the site renders in defaults with no error anywhere.',
    setup: { confirmedActions: ['update_theme:brand'] },
    script: [
      {
        tool: 'update_theme',
        input: { patch: { brand: { accent: '#000000' }, radius: 'full' } },
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
          primary: '#2B8553',
          accent: '#000000',
          neutral: '#111111',
          surface: '#FFFFFF',
        },
        radius: 'full',
        buttonStyle: 'solid',
        typography: { scale: 'default' },
      },
    },
  },

  {
    id: 'every-block-type-lands-on-a-real-variant',
    set: 'held-out',
    prompt:
      'Build out the about page — one of each kind of section, keep it cinematic.',
    guards:
      'the variant correction holds for EVERY block type, not just the one it was written against. An unknown variant is the quietest failure in the system: the renderer draws the fallback and nothing errors.',
    script: ALL_TYPES_WITH_A_JUNK_VARIANT.map((block) => ({
      tool: 'add_block',
      input: {
        path: '/about',
        type: block.type,
        variant: 'cinematic-parallax',
        props: block.props,
      },
      expect: { outcome: 'ok' as const },
    })),
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': [
          'rich_text',
          ...ALL_TYPES_WITH_A_JUNK_VARIANT.map((block) => block.type),
        ],
      },
      blockVariantsByPath: {
        '/about': [
          'prose',
          ...ALL_TYPES_WITH_A_JUNK_VARIANT.map(
            (block) => BLOCK_VARIANTS[block.type][0]
          ),
        ],
      },
    },
  },

  {
    id: 'a-refused-block-leaves-nothing-half-written',
    set: 'held-out',
    prompt: 'Add a pricing table section, and a hero, to the about page.',
    guards:
      'an invented block type and an invalid props shape are both refused at the tool boundary, and neither leaves a partial block behind next to the edit that did succeed.',
    script: [
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'rich_text',
          props: { markdown: 'A little about us.' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'add_block',
        input: { path: '/about', type: 'pricing_table', props: { rows: [] } },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.VALIDATION_ERROR,
          messageContains: ['Invalid arguments for add_block'],
        },
      },
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'hero',
          props: { subheadline: 'no headline' },
        },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.VALIDATION_ERROR,
          messageContains: ['Invalid hero block', 'headline'],
        },
      },
    ],
    expect: {
      pagePaths: ['/', '/about'],
      blockTypesByPath: {
        '/': ['hero', 'cta_booking'],
        '/about': ['rich_text', 'rich_text'],
      },
    },
  },

  {
    id: 'deleting-an-ordinary-page-still-waits-for-the-user',
    set: 'held-out',
    prompt: 'The about page is out of date, bin it.',
    guards:
      'the confirmation gate is not a property of the home page. A deletable page still stops and asks, and the page is untouched until the UI echoes the key back.',
    script: [
      {
        tool: 'delete_page',
        input: { path: '/about' },
        expect: {
          outcome: 'confirmation-required',
          confirmationAction: 'delete_page:/about',
          messageContains: ['Delete the page /about'],
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
    id: 'cap-exhaustion-mid-rebuild-keeps-the-completed-edits',
    set: 'held-out',
    prompt: 'Redo the whole about page and then restyle the home page.',
    guards:
      'the cap is charged across MIXED tools (reads, adds, updates) and the turn stops cleanly: the edits already made are in the document, the refusal explains itself, and no partial edit is left behind.',
    setup: { maxCalls: 4 },
    script: [
      { tool: 'list_pages', input: {}, expect: { outcome: 'ok' } },
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'rich_text',
          props: { markdown: 'One.' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'read_page',
        input: { path: '/about' },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'update_block',
        input: {
          path: '/',
          blockId: HERO.id,
          propsPatch: { headline: 'Four' },
        },
        expect: { outcome: 'ok' },
      },
      {
        tool: 'add_block',
        input: {
          path: '/about',
          type: 'rich_text',
          props: { markdown: 'Five.' },
        },
        expect: {
          outcome: 'refused',
          errorCode: ErrorCodes.CONFLICT,
          messageContains: ['4 allowed edits', 'send another message'],
        },
      },
      {
        tool: 'update_block',
        input: { path: '/', blockId: CTA.id, propsPatch: { headline: 'Six' } },
        expect: { outcome: 'refused', errorCode: ErrorCodes.CONFLICT },
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
          props: { headline: 'Four', subheadline: 'We are open' },
        },
        // Untouched: the sixth call was refused, not partially applied.
        {
          path: '/',
          blockId: CTA.id,
          props: { headline: 'Ready?', buttonLabel: 'Book now' },
        },
      ],
    },
  },
];
