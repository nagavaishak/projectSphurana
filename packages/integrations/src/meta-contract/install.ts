import { setFetchInterceptor } from '@borradh-workspace/http';
import { createMetaFakeInterceptor } from './fake/index.js';
import { type FakeStoreBackend, setFakeStoreBackend } from './fake/store.js';
import { createRecordingInterceptor } from './record.js';
import { createValidatingInterceptor } from './validate.js';

/**
 * Boot wiring for the Meta contract fake / recorder.
 *
 * Called ONCE from `apps/api/src/main.ts` and `apps/video-worker/src/main.ts`,
 * as early as possible — before any module gets a chance to make a request.
 * Both processes call the same function so they cannot drift: a stubbed API
 * beside a live worker would send half the traffic to real Meta and the failure
 * would look like a product bug.
 *
 * Reads `process.env` directly with `=== 'true'` rather than the parsed env
 * object. That is deliberate and matches the Stripe stub: `z.coerce.boolean()`
 * turns the STRING `"false"` into `true`, so a host that explicitly sets
 * `META_E2E_STUB=false` would otherwise enable the fake.
 *
 * Returns a short description of what was installed, so the caller can log it.
 * Production installs nothing and gets `null`.
 */
export function installMetaContractInterceptor(
  options: { store?: FakeStoreBackend } = {}
): string | null {
  const stub = process.env.META_E2E_STUB === 'true';
  const record = process.env.META_CONTRACT_RECORD === 'true';
  const validate = process.env.META_CONTRACT_VALIDATE === 'true';

  if (stub && validate) {
    // Validating the fake's own answers against the schemas the fake generates
    // them from is a tautology that would report a permanently clean contract.
    throw new Error(
      'META_E2E_STUB and META_CONTRACT_VALIDATE are both true. Validation ' +
        'checks REAL Meta responses; with the fake installed it would only ' +
        'confirm the fake agrees with itself. Enable exactly one.'
    );
  }

  if (stub && record) {
    // Recording captures what REAL Meta returned. With the fake installed there
    // is nothing real to capture — you'd record the fake's own answers and then
    // "validate" the contract against itself. Fail loudly rather than silently
    // producing worthless golden files.
    throw new Error(
      'META_E2E_STUB and META_CONTRACT_RECORD are both true. Recording exists ' +
        'to capture REAL Graph responses; with the fake installed there is ' +
        'nothing real to record. Enable exactly one.'
    );
  }

  if (stub) {
    // `marketing` fakes the Marketing API only and passes messaging through to
    // real Meta. That is the deliberate split: ad publishes are what trip Meta's
    // user-level rate limit (code 17), while Messenger/WhatsApp delivery is the
    // coverage most worth keeping real — a silently non-replying bot is a
    // high-blast-radius failure, and messaging is where Meta actually changes
    // behaviour under us.
    //
    // Defaults to `all` so a host that sets only META_E2E_STUB gets full
    // isolation (no accidental real-Meta traffic from an unset scope).
    const scope =
      process.env.META_E2E_STUB_SCOPE === 'marketing' ? 'marketing' : 'all';

    // The object graph MUST be shared when more than one process serves the
    // suite. `e2e-app.yml` scales the preview API to two machines and the
    // worker is a third, so with the default in-memory store a campaign
    // created on one machine is invisible to the next request — which the
    // suite saw as a campaign list that was empty, then held one, then three
    // duplicates. The host passes a Redis-backed store; see `store.ts`.
    if (options.store) setFakeStoreBackend(options.store);

    setFetchInterceptor(createMetaFakeInterceptor({ scope }));
    return `meta-contract: FAKE installed (scope=${scope}, store=${
      options.store ? 'shared' : 'in-memory'
    })${
      scope === 'marketing'
        ? ' — messaging still hits real Meta'
        : ' — no real Meta calls'
    }`;
  }

  if (record) {
    const dir = process.env.META_CONTRACT_RECORD_DIR ?? './meta-recordings';
    setFetchInterceptor(createRecordingInterceptor({ dir }));
    return `meta-contract: RECORDER installed — real Graph traffic → ${dir}`;
  }

  if (validate) {
    setFetchInterceptor(createValidatingInterceptor());
    return 'meta-contract: RESPONSE VALIDATION installed (report-only) — real Meta, drift logged';
  }

  return null;
}
