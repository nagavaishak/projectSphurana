import type { DbConnection } from '../../../shared/index.js';
import { reclassifyBusiness } from '../reclassify-business/index.js';

export interface BackfillBusinessProfilesSummary {
  total: number;
  classified: number;
  skippedNoServices: number;
  unchanged: number;
  failed: Array<{ orgId: string; reason: string }>;
}

/**
 * Batch (re)classification of every organization's business profile.
 *
 * Lifted verbatim out of `ClaireAdminController.backfillAll`, which was the
 * only controller in the codebase reaching for `db.query.*` directly (Gate 5
 * `direct-db`). The loop is orchestration over three services' worth of data,
 * which is a use case, not transport.
 *
 * Idempotent. Orgs with zero services are skipped. `reclassifyBusiness` itself
 * short-circuits orgs whose profile is already up to date (matching
 * `inputHash` + `classifierVersion`), so re-runs are cheap.
 */
export const backfillBusinessProfiles = async (
  db: DbConnection
): Promise<BackfillBusinessProfilesSummary> => {
  const orgs = await db.query.organization.findMany({
    columns: { id: true, name: true },
  });

  const summary: BackfillBusinessProfilesSummary = {
    total: orgs.length,
    classified: 0,
    skippedNoServices: 0,
    unchanged: 0,
    failed: [],
  };

  // Sequential — classifier hits an LLM and we don't want to fan out 50
  // concurrent OpenAI calls from one HTTP request. If this gets slow,
  // move it onto a worker queue instead of parallelising in-process.
  for (const org of orgs) {
    const firstService = await db.query.organizationService.findFirst({
      where: (s, { eq }) => eq(s.organizationId, org.id),
      columns: { id: true },
    });

    if (!firstService) {
      summary.skippedNoServices++;
      continue;
    }

    const before = await db.query.businessProfile.findFirst({
      where: (p, { eq }) => eq(p.organizationId, org.id),
      columns: { inputHash: true, classifierVersion: true },
    });

    const result = await reclassifyBusiness(db, { organizationId: org.id });
    if (!result.success) {
      summary.failed.push({ orgId: org.id, reason: result.error.message });
      continue;
    }

    const isUnchanged =
      !!before &&
      before.inputHash === result.data.inputHash &&
      before.classifierVersion === result.data.classifierVersion;
    if (isUnchanged) summary.unchanged++;
    else summary.classified++;
  }

  return summary;
};
