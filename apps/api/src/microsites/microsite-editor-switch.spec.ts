import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MicrositeEditorGuard } from '../common/guards/microsite-editor.guard.js';

/**
 * The editor kill switch is a POLICY, so it is asserted rather than left to a
 * decorator nobody re-reads.
 *
 * Two halves, and the second matters as much as the first: every EDITING
 * controller must sit behind the switch, and the PUBLIC render controller must
 * NOT. Guarding the public one would take every tenant's live site down the
 * moment the editor is switched off — a far worse outage than the one the
 * switch exists to prevent.
 *
 * Static source scan, like the other architecture gates: importing a
 * controller pulls the auth guard, which pulls better-auth, which pulls the
 * database package and reads env at module load. The gate has to run in a
 * plain unit process. The guard class itself imports only @nestjs/common, so
 * its behaviour IS exercised for real below.
 */
const read = (file: string): string =>
  readFileSync(path.join(__dirname, file), 'utf-8');

/**
 * `process.env[key] = undefined` stringifies to "undefined", which is TRUTHY —
 * so a naive restore makes an "unset" case assert the opposite of what it
 * claims. `Reflect.deleteProperty` actually unsets it (and sidesteps the
 * `noDelete` lint rule).
 */
const restore = (key: string, value: string | undefined): void => {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
};

const classGuards = (source: string): string => {
  const match = source.match(/@Controller\([^)]*\)\s*\n@UseGuards\(([^)]*)\)/);
  return match?.[1] ?? '';
};

describe('microsite editor kill switch', () => {
  it.each([['microsites.controller.ts'], ['domains.controller.ts']])(
    '%s is behind MicrositeEditorGuard',
    (file) => {
      expect(classGuards(read(file))).toContain('MicrositeEditorGuard');
    }
  );

  it('the guard runs FIRST, before auth — a disabled feature should not ask for credentials', () => {
    const guards = classGuards(read('microsites.controller.ts'))
      .split(',')
      .map((g) => g.trim());
    expect(guards[0]).toBe('MicrositeEditorGuard');
  });

  it('the PUBLIC render controller is NOT behind it — a tenant site must survive the switch', () => {
    const source = read('public-microsites.controller.ts');
    expect(source).not.toContain('MicrositeEditorGuard');
  });

  /**
   * Provisioning must stay a REQUEST, never a side effect of signing up.
   *
   * The plan has `provisionMicrosite` "fired from onboarding completion"
   * (§13, phase 1) and that wiring was never built. It should stay unbuilt
   * while the editor is preview-only: every new org would silently get a site
   * nobody can edit, and each one costs a model call to write its copy. The
   * editor's empty state asks for it instead (`POST /microsites`).
   *
   * So the allowed callers are enumerated rather than assumed. A new one is
   * not necessarily wrong — but it has to be added here deliberately, which is
   * the point: onboarding growing a quiet call to this is exactly the change
   * that would otherwise land unnoticed.
   */
  it('is only reachable on request — nothing provisions a microsite as a side effect', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const callers = execSync(
      `grep -rln "provisionMicrosite" ${repoRoot}/apps ${repoRoot}/packages --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.turbo --include=*.ts --include=*.tsx || true`,
      { encoding: 'utf-8' }
    )
      .split('\n')
      .filter(Boolean)
      .map((file) => path.relative(repoRoot, file))
      .filter(
        (file) =>
          // the service and its own tests
          !file.includes('microsites/services/provision-microsite') &&
          !file.endsWith('microsite-editor-switch.spec.ts')
      )
      .sort();

    expect(callers).toEqual([
      // The explicit endpoint the editor's empty state calls. Nothing else.
      'apps/api/src/microsites/microsite-workspace.ts',
    ]);
  });

  describe('the guard itself', () => {
    const guard = new MicrositeEditorGuard();
    const nodeEnv = process.env.NODE_ENV;
    const flag = process.env.MICROSITE_EDITOR_ENABLED;

    afterEach(() => {
      restore('NODE_ENV', nodeEnv);
      restore('MICROSITE_EDITOR_ENABLED', flag);
    });

    it('refuses when the flag is unset', () => {
      restore('MICROSITE_EDITOR_ENABLED', undefined);
      expect(() => guard.canActivate()).toThrow(/not enabled here/i);
    });

    it('refuses when the flag is empty, not merely absent', () => {
      process.env.MICROSITE_EDITOR_ENABLED = '';
      expect(() => guard.canActivate()).toThrow(/not enabled here/i);
    });

    it('allows when explicitly enabled', () => {
      process.env.MICROSITE_EDITOR_ENABLED = 'true';
      expect(guard.canActivate()).toBe(true);
    });

    /**
     * The regression that shipped: the first version keyed on NODE_ENV, and
     * preview Fly apps inherit NODE_ENV=production from fly.toml — so it 404'd
     * the previews it existed to enable. The flag must be the ONLY input.
     */
    it.each([['production'], ['preview'], ['development'], ['test']])(
      'ignores NODE_ENV=%s — preview apps run as production and must still work',
      (env) => {
        process.env.NODE_ENV = env;
        process.env.MICROSITE_EDITOR_ENABLED = 'true';
        expect(guard.canActivate()).toBe(true);

        restore('MICROSITE_EDITOR_ENABLED', undefined);
        expect(() => guard.canActivate()).toThrow();
      }
    );
  });

  it('pr-preview.yml sets the flag on both preview apps', () => {
    // The guard is default-off, so the preview deploy is the ONLY thing that
    // turns it on. If this drifts, the editor silently 404s on every preview
    // and the failure looks like a broken feature rather than missing config.
    const workflow = readFileSync(
      path.resolve(__dirname, '../../../../.github/workflows/pr-preview.yml'),
      'utf-8'
    );
    const occurrences = workflow.split('MICROSITE_EDITOR_ENABLED').length - 1;
    expect(occurrences).toBe(2);
  });
});
