import type { Practitioner } from '@borradh-workspace/database';
import { permissionLevelToRole } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type InviteMemberResponse,
  inviteMember,
} from '../../../organizations/services/invite-member/invite-member.service.js';
import { updateWageConfig } from '../../../scheduling/services/update-wage-config/update-wage-config.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { assignPractitionerLocations } from '../assign-practitioner-locations/assign-practitioner-locations.service.js';
import { assignPractitionerServices } from '../assign-practitioner-services/assign-practitioner-services.service.js';
import { createPractitioner } from '../create-practitioner/create-practitioner.service.js';
import {
  type CreateTeamMemberInput,
  createTeamMemberSchema,
} from './create-team-member.schema.js';

export interface CreateTeamMemberData {
  practitioner: Practitioner;
  invitation: InviteMemberResponse;
}

/**
 * Structural error shape returned by the composed step `Result`s. The steps are
 * wrapped by `trackedResult`, which widens the `FeatureError` class to this
 * plain shape, so we capture it structurally and rebuild a `FeatureError` in the
 * catch block.
 */
interface StepError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Sentinel used to abort the orchestration transaction while preserving the
 * exact error a composed step returned. Throwing rolls the whole transaction
 * back (create/assign/wage/invite become atomic); the catch block unwraps this
 * and returns the original step error to the caller.
 */
class TeamMemberStepAbort extends Error {
  constructor(readonly featureError: StepError) {
    super(featureError.message);
    this.name = 'TeamMemberStepAbort';
  }
}

/**
 * Orchestrate adding a team member (spec §6 "Save semantics"): in ONE
 * transaction, create the practitioner, assign services + locations, upsert the
 * wage config, and finally create + email the invitation. Every composed
 * service receives the transaction as its `db`, so any non-success `Result`
 * throws and rolls the whole unit of work back — no partial commit.
 *
 * Ordering note: the invite is deliberately the LAST step. `inviteMember` sends
 * the invitation email as a side effect (after the row insert), so keeping it
 * last means the email only fires once the practitioner + associations + wage
 * config have all committed successfully — an earlier failure never sends a
 * dangling invite. (`inviteMember` swallows email-delivery failures internally,
 * so a flaky mailer does not roll back a valid invitation.)
 */
const createTeamMemberImpl = async (
  db: DbConnection,
  input: CreateTeamMemberInput
): Promise<Result<CreateTeamMemberData>> => {
  const parsed = createTeamMemberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    inviterId,
    permissionLevel,
    serviceIds,
    locationIds,
    wageConfig,
    jobTitle,
    ...profile
  } = parsed.data;

  const role = permissionLevelToRole[permissionLevel];

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Create the practitioner (derives `name` from first/last).
      const practitionerResult = await createPractitioner(tx, {
        organizationId,
        ...profile,
        title: jobTitle,
        // This flow ALWAYS ends in an invitation (step 5), so the practitioner
        // it creates is by definition someone who has not accepted yet. Until
        // they do, they are not offered to customers and cannot be picked as
        // the practitioner on a staff booking — the seeded 09:00-17:00 shift
        // no longer makes an unreachable person look available (ENG-794).
        invitationPending: true,
      });
      if (!practitionerResult.success) {
        throw new TeamMemberStepAbort(practitionerResult.error);
      }
      const createdPractitioner = practitionerResult.data;

      // 2. Assign services (if any).
      if (serviceIds && serviceIds.length > 0) {
        const servicesResult = await assignPractitionerServices(tx, {
          practitionerId: createdPractitioner.id,
          organizationId,
          serviceIds,
        });
        if (!servicesResult.success) {
          throw new TeamMemberStepAbort(servicesResult.error);
        }
      }

      // 3. Assign locations (if any) — map ids to the assignment shape.
      if (locationIds && locationIds.length > 0) {
        const locationsResult = await assignPractitionerLocations(tx, {
          practitionerId: createdPractitioner.id,
          organizationId,
          locations: locationIds.map((locationId) => ({ locationId })),
        });
        if (!locationsResult.success) {
          throw new TeamMemberStepAbort(locationsResult.error);
        }
      }

      // 4. Upsert wage config (if provided).
      if (wageConfig) {
        const wageResult = await updateWageConfig(tx, {
          organizationId,
          practitionerId: createdPractitioner.id,
          ...wageConfig,
        });
        if (!wageResult.success) {
          throw new TeamMemberStepAbort(wageResult.error);
        }
      }

      // 5. Create the invitation LAST (sends the email on full success).
      const inviteResult = await inviteMember(tx, {
        organizationId,
        inviterId,
        email: profile.email,
        role,
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone,
        phoneCountry: profile.phoneCountry,
        country: profile.country,
      });
      if (!inviteResult.success) {
        throw new TeamMemberStepAbort(inviteResult.error);
      }

      return {
        practitioner: createdPractitioner,
        invitation: inviteResult.data,
      };
    });

    return ok(result);
  } catch (error) {
    // A composed step failed: unwrap and return its original error (the
    // transaction has already rolled back).
    if (error instanceof TeamMemberStepAbort) {
      return err(
        new FeatureError(
          error.featureError.code,
          error.featureError.message,
          error.featureError.details
        )
      );
    }

    logError('practitioners.createTeamMember', error, {
      feature: 'practitioners',
      extra: { organizationId, email: input.email },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create team member'
      )
    );
  }
};

export const createTeamMember = (
  db: DbConnection,
  input: CreateTeamMemberInput
) =>
  trackedResult(
    'practitioners.createTeamMember',
    () => createTeamMemberImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        email: input.email,
      },
    }
  );

export type CreateTeamMemberResult = Awaited<
  ReturnType<typeof createTeamMember>
>;
