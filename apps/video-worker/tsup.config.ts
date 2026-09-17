import { defineConfig } from 'tsup';

/**
 * The worker is bundled to ESM (`--format esm` in package.json's build script).
 * Some transitive CJS deps do a *dynamic* `require()` of Node built-ins — e.g.
 * `whatwg-url@5` (pulled in via `@borradh-workspace/ai` → openai → node-fetch@2)
 * does `require('punycode')`. esbuild can't statically resolve those, so it
 * emits its `__require` shim which throws at runtime:
 *
 *   Error: Dynamic require of "punycode" is not supported
 *
 * This crashes the worker on boot — and the Docker boot smoke test only greps
 * for MODULE_NOT_FOUND, so it slips through the build undetected.
 *
 * esbuild's `__require` shim delegates to a real `require` when one exists in
 * scope (`if (typeof require !== 'undefined') return require(x)`). The deployed
 * bundle ships node_modules, so providing a working `require` via createRequire
 * lets those dynamic requires resolve normally. Applies to every bundle entry.
 */
export default defineConfig({
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
