import { db, member, organization, user } from '@borradh-workspace/database';
import { eq, inArray } from 'drizzle-orm';
/**
 * `/testing/cleanup` — reaping throwaway E2E users must not destroy the
 * long-lived orgs they were merely GUESTS in.
 *
 * THE BUG THIS PINS (it really happened, and it took the whole suite down):
 *
 * `cleanupByEmailPattern` used to select "every organization these users are a
 * MEMBER of" and DELETE those orgs. That is the wrong contract. Cleanup's job is
 * to delete what the throwaway users CREATED — not every org they ever touched.
 *
 * `journeys/practitioner-booking.spec.ts` proves `POST /practitioners` is
 * owner-only by inviting a real non-owner (`e2e.test.nonowner.*`) into the
 * SHARED BARE ORG and asserting the 403. The moment that ran, global teardown
 * matched the invitee, walked their memberships to the bare org, and cascaded
 * the bare org out of existence. The bare OWNER survived — their email doesn't
 * match `e2e.test.%` — so the next run signed in perfectly, found ZERO
 * organizations, and got routed into the new-user `/welcome` deck. Setup then
 * hung waiting for a dashboard sidebar that was never going to render.
 *
 * The suite destroyed its own fixture, permanently, and then failed in a way
 * that looked like an auth bug, a memory bug, and an RLS bug in turn.
 *
 * A non-owner membership needs no explicit cleanup: `member.user_id` is
 * ON DELETE CASCADE, so deleting the user removes the row and leaves the host
 * org standing. That is asserted below.
 */
import { TestingService } from '../testing/testing.service.js';
import { seedMember, seedOrganization, seedUser } from './harness.js';

describe('/testing/cleanup — deletes what test users OWN, not what they VISIT', () => {
  const service = new TestingService();

  // Unique per run so a real `e2e.test.%` sweep can't collide with a parallel one.
  const stamp = Date.now();
  const pattern = `e2e.test.cleanupspec.${stamp}.%`;

  it('reaps a throwaway-OWNED org but spares a shared org the throwaway only joined', async () => {
    // The durable fixture: a long-lived org whose owner is NOT a test user.
    // This models the shared bare org.
    const durableOrgId = await seedOrganization();
    const durableOwner = await seedUser({
      email: `durable.owner.${stamp}@borradh.test`,
    });
    await seedMember({
      organizationId: durableOrgId,
      userId: durableOwner.id,
      role: 'owner',
    });

    // A throwaway user who OWNS their own org — this one SHOULD be reaped.
    const ownedOrgId = await seedOrganization();
    const throwawayOwner = await seedUser({
      email: `e2e.test.cleanupspec.${stamp}.owner@example.com`,
    });
    await seedMember({
      organizationId: ownedOrgId,
      userId: throwawayOwner.id,
      role: 'owner',
    });

    // A throwaway user who is a mere GUEST of the durable org — exactly the
    // invited non-owner from practitioner-booking.spec.ts. Reaping this user
    // must NOT take the durable org with it.
    const throwawayGuest = await seedUser({
      email: `e2e.test.cleanupspec.${stamp}.nonowner@example.com`,
    });
    await seedMember({
      organizationId: durableOrgId,
      userId: throwawayGuest.id,
      role: 'member',
    });

    const result = await service.cleanupByEmailPattern(pattern);
    expect(result.success).toBe(true);

    // The org the throwaway OWNED is gone.
    const owned = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, ownedOrgId));
    expect(owned).toHaveLength(0);

    // THE REGRESSION: the shared org the throwaway merely JOINED still exists.
    const durable = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, durableOrgId));
    expect(durable).toHaveLength(1);

    // ...and its owner still belongs to it, so they still land on the dashboard
    // instead of being mistaken for a brand-new user and sent to /welcome.
    const ownerMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, durableOwner.id));
    expect(ownerMembership).toHaveLength(1);

    // Both throwaway users are reaped, and the guest's membership row went with
    // them via ON DELETE CASCADE — no orphan left behind in the durable org.
    const survivors = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, [throwawayOwner.id, throwawayGuest.id]));
    expect(survivors).toHaveLength(0);

    const guestMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, throwawayGuest.id));
    expect(guestMembership).toHaveLength(0);
  });
});
