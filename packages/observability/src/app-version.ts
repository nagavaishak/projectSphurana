/**
 * The one release version, as reported by every deployed service.
 *
 * Source of truth is the repo-root `VERSION` file. The image build passes it as
 * the `APP_VERSION` build arg (see each app's Dockerfile), so the running
 * container has it in its environment.
 *
 * WHY NOT npm_package_version
 * Every call site used to read `process.env.npm_package_version`. npm and pnpm
 * only set that when they launch the process via a package script; the
 * production images are distroless and run `node dist/main.js` directly, so it
 * was never set. Every deployed service therefore reported `version: "unknown"`
 * — in `/health`, in the `version` field of every Better Stack log line, and as
 * the Sentry release, which is why suspect-commit attribution had nothing to
 * work with. It is kept below only as a fallback for local `pnpm dev` runs,
 * where it does resolve.
 */
export const getAppVersion = (): string =>
  process.env.APP_VERSION?.trim() ||
  process.env.npm_package_version?.trim() ||
  'unknown';
