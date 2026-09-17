/**
 * Shared definition of the committed capability-manifest artifact: where it
 * lives and the exact module text it should contain. The generator writes this
 * text; the staleness spec asserts the on-disk file matches it. Both import
 * from here so they can never disagree.
 */

import path from 'node:path';
import { renderCapabilityManifest } from './capability-manifest.js';
import { REPO_ROOT } from './tool-coverage.js';

/** The committed artifact the orchestrator imports. */
export const GENERATED_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'packages/features/src/assistant/skills/capability-manifest.generated.ts'
);

/**
 * The full text of the generated module. A single template literal holds the
 * rendered manifest; backticks and `${` in the content are escaped so the
 * emitted file is valid TypeScript.
 */
export function renderGeneratedModule(): string {
  const manifest = renderCapabilityManifest();
  const escaped = manifest
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: apps/api/src/assistant/tools/*\\/coverage.ts (the Gate 6 coverage
 * files). Regenerate with:
 *   pnpm --filter @borradh-workspace/api gen:capability-manifest
 *
 * Staleness is enforced in CI by
 * apps/api/src/architecture/capability-manifest.spec.ts — a hand-edit or a
 * coverage change without a regen fails the build.
 *
 * Consumed by the Claire prompt (skills/orchestrator.ts) so what Claire claims
 * she can and can't do is derived from her actual tools, not free prose.
 */

export const CAPABILITY_MANIFEST = \`${escaped}\`;
`;
}
