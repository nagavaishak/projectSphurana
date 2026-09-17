import { organizationService } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Transaction-scoped writer for `organization_service.turnaround_minutes`.
 *
 * WHY THIS EXISTS. Turnaround (the minutes a ROOM stays held after a service
 * for cleanup) is configured on the same screen as that service's resource
 * requirements, so `resources/setServiceResourceRequirements` needs to write it
 * inside ITS transaction — both must commit together or neither should.
 *
 * But `organization_service` is owned by THIS directory. A raw
 * `tx.update(organizationService)` from the resources feature would trip the
 * single-writer architecture rule
 * (packages/features/src/architecture/single-writer.test.ts), and that rule is
 * not bureaucracy: the audit behind it found `create-appointment` with 8
 * writers and `create-lead` with 14, each one quietly skipping the owning
 * service's business rules.
 *
 * So the write lives here, where it belongs, and callers pass their own `tx`.
 * Deliberately NOT wrapped in `trackedResult`/`withOrgScope`: it must compose
 * inside a caller's existing transaction and org scope, and nesting either
 * would either open a second scope or swallow the caller's rollback.
 *
 * Scoped by `organizationId` as well as `id` so a cross-org id can never write.
 *
 * @param turnaroundMinutes - 0 is normalised to null so "no turnaround" has a
 *   single representation and readers never treat 0 and null as distinct.
 */
export async function setServiceTurnaround(
  tx: DbConnection,
  input: {
    serviceId: string;
    organizationId: string;
    turnaroundMinutes: number | null;
  }
): Promise<void> {
  await tx
    .update(organizationService)
    .set({ turnaroundMinutes: input.turnaroundMinutes || null })
    .where(
      and(
        eq(organizationService.id, input.serviceId),
        eq(organizationService.organizationId, input.organizationId)
      )
    );
}
