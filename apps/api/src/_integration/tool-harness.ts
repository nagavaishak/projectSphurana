import type { AddressInfo } from 'node:net';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  type Provider,
  type Type,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AssistantPorts } from '../assistant/ports/index.js';
import { createApiFetch } from '../assistant/tool-factory/api-fetch.js';
import { createToolCallCounter } from '../assistant/tool-factory/tool-call-limit.js';
import type {
  AssistantToolsContext,
  ToolDefinition,
} from '../assistant/tool-factory/types.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import type { AuthenticatedRequest } from '../common/guards/auth.guard.js';
import { RoleGuard } from '../common/guards/role.guard.js';
import type { TestIdentity } from './harness.js';

/**
 * TIER 3 harness for CLAIRE TOOLS.
 *
 * `harness.ts` boots a controller and drives it with supertest. That is the
 * right shape for testing a controller, and the wrong shape for testing a
 * tool: a tool does not speak supertest, it calls `ctx.apiFetch`, which does a
 * real `fetch` to `http://localhost:${port}`. A tool test that stubs
 * `apiFetch` is testing the author's belief about the API, which is precisely
 * the construction that kept `meta_ads_generateAdCopy` green for months while
 * it was dead on 100% of calls.
 *
 * So this harness does the one thing that breaks the correlation: it puts a
 * REAL socket between the tool and the API.
 *
 *   1. boot the controllers the tool actually calls
 *   2. `listen(0)` — a real ephemeral port, not `app.init()`
 *   3. build the tool's REAL `apiFetch` against that port, including the
 *      tool's own `additionalAllowedPaths` whitelist
 *   4. run `tool.execute(input, ctx)` unmodified
 *
 * Nothing between the tool and Postgres is faked except identity.
 *
 * WHAT IS REAL
 *  - the tool's `execute`, its input validation, its whitelist, its parsing
 *  - a real HTTP request/response over a real socket
 *  - the NestJS pipeline: routing, ValidationPipe, param decorators
 *  - `RoleGuard` (it queries the real `member` table)
 *  - the feature services and their SQL, against the testcontainers Postgres
 *
 * WHAT IS FAKED, and why
 *  - `AuthGuard` only. We are testing the tool→API→DB path, not better-auth.
 *    The fake stamps a fixed identity so everything downstream runs unchanged.
 *  - `ports`, `createConfirmation` / `verifyConfirmation`, `reportIssue` are
 *    injected per test. Confirmation is a HUMAN-IN-THE-LOOP gate, not part of
 *    the API contract under test, so a destructive tool's second call is
 *    driven by granting the token directly. If a test needs the real token
 *    flow, pass real implementations.
 */

class FakeAuthGuard implements CanActivate {
  identity: TestIdentity = { userId: '', organizationId: undefined };

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = {
      id: this.identity.userId,
      email: this.identity.email ?? `${this.identity.userId}@example.test`,
    } as AuthenticatedRequest['user'];
    request.activeOrganizationId = this.identity.organizationId;
    return true;
  }
}

export interface ToolIntegrationApp {
  /** The listening Nest app. */
  app: INestApplication;
  /** The ephemeral port it bound to. */
  port: number;
  /** Switch identity for subsequent requests. */
  actAs: (identity: TestIdentity) => void;
  /**
   * Build a context for `tool.execute`. The `apiFetch` is the REAL one,
   * pointed at this app's port and carrying the tool's own path whitelist.
   */
  contextFor: (
    tool: Pick<ToolDefinition, 'additionalAllowedPaths'>,
    overrides?: Partial<AssistantToolsContext>
  ) => AssistantToolsContext;
  close: () => Promise<void>;
}

/**
 * Boot the given controllers on a real port and hand back a tool context.
 *
 * Pass EVERY controller the tool touches. A tool that calls two endpoints
 * needs both; a missing one surfaces as a 404 from a real socket, which is a
 * legitimate (if noisy) failure rather than a silent stub.
 */
export async function buildToolApp(
  controllers: Type<unknown>[],
  initialIdentity: TestIdentity,
  extraProviders: Provider[] = []
): Promise<ToolIntegrationApp> {
  const fakeAuth = new FakeAuthGuard();
  fakeAuth.identity = initialIdentity;

  const moduleRef = await Test.createTestingModule({
    controllers: controllers as Type<object>[],
    providers: [Reflector, RoleGuard, ...extraProviders],
  })
    .overrideGuard(AuthGuard)
    .useValue(fakeAuth)
    .compile();

  const app = moduleRef.createNestApplication();
  // The REAL app registers `ZodValidationPipe` from nestjs-zod (main.ts). This
  // harness registered only the stock class-validator `ValidationPipe`, under a
  // comment claiming it "mirrors the global ValidationPipe the real app uses".
  // It does not. Every DTO in this API is a `createZodDto`, which carries NO
  // class-validator metadata, so the stock pipe found zero constraints and
  // validated NOTHING — which means every "invalid input -> 400" assertion in
  // this suite was really exercising the SERVICE's safeParse, never the
  // boundary, and unknown-key stripping / z.coerce / .default were untested.
  //
  // Both are registered, in this order. Global pipes run before controller and
  // method pipes; the Zod pipe parses first, and the stock pipe then sees an
  // already-parsed plain object and passes it through. Keeping the stock pipe
  // is not redundancy: `organization.controller.ts` declares the codebase's
  // only two REAL class-validator DTOs inline, and dropping it would stop
  // validating them here.
  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({ transform: true })
  );
  await app.init();
  // listen(0) — a REAL socket on an ephemeral port. This is the whole point of
  // this harness; app.init() alone gives no port for apiFetch to reach.
  await app.listen(0);

  const address = app.getHttpServer().address() as AddressInfo;
  const port = address.port;

  return {
    app,
    port,
    actAs: (identity) => {
      fakeAuth.identity = identity;
    },
    contextFor: (tool, overrides = {}) => {
      const apiFetch = createApiFetch({
        port,
        additionalAllowedPaths: tool.additionalAllowedPaths,
      });
      const base: AssistantToolsContext = {
        organizationId: fakeAuth.identity.organizationId ?? '',
        userId: fakeAuth.identity.userId,
        conversationId: 'int-conversation',
        ports: {} as AssistantPorts,
        apiFetch,
        buildApiFetch: (extraPaths) =>
          createApiFetch({
            port,
            additionalAllowedPaths: [
              ...(tool.additionalAllowedPaths ?? []),
              ...extraPaths,
            ],
          }),
        reportIssue: () => undefined,
        callCounter: createToolCallCounter(),
        runHardBlocks: async () => [],
        createConfirmation: async () => ({
          id: 'int-token',
          expiresAt: new Date(Date.now() + 600_000),
        }),
        verifyConfirmation: async () => ({ valid: true, payload: null }),
      };
      return { ...base, ...overrides };
    },
    close: () => app.close(),
  };
}
