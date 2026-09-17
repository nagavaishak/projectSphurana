import { describe, expect, it } from 'vitest';
import {
  createDepositRequestBase,
  createDepositRequestSchema,
  refundDepositRequestBase,
  refundDepositRequestSchema,
} from './deposits.js';

// A valid `POST /deposits` body as the frontend would send it: no
// server-injected `organizationId`, amounts in INTEGER MINOR UNITS.
const validDepositBody = {
  appointmentId: 'appt_123',
  amountCents: 2500,
  successUrl: 'https://app.example.com/deposit/ok',
  cancelUrl: 'https://app.example.com/deposit/cancelled',
};

describe('createDepositRequestSchema', () => {
  it('accepts a valid deposit-create body', () => {
    const result = createDepositRequestSchema.safeParse(validDepositBody);
    expect(result.success).toBe(true);
  });

  it("materialises currency: 'usd' when the caller omits it", () => {
    const parsed = createDepositRequestSchema.parse(validDepositBody);
    // `.default()` means the key EXISTS in the parsed body even though the
    // caller never sent it — callers building a body from this schema now emit
    // `currency` where they previously did not.
    expect(parsed.currency).toBe('usd');
  });

  it('keeps an explicit currency', () => {
    const parsed = createDepositRequestSchema.parse({
      ...validDepositBody,
      currency: 'eur',
    });
    expect(parsed.currency).toBe('eur');
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    const result = createDepositRequestSchema.safeParse({
      ...validDepositBody,
      // Server-injected: it must never be accepted from the wire.
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  // MONEY. These are the constraints that stop a mis-scaled or nonsensical
  // charge from ever reaching Stripe.
  it('rejects a decimal amount (cents are integer minor units)', () => {
    const result = createDepositRequestSchema.safeParse({
      ...validDepositBody,
      amountCents: 19.99,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero or negative amount', () => {
    for (const amountCents of [0, -100]) {
      const result = createDepositRequestSchema.safeParse({
        ...validDepositBody,
        amountCents,
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a non-URL success/cancel redirect', () => {
    for (const key of ['successUrl', 'cancelUrl'] as const) {
      const result = createDepositRequestSchema.safeParse({
        ...validDepositBody,
        [key]: 'not-a-url',
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a blank string for a required URL', () => {
    const result = createDepositRequestSchema.safeParse({
      ...validDepositBody,
      successUrl: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a blank appointmentId', () => {
    const result = createDepositRequestSchema.safeParse({
      ...validDepositBody,
      appointmentId: '',
    });
    expect(result.success).toBe(false);
  });

  it('bounds expirationHours to 1..168 (one hour to seven days)', () => {
    for (const expirationHours of [0, 169, 2.5]) {
      const result = createDepositRequestSchema.safeParse({
        ...validDepositBody,
        expirationHours,
      });
      expect(result.success).toBe(false);
    }
    for (const expirationHours of [1, 24, 168]) {
      const result = createDepositRequestSchema.safeParse({
        ...validDepositBody,
        expirationHours,
      });
      expect(result.success).toBe(true);
    }
  });

  it('the BASE is extendable and the extension accepts the server shape', () => {
    // This is the exact derivation the features package performs.
    const serverSchema = createDepositRequestBase.extend({
      organizationId: createDepositRequestSchema.shape.appointmentId,
    });
    const result = serverSchema.safeParse({
      ...validDepositBody,
      organizationId: 'org_1',
    });
    expect(result.success).toBe(true);
  });
});

describe('refundDepositRequestSchema', () => {
  it('accepts an empty body (reason is optional)', () => {
    const result = refundDepositRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts each Stripe refund reason', () => {
    for (const reason of [
      'requested_by_customer',
      'duplicate',
      'fraudulent',
    ] as const) {
      expect(refundDepositRequestSchema.safeParse({ reason }).success).toBe(
        true
      );
    }
  });

  it('rejects a reason outside the Stripe vocabulary', () => {
    const result = refundDepositRequestSchema.safeParse({
      reason: 'changed_my_mind',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS depositId in the body — it is the route param (proves .strict())', () => {
    // Accepting this would let a caller refund a deposit other than the one in
    // the URL. MONEY: this must be a hard failure, not a silent strip.
    const result = refundDepositRequestSchema.safeParse({
      depositId: 'dep_other',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('the BASE is extendable with the route/session context', () => {
    const serverSchema = refundDepositRequestBase.extend({
      depositId: createDepositRequestBase.shape.appointmentId,
      organizationId: createDepositRequestBase.shape.appointmentId,
    });
    const result = serverSchema.safeParse({
      depositId: 'dep_1',
      organizationId: 'org_1',
      reason: 'duplicate',
    });
    expect(result.success).toBe(true);
  });
});
