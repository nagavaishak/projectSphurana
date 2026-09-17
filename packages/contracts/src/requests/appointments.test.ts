import { describe, expect, it } from 'vitest';
import {
  createAppointmentRequestSchema,
  findOpenSlotsRequestSchema,
  updateAppointmentRequestSchema,
} from './appointments.js';

// A valid `POST /appointments` body as the frontend would send it over the
// wire: dates are ISO strings, no server-injected `organizationId`.
const validCreate = {
  title: 'Haircut',
  startDate: '2024-01-01T10:00:00.000Z',
  endDate: '2024-01-01T11:00:00.000Z',
  leadId: 'lead_123',
};

describe('createAppointmentRequestSchema', () => {
  it('applies the server defaults (color, status, source)', () => {
    const result = createAppointmentRequestSchema.parse(validCreate);
    expect(result.color).toBe('blue');
    expect(result.status).toBe('booked');
    expect(result.source).toBe('manual');
  });

  // REGRESSION — the contract used to mark `endDate` REQUIRED while the feature
  // schema (the thing that actually runs) had it OPTIONAL, derived from the
  // services cart. The contract was describing a stricter API than the one that
  // ships, so a legitimate cart booking looked invalid on the client.
  it('accepts a cart booking with NO endDate (derived from services)', () => {
    const { endDate: _omit, ...noEnd } = validCreate;
    const result = createAppointmentRequestSchema.safeParse({
      ...noEnd,
      services: [{ name: 'Cut & blow-dry', durationMinutes: 45 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a body with NEITHER an endDate NOR a services cart', () => {
    const { endDate: _omit, ...noEnd } = validCreate;
    const result = createAppointmentRequestSchema.safeParse(noEnd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'endDate')).toBe(
        true
      );
    }
  });

  it('rejects an EMPTY services cart when there is no endDate', () => {
    const { endDate: _omit, ...noEnd } = validCreate;
    const result = createAppointmentRequestSchema.safeParse({
      ...noEnd,
      services: [],
    });
    expect(result.success).toBe(false);
  });

  // The invariant compares INSTANTS, not strings: these two spellings are the
  // same moment but do not compare equal lexicographically.
  it('treats equivalent ISO spellings as the same instant', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validCreate,
      startDate: '2024-01-01T10:00:00Z',
      endDate: '2024-01-01T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a services cart with snapshot fields', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validCreate,
      services: [
        {
          serviceId: 'svc_1',
          variantId: 'var_1',
          name: 'Balayage',
          durationMinutes: 120,
          priceCents: 18000,
          practitionerId: 'prac_1',
          sortOrder: 0,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a cart line missing its duration snapshot', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validCreate,
      services: [{ name: 'Balayage' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown enum value for source', () => {
    const result = createAppointmentRequestSchema.safeParse({
      ...validCreate,
      source: 'carrier_pigeon',
    });
    expect(result.success).toBe(false);
  });
});

// A `PUT /appointments/:id` body: a PATCH, so every key is optional and the
// route `id` is NOT part of the body.
describe('updateAppointmentRequestSchema', () => {
  it('accepts an EMPTY patch', () => {
    expect(updateAppointmentRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-key patch (the quick-actions slice)', () => {
    const result = updateAppointmentRequestSchema.safeParse({
      status: 'no_show',
    });
    expect(result.success).toBe(true);
  });

  // PATCH semantics: `null` CLEARS a nullable column, an absent key leaves it
  // alone. Collapsing the two would make "clear the note" unexpressible.
  it('accepts null on a nullable column (clear) and omission (leave alone)', () => {
    expect(
      updateAppointmentRequestSchema.safeParse({ description: null }).success
    ).toBe(true);
    expect(
      updateAppointmentRequestSchema.safeParse({ serviceId: null }).success
    ).toBe(true);
  });

  // A booking always belongs to someone — the server has never accepted a null
  // assignee, so neither does the wire. `buildUpdateAppointmentPayload` drops
  // the key instead.
  it('REJECTS a null assignedToId', () => {
    const result = updateAppointmentRequestSchema.safeParse({
      assignedToId: null,
    });
    expect(result.success).toBe(false);
  });

  it('enforces endDate > startDate only when BOTH are present', () => {
    expect(
      updateAppointmentRequestSchema.safeParse({
        startDate: '2024-01-01T11:00:00.000Z',
        endDate: '2024-01-01T10:00:00.000Z',
      }).success
    ).toBe(false);
    // A reschedule that moves only the end has nothing to compare against.
    expect(
      updateAppointmentRequestSchema.safeParse({
        endDate: '2024-01-01T10:00:00.000Z',
      }).success
    ).toBe(true);
  });

  // REGRESSION — the frontend's hand-written mirror typed `color` and `status`
  // as bare `z.string()`, so a stale enum value was a client-side pass and a
  // server-side 400.
  it('rejects an unknown enum value for status', () => {
    const result = updateAppointmentRequestSchema.safeParse({
      status: 'ghosted',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Date object where an ISO string is required (wire shape)', () => {
    const result = updateAppointmentRequestSchema.safeParse({
      startDate: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a body carrying the route id (proves .strict())', () => {
    const result = updateAppointmentRequestSchema.safeParse({
      id: 'appt_1',
      title: 'Haircut',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });
});

describe('findOpenSlotsRequestSchema', () => {
  it('applies the defaults (timePreference, timezone)', () => {
    const result = findOpenSlotsRequestSchema.parse({ date: '2024-01-01' });
    expect(result.timePreference).toBe('any');
    expect(result.timezone).toBe('UTC');
  });

  // `date` is a CALENDAR DAY resolved against `timezone`, not an instant.
  it('rejects an ISO instant where a YYYY-MM-DD day is required', () => {
    const result = findOpenSlotsRequestSchema.safeParse({
      date: '2024-01-01T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('enforces the 15–480 minute duration bounds', () => {
    expect(
      findOpenSlotsRequestSchema.safeParse({ date: '2024-01-01', duration: 30 })
        .success
    ).toBe(true);
    expect(
      findOpenSlotsRequestSchema.safeParse({ date: '2024-01-01', duration: 5 })
        .success
    ).toBe(false);
    expect(
      findOpenSlotsRequestSchema.safeParse({
        date: '2024-01-01',
        duration: 600,
      }).success
    ).toBe(false);
  });

  it('REJECTS a body with the server-injected organizationId (proves .strict())', () => {
    const result = findOpenSlotsRequestSchema.safeParse({
      date: '2024-01-01',
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
