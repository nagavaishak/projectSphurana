import { describe, expect, it } from 'vitest';
import {
  buildFallbackFingerprint,
  hasAppStackFrame,
  isAppCodeStackLine,
} from './exception-fingerprint.js';

// A stack line shaped like a real deployed-bundle frame from OUR OWN
// workspace package, resolved through pnpm's on-disk store — this DOES
// contain "node_modules/" but IS app code.
const WORKSPACE_PACKAGE_LINE =
  '    at createLeadImpl (/app/node_modules/.pnpm/@borradh-workspace+features@0.0.1/node_modules/@borradh-workspace/features/dist/leads/services/create-lead/create-lead.service.js:42:15)';

// A stack line shaped like a real deployed-bundle frame from apps/api — no
// node_modules segment at all.
const APPS_API_LINE =
  '    at LeadsController.create (/app/apps/api/dist/leads/leads.controller.js:18:23)';

// A dev/vitest-shaped resolved frame (relative import back to source).
const RELATIVE_SRC_LINE =
  '    at createLeadImpl (../../src/leads/services/create-lead/create-lead.service.ts:42:15)';

// A genuine third-party dependency frame — has "node_modules/" and even
// happens to contain the substring "packages" in an unrelated position, but
// is NOT our workspace package.
const THIRD_PARTY_LINE =
  '    at Object.query (/app/node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/cjs/src/connection.js:788:26)';

// A pure node-internals frame — no path at all.
const NODE_INTERNAL_LINE =
  '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)';

describe('isAppCodeStackLine', () => {
  it('recognizes a workspace package resolved through pnpm store (node_modules + @borradh-workspace+)', () => {
    expect(isAppCodeStackLine(WORKSPACE_PACKAGE_LINE)).toBe(true);
  });

  it('recognizes an apps/api frame with no node_modules segment', () => {
    expect(isAppCodeStackLine(APPS_API_LINE)).toBe(true);
  });

  it('recognizes a dev-mode relative ../../src/ frame', () => {
    expect(isAppCodeStackLine(RELATIVE_SRC_LINE)).toBe(true);
  });

  it('rejects a genuine third-party dependency frame', () => {
    expect(isAppCodeStackLine(THIRD_PARTY_LINE)).toBe(false);
  });

  it('rejects a pure node-internals frame', () => {
    expect(isAppCodeStackLine(NODE_INTERNAL_LINE)).toBe(false);
  });
});

describe('hasAppStackFrame', () => {
  it('is false for a plain node-internals stack with no cause', () => {
    const err = new Error('boom');
    err.stack = `Error: boom\n${NODE_INTERNAL_LINE}`;
    expect(hasAppStackFrame(err)).toBe(false);
  });

  it('is true when the top-level error itself has an app frame', () => {
    const err = new Error('boom');
    err.stack = `Error: boom\n${APPS_API_LINE}\n${NODE_INTERNAL_LINE}`;
    expect(hasAppStackFrame(err)).toBe(true);
  });

  it('is true when only a cause deep in the chain has an app frame', () => {
    const root = new Error('root cause');
    root.stack = `Error: root cause\n${WORKSPACE_PACKAGE_LINE}`;
    const wrapper = new Error('wrapper', { cause: root });
    wrapper.stack = `Error: wrapper\n${NODE_INTERNAL_LINE}`;
    expect(hasAppStackFrame(wrapper)).toBe(true);
  });

  it('is false when neither the error nor any cause has an app frame', () => {
    const root = new Error('root cause');
    root.stack = `Error: root cause\n${THIRD_PARTY_LINE}`;
    const wrapper = new Error('wrapper', { cause: root });
    wrapper.stack = `Error: wrapper\n${NODE_INTERNAL_LINE}`;
    expect(hasAppStackFrame(wrapper)).toBe(false);
  });

  it('does not throw and returns false for a non-Error cause chain terminator', () => {
    const err = new Error('boom', { cause: 'not an error' });
    err.stack = `Error: boom\n${NODE_INTERNAL_LINE}`;
    expect(hasAppStackFrame(err)).toBe(false);
  });

  it('does not infinite-loop on a self-referential cause chain', () => {
    const err = new Error('boom');
    err.stack = `Error: boom\n${NODE_INTERNAL_LINE}`;
    // @ts-expect-error -- deliberately malformed for the depth-guard test
    err.cause = err;
    expect(() => hasAppStackFrame(err)).not.toThrow();
    expect(hasAppStackFrame(err)).toBe(false);
  });
});

describe('buildFallbackFingerprint', () => {
  it('joins operation, error name, and code', () => {
    expect(
      buildFallbackFingerprint('leads.createLead', 'PostgresError', '23505')
    ).toBe('leads.createLead:PostgresError:23505');
  });

  it('drops a missing code rather than serializing "undefined"', () => {
    expect(buildFallbackFingerprint('leads.createLead', 'Error')).toBe(
      'leads.createLead:Error'
    );
  });

  it('drops an empty-string code', () => {
    expect(buildFallbackFingerprint('leads.createLead', 'Error', '')).toBe(
      'leads.createLead:Error'
    );
  });
});
