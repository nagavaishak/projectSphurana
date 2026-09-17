/**
 * The comparator: what a case run must look like, checked against what it was.
 *
 * Two rules hold everything else up.
 *
 * 1. EVERY CASE MUST BE ABLE TO FAIL. A case that only asserts absences ("the
 *    booking CTA is still there", "no prices leaked into props") passes on an
 *    EMPTY DOCUMENT, which is the one state where every guardrail is trivially
 *    satisfied and the product is broken. `pagePaths` and `blockTypesByPath`
 *    are therefore mandatory and non-empty — a case that omits them fails as
 *    malformed, not as green.
 *
 * 2. GLOBAL INVARIANTS RUN ON EVERY CASE, asserted or not. Chiefly: every block
 *    in the final document carries a variant that is in `BLOCK_VARIANTS`. An
 *    unknown variant is the quietest failure in the system — the renderer draws
 *    the fallback, no tool errors, no log line, and the user gets a layout they
 *    did not ask for.
 */

import { BLOCK_VARIANTS } from '@borradh-workspace/web-shared';
import { isDataBoundBlock } from '../blocks/index.js';
import type {
  CaseRun,
  DocumentExpectation,
  MicrositeEvalCase,
  RunDocument,
} from './types.test-utils.js';

const variantsFor = (type: string): readonly string[] | undefined =>
  (BLOCK_VARIANTS as Record<string, readonly string[]>)[type];

export const compareCase = (
  evalCase: MicrositeEvalCase,
  run: CaseRun
): string[] => {
  const failures: string[] = [];
  failures.push(...checkScript(evalCase, run));
  failures.push(...checkWellFormed(evalCase.expect));
  failures.push(...checkInvariants(run.document));
  failures.push(...checkDocument(evalCase.expect, run.document));
  return failures;
};

/* -------------------------------------------------------------------------- */

const checkScript = (evalCase: MicrositeEvalCase, run: CaseRun): string[] => {
  const failures: string[] = [];
  if (run.calls.length !== evalCase.script.length) {
    failures.push(
      `script: ran ${run.calls.length} calls, case declares ${evalCase.script.length}`
    );
    return failures;
  }

  evalCase.script.forEach((scripted, index) => {
    const actual = run.calls[index];
    const where = `call ${index + 1} (${scripted.tool})`;
    if (actual.outcome !== scripted.expect.outcome) {
      failures.push(
        `${where}: expected ${scripted.expect.outcome}, got ${actual.outcome}${
          actual.errorCode ? ` (${actual.errorCode})` : ''
        } — "${actual.message}"`
      );
      return;
    }
    if (
      scripted.expect.errorCode &&
      actual.errorCode !== scripted.expect.errorCode
    ) {
      failures.push(
        `${where}: expected error code ${scripted.expect.errorCode}, got ${actual.errorCode ?? 'none'}`
      );
    }
    for (const phrase of scripted.expect.messageContains ?? []) {
      if (!actual.message.toLowerCase().includes(phrase.toLowerCase())) {
        failures.push(
          `${where}: message does not explain itself — expected it to contain "${phrase}", got "${actual.message}"`
        );
      }
    }
    if (
      scripted.expect.confirmationAction &&
      actual.confirmationAction !== scripted.expect.confirmationAction
    ) {
      failures.push(
        `${where}: expected confirmation action "${scripted.expect.confirmationAction}", got "${actual.confirmationAction ?? 'none'}"`
      );
    }
  });

  return failures;
};

/** Rule 1: a case with no presence assertion is malformed, not passing. */
const checkWellFormed = (expected: DocumentExpectation): string[] => {
  const failures: string[] = [];
  if (!expected.pagePaths?.length) {
    failures.push(
      'malformed case: `pagePaths` is required and non-empty — without it an empty document satisfies every absence assertion'
    );
  }
  const declared = Object.keys(expected.blockTypesByPath ?? {});
  if (!declared.length) {
    failures.push(
      'malformed case: `blockTypesByPath` is required and non-empty — a case must prove the document rendered before an absence is believed'
    );
  }
  for (const path of expected.pagePaths ?? []) {
    if (!declared.includes(path)) {
      failures.push(
        `malformed case: page ${path} is expected to exist but its block list is not declared`
      );
    }
  }
  return failures;
};

/** Rule 2: invariants nobody has to remember to assert. */
const checkInvariants = (document: RunDocument): string[] => {
  const failures: string[] = [];
  if (document.pages.length === 0) {
    failures.push('invariant: the document has no pages at all');
  }
  for (const page of document.pages) {
    for (const block of page.blocks) {
      const allowed = variantsFor(block.type);
      if (!allowed) {
        failures.push(
          `invariant: ${page.path} holds block type "${block.type}", which is not in the contract`
        );
        continue;
      }
      if (!allowed.includes(block.variant)) {
        failures.push(
          `invariant: ${page.path} ${block.type} has variant "${block.variant}", which is not in BLOCK_VARIANTS (${allowed.join(', ')}) — the renderer would silently draw "${allowed[0]}"`
        );
      }
    }
  }
  return failures;
};

/* -------------------------------------------------------------------------- */

const checkDocument = (
  expected: DocumentExpectation,
  document: RunDocument
): string[] => {
  const failures: string[] = [];
  const byPath = new Map(document.pages.map((page) => [page.path, page]));

  const actualPaths = [...byPath.keys()].sort();
  const expectedPaths = [...(expected.pagePaths ?? [])].sort();
  if (actualPaths.join(',') !== expectedPaths.join(',')) {
    failures.push(
      `pages: expected [${expectedPaths.join(', ')}], got [${actualPaths.join(', ')}]`
    );
  }

  for (const [path, types] of Object.entries(expected.blockTypesByPath ?? {})) {
    const page = byPath.get(path);
    if (!page) {
      failures.push(`blocks: page ${path} is missing entirely`);
      continue;
    }
    const actual = page.blocks.map((block) => block.type);
    if (actual.join(',') !== types.join(',')) {
      failures.push(
        `blocks on ${path}: expected [${types.join(', ')}], got [${actual.join(', ')}]`
      );
    }
  }

  for (const [path, variants] of Object.entries(
    expected.blockVariantsByPath ?? {}
  )) {
    const page = byPath.get(path);
    if (!page) {
      failures.push(`variants: page ${path} is missing entirely`);
      continue;
    }
    const actual = page.blocks.map((block) => block.variant);
    if (actual.join(',') !== variants.join(',')) {
      failures.push(
        `variants on ${path}: expected [${variants.join(', ')}], got [${actual.join(', ')}]`
      );
    }
  }

  for (const expectation of expected.blockProps ?? []) {
    const page = byPath.get(expectation.path);
    if (!page) {
      failures.push(`props: page ${expectation.path} is missing entirely`);
      continue;
    }
    const block = page.blocks.find((candidate) =>
      expectation.blockId
        ? candidate.id === expectation.blockId
        : candidate.type === expectation.type
    );
    if (!block) {
      failures.push(
        `props: no block ${expectation.blockId ?? expectation.type} on ${expectation.path}`
      );
      continue;
    }
    const actual = stable(block.props);
    const wanted = stable(expectation.props);
    if (actual !== wanted) {
      failures.push(
        `props of ${block.type} on ${expectation.path}: expected ${wanted}, got ${actual}`
      );
    }
  }

  for (const absent of expected.absentBlocks ?? []) {
    const page = byPath.get(absent.path);
    if (!page) continue;
    if (page.blocks.some((block) => block.type === absent.type)) {
      failures.push(
        `absence: ${absent.path} still holds a ${absent.type} block`
      );
    }
  }

  if (expected.theme) {
    failures.push(...subsetFailures(expected.theme, document.theme, 'theme'));
  }

  for (const rule of expected.dataBoundPropsFreeOf ?? []) {
    const pattern = new RegExp(rule.pattern, 'i');
    for (const page of document.pages) {
      for (const block of page.blocks) {
        if (!isDataBoundBlock(block.type as never)) continue;
        const json = JSON.stringify(block.props);
        if (pattern.test(json)) {
          failures.push(
            `data binding: ${block.type} on ${page.path} has /${rule.pattern}/ in its props (${json}) — ${rule.why}`
          );
        }
      }
    }
  }

  return failures;
};

const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`);
  return `{${entries.join(',')}}`;
};

const subsetFailures = (
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  path: string
): string[] => {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const here = `${path}.${key}`;
    const found = actual?.[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      found &&
      typeof found === 'object'
    ) {
      failures.push(
        ...subsetFailures(
          value as Record<string, unknown>,
          found as Record<string, unknown>,
          here
        )
      );
      continue;
    }
    if (stable(found) !== stable(value)) {
      failures.push(`${here}: expected ${stable(value)}, got ${stable(found)}`);
    }
  }
  return failures;
};
