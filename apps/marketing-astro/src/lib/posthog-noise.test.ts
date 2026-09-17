import { describe, expect, it, vi } from 'vitest';

import { dropPostHogNoise } from './posthog-noise';

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

describe('dropPostHogNoise (marketing-astro)', () => {
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
  });

  it('drops client connectivity', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([{ type: 'TypeError', value: 'Failed to fetch' }])
      )
    ).toBeNull();
  });

  it('drops ResizeObserver loop noise (ENG-853)', () => {
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

  it('drops the Safari/Chrome inline-suggestions autofill failure (ENG-853)', () => {
    expect(
      dropPostHogNoise(
        exceptionEvent([
          { type: 'Error', value: 'Failed to get inline suggestions' },
        ])
      )
    ).toBeNull();
  });

  it('drops the Meta in-app browser postMessage bridge teardown (ENG-853)', () => {
    // The event this ticket found ON THIS APP: Facebook/Instagram's Android
    // in-app browser tearing down its JS bridge mid-call.
    expect(
      dropPostHogNoise(
        exceptionEvent([
          {
            type: 'Error',
            value: 'Error invoking postMessage: Java object is gone',
          },
        ])
      )
    ).toBeNull();
  });

  it('KEEPS a real defect', () => {
    const real = exceptionEvent([
      { type: 'TypeError', value: 'Cannot read properties of undefined' },
    ]);
    expect(dropPostHogNoise(real)).toBe(real);
  });

  it('does not drop a message that merely mentions ResizeObserver', () => {
    const real = exceptionEvent([
      { type: 'ReferenceError', value: 'ResizeObserver is not defined' },
    ]);
    expect(dropPostHogNoise(real)).toBe(real);
  });

  it('passes NON-exception events through untouched', () => {
    for (const name of ['$pageview', '$autocapture', '$feature_flag_called']) {
      const ev = {
        uuid: 'u',
        event: name,
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
