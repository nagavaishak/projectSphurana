import { SetMetadata } from '@nestjs/common';

/**
 * A structural, zod-compatible schema — the only surface the interceptor needs.
 * A `@borradh-workspace/contracts` Zod schema satisfies this exactly, so call
 * sites pass e.g. `listLeadsResponseSchema` directly. Kept structural (rather
 * than importing `ZodType`) so the common layer stays decoupled from zod.
 */
export interface ResponseContractSchema {
  safeParse(
    data: unknown
  ): { success: true; data: unknown } | { success: false; error: unknown };
}

/** Route-metadata key under which the response contract schema is stashed. */
export const RESPONSE_CONTRACT_KEY = 'response:contract';

/**
 * Attach a response contract to a controller method. The
 * `ResponseContractInterceptor` reads it via `Reflector` and validates the
 * (serialized) response against it — report mode by default, strict when
 * `isFeatureOn('response-parse-strict')`.
 *
 * @example
 * ```ts
 * import { listLeadsResponseSchema } from '@borradh-workspace/contracts';
 *
 * @Get()
 * @ResponseContract(listLeadsResponseSchema)
 * async findAll() { ... }
 * ```
 */
export const ResponseContract = (schema: ResponseContractSchema) =>
  SetMetadata(RESPONSE_CONTRACT_KEY, schema);
