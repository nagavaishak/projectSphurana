/**
 * Async test helpers
 */

/**
 * Wait for a condition to be true
 * Useful for testing async state changes
 *
 * @example
 * ```typescript
 * await waitFor(() => mockFn.mock.calls.length > 0);
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Flush all pending promises
 * Useful for testing code that uses Promise.resolve() or microtasks
 *
 * @example
 * ```typescript
 * someAsyncFunction();
 * await flushPromises();
 * expect(result).toBeDefined();
 * ```
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    // Use setImmediate if available (Node.js), otherwise setTimeout
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Create a deferred promise for testing async flows
 *
 * @example
 * ```typescript
 * const deferred = createDeferred<User>();
 *
 * // Start async operation
 * const promise = fetchUser(id);
 *
 * // Resolve when ready
 * deferred.resolve(mockUser);
 *
 * const result = await promise;
 * ```
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve as (value: T) => void,
    reject: reject as (error: Error) => void,
  };
}

/**
 * Sleep for a specified duration
 * Use sparingly - prefer waitFor for conditions
 *
 * @example
 * ```typescript
 * await sleep(100); // Wait 100ms
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function until it succeeds or max retries reached
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   async () => fetchData(),
 *   { maxRetries: 3, delay: 100 }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 100 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Retry failed');
}
