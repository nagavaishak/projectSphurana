/**
 * Codegen: write the capability manifest the Claire prompt consumes.
 *
 * Reads the `coverage.ts` files (via {@link renderCapabilityManifest}) and
 * writes the rendered string to the committed artifact in `packages/features`,
 * which the orchestrator imports (that package cannot import `apps/api`, so the
 * bridge is a generated data file, not a runtime import).
 *
 * Run: `pnpm --filter @borradh-workspace/api gen:capability-manifest`.
 * CI guards staleness in `capability-manifest.spec.ts` — a stale artifact fails
 * the build until this is re-run and the diff committed.
 */

import { writeFileSync } from 'node:fs';
import {
  GENERATED_MANIFEST_PATH,
  renderGeneratedModule,
} from './capability-manifest.artifact.js';

function main(): void {
  writeFileSync(GENERATED_MANIFEST_PATH, renderGeneratedModule(), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote capability manifest → ${GENERATED_MANIFEST_PATH}`);
}

main();
