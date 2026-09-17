import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

/**
 * E2E test-quality gate.
 *
 * The governing rule, from which every rule below follows:
 *
 *   A test must be unable to pass without exercising and asserting its subject.
 *
 * And its most-violated corollary:
 *
 *   Skip on ENVIRONMENT, never on observed APPLICATION STATE.
 *
 * "No Meta token in this env" is knowable before the browser opens and is a
 * legitimate, declared skip. "No campaigns rendered", "no time slots appeared",
 * "the model fired no tools" are observations of the app under test — they are
 * regressions wearing a skip's clothing. Seed the precondition, or let it fail.
 *
 * Existing violations are grandfathered in `eslint-suppressions.json` so this
 * gate gives new code the standard immediately without blocking on a burn-down.
 * That file is a debt register: entries come out, never go in. Run
 * `pnpm lint:prune` after fixing violations to shrink it.
 */
export default [
  {
    files: ['src/**/*.ts'],
    ignores: [
      // Playwright *setup projects* (setup-bare, setup-connected, global-setup):
      // these legitimately perform actions without assertions — they exist to
      // produce storageState, not to test anything.
      'src/setup-*.ts',
      'src/global-*.ts',
    ],

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { playwright },

    rules: {
      // ---- A test must assert its subject ---------------------------------
      'playwright/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'assertRoutedOrSkip',
            'assertNoError',
            'expectAppReady',
          ],
        },
      ],
      // An assertion inside an `if` can be jumped over silently — the test then
      // passes having asserted nothing. This is where tautologies breed
      // (`if (x) expect(x).toBe(true)`).
      'playwright/no-conditional-expect': 'error',
      'playwright/no-standalone-expect': 'error',
      'playwright/valid-expect': 'error',
      'playwright/no-focused-test': 'error',

      // ---- Branching is the mechanism behind almost every bad skip ---------
      'playwright/no-conditional-in-test': 'error',

      // ---- Races: non-waiting checks and blind sleeps ----------------------
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/no-useless-await': 'error',
      'playwright/no-force-option': 'warn',

      // Blind sleeps are the single largest flake source in this suite
      // (~132 call sites, ~269s of guessed waiting per full run). Every one is
      // a coin flip against a slow API. Use web-first assertions / .waitFor().
      'playwright/no-wait-for-timeout': 'error',

      // `test.skip(cond, reason)` (env-gated) is allowed; `test.skip()` is not.
      'playwright/no-skipped-test': ['error', { allowConditional: true }],

      'no-restricted-syntax': [
        'error',
        {
          // `test.skip(true, ...)` is a SELF-SKIP: the test decides at runtime,
          // from what it just observed in the app, that it will not run. That
          // converts the feature's most likely regression into a green run.
          //
          // Genuinely-external constraints (Meta rate-limited us; no model key
          // on this API) ARE legitimate reasons to skip — but they belong in a
          // named, sanctioned helper in `src/fixtures/` (see the override
          // below), never inline in a spec. That keeps every such escape hatch
          // centralised and greppable instead of scattered across 60 specs.
          selector:
            "CallExpression[callee.object.name='test'][callee.property.name='skip'] > Literal[value=true]",
          message:
            'Self-skip on observed app state. Skip on ENVIRONMENT (declared up front, e.g. test.skip(!HAS_TOKEN, ...)), never on what the app just did. Seed the precondition, or let it fail. For a genuine external constraint, use a sanctioned helper from src/fixtures/.',
        },
        {
          // locator.isVisible() does NOT wait — its `timeout` option is
          // ignored. It returns immediately, so it races the render. Used as a
          // skip-guard it produces false skips; used as a branch it silently
          // takes the wrong path.
          selector:
            "CallExpression > MemberExpression[property.name='isVisible']",
          message:
            'locator.isVisible() does NOT wait (its timeout option is ignored) — it races the render. Use `await expect(locator).toBeVisible()` or `locator.waitFor()`.',
        },
        {
          // `await new Promise(r => setTimeout(r, 15_000))` is the same blind
          // sleep as page.waitForTimeout(), just wearing a disguise that
          // `playwright/no-wait-for-timeout` can't see. Same coin-flip, same
          // flake. (Poll back-offs inside src/fixtures/ are legitimate and are
          // exempted by the fixtures override below, which replaces this rule.)
          selector:
            "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']",
          message:
            'Blind sleep in disguise. Wait on the real condition (expect().toBeVisible(), locator.waitFor(), expect.poll, page.waitForResponse) instead of a fixed delay.',
        },
      ],
    },
  },

  /**
   * Fixtures are the ONLY place a genuinely-external constraint may skip a
   * test — via a named, sanctioned helper (`skipIfMetaRateLimited`,
   * `skipIfAssistantUnavailable`). Meta rate-limiting us, or an API with no
   * model key, is not a regression and not something a test can seed its way
   * out of. Centralising those here keeps them countable: `grep -r skipIf`
   * enumerates every escape hatch in the suite.
   *
   * Everything else still applies — fixtures get no pass on blind sleeps or
   * non-waiting visibility probes.
   */
  {
    files: ['src/fixtures/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression > MemberExpression[property.name='isVisible']",
          message:
            'locator.isVisible() does NOT wait (its timeout option is ignored) — it races the render. Use `await expect(locator).toBeVisible()` or `locator.waitFor()`.',
        },
      ],
    },
  },
];
