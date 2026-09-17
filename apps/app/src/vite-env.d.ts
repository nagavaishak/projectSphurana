/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * When `'true'`, forces the Stripe Terminal **simulated** reader even in a
   * production-mode bundle (see `usesSimulatedReader()` in
   * `src/features/terminal/lib/terminal-service.ts`). Test-lane only — baked in
   * on-disk by the CI `build-apk` job, never committed to `.env.production`.
   */
  readonly VITE_TAP_TO_PAY_SIMULATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
