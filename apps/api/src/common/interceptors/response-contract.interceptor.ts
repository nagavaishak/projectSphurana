import {
  type FlagProvider,
  isFeatureOn,
  logError,
} from '@borradh-workspace/observability';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, from, switchMap } from 'rxjs';
import {
  RESPONSE_CONTRACT_KEY,
  type ResponseContractSchema,
} from '../decorators/response-contract.decorator.js';

/**
 * Provider-side response-contract validation — the backend twin of the
 * frontend's `parseResponse` (packages/api-client/src/parse.ts).
 *
 * A controller method annotated with `@ResponseContract(schema)` has its
 * response validated against the SAME `@borradh-workspace/contracts` Zod schema
 * the frontend parses against, so both ends are checked independently. Methods
 * without the decorator pass straight through (no schema in route metadata).
 *
 * ## Serialization matters
 * The handler returns domain objects carrying `Date` instances; the contract
 * schemas describe the WIRE shape (`z.string().datetime()` for dates). So we
 * validate the SERIALIZED value — a `JSON.parse(JSON.stringify(result))` round
 * trip turns Dates into ISO strings and drops `undefined`s, exactly as Nest
 * will serialize the body on the way out. `JSON.stringify(serialized)` is
 * byte-identical to `JSON.stringify(result)`, so returning `serialized` in
 * report mode is fully behaviour-preserving.
 *
 * ## Two modes (same flag pattern as the rest of the server)
 *   report (default) — on a mismatch, log `{ route, zodError }` to the
 *                       observability package and RETURN THE SERIALIZED VALUE
 *                       unchanged (non-fatal). We return `serialized`, NOT the
 *                       zod-parsed value, so an incomplete projection never
 *                       silently strips fields (mirrors the frontend fix).
 *   strict           — throw, surfacing the mismatch as a 500.
 *
 * Strict is gated by `isFeatureOn('response-parse-strict')`. The global
 * kill-switch is honoured inside `isFeatureOn` (killswitch on → every flag
 * reads false → report mode, the safe default). `isFeatureOn` never throws, so
 * a flag-eval blip degrades to report.
 */
export const RESPONSE_PARSE_STRICT_FLAG = 'response-parse-strict';

/** DI token for a test-injected flag provider (unset in production). */
export const RESPONSE_CONTRACT_FLAG_PROVIDER =
  'RESPONSE_CONTRACT_FLAG_PROVIDER';

/** Error thrown in strict mode when a response fails its contract schema. */
export class ResponseContractError extends Error {
  readonly route: string;
  readonly zodError: unknown;
  constructor(route: string, zodError: unknown) {
    super(`Response from "${route}" failed contract validation`);
    this.name = 'ResponseContractError';
    this.route = route;
    this.zodError = zodError;
  }
}

@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    // Test seam: `withFlags({...})` from @borradh-workspace/observability. Unset
    // in production, where `isFeatureOn` uses the real PostHog-backed provider.
    @Optional()
    @Inject(RESPONSE_CONTRACT_FLAG_PROVIDER)
    private readonly flagProvider?: FlagProvider
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ResponseContractSchema | undefined>(
      RESPONSE_CONTRACT_KEY,
      context.getHandler()
    );

    // No contract on this route → passthrough, zero overhead.
    if (!schema) return next.handle();

    const req = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const route = `${req.method ?? 'GET'} ${req.originalUrl ?? req.url ?? '?'}`;

    return next
      .handle()
      .pipe(switchMap((result) => from(this.validate(route, result, schema))));
  }

  private async validate(
    route: string,
    result: unknown,
    schema: ResponseContractSchema
  ): Promise<unknown> {
    // Serialize to the wire shape (Date → ISO string, undefined dropped). If the
    // handler wrote to `res` directly (`@Res()`) the result is undefined / not
    // JSON-serializable — nothing to validate, pass through.
    let serialized: unknown;
    try {
      serialized = JSON.parse(JSON.stringify(result));
    } catch {
      return result;
    }

    const parsed = schema.safeParse(serialized);
    const strict = await this.isStrict();

    if (parsed.success) {
      // Strict may return the validated value; report returns the serialized
      // value unchanged (never the stripped parse output).
      return strict ? parsed.data : serialized;
    }

    if (strict) {
      throw new ResponseContractError(route, parsed.error);
    }

    // Report mode: surface the divergence to observability, then pass through.
    // logError never throws; the guard is belt-and-braces so telemetry can
    // never break a request.
    try {
      logError(
        'api.responseContract',
        parsed.error instanceof Error
          ? parsed.error
          : new Error('Response failed contract validation'),
        { feature: 'response-contract', extra: { route } }
      );
    } catch {
      // ignore — never fail a request over a report-mode log.
    }
    return serialized;
  }

  private async isStrict(): Promise<boolean> {
    return isFeatureOn(
      RESPONSE_PARSE_STRICT_FLAG,
      this.flagProvider ? { provider: this.flagProvider } : {}
    );
  }
}
