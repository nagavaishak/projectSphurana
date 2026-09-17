import type { LiveProvider } from './harness.js';
/**
 * The HELD-OUT eval — the gate the location redesign's biggest risk hangs on.
 *
 * ## What "held out" means here, precisely
 *
 * These fixtures are not tuned against during prompt work. The rest of the
 * suite is written alongside the prompt and the skills, which is what makes it
 * good at catching plumbing regressions and bad at telling you whether the
 * behaviour is right — a suite you edit whenever it goes red measures the edits,
 * not the model. This set is kept separate so that when it fails, the honest
 * first assumption is that the BEHAVIOUR changed, not that the assertion needs
 * loosening.
 *
 * Practical rule: if a change to a fixture in here would make a red run green,
 * that change needs the same scrutiny as a change to the prompt. Do not
 * re-record one to get past CI.
 *
 * ## What it gates
 *
 * Branch-scoped pricing (plan §3.3, risk 1). Once a service can be priced per
 * branch, every price Claire says is a number a real customer acts on, and the
 * failure mode is silent: quoting the org's base price where a branch overrides
 * it produces a perfectly well-formed answer that is wrong. No plumbing
 * assertion can see it — the tool was called, the confirmation was presented,
 * the response parsed. Only an assertion on the NUMBER catches it.
 *
 * Three shapes, each a different way to be wrong about a price:
 *
 *   - `branch-pricing-quotes-branch-price` — the branch's overridden price is
 *     relayed and the org's base price is not mentioned at all.
 *   - `branch-pricing-no-invented-price` — a POA service gets no figure.
 *   - `branch-pricing-variants-are-a-from` — a variant-priced service is a
 *     "from", not a flat price. This one also covers the gap where the branch
 *     override does NOT reach: variant prices have no per-branch column.
 *
 * ## What it does NOT cover — read this before trusting a green run
 *
 * In **replay** mode these gate a FROZEN transcript. A green run proves the
 * recorded decision was right, not that today's model would make it. That is
 * the whole suite's limitation (see README, "Limits, stated") and it applies
 * here with more force, because the thing under test IS a decision.
 *
 * So: re-record whenever the prompt, the skills or the service-read tools
 * change, and treat `EVAL_RECORD=1` as the run that actually exercises choice.
 *
 * Also not covered: whether Claire ASKS which branch when an org has several
 * and none is in scope. That needs a multi-branch conversational fixture and a
 * product decision about what she should do — currently the WhatsApp path
 * carries no branch at all (one number per org), so she has nothing to resolve
 * and the question does not arise there.
 *
 * ## Run
 *
 *   pnpm test:eval-claire-heldout                 # replay (keyless, CI gate)
 *   EVAL_RECORD=1 pnpm test:eval-claire-heldout   # re-record (needs ANTHROPIC_API_KEY)
 *
 * A fixture with no recording fails loudly with the exact command to populate
 * it — deliberately, rather than skipping. A held-out gate that silently skips
 * is worse than no gate, because it reads as a pass.
 */
import { runEval } from './runner.js';
import type { EvalMode } from './types.js';

/** The held-out category. Everything else in `fixtures/` is out of scope here. */
const HELD_OUT_CATEGORY = 'branch-pricing';

async function main(): Promise<void> {
  const mode: EvalMode = process.env.EVAL_RECORD === '1' ? 'record' : 'replay';

  let liveProvider: LiveProvider | undefined;
  if (mode === 'record') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        'EVAL_RECORD=1 requires ANTHROPIC_API_KEY. Drop the flag for replay mode.'
      );
      process.exit(2);
    }
    // Same provider the main runner builds; imported lazily so the default
    // replay path never pulls in the AI client.
    const { buildLiveProvider } = await import('./run-eval.js');
    liveProvider = await buildLiveProvider();
  }

  console.log(
    `Held-out eval (${mode}) — category "${HELD_OUT_CATEGORY}".\nThese are not tuned against. A failure here means the behaviour moved.\n`
  );

  const summary = await runEval({
    mode,
    serial: true,
    liveProvider,
    categories: [HELD_OUT_CATEGORY],
  });

  if (summary.total === 0) {
    // A gate that matches nothing passes vacuously — the exact failure the
    // rest of this repo's architecture gates guard against.
    console.error(
      `No fixtures in category "${HELD_OUT_CATEGORY}". The gate would pass vacuously; either the fixtures were deleted or the category was renamed.`
    );
    process.exit(2);
  }

  process.exit(summary.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
