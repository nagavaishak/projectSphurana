/**
 * The eval suite. Runs offline, in CI, with no model call and no API key.
 *
 * Three things are checked here:
 *   1. every case passes (tuned and held-out, reported separately);
 *   2. the case files stay well formed (ids unique, sets not mixed up);
 *   3. the COMPARATOR itself can fail — each assertion key is shown rejecting a
 *      document that violates it. Without (3) a comparator bug turns the whole
 *      suite into a green light that checks nothing, which is strictly worse
 *      than having no suite at all.
 */

import { describe, expect, it } from '@borradh-workspace/testing';
import {
  ALL_CASES,
  HELD_OUT_CASES,
  TUNED_CASES,
} from './cases/index.test-utils.js';
import { compareCase } from './compare.test-utils.js';
import { runCase } from './run-case.test-utils.js';
import type { CaseRun, MicrositeEvalCase } from './types.test-utils.js';

const report = (evalCase: MicrositeEvalCase, failures: string[]) =>
  `${evalCase.id} [${evalCase.set}] — ${evalCase.guards}\n  - ${failures.join('\n  - ')}`;

describe('microsite agent eval — tuned set', () => {
  for (const evalCase of TUNED_CASES) {
    it(evalCase.id, async () => {
      const run = await runCase(evalCase);
      const failures = compareCase(evalCase, run);
      expect(failures.length === 0 ? '' : report(evalCase, failures)).toBe('');
    });
  }
});

describe('microsite agent eval — held-out set', () => {
  for (const evalCase of HELD_OUT_CASES) {
    it(evalCase.id, async () => {
      const run = await runCase(evalCase);
      const failures = compareCase(evalCase, run);
      expect(failures.length === 0 ? '' : report(evalCase, failures)).toBe('');
    });
  }
});

describe('the case files', () => {
  it('gives every case a unique id', () => {
    const ids = ALL_CASES.map((evalCase) => evalCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the two sets apart', () => {
    expect(TUNED_CASES.every((c) => c.set === 'tuned')).toBe(true);
    expect(HELD_OUT_CASES.every((c) => c.set === 'held-out')).toBe(true);
    expect(HELD_OUT_CASES.length).toBeGreaterThan(0);
  });

  it('makes every case say what it guards and do something', () => {
    for (const evalCase of ALL_CASES) {
      expect(evalCase.guards.length, evalCase.id).toBeGreaterThan(20);
      expect(evalCase.prompt.length, evalCase.id).toBeGreaterThan(5);
      expect(evalCase.script.length, evalCase.id).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The comparator must be able to fail.                                        */
/* -------------------------------------------------------------------------- */

const baseCase = (): MicrositeEvalCase => ({
  id: 'probe',
  set: 'tuned',
  prompt: 'p',
  guards: 'a probe case used to prove the comparator can fail',
  script: [],
  expect: {
    pagePaths: ['/'],
    blockTypesByPath: { '/': ['hero', 'cta_booking'] },
  },
});

const baseRun = (): CaseRun => ({
  caseId: 'probe',
  calls: [],
  callsCharged: 0,
  document: {
    theme: { brand: { primary: '#2B8553' }, radius: 'md' },
    pages: [
      {
        path: '/',
        title: 'Home',
        isSystem: true,
        seo: {},
        blocks: [
          {
            id: 'blk-hero',
            type: 'hero',
            variant: 'image-right',
            props: { headline: 'Hi', subheadline: 'There' },
          },
          {
            id: 'blk-cta',
            type: 'cta_booking',
            variant: 'band',
            props: { headline: 'Ready?', buttonLabel: 'Book now' },
          },
        ],
      },
    ],
  },
});

describe('compareCase', () => {
  it('passes a run that matches', () => {
    expect(compareCase(baseCase(), baseRun())).toEqual([]);
  });

  it('fails a case that asserts no presence at all', () => {
    const evalCase = baseCase();
    evalCase.expect = { pagePaths: [], blockTypesByPath: {} };
    const failures = compareCase(evalCase, baseRun());
    expect(failures.join(' ')).toMatch(/malformed case/);
  });

  it('fails an ABSENCE assertion against an empty document', () => {
    // The reason `pagePaths` is mandatory: an empty document satisfies
    // "the CTA was not removed" and every other absence in the file.
    const evalCase = baseCase();
    evalCase.expect.absentBlocks = [{ path: '/', type: 'gallery' }];
    const run = baseRun();
    run.document.pages = [];
    const failures = compareCase(evalCase, run);
    expect(failures.join(' ')).toMatch(/the document has no pages at all/);
    expect(failures.join(' ')).toMatch(/pages: expected/);
  });

  it('fails a variant that is not in BLOCK_VARIANTS', () => {
    const run = baseRun();
    run.document.pages[0].blocks[0].variant = 'cinematic-parallax';
    const failures = compareCase(baseCase(), run);
    expect(failures.join(' ')).toMatch(/not in BLOCK_VARIANTS/);
  });

  it('fails a block type the contract does not have', () => {
    const run = baseRun();
    run.document.pages[0].blocks[0].type = 'pricing_table';
    const failures = compareCase(baseCase(), run);
    expect(failures.join(' ')).toMatch(/not in the contract/);
  });

  it('fails a dropped prop — the patch regression', () => {
    const evalCase = baseCase();
    evalCase.expect.blockProps = [
      {
        path: '/',
        blockId: 'blk-hero',
        props: { headline: 'Hi', subheadline: 'There' },
      },
    ];
    const run = baseRun();
    run.document.pages[0].blocks[0].props = { headline: 'Hi' };
    const failures = compareCase(evalCase, run);
    expect(failures.join(' ')).toMatch(/props of hero/);
  });

  it('fails copied data on a data-bound block', () => {
    const evalCase = baseCase();
    evalCase.expect.blockTypesByPath = { '/': ['services', 'cta_booking'] };
    evalCase.expect.dataBoundPropsFreeOf = [
      { pattern: '€', why: 'a data-bound block holds a query, never a copy' },
    ];
    const run = baseRun();
    run.document.pages[0].blocks[0] = {
      id: 'blk-services',
      type: 'services',
      variant: 'cards',
      props: { showPrices: true, items: [{ name: 'Facial', price: '€80' }] },
    };
    const failures = compareCase(evalCase, run);
    expect(failures.join(' ')).toMatch(/data binding/);
  });

  it('fails a refusal that does not explain itself', () => {
    const evalCase = baseCase();
    evalCase.script = [
      {
        tool: 'add_block',
        input: {},
        expect: {
          outcome: 'refused',
          messageContains: ['send another message'],
        },
      },
    ];
    const run = baseRun();
    run.calls = [
      {
        tool: 'add_block',
        outcome: 'refused',
        errorCode: 'CONFLICT',
        message: 'no',
      },
    ];
    const failures = compareCase(evalCase, run);
    expect(failures.join(' ')).toMatch(/does not explain itself/);
  });

  it('fails a theme value the run did not produce', () => {
    const evalCase = baseCase();
    evalCase.expect.theme = { brand: { primary: '#FF0000' } };
    const failures = compareCase(evalCase, baseRun());
    expect(failures.join(' ')).toMatch(/theme\.brand\.primary/);
  });
});
