// Mock the env barrel so we can mutate apiEnv between tests to exercise both
// branches of the destructive guard (NODE_ENV=production with and without the
// E2E_DESTRUCTIVE_ALLOWED escape hatch).
jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

import { apiEnv } from '@borradh-workspace/env/api';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { DestructiveTestingGuard, SeedTokenGuard } from './seed-token.guard.js';

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32); // 64 chars, satisfies E2E_SEED_TOKEN .min(32)

function ctx(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

/**
 * These cases previously lived in `testing.controller.spec.ts` and drove the
 * controller's `validateDestructiveAccess` / `validateSeedToken` private
 * methods through a real handler call. The policy is now a Guard, so they
 * drive the Guard — the assertions (status, message, which env combinations
 * pass) are carried over unchanged.
 */
describe('testing access guards', () => {
  beforeEach(() => {
    // Reset apiEnv between tests so one mutation doesn't leak into the next.
    for (const key of Object.keys(apiEnv)) {
      delete (apiEnv as Record<string, unknown>)[key];
    }
  });

  describe('DestructiveTestingGuard', () => {
    const guard = new DestructiveTestingGuard();

    it('blocks when NODE_ENV=production and E2E_DESTRUCTIVE_ALLOWED is false', () => {
      (apiEnv as Record<string, unknown>).NODE_ENV = 'production';
      (apiEnv as Record<string, unknown>).E2E_DESTRUCTIVE_ALLOWED = false;
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;

      expect(() => guard.canActivate(ctx(`Bearer ${TOKEN}`))).toThrow(
        UnauthorizedException
      );
      expect(() => guard.canActivate(ctx(`Bearer ${TOKEN}`))).toThrow(
        /disabled in production/
      );
    });

    it('allows when NODE_ENV=production and E2E_DESTRUCTIVE_ALLOWED=true (PR preview)', () => {
      (apiEnv as Record<string, unknown>).NODE_ENV = 'production';
      (apiEnv as Record<string, unknown>).E2E_DESTRUCTIVE_ALLOWED = true;
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;

      expect(guard.canActivate(ctx(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('allows in development (NODE_ENV=development)', () => {
      (apiEnv as Record<string, unknown>).NODE_ENV = 'development';
      (apiEnv as Record<string, unknown>).E2E_DESTRUCTIVE_ALLOWED = false;
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;

      expect(guard.canActivate(ctx(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('still requires a valid seed token even when the production guard passes', () => {
      (apiEnv as Record<string, unknown>).NODE_ENV = 'production';
      (apiEnv as Record<string, unknown>).E2E_DESTRUCTIVE_ALLOWED = true;
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;

      expect(() => guard.canActivate(ctx('Bearer wrong-token-value'))).toThrow(
        UnauthorizedException
      );
    });
  });

  describe('SeedTokenGuard', () => {
    const guard = new SeedTokenGuard();

    it('rejects when E2E_SEED_TOKEN is not configured', () => {
      expect(() => guard.canActivate(ctx(`Bearer ${TOKEN}`))).toThrow(
        /E2E_SEED_TOKEN not configured/
      );
    });

    it('rejects a missing authorization header', () => {
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;
      expect(() => guard.canActivate(ctx(undefined))).toThrow(
        /Invalid seed token/
      );
    });

    it('rejects a wrong token', () => {
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;
      expect(() => guard.canActivate(ctx('Bearer wrong-token-value'))).toThrow(
        /Invalid seed token/
      );
    });

    it('allows a matching token in any environment', () => {
      (apiEnv as Record<string, unknown>).NODE_ENV = 'production';
      (apiEnv as Record<string, unknown>).E2E_SEED_TOKEN = TOKEN;
      expect(guard.canActivate(ctx(`Bearer ${TOKEN}`))).toBe(true);
    });
  });
});
