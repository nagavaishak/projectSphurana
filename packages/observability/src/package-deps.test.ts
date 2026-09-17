import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the "backend product events go dark" outage.
 *
 * `@nestjs/common` is used by this package ONLY as a type
 * (`import type { LoggerService }` in nest-logger.ts). If it is declared as a
 * runtime `dependency`, its optional `class-validator` / `class-transformer`
 * peers make pnpm mint TWO peer-variants of `@borradh-workspace/observability`
 * at `pnpm deploy` time. `initPostHog()` then initializes one instance while
 * the features-package `trackedResult` path imports the other, never-initialized
 * copy — so every backend product event (`<feature>.<op>.success|error`, all
 * `conversation.*`, etc.) is silently dropped while `$ai_generation` survives
 * (it happens to resolve the initialized copy).
 *
 * This bit us twice: originally (fixed in #528, moved the dep to
 * devDependencies) and again when #526 re-added it to `dependencies`, taking
 * backend analytics dark for ~2 weeks unnoticed. Keep it type-only.
 */
describe('observability package dependencies', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('does NOT declare @nestjs/common as a runtime dependency (type-only → devDependencies)', () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty('@nestjs/common');
  });

  it('keeps @nestjs/common in devDependencies (still needed for the LoggerService type)', () => {
    expect(pkg.devDependencies ?? {}).toHaveProperty('@nestjs/common');
  });
});
