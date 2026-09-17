/**
 * Microsite editing-agent eval: the case shape.
 *
 * WHAT THIS EVAL IS
 * -----------------
 * A case is a SCRIPTED TRANSCRIPT — the exact sequence of tool calls a model
 * made (or could make) — replayed through the REAL tool registry
 * (`agent/tools/index.ts`) against a stateful in-memory draft. Every assertion
 * is on the RESULTING DOCUMENT and on the tool outcomes: which page holds which
 * blocks, in which order, with which props and which variants. Nothing here
 * asserts on prose. "Did it say something reasonable" is not a test.
 *
 * That makes this an eval of the GUARDRAIL LAYER — the half of the design that
 * is code, not prompting. It answers "can this sequence of calls get past the
 * rule", which is the question a regression makes invisible: the tools all
 * return `ok`, the sidebar shows a tidy activity line, and the document is
 * wrong.
 *
 * WHAT IT IS NOT
 * --------------
 * It does not evaluate model JUDGEMENT (did it pick the right tool for a vague
 * request). That needs a live model and recorded transcripts; see README
 * "Unevaluable offline". Scripts here are hand-authored, so a case proves what
 * the CODE does when handed a sequence, not what the model would send.
 *
 * TWO SETS, KEPT APART
 * --------------------
 *   `tuned`    — the shapes the guardrails were written against. These mirror
 *                `agent/guardrails.test.ts`. They can only ever confirm the
 *                implementation still does what it was built to do.
 *   `held-out` — routes AROUND those rules, on documents the implementation
 *                never saw: move-then-delete, delete-the-page-instead,
 *                duplicate-then-remove, every block type at once.
 *
 * Mixing them destroys the signal. The moment a held-out case fails and someone
 * "fixes" it by editing the guardrail until it passes, that case has become a
 * tuned case — it now measures the fix, not the rule. When that happens, MOVE
 * the case file entry into `cases/tuned.cases.ts` and write a NEW held-out case
 * for the route you just closed. A held-out set that has been iterated against
 * is a tuned set wearing the wrong label, and it will report green while the
 * next variation of the same bug ships.
 */

import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import type { EvalPageRow } from './draft-store.test-utils.js';

export type EvalSet = 'tuned' | 'held-out';

export interface MicrositeEvalCase {
  /** Stable slug. Also the test name. */
  id: string;
  set: EvalSet;
  /** The user request this scripted transcript stands in for. Documentation. */
  prompt: string;
  /** The regression this case exists to catch. One sentence, concrete. */
  guards: string;
  setup?: EvalCaseSetup;
  /** The tool calls, in order, exactly as the model would emit them. */
  script: ScriptedCall[];
  expect: DocumentExpectation;
}

export interface EvalCaseSetup {
  /** Starting pages. Defaults to the home + about fixture pair. */
  pages?: () => EvalPageRow[];
  theme?: MicrositeTheme;
  /** Per-turn call cap. Defaults to the contract's 25. */
  maxCalls?: number;
  /**
   * Destructive actions the UI has already confirmed, as `"<tool>:<resource>"`.
   * Supplied by the REQUEST in production — a case that wants to test what
   * happens AFTER confirmation sets it here; one that wants to test the gate
   * leaves it empty.
   */
  confirmedActions?: string[];
}

export interface ScriptedCall {
  /** Must be a name in `MICROSITE_AGENT_TOOLS`. An unknown name fails the case. */
  tool: string;
  input: Record<string, unknown>;
  expect: CallExpectation;
}

export type CallOutcomeKind = 'ok' | 'refused' | 'confirmation-required';

export interface CallExpectation {
  outcome: CallOutcomeKind;
  /** `ErrorCodes` value, checked when the outcome is `refused`. */
  errorCode?: string;
  /**
   * Substrings the refusal (or the confirmation prompt) must contain,
   * case-insensitively. Used to pin that a refusal EXPLAINS itself — a cap that
   * truncates silently and a cap that refuses with a relayable sentence are
   * indistinguishable without this.
   */
  messageContains?: string[];
  /** The confirmation key the UI must echo back, for `confirmation-required`. */
  confirmationAction?: string;
}

/**
 * Assertions on the document the script LEFT BEHIND.
 *
 * `pagePaths` and `blockTypesByPath` are REQUIRED and non-empty (the comparator
 * fails a case that omits them). Every case therefore proves the document
 * rendered at all before any absence assertion is believed — otherwise an empty
 * document passes every "the CTA was not removed" test in the file.
 */
export interface DocumentExpectation {
  /** Exact set of page paths, order-insensitive. */
  pagePaths: string[];
  /** Exact, ORDERED block types per page. Every page in `pagePaths` must appear. */
  blockTypesByPath: Record<string, string[]>;
  /** Exact, ordered variants per page. Optional — the global invariant already
   *  checks every variant is in BLOCK_VARIANTS; this pins WHICH one. */
  blockVariantsByPath?: Record<string, string[]>;
  /**
   * Exact props of one block — a deep equality, not a subset. This is the shape
   * that catches the patch regression: a subset match would happily pass while
   * `update_block` dropped every prop it was not given.
   */
  blockProps?: BlockPropsExpectation[];
  /** No block of this type may exist on this page. */
  absentBlocks?: { path: string; type: string }[];
  /** Deep-subset match on the theme. */
  theme?: Record<string, unknown>;
  /**
   * Patterns that must NOT appear anywhere in a DATA-BOUND block's props.
   *
   * Data-bound blocks hold a query, never a copy: the whole differentiator is
   * that a price edit in the dashboard shows on the site with no republish. A
   * services block whose props carry "€80" has silently become a snapshot, and
   * nothing anywhere else fails.
   */
  dataBoundPropsFreeOf?: { pattern: string; why: string }[];
}

export interface BlockPropsExpectation {
  path: string;
  /** Address by id (fixture blocks) or by type (blocks the script created). */
  blockId?: string;
  type?: string;
  props: Record<string, unknown>;
}

/** What one scripted call actually did. */
export interface CallOutcome {
  tool: string;
  outcome: CallOutcomeKind;
  errorCode?: string;
  /** Refusal message, or the confirmation prompt, or the human summary. */
  message: string;
  confirmationAction?: string;
}

/** The whole result of replaying one case. Compared by `compare.ts`. */
export interface CaseRun {
  caseId: string;
  calls: CallOutcome[];
  document: RunDocument;
  callsCharged: number;
}

export interface RunDocument {
  theme: Record<string, unknown>;
  pages: {
    path: string;
    title: string;
    isSystem: boolean;
    seo: Record<string, unknown>;
    blocks: {
      id: string;
      type: string;
      variant: string;
      props: Record<string, unknown>;
    }[];
  }[];
}

export interface CaseOutcome {
  caseId: string;
  set: EvalSet;
  passed: boolean;
  failures: string[];
  run: CaseRun;
}
