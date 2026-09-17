import { expect } from 'vitest';

/**
 * Custom matchers for Vitest
 *
 * Usage: Call setupCustomMatchers() in your test setup file
 *
 * @example
 * ```typescript
 * // In vitest.setup.ts
 * import { setupCustomMatchers } from '@borradh-workspace/testing';
 * setupCustomMatchers();
 *
 * // In tests
 * expect(result).toBeSuccessResult();
 * expect(result).toBeErrorResult();
 * expect(result).toHaveErrorCode('VALIDATION_ERROR');
 * ```
 */
export function setupCustomMatchers(): void {
  expect.extend({
    /**
     * Check if a result is a success result
     */
    toBeSuccessResult(received: unknown) {
      const result = received as { success?: boolean; data?: unknown };
      const pass = result?.success === true && 'data' in result;

      return {
        pass,
        message: () =>
          pass
            ? 'Expected result not to be a success result'
            : `Expected result to be a success result, but got: ${JSON.stringify(received, null, 2)}`,
      };
    },

    /**
     * Check if a result is an error result
     */
    toBeErrorResult(received: unknown) {
      const result = received as { success?: boolean; error?: unknown };
      const pass = result?.success === false && 'error' in result;

      return {
        pass,
        message: () =>
          pass
            ? 'Expected result not to be an error result'
            : `Expected result to be an error result, but got: ${JSON.stringify(received, null, 2)}`,
      };
    },

    /**
     * Check if an error result has a specific error code
     */
    toHaveErrorCode(received: unknown, expectedCode: string) {
      const result = received as {
        success?: boolean;
        error?: { code?: string };
      };
      const actualCode = result?.error?.code;
      const pass = result?.success === false && actualCode === expectedCode;

      return {
        pass,
        message: () =>
          pass
            ? `Expected error code not to be "${expectedCode}"`
            : `Expected error code to be "${expectedCode}", but got "${actualCode}"`,
      };
    },

    /**
     * Check if a date is within a range of another date
     */
    toBeWithinDateRange(received: unknown, target: Date, toleranceMs = 1000) {
      const receivedDate =
        received instanceof Date ? received : new Date(received as string);
      const diff = Math.abs(receivedDate.getTime() - target.getTime());
      const pass = diff <= toleranceMs;

      return {
        pass,
        message: () =>
          pass
            ? `Expected date not to be within ${toleranceMs}ms of ${target.toISOString()}`
            : `Expected date to be within ${toleranceMs}ms of ${target.toISOString()}, but difference was ${diff}ms`,
      };
    },

    /**
     * Check if a string is a valid UUID
     */
    toBeValidUUID(received: unknown) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const pass = typeof received === 'string' && uuidRegex.test(received);

      return {
        pass,
        message: () =>
          pass
            ? `Expected "${received}" not to be a valid UUID`
            : `Expected "${received}" to be a valid UUID`,
      };
    },
  });
}

// Type declarations for custom matchers
declare module 'vitest' {
  // biome-ignore lint/correctness/noUnusedVariables: Required for vitest module augmentation
  interface Assertion<T> {
    toBeSuccessResult(): this;
    toBeErrorResult(): this;
    toHaveErrorCode(code: string): this;
    toBeWithinDateRange(target: Date, toleranceMs?: number): this;
    toBeValidUUID(): this;
  }

  interface AsymmetricMatchersContaining {
    toBeSuccessResult(): unknown;
    toBeErrorResult(): unknown;
    toHaveErrorCode(code: string): unknown;
    toBeWithinDateRange(target: Date, toleranceMs?: number): unknown;
    toBeValidUUID(): unknown;
  }
}
