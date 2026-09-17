import { db, organizationLocation } from '@borradh-workspace/database';
// The ROOT entry, not `/shared`: that subpath is the FRONTEND-SAFE barrel
// (`shared/public.ts`), and `nativeBookingLink` reaches `apiEnv` and the
// observability logger. Re-exporting it there pulled node:net/node:tls into the
// SPA bundle and broke the Vite build. The root entry re-exports the full
// server-side shared barrel, which is what an API-side test should use.
import { nativeBookingLink } from '@borradh-workspace/features';
import { resolveConversationBranch } from '@borradh-workspace/features/conversations';
import { branchSegmentFor } from '@borradh-workspace/web-shared';
import { eq } from 'drizzle-orm';
/**
 * The booking link Claire sends must name the SAME branch whose prices she just
 * quoted.
 *
 * These two halves live apart and only agree through rows, which is why this is
 * asserted against a real database rather than mocked. `resolveConversationBranch`
 * reads the org's locations to decide which branch a conversation is about;
 * `nativeBookingLink` builds the URL. They were shipped out of step: the
 * per-service links carried the branch while the generic "here's the link to
 * book in" one did not, so a single-branch clinic sent customers to the org-level
 * entry and a multi-branch one dropped them on the chooser right after being
 * quoted one branch's price. It cost a redirect at best and the booking at worst,
 * and the connected-chatbot E2E lane caught it only after the fact.
 *
 * The precedence being pinned is `resolveConversationBranch`'s own, and the
 * NULL arm matters as much as the resolved one: an org with several branches and
 * no ad signal must NOT have a branch guessed for it. Stamping the primary there
 * would put a real-looking branch on a conversation nobody said anything about.
 */
import { seedLocation, seedOrganization } from './harness.js';

/** The path tier — no custom domain, so links carry `/sites/{slug}`. */
const NO_CUSTOM_DOMAIN = null;

/**
 * The origin the builder composes on, taken from the environment rather than
 * hardcoded: this suite runs with its own MARKETING_URL and the point of these
 * assertions is the PATH, not which host the harness happens to use.
 */
const MARKETING = process.env.MARKETING_URL ?? process.env.WEB_URL ?? '';

async function branchLinkFor(input: {
  organizationId: string;
  slug: string;
}): Promise<string | null> {
  const locationId = await resolveConversationBranch(db, {
    organizationId: input.organizationId,
  });

  const location = locationId
    ? await db.query.organizationLocation.findFirst({
        where: eq(organizationLocation.id, locationId),
      })
    : null;

  return nativeBookingLink(
    { slug: input.slug },
    NO_CUSTOM_DOMAIN,
    location ? branchSegmentFor(location) : null
  );
}

describe("Claire's booking link names the branch she quoted", () => {
  it('scopes the link to the one branch a single-branch org has', async () => {
    const slug = `clinic-${Date.now()}`;
    const organizationId = await seedOrganization({ slug });
    const locationId = await seedLocation({ organizationId, isPrimary: true });

    const link = await branchLinkFor({ organizationId, slug });

    // The branch has no slug of its own yet (nullable, backfill pending), so
    // the handle is its id — the same fallback `branchSegmentFor` gives the
    // app's own links.
    expect(link).toBe(`${MARKETING}/sites/${slug}/l/${locationId}/book`);
  });

  it('never emits the retired /book/l/ ordering, which only resolves via a 301', async () => {
    // A link Claire sends a customer should not spend a redirect, nor depend on
    // one existing — on a preview it does not.
    const slug = `clinic-${Date.now()}-shape`;
    const organizationId = await seedOrganization({ slug });
    await seedLocation({ organizationId, isPrimary: true });

    const link = await branchLinkFor({ organizationId, slug });

    expect(link).not.toContain('/book/l/');
    expect(link).toMatch(/\/sites\/[^/]+\/l\/[^/]+\/book$/);
  });

  it('names NO branch when the org has several and nothing said which', async () => {
    const slug = `clinic-${Date.now()}-multi`;
    const organizationId = await seedOrganization({ slug });
    await seedLocation({ organizationId, name: 'Dublin', isPrimary: true });
    await seedLocation({ organizationId, name: 'Cork', isPrimary: false });

    const link = await branchLinkFor({ organizationId, slug });

    // The un-branched entry, which renders the chooser. Guessing the primary
    // here would be a real-looking branch nobody chose.
    expect(link).toBe(`${MARKETING}/sites/${slug}/book`);
  });

  it('has no link at all for an org with no slug, rather than a broken one', async () => {
    // A native org must never fall back to a stale external booking link, and a
    // slugless org cannot be addressed on the path tier at all.
    const organizationId = await seedOrganization({
      slug: `unused-${Date.now()}`,
    });
    await seedLocation({ organizationId, isPrimary: true });

    const locationId = await resolveConversationBranch(db, { organizationId });
    expect(locationId).toBeTruthy();

    expect(
      nativeBookingLink({ slug: null }, NO_CUSTOM_DOMAIN, locationId)
    ).toBeNull();
  });
});
