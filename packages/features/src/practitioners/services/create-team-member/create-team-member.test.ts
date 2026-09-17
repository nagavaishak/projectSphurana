import {
  afterEach,
  beforeEach,
  createMockDatabaseWithRollback,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as inviteMemberModule from '../../../organizations/services/invite-member/invite-member.service.js';
import * as updateWageConfigModule from '../../../scheduling/services/update-wage-config/update-wage-config.service.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import * as assignPractitionerLocationsModule from '../assign-practitioner-locations/assign-practitioner-locations.service.js';
import * as assignPractitionerServicesModule from '../assign-practitioner-services/assign-practitioner-services.service.js';
import * as createPractitionerModule from '../create-practitioner/create-practitioner.service.js';
import { createTeamMember } from './create-team-member.service.js';

// Every composed service is stubbed so the orchestration is exercised in
// isolation — with restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false`
// all files in a worker share one module graph, so a hoisted bare-factory mock
// leaks outward (deleting every export it omits — five modules' worth here) and
// silently misses whenever an earlier file already imported the real module.
const mocks = {} as Record<
  | 'createPractitioner'
  | 'assignPractitionerServices'
  | 'assignPractitionerLocations'
  | 'updateWageConfig'
  | 'inviteMember',
  MockInstance
>;

const mockPractitioner = {
  id: 'prac-1',
  organizationId: 'org-1',
  name: 'Jane Doe',
  email: 'jane@example.com',
} as never;

const mockInvitation = {
  id: 'inv-1',
  organizationId: 'org-1',
  email: 'jane@example.com',
  role: 'admin',
  status: 'pending',
} as never;

const validInput = {
  organizationId: 'org-1',
  inviterId: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  permissionLevel: 'medium' as const,
  serviceIds: ['svc-1', 'svc-2'],
  locationIds: ['loc-1'],
  wageConfig: { compensationType: 'hourly' as const, hourlyRateCents: 2000 },
};

describe('createTeamMember', () => {
  let mockDb: ReturnType<typeof createMockDatabaseWithRollback>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabaseWithRollback();

    mocks.createPractitioner = vi.spyOn(
      createPractitionerModule,
      'createPractitioner'
    );
    mocks.assignPractitionerServices = vi.spyOn(
      assignPractitionerServicesModule,
      'assignPractitionerServices'
    );
    mocks.assignPractitionerLocations = vi.spyOn(
      assignPractitionerLocationsModule,
      'assignPractitionerLocations'
    );
    mocks.updateWageConfig = vi.spyOn(
      updateWageConfigModule,
      'updateWageConfig'
    );
    mocks.inviteMember = vi.spyOn(inviteMemberModule, 'inviteMember');

    // Happy-path defaults; individual tests override as needed.
    mocks.createPractitioner.mockResolvedValue(ok(mockPractitioner));
    mocks.assignPractitionerServices.mockResolvedValue(
      ok({ practitionerId: 'prac-1', serviceIds: ['svc-1', 'svc-2'] })
    );
    mocks.assignPractitionerLocations.mockResolvedValue(
      ok({ practitionerId: 'prac-1', locations: [{ locationId: 'loc-1' }] })
    );
    mocks.updateWageConfig.mockResolvedValue(
      ok({ practitionerId: 'prac-1', organizationId: 'org-1' })
    );
    mocks.inviteMember.mockResolvedValue(ok(mockInvitation));
  });

  afterEach(() => {
    for (const spy of Object.values(mocks)) spy.mockRestore();
  });

  it('creates practitioner, assigns services/locations/wage, invites, and returns both', async () => {
    const result = await createTeamMember(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.practitioner).toBe(mockPractitioner);
      expect(result.data.invitation).toBe(mockInvitation);
    }

    // Every step ran, threading the transaction as its db.
    expect(mocks.createPractitioner).toHaveBeenCalledTimes(1);
    expect(mocks.assignPractitionerServices).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        practitionerId: 'prac-1',
        organizationId: 'org-1',
        serviceIds: ['svc-1', 'svc-2'],
      })
    );
    // locationIds mapped to the assignment shape.
    expect(mocks.assignPractitionerLocations).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        locations: [{ locationId: 'loc-1' }],
      })
    );
    expect(mocks.updateWageConfig).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        practitionerId: 'prac-1',
        compensationType: 'hourly',
        hourlyRateCents: 2000,
      })
    );

    // jobTitle mapped to practitioner `title`.
    const createArg = mocks.createPractitioner.mock.calls[0][1];
    expect(createArg.organizationId).toBe('org-1');

    // No rollback on the happy path.
    expect(mockDb._wasRolledBack).toBe(false);
  });

  // ── ENG-794 ───────────────────────────────────────────────────────────────
  it('marks the new practitioner as invitation-pending, so they are not bookable yet', async () => {
    await createTeamMember(mockDb as never, validInput);

    // This flow always ends in an invitation, so the practitioner it creates
    // has by definition not accepted. Until they do they are excluded from the
    // calendar's practitioner columns, the appointment picker and public
    // availability — the seeded 09:00-17:00 shift no longer makes someone who
    // may never join look bookable.
    expect(mocks.createPractitioner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ invitationPending: true })
    );
  });

  it('maps permissionLevel medium → admin role on the invitation', async () => {
    await createTeamMember(mockDb as never, validInput);

    expect(mocks.inviteMember).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ role: 'admin', email: 'jane@example.com' })
    );
  });

  it('maps permissionLevel low → member role', async () => {
    await createTeamMember(mockDb as never, {
      ...validInput,
      permissionLevel: 'low',
    });

    expect(mocks.inviteMember).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ role: 'member' })
    );
  });

  it('maps permissionLevel high → admin role', async () => {
    await createTeamMember(mockDb as never, {
      ...validInput,
      permissionLevel: 'high',
    });

    expect(mocks.inviteMember).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ role: 'admin' })
    );
  });

  it('orders the invite LAST so its email only fires after prior steps commit', async () => {
    const order: string[] = [];
    mocks.createPractitioner.mockImplementation(async () => {
      order.push('practitioner');
      return ok(mockPractitioner);
    });
    mocks.assignPractitionerServices.mockImplementation(async () => {
      order.push('services');
      return ok({ practitionerId: 'prac-1', serviceIds: [] });
    });
    mocks.assignPractitionerLocations.mockImplementation(async () => {
      order.push('locations');
      return ok({ practitionerId: 'prac-1', locations: [] });
    });
    mocks.updateWageConfig.mockImplementation(async () => {
      order.push('wage');
      return ok({ practitionerId: 'prac-1', organizationId: 'org-1' });
    });
    mocks.inviteMember.mockImplementation(async () => {
      order.push('invite');
      return ok(mockInvitation);
    });

    await createTeamMember(mockDb as never, validInput);

    expect(order).toEqual([
      'practitioner',
      'services',
      'locations',
      'wage',
      'invite',
    ]);
  });

  it('skips optional steps when serviceIds/locationIds/wageConfig are absent', async () => {
    const result = await createTeamMember(mockDb as never, {
      organizationId: 'org-1',
      inviterId: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      permissionLevel: 'low',
    });

    expect(result.success).toBe(true);
    expect(mocks.assignPractitionerServices).not.toHaveBeenCalled();
    expect(mocks.assignPractitionerLocations).not.toHaveBeenCalled();
    expect(mocks.updateWageConfig).not.toHaveBeenCalled();
    expect(mocks.inviteMember).toHaveBeenCalledTimes(1);
  });

  it('rolls back and returns the step error when assign-services fails', async () => {
    mocks.assignPractitionerServices.mockResolvedValue(
      err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'One or more services not found'
        )
      )
    );

    const result = await createTeamMember(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toBe('One or more services not found');
    }

    // Transaction rolled back; later steps never ran.
    expect(mockDb._wasRolledBack).toBe(true);
    expect(mocks.assignPractitionerLocations).not.toHaveBeenCalled();
    expect(mocks.updateWageConfig).not.toHaveBeenCalled();
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  // ENG-721: adding a team member whose email already belongs to an active
  // practitioner must surface ALREADY_EXISTS — the controller maps that to 409
  // with a message the owner can act on. It used to escape as INTERNAL_ERROR,
  // so prod answered an opaque 500 "Failed to create practitioner" and the
  // owner retried ten times, never getting an invitation email.
  it('surfaces ALREADY_EXISTS (not INTERNAL_ERROR) for a duplicate email', async () => {
    mocks.createPractitioner.mockResolvedValue(
      err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A practitioner with this email already exists in this organization'
        )
      )
    );

    const result = await createTeamMember(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
      expect(result.error.message).toBe(
        'A practitioner with this email already exists in this organization'
      );
    }

    expect(mockDb._wasRolledBack).toBe(true);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  it('rolls back when the invitation step fails', async () => {
    mocks.inviteMember.mockResolvedValue(
      err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'An invitation is already pending for this email'
        )
      )
    );

    const result = await createTeamMember(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
    expect(mockDb._wasRolledBack).toBe(true);
  });

  it('returns VALIDATION_ERROR for invalid input and runs no steps', async () => {
    const result = await createTeamMember(
      mockDb as never,
      {
        organizationId: 'org-1',
        inviterId: 'user-1',
        email: 'not-an-email',
        permissionLevel: 'low',
      } as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mocks.createPractitioner).not.toHaveBeenCalled();
  });
});
