import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleSessionInvalidation,
  markSessionAuthenticated,
  registerSessionInvalidationHandler,
} from './session-lifecycle';

describe('session lifecycle', () => {
  let unregister: (() => void) | undefined;

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    markSessionAuthenticated();
  });

  it('runs recovery once even when several protected requests observe expiry', () => {
    const recovery = vi.fn();
    unregister = registerSessionInvalidationHandler(recovery);

    handleSessionInvalidation();
    handleSessionInvalidation();

    expect(recovery).toHaveBeenCalledOnce();
  });

  it('allows a later, newly authenticated session to recover independently', () => {
    const recovery = vi.fn();
    unregister = registerSessionInvalidationHandler(recovery);

    handleSessionInvalidation();
    markSessionAuthenticated();
    handleSessionInvalidation();

    expect(recovery).toHaveBeenCalledTimes(2);
  });
});
