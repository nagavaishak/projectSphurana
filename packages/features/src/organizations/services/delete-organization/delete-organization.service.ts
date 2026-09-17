import { organization, withOrgScope } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
  softDeleteOrgChildren,
} from '../../../shared/index.js';
import {
  type DeleteOrganizationInput,
  deleteOrganizationSchema,
} from './delete-organization.schema.js';

/**
 * Response type for delete organization
 */
export interface DeleteOrganizationResponse {
  success: boolean;
  deletedOrganizationId: string;
}

/**
 * Internal implementation of delete organization
 */
const deleteOrganizationImpl = async (
  db: DbConnection,
  input: DeleteOrganizationInput
): Promise<Result<DeleteOrganizationResponse>> => {
  // Validate input
  const parsed = deleteOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, requesterId } = parsed.data;

  // Check if organization exists
  const org = await db.query.organization.findFirst({
    where: (o, { eq, and, isNull }) =>
      and(eq(o.id, organizationId), isNull(o.deletedAt)),
  });

  if (!org) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Organization with ID ${organizationId} not found`,
        { organizationId }
      )
    );
  }

  // Check if requester is an owner of the organization
  const requesterMember = await db.query.member.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.organizationId, organizationId), eq(m.userId, requesterId)),
  });

  if (!requesterMember) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'You are not a member of this organization',
        { organizationId, userId: requesterId }
      )
    );
  }

  // Only owners can delete the organization
  if (requesterMember.role !== 'owner') {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Only owners can delete the organization',
        { organizationId, requesterRole: requesterMember.role }
      )
    );
  }

  try {
    if (!(await isFeatureOn('killswitch-soft-deletes'))) {
      await db.delete(organization).where(eq(organization.id, organizationId));
      return ok({ success: true, deletedOrganizationId: organizationId });
    }

    await softDeleteOrgChildren(db, organizationId);

    await db
      .update(organization)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    return ok({
      success: true,
      deletedOrganizationId: organizationId,
    });
  } catch (error) {
    logError('organizations.deleteOrganization', error, {
      feature: 'organizations',
      extra: { organizationId, requesterId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while deleting the organization. Please try again.'
      )
    );
  }
};

/**
 * Delete an organization
 *
 * Only owners can delete an organization. All related data will be
 * cascade deleted (members, invitations, assets, etc.).
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Delete organization data
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * const result = await deleteOrganization(db, {
 *   organizationId: 'org-123',
 *   requesterId: 'user-789',
 * });
 *
 * if (result.success) {
 *   console.log('Organization deleted');
 * }
 * ```
 */
export const deleteOrganization = async (
  db: DbConnection,
  input: DeleteOrganizationInput
) => {
  const result = await trackedResult(
    'organizations.deleteOrganization',
    () => withOrgScope((tx) => deleteOrganizationImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );
  // Audit log fires after transaction commits — safe from phantom entries on rollback
  if (result.success) {
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'organization',
      entityId: input.organizationId,
      actorType: 'user',
      actorId: input.requesterId,
      organizationId: input.organizationId,
    }).catch((error) => {
      logError('organizations.deleteOrganization.auditLog', error, {
        feature: 'organizations',
        extra: {
          organizationId: input.organizationId,
          requesterId: input.requesterId,
        },
      });
    });
  }
  return result;
};

export type DeleteOrganizationResult = Awaited<
  ReturnType<typeof deleteOrganization>
>;
