/**
 * Replay one case's scripted tool calls through the REAL tool registry.
 *
 * OFFLINE AND DETERMINISTIC BY DEFAULT — and there is no default-path switch to
 * turn that off. The script is the transcript; no model is consulted, no
 * network call is made, and nothing here reads an API key. A suite that only
 * runs with credentials does not run, so this one has none to want.
 *
 * The two nondeterministic things the tools do are contained rather than
 * mocked away:
 *   - block ids are minted server-side from Math.random + Date.now, so no
 *     assertion in this eval names a generated id (blocks the script created
 *     are addressed BY TYPE);
 *   - `generate_image` and `search_org_assets` reach outside the draft, so no
 *     case scripts them. They have unit coverage; a case here would either hit
 *     the network or assert against a mock of the thing under test.
 */

import { SESSION } from '../agent/agent-fixtures.test-utils.js';
import { loadDraft } from '../agent/draft-writer.js';
import { createTurnBudget } from '../agent/guardrails.js';
import { micrositeToolByName } from '../agent/tools/index.js';
import type { MicrositeToolContext } from '../agent/types.js';
import {
  type EvalPageRow,
  createEvalDraftStore,
  evalSiteRow,
} from './draft-store.test-utils.js';
import { defaultEvalPages } from './fixtures.test-utils.js';
import type {
  CallOutcome,
  CaseRun,
  MicrositeEvalCase,
  RunDocument,
} from './types.test-utils.js';

export const runCase = async (
  evalCase: MicrositeEvalCase
): Promise<CaseRun> => {
  const pages: EvalPageRow[] = (evalCase.setup?.pages ?? defaultEvalPages)();
  const store = createEvalDraftStore({
    pages,
    site: evalSiteRow({
      micrositeId: SESSION.micrositeId,
      organizationId: SESSION.organizationId,
      theme: evalCase.setup?.theme,
    }),
  });

  const ctx: MicrositeToolContext = {
    db: store.db as never,
    session: SESSION,
    budget: createTurnBudget(
      evalCase.setup?.maxCalls ? { maxCalls: evalCase.setup.maxCalls } : {}
    ),
    confirmedActions: new Set(evalCase.setup?.confirmedActions ?? []),
  };

  const calls: CallOutcome[] = [];
  for (const scripted of evalCase.script) {
    const tool = micrositeToolByName(scripted.tool);
    if (!tool) {
      calls.push({
        tool: scripted.tool,
        outcome: 'refused',
        errorCode: 'UNKNOWN_TOOL',
        message: `"${scripted.tool}" is not a registered microsite tool`,
      });
      continue;
    }

    const result = await tool.execute(ctx, scripted.input);
    if (!result.success) {
      calls.push({
        tool: scripted.tool,
        outcome: 'refused',
        errorCode: result.error.code,
        message: result.error.message,
      });
      continue;
    }
    if (result.data.confirmationRequired) {
      calls.push({
        tool: scripted.tool,
        outcome: 'confirmation-required',
        message: result.data.confirmationRequired.prompt,
        confirmationAction: result.data.confirmationRequired.action,
      });
      continue;
    }
    calls.push({
      tool: scripted.tool,
      outcome: 'ok',
      message: result.data.summary,
    });
  }

  const draft = await loadDraft(store.db as never, SESSION);
  if (!draft.success) {
    throw new Error(
      `[${evalCase.id}] the draft could not be read back after the script: ${draft.error.message}`
    );
  }

  const document: RunDocument = {
    theme: draft.data.theme as unknown as Record<string, unknown>,
    pages: draft.data.pages.map((page) => ({
      path: page.path,
      title: page.title,
      isSystem: page.isSystem,
      seo: page.seo as unknown as Record<string, unknown>,
      blocks: page.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        variant: block.variant,
        props: block.props as unknown as Record<string, unknown>,
      })),
    })),
  };

  return {
    caseId: evalCase.id,
    calls,
    document,
    callsCharged: ctx.budget.calls,
  };
};
