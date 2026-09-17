import { describe, expect, it } from 'vitest';
import {
  acceptInvitationRequestSchema,
  assignPractitionerLocationsRequestSchema,
  assignPractitionerServicesRequestSchema,
  createLocationRequestSchema,
  createPractitionerRequestSchema,
  createTeamMemberRequestSchema,
  inviteMemberRequestSchema,
  updateLocationRequestSchema,
  updatePractitionerRequestSchema,
} from './team.js';

/** Assert a `.strict()` violation specifically (not just "some failure"). */
const expectUnrecognizedKey = (result: {
  success: boolean;
  error?: unknown;
}) => {
  expect(result.success).toBe(false);
  if (!result.success) {
    const error = result.error as { issues: { code: string }[] };
    expect(error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  }
};

// ---------------------------------------------------------------------------
// POST /practitioners
// ---------------------------------------------------------------------------

describe('createPractitionerRequestSchema', () => {
  const valid = { name: 'Grace Hopper', email: 'grace@example.com' };

  it('accepts a minimal valid body', () => {
    expect(createPractitionerRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts the full profile (enums, jsonb shapes, work details)', () => {
    const result = createPractitionerRequestSchema.safeParse({
      ...valid,
      firstName: 'Grace',
      lastName: 'Hopper',
      country: 'ie',
      employmentType: 'full_time',
      color: 'blue',
      photo: 'https://cdn.example.com/grace.jpg',
      headline: 'Senior stylist',
      socialLinks: { instagram: '@grace' },
      workingHours: { 1: { from: 540, to: 1020 } },
      bookingLink: '',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS server-injected organizationId in the body (proves .strict())', () => {
    expectUnrecognizedKey(
      createPractitionerRequestSchema.safeParse({
        ...valid,
        organizationId: 'org_1',
      })
    );
  });

  it('rejects a missing email (required)', () => {
    expect(
      createPractitionerRequestSchema.safeParse({ name: 'Grace' }).success
    ).toBe(false);
  });

  it('rejects a blank email — `` is neither absent nor valid', () => {
    expect(
      createPractitionerRequestSchema.safeParse({ ...valid, email: '' }).success
    ).toBe(false);
  });

  it('rejects an unknown country code (enum is label-derived)', () => {
    expect(
      createPractitionerRequestSchema.safeParse({ ...valid, country: 'zz' })
        .success
    ).toBe(false);
  });

  it('rejects a headline over 64 chars', () => {
    expect(
      createPractitionerRequestSchema.safeParse({
        ...valid,
        headline: 'x'.repeat(65),
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT /practitioners/:id
// ---------------------------------------------------------------------------

describe('updatePractitionerRequestSchema', () => {
  it('accepts an empty body (PATCH: every field optional)', () => {
    expect(updatePractitionerRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts null on the clearable fields (null = unset)', () => {
    const result = updatePractitionerRequestSchema.safeParse({
      phone: null,
      country: null,
      employmentType: null,
      color: null,
      socialLinks: null,
      workingHours: null,
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS the route param `id` in the body (proves .strict())', () => {
    expectUnrecognizedKey(
      updatePractitionerRequestSchema.safeParse({ id: 'prac_1' })
    );
  });

  it('rejects a blank name — you may leave it, you may not blank it', () => {
    expect(
      updatePractitionerRequestSchema.safeParse({ name: '' }).success
    ).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(
      updatePractitionerRequestSchema.safeParse({ email: 'not-an-email' })
        .success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /practitioners/team-member
// ---------------------------------------------------------------------------

describe('createTeamMemberRequestSchema', () => {
  const valid = { email: 'grace@example.com' };

  it('accepts a minimal valid body', () => {
    expect(createTeamMemberRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('MATERIALISES permissionLevel: "low" when omitted (.default())', () => {
    const result = createTeamMemberRequestSchema.parse(valid);
    expect(result.permissionLevel).toBe('low');
  });

  it('accepts the association sets and a partial wage-config patch', () => {
    const result = createTeamMemberRequestSchema.safeParse({
      ...valid,
      permissionLevel: 'medium',
      serviceIds: ['svc_1'],
      locationIds: ['loc_1'],
      jobTitle: 'Stylist',
      wageConfig: {
        compensationType: 'hourly',
        hourlyRateCents: 1550,
        overtimeEnabled: true,
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
        autoClockIn: 'enabled',
      },
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS server-injected inviterId in the body (proves .strict())', () => {
    expectUnrecognizedKey(
      createTeamMemberRequestSchema.safeParse({ ...valid, inviterId: 'user_1' })
    );
  });

  it('rejects an unknown key inside wageConfig (nested strictness)', () => {
    const result = createTeamMemberRequestSchema.safeParse({
      ...valid,
      wageConfig: { compensationType: 'hourly', organizationId: 'org_1' },
    });
    expect(result.success).toBe(false);
  });

  it('SECURITY: rejects a raw role — owner is unreachable from this body', () => {
    expect(
      createTeamMemberRequestSchema.safeParse({
        ...valid,
        permissionLevel: 'owner',
      }).success
    ).toBe(false);
  });

  it('rejects an empty-string service id', () => {
    expect(
      createTeamMemberRequestSchema.safeParse({ ...valid, serviceIds: [''] })
        .success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Assignment endpoints
// ---------------------------------------------------------------------------

describe('assignPractitionerServicesRequestSchema', () => {
  it('accepts an EMPTY array — clearing every assignment is a valid body', () => {
    expect(
      assignPractitionerServicesRequestSchema.safeParse({ serviceIds: [] })
        .success
    ).toBe(true);
  });

  it('accepts a populated array', () => {
    expect(
      assignPractitionerServicesRequestSchema.safeParse({
        serviceIds: ['svc_1', 'svc_2'],
      }).success
    ).toBe(true);
  });

  it('rejects an empty-string id', () => {
    expect(
      assignPractitionerServicesRequestSchema.safeParse({ serviceIds: [''] })
        .success
    ).toBe(false);
  });

  it('REJECTS the route param practitionerId (proves .strict())', () => {
    expectUnrecognizedKey(
      assignPractitionerServicesRequestSchema.safeParse({
        serviceIds: [],
        practitionerId: 'prac_1',
      })
    );
  });

  it('rejects a missing serviceIds (required, even when empty)', () => {
    expect(assignPractitionerServicesRequestSchema.safeParse({}).success).toBe(
      false
    );
  });
});

describe('assignPractitionerLocationsRequestSchema', () => {
  it('accepts an EMPTY array — clearing every assignment is a valid body', () => {
    expect(
      assignPractitionerLocationsRequestSchema.safeParse({ locations: [] })
        .success
    ).toBe(true);
  });

  it('accepts assignments with and without a working-hours override', () => {
    const result = assignPractitionerLocationsRequestSchema.safeParse({
      locations: [
        { locationId: 'loc_1' },
        { locationId: 'loc_2', workingHours: { 1: { from: 540, to: 1020 } } },
        { locationId: 'loc_3', workingHours: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a working-hours range outside a single day', () => {
    const result = assignPractitionerLocationsRequestSchema.safeParse({
      locations: [
        { locationId: 'loc_1', workingHours: { 1: { from: 540, to: 2000 } } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS an unknown key on an assignment entry', () => {
    const result = assignPractitionerLocationsRequestSchema.safeParse({
      locations: [{ locationId: 'loc_1', organizationId: 'org_1' }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invite / accept invite
// ---------------------------------------------------------------------------

describe('inviteMemberRequestSchema', () => {
  it('accepts a minimal valid body', () => {
    expect(
      inviteMemberRequestSchema.safeParse({ email: 'grace@example.com' })
        .success
    ).toBe(true);
  });

  it('MATERIALISES role: "member" when omitted — the least-privileged default', () => {
    const result = inviteMemberRequestSchema.parse({
      email: 'grace@example.com',
    });
    expect(result.role).toBe('member');
  });

  it('accepts the Review-step prefill fields', () => {
    const result = inviteMemberRequestSchema.safeParse({
      email: 'grace@example.com',
      role: 'admin',
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '0851234567',
      phoneCountry: '+353',
      country: 'ie',
    });
    expect(result.success).toBe(true);
  });

  it('SECURITY: rejects role "owner" — an invite can never confer ownership', () => {
    expect(
      inviteMemberRequestSchema.safeParse({
        email: 'grace@example.com',
        role: 'owner',
      }).success
    ).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(
      inviteMemberRequestSchema.safeParse({ email: 'grace-at-example' }).success
    ).toBe(false);
  });

  it('rejects a blank prefill field — omit it, do not send ``', () => {
    expect(
      inviteMemberRequestSchema.safeParse({
        email: 'grace@example.com',
        firstName: '   ',
      }).success
    ).toBe(false);
  });

  it('REJECTS server-injected organizationId / inviterId (proves .strict())', () => {
    expectUnrecognizedKey(
      inviteMemberRequestSchema.safeParse({
        email: 'grace@example.com',
        organizationId: 'org_1',
        inviterId: 'user_1',
      })
    );
  });
});

describe('acceptInvitationRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(acceptInvitationRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts acceptedTerms', () => {
    expect(
      acceptInvitationRequestSchema.safeParse({ acceptedTerms: true }).success
    ).toBe(true);
  });

  it('SECURITY: REJECTS an invitationId in the body — it is the route param', () => {
    expectUnrecognizedKey(
      acceptInvitationRequestSchema.safeParse({ invitationId: 'inv_1' })
    );
  });

  it('SECURITY: REJECTS a userId in the body — it comes from the session', () => {
    expectUnrecognizedKey(
      acceptInvitationRequestSchema.safeParse({ userId: 'user_1' })
    );
  });
});

// ---------------------------------------------------------------------------
// locations
// ---------------------------------------------------------------------------

describe('createLocationRequestSchema', () => {
  const valid = { addressLine1: '1 Main St', city: 'Dublin', country: 'ie' };

  it('accepts a minimal valid body', () => {
    expect(createLocationRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('MATERIALISES isPrimary: false when omitted (.default())', () => {
    expect(createLocationRequestSchema.parse(valid).isPrimary).toBe(false);
  });

  it('accepts nulls on the genuinely-absent fields', () => {
    const result = createLocationRequestSchema.safeParse({
      ...valid,
      name: null,
      addressLine2: null,
      county: null,
      postalCode: null,
      latitude: null,
      longitude: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing addressLine1', () => {
    const { addressLine1: _omit, ...rest } = valid;
    expect(createLocationRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a blank city', () => {
    expect(
      createLocationRequestSchema.safeParse({ ...valid, city: '' }).success
    ).toBe(false);
  });

  it('rejects an unknown country code', () => {
    expect(
      createLocationRequestSchema.safeParse({ ...valid, country: 'zz' }).success
    ).toBe(false);
  });

  it('REJECTS server-injected organizationId (proves .strict())', () => {
    expectUnrecognizedKey(
      createLocationRequestSchema.safeParse({ ...valid, organizationId: 'o1' })
    );
  });
});

describe('updateLocationRequestSchema', () => {
  it('accepts an empty body (PATCH)', () => {
    expect(updateLocationRequestSchema.safeParse({}).success).toBe(true);
  });

  it('does NOT default isPrimary — omitting it means "leave it"', () => {
    expect('isPrimary' in updateLocationRequestSchema.parse({})).toBe(false);
  });

  it('rejects blanking addressLine1', () => {
    expect(
      updateLocationRequestSchema.safeParse({ addressLine1: '' }).success
    ).toBe(false);
  });

  it('rejects a negative sortOrder', () => {
    expect(
      updateLocationRequestSchema.safeParse({ sortOrder: -1 }).success
    ).toBe(false);
  });

  it('REJECTS the route param `id` in the body (proves .strict())', () => {
    expectUnrecognizedKey(
      updateLocationRequestSchema.safeParse({ id: 'loc_1' })
    );
  });
});
