import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection } from '../../../shared/index.js';
import { classifyBusiness } from '../classify-business/index.js';

export type ReclassifyBusinessInput = {
  organizationId: string;
  // When true, bypass the inputHash + classifierVersion short-circuit. Used by
  // owner-override and onboarding-completion paths where we know the inputs
  // *should* produce a fresh classification. Service-CRUD triggers leave it
  // false so the hash check skips no-op work.
  force?: boolean;
};

// Thin wrapper around classifyBusiness for callers (triggers, override
// mutation) that want a stable name semantically distinct from "first-time
// classify". Behaviour is identical: classifyBusiness is idempotent by
// design via inputHash + classifierVersion.
export const reclassifyBusiness = (
  db: DbConnection,
  input: ReclassifyBusinessInput
) =>
  trackedResult(
    'claire.reclassifyBusiness',
    () =>
      classifyBusiness(db, {
        organizationId: input.organizationId,
        force: input.force,
      }),
    {
      properties: {
        organizationId: input.organizationId,
        force: !!input.force,
      },
    }
  );

export type ReclassifyBusinessResult = Awaited<
  ReturnType<typeof reclassifyBusiness>
>;
