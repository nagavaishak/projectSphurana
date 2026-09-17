# Microsite editing-agent eval

The editing agent shipped with guardrails and no eval. This is the eval.

It pins the rules that are **code** — the conversion-path refusal, the system-page
refusal, the per-turn cap, the `update_block` patch merge, the variant
correction, the data-binding of data-bound blocks — against sequences of tool
calls designed to get around them. Every assertion is on the **resulting
document**: which page holds which blocks, in which order, with which props and
which variants. Nothing asserts on prose. "Did it say something reasonable" is
not a test.

The class of bug this exists for is the one that leaves no trace: every tool
returns `ok`, the sidebar shows a tidy activity line, no log fires, and the
document is wrong.

## Run

```bash
cd packages/features && pnpm vitest run src/microsites/eval
```

No API key. No network. No model call. It is a normal vitest file and runs in
the ordinary `pnpm turbo test --filter=@borradh-workspace/features` gate, which
is the point: a suite that only runs with credentials does not run.

## How offline determinism works

A case is a **scripted transcript** — the exact tool calls, in order, as a model
would emit them — replayed through the **real** registry (`agent/tools/index.ts`)
against a stateful in-memory draft (`draft-store.test-utils.ts`). The tools, the
wrapper, the Zod schemas, the patch merge, the budget and the guardrails are all
the production code. Only the model and the database are absent.

Two nondeterministic things are contained rather than mocked:

- block ids are minted server-side from `Math.random` + `Date.now`, so no
  assertion names a generated id — blocks the script created are addressed **by
  type** (`blockTypesByPath`, `blockProps.type`);
- `generate_image` and `search_org_assets` reach outside the draft, so no case
  scripts them (see "Not evaluated here").

The draft store keeps the same drizzle chain shapes the unit-test mock uses, but
makes them **write**, so the document can be read back at the end through the
tools' own read path (`loadDraft`). Rows, blocks, theme and session all come from
`agent/agent-fixtures.test-utils.ts` — there is no second fixture set.

## The two sets, and why they must not mix

| Set | File | What it can tell you |
|---|---|---|
| **tuned** | `cases/tuned.cases.test-utils.ts` | The implementation still does what it was built to do. These mirror `agent/guardrails.test.ts` — the shapes the guardrails were written against. |
| **held out** | `cases/held-out.cases.test-utils.ts` | The rule survives a route nobody thought of. Nothing here was used while writing the guardrails, and nothing here may be used to iterate on them. |

Held-out routes currently covered: move-then-delete, delete-the-page-under-it,
duplicate-then-delete-the-original, a three-step patch sequence (scalar / array
replace / null clear), a nested theme merge, **every** block type asked for with
an invented variant, refusals leaving nothing half-written, the confirmation gate
on an ordinary page, and cap exhaustion across mixed tools.

**Mixing them destroys the signal.** If a held-out case fails, the finding is
"the rule has a hole". The fix is a change to the rule, re-checked against a
**new** held-out route — not a tweak until this file goes green. A held-out case
that has been iterated against is a tuned case wearing the wrong label: it will
report green while the next variation of the same bug ships. When a held-out
case has driven a fix, **move it into `tuned.cases`** and write a replacement.

Fixtures overfit fast. That is the whole reason for the split.

## Every case must be able to fail

Two structural rules, enforced by the comparator (`compare.test-utils.ts`), not
by reviewer discipline:

1. **`pagePaths` and `blockTypesByPath` are mandatory and non-empty.** A case
   that only asserts absences ("the booking CTA is still there", "no prices
   leaked into props") passes on an **empty document** — the one state where
   every guardrail is trivially satisfied and the product is broken. A case
   without a presence assertion fails as malformed.
2. **Global invariants run on every case, asserted or not:** the document has
   pages, every block type is in the contract, and every variant is in
   `BLOCK_VARIANTS`. An unknown variant is the quietest failure in the system —
   the renderer draws the fallback, nothing errors anywhere, and the user gets a
   layout they did not ask for.

`eval.test.ts` also proves the **comparator itself** can fail: each assertion key
is shown rejecting a document that violates it. Without that, a comparator bug
turns the suite into a green light that checks nothing.

The suite was verified by mutation: reverting `isProtectedConversionBlock` to
`false`, making `applyPropsPatch` replace instead of merge, and making
`resolveRequestedVariant` pass the model's variant through turned **13 of 17**
cases red. The four that stayed green target other guardrails.

## Adding a case

1. Decide the set — honestly. If you are writing it while looking at a guardrail
   you are about to change, it is **tuned**.
2. Write the `prompt` (the user request it stands in for) and `guards` (the
   regression it catches, one concrete sentence).
3. Script the calls with the outcome each must have. For a refusal, assert
   `messageContains` — a cap that stops silently and a cap that refuses with a
   relayable sentence are indistinguishable otherwise.
4. Assert the document. Use exact `blockProps` (a deep equality, not a subset) —
   a subset match happily passes while `update_block` drops every prop it was not
   given.
5. Run the suite, then **break the guardrail on purpose** and confirm your case
   goes red. A case that cannot fail is worse than no case.

## Not evaluated here

Stated rather than faked, because a case that always passes is the failure mode
this file exists to prevent.

- **Model judgement.** Whether the model picks `update_block` over
  `delete_block` + `add_block`, or reaches for a data-bound `services` block when
  the user says "put our prices on the page", is a decision, not a rule. Scripts
  here are hand-authored, so they measure what the code does with a sequence, not
  what the model would send. Evaluating that needs live transcripts recorded per
  prompt-and-tool-description change — the shape `assistant/eval` uses. There is
  no hook for it here yet, and no case pretends to cover it.
- **The data-binding rule is only half enforceable in code.** A `services` block
  cannot hold copied prices — the block schema strips what it does not name, and
  `services-stay-data-bound-when-asked-for-prices` pins that. But nothing stops
  the model answering "put our prices on the page" with a **`rich_text` block
  containing a hand-typed price list**, which is the same staleness bug through
  an unguarded door. That route has no code guardrail to test, so there is no
  case for it; closing it needs either a check on `rich_text` content or a
  prompt-level rule with a live eval behind it.
- **`generate_image` / `search_org_assets`.** They leave the draft (S3, the image
  model, the assets service). A case here would either hit the network or assert
  against a mock of the thing under test. They have unit coverage in
  `agent/tools.test.ts`.
- **The turn lifecycle** (`turn.ts`: one revision per mutating turn, the
  transaction around `createRevision`). Covered by `agent/turn.test.ts`; this
  eval runs the tool loop only.
- **Tenant isolation.** The store here answers for one org by construction. The
  WHERE-clause boundary is unit-tested in `agent/guardrails.test.ts`.
