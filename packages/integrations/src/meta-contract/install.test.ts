import {
  getFetchInterceptor,
  setFetchInterceptor,
} from '@borradh-workspace/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMetaContractInterceptor } from './install.js';

const ENV_KEYS = [
  'META_E2E_STUB',
  'META_CONTRACT_RECORD',
  'META_CONTRACT_RECORD_DIR',
  'META_CONTRACT_VALIDATE',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  setFetchInterceptor(null);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setFetchInterceptor(null);
});

describe('installMetaContractInterceptor', () => {
  it('installs nothing in production (both flags unset)', () => {
    expect(installMetaContractInterceptor()).toBeNull();
    expect(getFetchInterceptor()).toBeNull();
  });

  it('installs the fake when META_E2E_STUB is exactly "true"', () => {
    process.env.META_E2E_STUB = 'true';
    const mode = installMetaContractInterceptor();

    expect(mode).toMatch(/FAKE installed/);
    expect(getFetchInterceptor()).not.toBeNull();
  });

  it('treats the STRING "false" as off', () => {
    // The footgun this guards: z.coerce.boolean()('false') === true, so a host
    // that explicitly disables the stub would otherwise ENABLE it. Same bug
    // shape the Stripe stub documents.
    process.env.META_E2E_STUB = 'false';

    expect(installMetaContractInterceptor()).toBeNull();
    expect(getFetchInterceptor()).toBeNull();
  });

  it('ignores other truthy-looking values', () => {
    for (const value of ['1', 'yes', 'TRUE', 'True']) {
      setFetchInterceptor(null);
      process.env.META_E2E_STUB = value;
      expect(installMetaContractInterceptor()).toBeNull();
    }
  });

  it('installs the recorder when META_CONTRACT_RECORD is "true"', () => {
    process.env.META_CONTRACT_RECORD = 'true';
    process.env.META_CONTRACT_RECORD_DIR = '/tmp/recordings';

    expect(installMetaContractInterceptor()).toMatch(
      /RECORDER installed.*\/tmp\/recordings/
    );
    expect(getFetchInterceptor()).not.toBeNull();
  });

  it('installs response validation when META_CONTRACT_VALIDATE is "true"', () => {
    process.env.META_CONTRACT_VALIDATE = 'true';

    expect(installMetaContractInterceptor()).toMatch(
      /RESPONSE VALIDATION installed \(report-only\)/
    );
    expect(getFetchInterceptor()).not.toBeNull();
  });

  it('refuses to run the fake and validation together', () => {
    // Validating the fake's answers against the schemas it generates them from
    // is a tautology — it would report a permanently clean contract.
    process.env.META_E2E_STUB = 'true';
    process.env.META_CONTRACT_VALIDATE = 'true';

    expect(() => installMetaContractInterceptor()).toThrow(
      /confirm the fake agrees with itself/
    );
    expect(getFetchInterceptor()).toBeNull();
  });

  it('refuses to run the fake and the recorder together', () => {
    // Recording with the fake installed would capture the fake's OWN answers,
    // then "validate" the contract against itself — worthless golden files that
    // look authoritative. Fail loudly instead.
    process.env.META_E2E_STUB = 'true';
    process.env.META_CONTRACT_RECORD = 'true';

    expect(() => installMetaContractInterceptor()).toThrow(
      /nothing real to record/
    );
    expect(getFetchInterceptor()).toBeNull();
  });
});
