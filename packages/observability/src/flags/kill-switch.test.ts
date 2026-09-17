import { describe, expect, it } from 'vitest';
import { resolveKillSwitch } from './kill-switch.js';

describe('resolveKillSwitch', () => {
  it('defaults OFF when the provider returns undefined', () => {
    expect(resolveKillSwitch(undefined)).toBe(false);
  });

  it('defaults OFF when the provider returns null', () => {
    expect(resolveKillSwitch(null)).toBe(false);
  });

  it('defaults OFF when the provider eval threw (Error state)', () => {
    expect(resolveKillSwitch(new Error('posthog timeout'))).toBe(false);
  });

  it('honors an explicit true from the provider', () => {
    expect(resolveKillSwitch(true)).toBe(true);
  });

  it('honors an explicit false from the provider', () => {
    expect(resolveKillSwitch(false)).toBe(false);
  });

  it('respects defaultEnabled=true on no-opinion (undefined)', () => {
    expect(resolveKillSwitch(undefined, { defaultEnabled: true })).toBe(true);
  });

  it('respects defaultEnabled=true on error (degrade to safe-on)', () => {
    expect(resolveKillSwitch(new Error('boom'), { defaultEnabled: true })).toBe(
      true
    );
  });

  it('an explicit provider value wins over defaultEnabled', () => {
    // Provider says false even though the configured safe default is on.
    expect(resolveKillSwitch(false, { defaultEnabled: true })).toBe(false);
    // Provider says true even though the configured safe default is off.
    expect(resolveKillSwitch(true, { defaultEnabled: false })).toBe(true);
  });

  it('never throws', () => {
    expect(() =>
      resolveKillSwitch(new Error('x'), { defaultEnabled: false })
    ).not.toThrow();
  });
});
