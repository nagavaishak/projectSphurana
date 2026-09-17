import { withSystemScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { checkMemberAccess } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ListAppointmentsResponse } from '../list-appointments/list-appointments.service.js';
import { listAppointments } from '../list-appointments/list-appointments.service.js';
import {
  type ListAppointmentsForMemberInput,
  listAppointmentsForMemberSchema,
} from './list-appointments-for-member.schema.js';

/**
 * Roles holding `appointments:view_all` — they see the whole org calendar.
 * Anyone else (a plain `member`) holds `appointments:view_own` only and is
 * scoped in SQL to appointments assigned to them or booked against their
 * linked practitioner record. Mirrors `ROLE_PERMISSIONS` in
 * apps/api/src/common/guards/permissions.ts, where `admin` and `owner` are the
 * two roles at or above the `admin` tier.
 */
const VIEW_ALL_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

const listAppointmentsForMemberImpl = async (
  db: DbConnection,
  input: ListAppointmentsForMemberInput
): Promise<Result<ListAppointmentsResponse>> => {
  const parsed = listAppointmentsForMemberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, ...filters } = parsed.data;

  // Role resolution reads `member` across the org boundary, so it runs under
  // the system scope rather than the caller's org scope.
  const access = await withSystemScope(
    (conn) =>
      checkMemberAccess(conn, {
        userId,
        organizationId: filters.organizationId,
      }),
    { db }
  );

  const role = access.success ? access.data.role : null;
  const canViewAll = role ? VIEW_ALL_ROLES.has(role) : false;

  const result = await listAppointments(db, {
    ...filters,
    scopeToUserId: canViewAll ? undefined : userId,
  });

  if (!result.success) {
    return err(
      new FeatureError(
        result.error.code,
        result.error.message,
        result.error.details
      )
    );
  }

  return ok(result.data);
};

/**
 * List appointments visible to a given organization member.
 */
export const listAppointmentsForMember = (
  db: DbConnection,
  input: ListAppointmentsForMemberInput
) =>
  trackedResult(
    'appointments.listAppointmentsForMember',
    () => listAppointmentsForMemberImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    }
  );

export type ListAppointmentsForMemberServiceResult = Awaited<
  ReturnType<typeof listAppointmentsForMember>
>;
