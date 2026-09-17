/**
 * Guardrails (contract §3). CODE, not prompting.
 *
 * Everything here is enforced on the path a tool actually takes, so the model
 * cannot talk its way past it: the per-turn call budget is a counter the tool
 * wrapper decrements, the conversion-path rule is a check inside `delete_block`,
 * and confirmation is a set supplied by the REQUEST — a field the model has no
 * way to write.
 *
 * A guardrail that lives in the system prompt is a request. These are refusals.
 */

import { ErrorCodes, FeatureError } from '../../shared/index.js';

/**
 * Hard cap on tool calls in one turn (contract §3, "~25"). Past it every tool
 * refuses with an explanation the model can relay, rather than the loop being
 * killed silently — a turn that stops mid-edit still owes the user a sentence.
 */
export const MAX_MICROSITE_TOOL_CALLS = 25;

/**
 * Ceiling on the bytes of tool OUTPUT a turn may feed back to the model. The
 * page structure is compact by construction, but `read_page` on a long page
 * plus a wide `search_org_assets` will otherwise grow the context every round.
 */
export const MAX_MICROSITE_TOOL_OUTPUT_BYTES = 120_000;

/** The path whose conversion path is not up for negotiation. */
export const HOME_PAGE_PATH = '/';

/** Per-turn budget shared by every tool in the turn. */
export interface MicrositeTurnBudget {
  /** Calls made so far. */
  calls: number;
  /** Bytes of tool output returned so far. */
  outputBytes: number;
  maxCalls: number;
  maxOutputBytes: number;
}

export const createTurnBudget = (
  overrides: Partial<
    Pick<MicrositeTurnBudget, 'maxCalls' | 'maxOutputBytes'>
  > = {}
): MicrositeTurnBudget => ({
  calls: 0,
  outputBytes: 0,
  maxCalls: overrides.maxCalls ?? MAX_MICROSITE_TOOL_CALLS,
  maxOutputBytes: overrides.maxOutputBytes ?? MAX_MICROSITE_TOOL_OUTPUT_BYTES,
});

/**
 * Charge one call against the budget.
 *
 * Returns a FeatureError when the turn is spent. CONFLICT rather than
 * VALIDATION_ERROR: nothing about the arguments is wrong, the turn is simply
 * over — and the message is written for the model to relay verbatim.
 */
export const chargeToolCall = (
  budget: MicrositeTurnBudget,
  toolName: string
): FeatureError | null => {
  if (budget.calls >= budget.maxCalls) {
    return new FeatureError(
      ErrorCodes.CONFLICT,
      `This turn has used its ${budget.maxCalls} allowed edits. Tell the user what you changed so far and ask them to send another message to continue.`,
      { toolName, calls: budget.calls, maxCalls: budget.maxCalls }
    );
  }
  budget.calls += 1;
  return null;
};

/** Charge tool output bytes; refuses once the turn's context ceiling is hit. */
export const chargeToolOutput = (
  budget: MicrositeTurnBudget,
  bytes: number
): FeatureError | null => {
  budget.outputBytes += bytes;
  if (budget.outputBytes > budget.maxOutputBytes) {
    return new FeatureError(
      ErrorCodes.CONFLICT,
      'This turn has read as much of the site as it can hold. Summarise what you found and ask the user to send another message.',
      { outputBytes: budget.outputBytes, maxOutputBytes: budget.maxOutputBytes }
    );
  }
  return null;
};

/**
 * The confirmation key the UI echoes back. Scoped to the resource so a
 * confirmation for `/about` cannot delete `/pricing`.
 */
export const confirmationKey = (toolName: string, resource: string): string =>
  `${toolName}:${resource}`;

/**
 * The conversion path is not the model's decision (contract §3).
 *
 * Enforced on the DOCUMENT, not on intent: a `cta_booking` block on the home
 * page cannot be deleted, whatever the block is called and whoever asked.
 */
export const isProtectedConversionBlock = (
  pagePath: string,
  blockType: string
): boolean => pagePath === HOME_PAGE_PATH && blockType === 'cta_booking';

export const conversionBlockRefusal = (): FeatureError =>
  new FeatureError(
    ErrorCodes.FORBIDDEN,
    'The booking call-to-action cannot be removed from the home page. Offer to move it, restyle it or change its wording instead.',
    { guardrail: 'cta_booking_home_page' }
  );
