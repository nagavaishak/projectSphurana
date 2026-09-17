// This guard decides whether routes that MANUFACTURE ERRORS are reachable, and
// it has to satisfy two requirements that pull against each other:
//
//   - synthetic exceptions must not reach the stream on-call trusts unless
//     someone deliberately turned them on (API-FE and MARKETING-4 were exactly
//     that: probe traffic that an automated responder treated as an incident)
//   - preview must stay verifiable, because that is the only deployed place the
//     error pipeline can be proven, and doing so found three silent breakages
//     on 2026-08-17
//
// Every tier below is one of those requirements. Deleting a case re-opens one.
// The guard reads ITS OWN flags from process.env (strictly — see the guard).
// assertSeedToken, which it delegates to, reads the parsed apiEnv, so both have
// to be controllable here.
jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }));

import { apiEnv } from '@borradh-workspace/env/api';
import type { ExecutionContext } from '@nestjs/common';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { NonProductionGuard } from './non-production.guard.js';

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32); // satisfies E2E_SEED_TOKEN .min(32)

function ctx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

const ORIGINAL_ENV = { ...process.env };
const parsedEnv = apiEnv as unknown as Record<string, unknown>;
const env = process.env as Record<string, string | undefined>;
const status = (fn: () => unknown): number | string => {
  try {
    fn();
    return 'no throw';
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : String(e);
  }
};

describe('NonProductionGuard', () => {
  const guard = new NonProductionGuard();

  beforeEach(() => {
    for (const k of [
      'NODE_ENV',
      'DEBUG_ENDPOINTS_ENABLED',
      'E2E_DESTRUCTIVE_ALLOWED',
      'E2E_SEED_TOKEN',
    ])
      delete env[k];
    for (const k of Object.keys(parsedEnv)) delete parsedEnv[k];
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('tier 0 — a flag that reads as off must BE off', () => {
    // z.coerce.boolean() (used by apiEnv) is Boolean(string), so "false" parses
    // as TRUE. This guard reads process.env strictly for exactly that reason; if
    // someone "disables" a flag the intuitive way, it must actually disable.
    it.each(['false', '0', 'no', ''])(
      'DEBUG_ENDPOINTS_ENABLED=%s keeps the routes hidden',
      (value) => {
        env.NODE_ENV = 'development';
        env.DEBUG_ENDPOINTS_ENABLED = value;

        expect(status(() => guard.canActivate(ctx()))).toBe(404);
      }
    );

    it('E2E_DESTRUCTIVE_ALLOWED=false does NOT mark a prod host as preview', () => {
      env.NODE_ENV = 'production';
      env.DEBUG_ENDPOINTS_ENABLED = 'true';
      env.E2E_DESTRUCTIVE_ALLOWED = 'false';
      env.E2E_SEED_TOKEN = TOKEN;
      parsedEnv.E2E_SEED_TOKEN = TOKEN;

      expect(status(() => guard.canActivate(ctx(`Bearer ${TOKEN}`)))).toBe(404);
    });
  });

  describe('tier 1 — off unless explicitly enabled', () => {
    it.each(['development', 'test', 'production', undefined])(
      '404s in %s when DEBUG_ENDPOINTS_ENABLED is unset',
      (nodeEnv) => {
        env.NODE_ENV = nodeEnv as string | undefined;
        // Deliberately generous on everything else: even a valid token and the
        // preview escape hatch must not open a route nobody enabled.
        env.E2E_DESTRUCTIVE_ALLOWED = 'true';
        env.E2E_SEED_TOKEN = TOKEN;
        parsedEnv.E2E_SEED_TOKEN = TOKEN;

        expect(status(() => guard.canActivate(ctx(`Bearer ${TOKEN}`)))).toBe(
          404
        );
      }
    );
  });

  describe('tier 2 — never on real production', () => {
    it('404s even with the flag set and a valid token', () => {
      env.NODE_ENV = 'production';
      env.DEBUG_ENDPOINTS_ENABLED = 'true';
      env.E2E_DESTRUCTIVE_ALLOWED = 'false';
      env.E2E_SEED_TOKEN = TOKEN;
      parsedEnv.E2E_SEED_TOKEN = TOKEN;

      expect(status(() => guard.canActivate(ctx(`Bearer ${TOKEN}`)))).toBe(404);
    });

    it('404 not 403 — the routes must look nonexistent, not forbidden', () => {
      env.NODE_ENV = 'production';
      env.DEBUG_ENDPOINTS_ENABLED = 'true';

      expect(status(() => guard.canActivate(ctx()))).toBe(404);
    });
  });

  describe('tier 3 — preview/staging, flag AND token', () => {
    beforeEach(() => {
      // A preview host: NODE_ENV=production inherited from fly.toml, plus the
      // escape hatch that marks it as not-real-production.
      env.NODE_ENV = 'production';
      env.DEBUG_ENDPOINTS_ENABLED = 'true';
      env.E2E_DESTRUCTIVE_ALLOWED = 'true';
      env.E2E_SEED_TOKEN = TOKEN;
      parsedEnv.E2E_SEED_TOKEN = TOKEN;
    });

    it('allows a correct token', () => {
      expect(guard.canActivate(ctx(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('401s without a token', () => {
      expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    });

    it('401s on a wrong token', () => {
      expect(() => guard.canActivate(ctx(`Bearer ${'c'.repeat(64)}`))).toThrow(
        UnauthorizedException
      );
    });

    it('fails closed when the flags are set but no token is configured', () => {
      env.E2E_SEED_TOKEN = undefined;
      parsedEnv.E2E_SEED_TOKEN = undefined;

      expect(() => guard.canActivate(ctx(`Bearer ${TOKEN}`))).toThrow(
        UnauthorizedException
      );
    });
  });

  describe('tier 4 — local dev/test with the flag', () => {
    it.each(['development', 'test'])(
      'allows %s, no token needed',
      (nodeEnv) => {
        env.NODE_ENV = nodeEnv as string | undefined;
        env.DEBUG_ENDPOINTS_ENABLED = 'true';

        expect(guard.canActivate(ctx())).toBe(true);
      }
    );
  });
});
