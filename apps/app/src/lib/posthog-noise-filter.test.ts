// PostHog must drop the same non-defects Sentry drops. If these rules diverge,
// whichever sink is stricter quietly becomes the only usable one.
import { describe, expect, it, vi } from 'vitest';

import { dropPostHogNoise } from './posthog-noise-filter';

type Ev = Parameters<typeof dropPostHogNoise>[0];

const exceptionEvent = (
  values: Array<{
    type?: string;
    value?: string;
    stacktrace?: { frames?: Array<{ filename?: string }> };
  }>
): Ev =>
  ({
    uuid: 'u',
    event: '$exception',
    properties: {
      $exception_list: values,
      $exception_values: values.map((v) => v.value),
    },
  }) as unknown as Ev;

describe('dropPostHogNoise', () => {
  it('drops MetaMask/extension injection', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([{ type: 'i', value: 'Failed to connect to MetaMask' }])
      )
    ).toBeNull();
  });

  it('drops an error with an extension stack frame, whatever the message', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([
          {
            type: 'TypeError',
            value: 'something plausible',
            stacktrace: {
              frames: [{ filename: 'chrome-extension://abc/inject.js' }],
            },
          },
        ])
      )
    ).toBeNull();
  });

  it('drops expected user conditions', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([
          { type: 'HTTPError', value: 'Invalid or expired session' },
        ])
      )
    ).toBeNull();
    expect(
      dropPostHogNoise(
        exceptionEvent([
          {
            type: 'HTTPError',
            value: 'A paid plan is required for this action',
          },
        ])
      )
    ).toBeNull();
  });

  it('drops one client’s connectivity', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([{ type: 'TypeError', value: 'Failed to fetch' }])
      )
    ).toBeNull();
  });

  it('KEEPS a real defect', () => {
    const real = exceptionEvent([
      { type: 'TypeError', value: 'Cannot read properties of undefined' },
    ]);
    expect(dropPostHogNoise(real)).toBe(real);
  });

  it('drops ResizeObserver noise through the full PostHog properties shape (ENG-853)', () => {
    // Regression guard: `exceptionEvent()` sets BOTH $exception_list and
    // $exception_values (as real PostHog events sometimes do defensively).
    // classifyDroppableEvent's rules for this ticket are anchored with
    // `^...$`, so if toSentryEventLike ever concatenates the list value and
    // the message fallback into one string again, this stops matching.
    expect(
      dropPostHogNoise(
        exceptionEvent([
          {
            type: 'Error',
            value:
              'ResizeObserver loop completed with undelivered notifications.',
          },
        ])
      )
    ).toBeNull();
  });

  it('passes NON-exception events through untouched', () => {
    // This hook sees every captured event. Filtering analytics would break
    // product reporting far more quietly than noisy error tracking ever could.
    for (const name of ['$pageview', '$autocapture', '$feature_flag_called']) {
      const ev = {
        uuid: 'u',
        event: name,
        // Deliberately carries text that WOULD match a drop rule, to prove the
        // event-type guard is what protects it.
        properties: { $current_url: 'https://x/y', note: 'Failed to fetch' },
      } as unknown as Ev;
      expect(dropPostHogNoise(ev)).toBe(ev);
    }
  });

  it('tolerates an exception event with no exception properties', () => {
    const bare = {
      uuid: 'u',
      event: '$exception',
      properties: {},
    } as unknown as Ev;
    expect(() => dropPostHogNoise(bare)).not.toThrow();
    expect(dropPostHogNoise(bare)).toBe(bare);
  });

  it('passes null through (posthog-js may hand us null)', () => {
    expect(dropPostHogNoise(null)).toBeNull();
  });

  it('ENG-853: forces handled=false for events on the unhandled-error path', () => {
    const ev = {
      uuid: 'u',
      event: '$exception',
      properties: {
        feature: 'unhandled',
        $exception_list: [
          { type: 'Error', value: 'boom', mechanism: { handled: true } },
        ],
      },
    } as unknown as Ev;

    const result = dropPostHogNoise(ev);

    expect(result).not.toBeNull();
    const list = (result?.properties as Record<string, unknown>)
      .$exception_list as Array<{ mechanism: { handled: boolean } }>;
    expect(list[0].mechanism.handled).toBe(false);
  });

  it('does NOT touch the handled flag for a normal (non-unhandled) capture', () => {
    const ev = {
      uuid: 'u',
      event: '$exception',
      properties: {
        feature: 'billing',
        $exception_list: [
          { type: 'Error', value: 'boom', mechanism: { handled: true } },
        ],
      },
    } as unknown as Ev;

    const result = dropPostHogNoise(ev);

    const list = (result?.properties as Record<string, unknown>)
      .$exception_list as Array<{ mechanism: { handled: boolean } }>;
    expect(list[0].mechanism.handled).toBe(true);
  });

  it('stays silent in production builds', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('DEV', false);

    dropPostHogNoise(
      exceptionEvent([{ type: 'TypeError', value: 'Failed to fetch' }])
    );

    expect(debug).not.toHaveBeenCalled();
    debug.mockRestore();
    vi.unstubAllEnvs();
  });
});
