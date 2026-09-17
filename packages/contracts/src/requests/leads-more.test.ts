import { describe, expect, it } from 'vitest';
import { updateLeadRequestBase, updateLeadRequestSchema } from './leads.js';

// A valid `PUT /leads/:id` body as the frontend builder sends it: no
// server-injected `id` / `organizationId`, blank fields ABSENT not empty.
const validUpdateBody = {
  firstName: 'Ada',
  status: 'contacted',
};

describe('updateLeadRequestSchema', () => {
  it('accepts a partial update body', () => {
    const result = updateLeadRequestSchema.safeParse(validUpdateBody);
    expect(result.success).toBe(true);
  });

  it('accepts an EMPTY body — every field is optional on an update', () => {
    expect(updateLeadRequestSchema.safeParse({}).success).toBe(true);
  });

  it('materialises NO defaults (a default would rewrite an unmentioned field)', () => {
    const parsed = updateLeadRequestSchema.parse({});
    expect(Object.keys(parsed)).toEqual([]);
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    for (const extra of [{ organizationId: 'org_1' }, { id: 'lead_2' }]) {
      const result = updateLeadRequestSchema.safeParse({
        ...validUpdateBody,
        ...extra,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.code === 'unrecognized_keys')
        ).toBe(true);
      }
    }
  });

  it('rejects a blank firstName (optional, but not blankable)', () => {
    const result = updateLeadRequestSchema.safeParse({ firstName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string email — blank means ABSENT, not ""', () => {
    // The exact live bug this contract closes: the form's blank default is `''`
    // and the server's rule is `.email()`, so `''` was a 400 for a client who
    // simply has no email. The payload builder normalises it to `undefined`.
    const result = updateLeadRequestSchema.safeParse({ email: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(
      updateLeadRequestSchema.safeParse({ email: 'not-an-email' }).success
    ).toBe(false);
  });

  it('accepts a well-formed email', () => {
    expect(
      updateLeadRequestSchema.safeParse({ email: 'ada@example.com' }).success
    ).toBe(true);
  });

  it('accepts the full labels vocabulary for source and status', () => {
    // The hand-typed copies of these unions had drifted: `meta_lead_form` /
    // `whatsapp` leads could not be edited at all, and `booked` / `cold` were
    // unsettable. Deriving from @borradh-workspace/labels is what fixed it.
    for (const source of ['manual', 'meta_lead_form', 'whatsapp'] as const) {
      expect(updateLeadRequestSchema.safeParse({ source }).success).toBe(true);
    }
    for (const status of ['new', 'booked'] as const) {
      expect(updateLeadRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects a source/status outside the vocabulary', () => {
    expect(
      updateLeadRequestSchema.safeParse({ source: 'carrier_pigeon' }).success
    ).toBe(false);
    expect(
      updateLeadRequestSchema.safeParse({ status: 'vibing' }).success
    ).toBe(false);
  });

  it('the BASE is extendable and the extension accepts the server shape', () => {
    // This is the exact derivation `updateLeadSchema` performs in the features
    // package: wire body + route param + session org.
    const serverSchema = updateLeadRequestBase.extend({
      id: updateLeadRequestBase.shape.assignedToId,
      organizationId: updateLeadRequestBase.shape.assignedToId,
    });
    const result = serverSchema.safeParse({
      ...validUpdateBody,
      id: 'lead_1',
      organizationId: 'org_1',
    });
    expect(result.success).toBe(true);
  });
});
