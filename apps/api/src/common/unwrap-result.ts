import type { HttpException, Logger } from '@nestjs/common';

/**
 * The five lines every handler in this codebase repeats.
 *
 *     if (!result.success) {
 *       this.logger.warn(`X failed: ${result.error.code} - ${result.error.message}`);
 *       throw this.mapErrorToHttpException(result.error);
 *     }
 *     return result.data;
 *
 * On its own that is fine. Multiplied by the six-or-so routes on a controller
 * it is what pushed handlers past the Gate 5 line while the handler's ACTUAL
 * content — which use case, with which inputs — was two of its twenty-eight
 * lines. Collapsing it makes the remaining body readable as "call the use case,
 * return it", which is the whole point of the gate.
 *
 * The mapper stays a member of each controller ON PURPOSE. `error-status-map`
 * (the one-code-one-status gate) parses `*.controller.ts` with the TypeScript
 * AST and reads the `switch (error.code)` out of each one; hoisting those
 * switches into a shared module would make every controller yield zero
 * mappings and blind that gate. So this takes the mapper as an argument rather
 * than owning one.
 */

export interface FeatureErrorShape {
  code: string;
  message: string;
}

type ResultShape<T> =
  | { success: true; data: T }
  | { success: false; error: FeatureErrorShape };

export interface UnwrapOptions {
  logger: Logger;
  /**
   * Human label for the WARN line, matching the existing convention:
   * `${label} failed: ${code} - ${message}`.
   */
  label: string;
  mapError: (error: FeatureErrorShape) => HttpException;
}

/**
 * Return `result.data`, or log the failure at WARN and throw the controller's
 * mapped `HttpException`. Byte-identical log line and exception to the inline
 * form it replaces.
 */
export function unwrapResult<T>(
  result: ResultShape<T>,
  { logger, label, mapError }: UnwrapOptions
): T {
  if (!result.success) {
    logger.warn(
      `${label} failed: ${result.error.code} - ${result.error.message}`
    );
    throw mapError(result.error);
  }
  return result.data;
}
