import { describe, expect, it } from 'vitest';
import { createAppointmentRequestSchema } from './appointments.js';
import { createLeadRequestSchema } from './leads.js';

// A valid `POST /appointments` body as the frontend would send it over the
// wire: dates are ISO strings, no server-injected `organizationId`.
const validBody = {
  title: 'Haircut',
  startDate: '2024-01-01T10:00:00.000Z',
  endDate: '2024-01-01T11:00:00.000Z',
  leadId: 'lead_123',
};

describe('createAppointmentRequestSchema', () => {
  it('accepts a valid appointment-create body', () => {
    const result = createAppointmentRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('accepts optional fields (assignedToId, enums) when present', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validBody,
      description: 'Trim only',
      assignedToId: 'user_9',
      color: 'green',
      status: 'booked',
      source: 'manual',
      serviceId: 'svc_1',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validBody,
      // `organizationId` is server-injected and must NOT appear in the body;
      // any unknown key is the drift this contract is meant to catch.
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('rejects a body missing a required field (leadId)', () => {
    const { leadId: _omit, ...withoutLeadId } = validBody;
    const result = createAppointmentRequestSchema.safeParse(withoutLeadId);
    expect(result.success).toBe(false);
  });

  it('rejects a Date object where an ISO string is required (wire shape)', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validBody,
      startDate: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('enforces the endDate > startDate invariant', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validBody,
      startDate: '2024-01-01T11:00:00.000Z',
      endDate: '2024-01-01T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

// A valid `POST /leads` body as the frontend builder sends it: no
// server-injected `organizationId`, optional fields ABSENT rather than blank.
const validLeadBody = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  source: 'referral',
};

describe('createLeadRequestSchema', () => {
  it('accepts a valid lead-create body', () => {
    const result = createLeadRequestSchema.safeParse(validLeadBody);
    expect(result.success).toBe(true);
  });

  it('applies the server defaults (source, status, consent flags)', () => {
    const result = createLeadRequestSchema.parse({ firstName: 'Ada' });
    expect(result.source).toBe('manual');
    expect(result.status).toBe('new');
    expect(result.consentEmail).toBe(false);
    expect(result.consentSms).toBe(false);
    expect(result.consentVoice).toBe(false);
  });

  it('accepts a well-formed email', () => {
    const result = createLeadRequestSchema.safeParse({
      ...validLeadBody,
      email: 'ada@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an ABSENT email (the field is optional)', () => {
    const result = createLeadRequestSchema.safeParse(validLeadBody);
    expect(result.success).toBe(true);
  });

  // REGRESSION — the live production bug. The frontend's hand-written mirror
  // typed `email` as a bare `z.string().optional()`, so a blank input sailed
  // through as `''` and the SERVER returned 400 "Invalid email format". An
  // optional email may be ABSENT; it may never be the empty string.
  it('REJECTS email: "" and names the email field', () => {
    const result = createLeadRequestSchema.safeParse({
      ...validLeadBody,
      email: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'email')).toBe(true);
    }
  });

  // The old frontend mirror typed `firstName` as a bare `z.string()`, so an
  // empty name was a client-side pass and a server-side 400.
  it('REJECTS firstName: ""', () => {
    const result = createLeadRequestSchema.safeParse({
      ...validLeadBody,
      firstName: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'firstName')).toBe(
        true
      );
    }
  });

  it('rejects a body missing the required firstName', () => {
    const { firstName: _omit, ...withoutFirstName } = validLeadBody;
    const result = createLeadRequestSchema.safeParse(withoutFirstName);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown enum value for source', () => {
    const result = createLeadRequestSchema.safeParse({
      ...validLeadBody,
      source: 'carrier_pigeon',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a body with an unknown / extra field (proves .strict())', () => {
    const result = createLeadRequestSchema.safeParse({
      ...validLeadBody,
      // `organizationId` is server-injected — the feature schema `.extend()`s
      // it on. It must never appear in the body.
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });
});
