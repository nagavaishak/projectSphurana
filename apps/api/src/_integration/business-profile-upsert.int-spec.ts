/**
 * business_profile concurrent-classify race.
 *
 * Reproduces the top production error by event volume:
 *   PostgresError: duplicate key value violates unique constraint
 *   "business_profile_organization_id_unique"
 *
 * classifyBusiness reads `existing` outside a transaction and then branches
 * update-by-id vs insert. business_profile is 1:1 with organization, so two
 * runs for the same org that both read null (the /assistant/chat path fires
 * one per turn) both take the insert branch — one wins, the other raises
 * 23505 and the whole classify fails with INTERNAL_ERROR.
 *
 * Locked here: N concurrent first-time classifies for one org all succeed and
 * leave exactly one row, and a racing writer's overriddenAxes — along with the
 * effective axes derived from them — survive rather than being replaced by the
 * loser's unconstrained guess.
 */
import { randomUUID } from 'node:crypto';
import { businessProfile, db } from '@borradh-workspace/database';
import { classifyBusiness } from '@borradh-workspace/features/claire';
import { eq } from 'drizzle-orm';
import { seedOrganization, seedService } from './harness.js';

// Force the classifier's deterministic heuristic path. With a real
// OPENAI_API_KEY present the vertical classifier makes live LLM calls that
// retry, take ~10s, and fail non-deterministically on schema checks — which
// would make this test measure the model, not the write race. classify.ts
// reads this at call time, so setting it here is enough.
process.env.OPENAI_API_KEY = '';

/** An org with a small menu, so the classifier has something to rank. */
async function seedClassifiableOrg(): Promise<string> {
  const organizationId = await seedOrganization();
  await seedService({ organizationId, name: 'Consultation' });
  await seedService({ organizationId, name: 'Follow-up' });
  return organizationId;
}

describe('business_profile concurrent classify', () => {
  it('survives N concurrent first-time classifies for one org', async () => {
    const organizationId = await seedClassifiableOrg();

    // All 5 read `existing = null` before any of them writes.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        classifyBusiness(db, { organizationId, reason: 'onboarding' })
      )
    );

    const failures = results.filter((r) => !r.success);
    expect(failures.map((f) => (f.success ? '' : f.error.message))).toEqual([]);

    const rows = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.organizationId, organizationId));
    expect(rows).toHaveLength(1);
  });

  /**
   * The deterministic reproduction, and the real regression guard.
   *
   * The production race needs `existing` to read null while a row exists by
   * write time. That interleaving cannot be scheduled from outside, so we
   * reproduce its EFFECT instead: `blindDb` delegates everything to the real
   * connection except businessProfile.findFirst, which always reports "no
   * row". The service therefore takes the insert branch against a table that
   * already has the row — exactly the state the losing writer is in.
   *
   * Pre-fix this raises 23505 and classify fails. Post-fix it folds into an
   * update.
   */
  it('folds into an update when the row appeared after the existence check', async () => {
    const organizationId = await seedClassifiableOrg();

    // The writer that won the race, having persisted real owner overrides.
    await db.insert(businessProfile).values({
      id: randomUUID(),
      organizationId,
      vertical: 'aesthetic_clinic',
      retentionModel: 'course_based',
      commitmentLevel: 'major',
      marketPosition: 'above',
      inputHash: 'winner-hash',
      classifierVersion: 'v1',
      overriddenAxes: { retentionModel: 'course_based', source: 'owner' },
    });

    // Blind ONLY the pre-write read, which is what a real race does: the row
    // does not exist when this run looks, and does by the time it writes. The
    // service's post-conflict re-read must still see the winner's row —
    // blinding that too would model a database that cannot be read at all.
    let firstRead = true;
    const blindDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'query') {
          return new Proxy(target.query, {
            get(qTarget, qProp, qReceiver) {
              if (qProp === 'businessProfile') {
                return {
                  ...qTarget.businessProfile,
                  findFirst: async (
                    ...args: Parameters<
                      typeof qTarget.businessProfile.findFirst
                    >
                  ) => {
                    if (firstRead) {
                      firstRead = false;
                      return undefined;
                    }
                    return qTarget.businessProfile.findFirst(...args);
                  },
                };
              }
              return Reflect.get(qTarget, qProp, qReceiver);
            },
          });
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const result = await classifyBusiness(blindDb as typeof db, {
      organizationId,
      reason: 'onboarding',
    });

    expect(result.success).toBe(true);

    const rows = await db
      .select()
      .from(businessProfile)
      .where(eq(businessProfile.organizationId, organizationId));

    // Still 1:1 with organization...
    expect(rows).toHaveLength(1);
    // ...the winner's owner overrides were not clobbered back to null...
    expect(rows[0].overriddenAxes).toMatchObject({ source: 'owner' });
    // ...and neither were the effective axes derived from them. The loser
    // classified WITHOUT these overrides, so writing its guess here would
    // leave a row carrying overrides that its own axes ignore.
    expect(rows[0].retentionModel).toBe('course_based');
    expect(rows[0].commitmentLevel).toBe('major');
    expect(rows[0].marketPosition).toBe('above');
    // inputHash is deliberately left stale so the row is not marked current:
    // the next classify fails isUpToDate and recomputes under the real
    // constraints. Marking it fresh here would strand the stale axes forever.
    expect(rows[0].inputHash).toBe('winner-hash');
  });
});
