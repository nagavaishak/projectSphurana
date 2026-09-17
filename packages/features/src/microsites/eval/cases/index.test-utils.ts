import type { MicrositeEvalCase } from '../types.test-utils.js';
import { HELD_OUT_CASES } from './held-out.cases.test-utils.js';
import { TUNED_CASES } from './tuned.cases.test-utils.js';

export { HELD_OUT_CASES, TUNED_CASES };

export const ALL_CASES: MicrositeEvalCase[] = [
  ...TUNED_CASES,
  ...HELD_OUT_CASES,
];
