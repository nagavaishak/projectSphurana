// Unit tests for the `before_send` hook that corrects `in_app` for our own
// workspace-package frames on `$exception` events (ENG-851, cause two).
//
// posthog-node's own frame parser sets `in_app = !filename.includes(
// 'node_modules/')` (see `filenameIsInApp` in the installed `@posthog/core`'s
// `error-tracking/parsers/node.mjs`), so every frame from `packages/features`
// / `packages/observability` is marked NOT in-app in the deployed bundle
// (those resolve under `node_modules/.pnpm/@borradh-workspace+*`). This hook
// is the only place that corrects it.
import { describe, expect, it } from 'vitest';
import { markWorkspaceFramesInApp } from './client.js';

const workspaceFilename =
  '/app/node_modules/.pnpm/@borradh-workspace+features@0.0.1/node_modules/@borradh-workspace/features/dist/leads/services/create-lead/create-lead.service.js';

const thirdPartyFilename =
  '/app/node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/cjs/src/connection.js';

const appsApiFilename = '/app/apps/api/dist/leads/leads.controller.js';

// A THIRD-PARTY vendor file that happens to sit under a "/packages/" segment
// INSIDE node_modules (e.g. a lib shipping its own internal monorepo
// layout) — a naive `filename.includes('/packages/')` check would wrongly
// promote this. It must stay in_app: false because it's not one of OUR
// workspace packages (no "@borradh-workspace+").
const vendorPackagesFilename = '/app/node_modules/some-lib/packages/x.js';

const exceptionEvent = (
  frames: Array<{ filename?: string; in_app?: boolean }>
) => ({
  event: '$exception',
  properties: {
    $exception_list: [
      {
        type: 'FeatureError',
        value: 'Failed to create lead',
        stacktrace: { type: 'raw' as const, frames },
      },
    ],
  },
});

describe('markWorkspaceFramesInApp', () => {
  it('flips in_app=true for a frame resolved through pnpm as one of OUR workspace packages', () => {
    const event = exceptionEvent([
      { filename: workspaceFilename, in_app: false },
    ]);

    const result = markWorkspaceFramesInApp(event as never);

    const frames = (
      result as unknown as {
        properties: {
          $exception_list: Array<{
            stacktrace: { frames: Array<{ in_app?: boolean }> };
          }>;
        };
      }
    ).properties.$exception_list[0].stacktrace.frames;
    expect(frames[0].in_app).toBe(true);
  });

  it('flips in_app=true for an /apps/ frame', () => {
    const event = exceptionEvent([
      { filename: appsApiFilename, in_app: false },
    ]);

    const result = markWorkspaceFramesInApp(event as never);

    const frames = (
      result as unknown as {
        properties: {
          $exception_list: Array<{
            stacktrace: { frames: Array<{ in_app?: boolean }> };
          }>;
        };
      }
    ).properties.$exception_list[0].stacktrace.frames;
    expect(frames[0].in_app).toBe(true);
  });

  it('leaves a vendor node_modules file with a "/packages/" segment as in_app: false — regression guard for the naive includes() check', () => {
    const event = exceptionEvent([
      { filename: vendorPackagesFilename, in_app: false },
    ]);

    const result = markWorkspaceFramesInApp(event as never);

    const frames = (
      result as unknown as {
        properties: {
          $exception_list: Array<{
            stacktrace: { frames: Array<{ in_app?: boolean }> };
          }>;
        };
      }
    ).properties.$exception_list[0].stacktrace.frames;
    expect(frames[0].in_app).toBe(false);
  });

  it('leaves a genuine third-party frame untouched', () => {
    const event = exceptionEvent([
      { filename: thirdPartyFilename, in_app: false },
    ]);

    const result = markWorkspaceFramesInApp(event as never);

    const frames = (
      result as unknown as {
        properties: {
          $exception_list: Array<{
            stacktrace: { frames: Array<{ in_app?: boolean }> };
          }>;
        };
      }
    ).properties.$exception_list[0].stacktrace.frames;
    expect(frames[0].in_app).toBe(false);
  });

  it('leaves non-$exception events completely untouched', () => {
    const event = {
      event: '$pageview',
      properties: {
        $exception_list: [
          {
            stacktrace: {
              frames: [{ filename: workspaceFilename, in_app: false }],
            },
          },
        ],
      },
    };

    const result = markWorkspaceFramesInApp(event as never);

    expect(result).toBe(event);
  });

  it('passes through null (event rejected upstream)', () => {
    expect(markWorkspaceFramesInApp(null)).toBeNull();
  });

  it('never throws on a malformed $exception event (missing properties)', () => {
    expect(() =>
      markWorkspaceFramesInApp({ event: '$exception' } as never)
    ).not.toThrow();
  });

  it('never throws when $exception_list is not an array', () => {
    expect(() =>
      markWorkspaceFramesInApp({
        event: '$exception',
        properties: { $exception_list: 'not-an-array' },
      } as never)
    ).not.toThrow();
  });

  it('never throws when frames is not an array', () => {
    expect(() =>
      markWorkspaceFramesInApp({
        event: '$exception',
        properties: {
          $exception_list: [{ stacktrace: { frames: 'not-an-array' } }],
        },
      } as never)
    ).not.toThrow();
  });

  it('never throws when a frame has no filename', () => {
    expect(() =>
      markWorkspaceFramesInApp(exceptionEvent([{ in_app: false }]) as never)
    ).not.toThrow();
  });
});
