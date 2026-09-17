/**
 * Canonical mock for `@borradh-workspace/env/storage`.
 *
 * Aliased in vite.config.ts so tests never run the real `createEnv` (which
 * validates `process.env`), and so every test file sees the *same* config
 * object — a prerequisite for `isolate: false`. env is CONFIG, not behaviour:
 * a static fake object, not vi.fn()s. See docs/plans/features-test-suite-speedup.md.
 */
export const storageEnv = {
  S3_ASSISTANT_UPLOADS_BUCKET: 'mock-assistant-uploads-bucket',
};
