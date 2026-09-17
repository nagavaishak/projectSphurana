import { expect } from 'vitest';

/**
 * Result type matching @borradh-workspace/features pattern
 */
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Type guard to check if result is successful
 */
export function isSuccess<T, E>(
  result: Result<T, E>
): result is { success: true; data: T } {
  return result.success === true;
}

/**
 * Type guard to check if result is an error
 */
export function isError<T, E>(
  result: Result<T, E>
): result is { success: false; error: E } {
  return result.success === false;
}

/**
 * Assert that a result is successful and return the data
 * Throws a descriptive error if the result is not successful
 *
 * @example
 * ```typescript
 * const result = await createUser(db, input);
 * const user = expectSuccess(result);
 * expect(user.email).toBe('test@example.com');
 * ```
 */
export function expectSuccess<T, E>(result: Result<T, E>): T {
  if (!result.success) {
    const errorMessage =
      result.error instanceof Error
        ? result.error.message
        : JSON.stringify(result.error, null, 2);
    throw new Error(`Expected success result but got error: ${errorMessage}`);
  }
  return result.data;
}

/**
 * Assert that a result is an error and return the error
 * Throws if the result is successful
 *
 * @example
 * ```typescript
 * const result = await createUser(db, invalidInput);
 * const error = expectError(result);
 * expect(error.code).toBe('VALIDATION_ERROR');
 * ```
 */
export function expectError<T, E>(result: Result<T, E>): E {
  if (result.success) {
    throw new Error(
      `Expected error result but got success: ${JSON.stringify(result.data, null, 2)}`
    );
  }
  return result.error;
}

/**
 * Assert result and provide type-safe assertions
 *
 * @example
 * ```typescript
 * await expectResult(createUser(db, input))
 *   .toSucceedWith((data) => {
 *     expect(data.email).toBe('test@example.com');
 *   });
 *
 * await expectResult(createUser(db, invalidInput))
 *   .toFailWith((error) => {
 *     expect(error.code).toBe('VALIDATION_ERROR');
 *   });
 * ```
 */
export function expectResult<T, E>(
  resultOrPromise: Result<T, E> | Promise<Result<T, E>>
) {
  const resolveResult = async () => {
    return resultOrPromise instanceof Promise
      ? await resultOrPromise
      : resultOrPromise;
  };

  return {
    /**
     * Assert result is successful and run assertions on data
     */
    async toSucceedWith(
      assertions?: (data: T) => void | Promise<void>
    ): Promise<T> {
      const result = await resolveResult();
      expect(result.success).toBe(true);

      if (!result.success) {
        throw new Error('Result was not successful');
      }

      if (assertions) {
        await assertions(result.data);
      }

      return result.data;
    },

    /**
     * Assert result is an error and run assertions on error
     */
    async toFailWith(
      assertions?: (error: E) => void | Promise<void>
    ): Promise<E> {
      const result = await resolveResult();
      expect(result.success).toBe(false);

      if (result.success) {
        throw new Error('Result was successful, expected error');
      }

      if (assertions) {
        await assertions(result.error);
      }

      return result.error;
    },

    /**
     * Assert result fails with a specific error code
     */
    async toFailWithCode(expectedCode: string): Promise<E> {
      const result = await resolveResult();
      expect(result.success).toBe(false);

      if (result.success) {
        throw new Error('Result was successful, expected error');
      }

      const error = result.error as unknown as { code?: string };
      expect(error.code).toBe(expectedCode);

      return result.error;
    },

    /**
     * Assert result succeeds with specific data shape
     */
    async toSucceedWithData(expectedData: Partial<T>): Promise<T> {
      const result = await resolveResult();
      expect(result.success).toBe(true);

      if (!result.success) {
        throw new Error('Result was not successful');
      }

      expect(result.data).toMatchObject(expectedData);

      return result.data;
    },
  };
}
