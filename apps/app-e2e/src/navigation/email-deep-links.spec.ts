import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Links the SERVER sends into the dashboard — the ones that ride in email and
 * push notifications — must land on a real surface.
 *
 * THE BUG THIS EXISTS FOR. Five call sites built
 * `/dashboard/conversations/{id}`, with the conversation id as a PATH SEGMENT.
 * No route has matched that shape since branch-scoping moved every surface to
 * `/dashboard/l/:branch/…`: `dashboard/conversations.tsx` takes the id as a
 * SEARCH param, so the path fell through to the compatibility splat, which
 * forwarded it to `/dashboard/l/{branch}/conversations/{id}` — which nothing
 * serves. Every escalation alert, follow-up-required email and stuck-
 * conversation digest pointed at a dead page, for months, silently.
 *
 * WHY THE UNIT TESTS DID NOT CATCH IT. They asserted the string the service
 * built against the same string the service built:
 *
 *     expect(props.dashboardUrl).toBe(`${APP_URL}/dashboard/conversations/${id}`)
 *
 * That is a tautology. It pins the shape without ever asking whether the shape
 * resolves, and it stayed green while the link was dead. The only thing that
 * can answer "does this URL open a page" is a browser pointed at the app, which
 * is why this file is an e2e spec and not a unit test.
 *
 * WHY THE PATHS ARE SPELLED OUT HERE. Deriving them from
 * `conversationInboxPath` in `@borradh-workspace/features/shared` would be
 * stronger, but this package deliberately carries no workspace dependencies —
 * importing `features` would drag `database`/`postgres` into the Playwright
 * process. The builder's SHAPE is pinned next to it in
 * `packages/features/src/shared/dashboard-links.test.ts`; what is pinned here
 * is that the shape RESOLVES. Neither test is sufficient alone.
 *
 * These are also the reason `dashboard/$.tsx` and `dashboard/conversations.tsx`
 * cannot be deleted with the rest of the compatibility shims: a conversation
 * has no `location_id`, so the server has no branch to name, and mail already
 * in someone's inbox cannot be rewritten.
 */

/** A conversation id shaped like the real ones, so encoding is exercised. */
const CONVERSATION_ID = 'conv_e2e_deep_link_1';

interface ServerLink {
  name: string;
  /** Exactly what the server puts in the mail. */
  path: string;
  /** Where the user must end up, as a branch-scoped path fragment. */
  landsOn: RegExp;
  /** Emitters that build this, so a failure names what to go and fix. */
  builtBy: string;
}

const SERVER_LINKS: ServerLink[] = [
  {
    // Keep names SHORT: the `org` fixture derives the provisioned org's
    // name from the test title, and the API caps it.
    name: 'conversation link',
    path: `/dashboard/conversations?id=${CONVERSATION_ID}`,
    landsOn: new RegExp(
      `/dashboard/l/[^/]+/clients/inbox\\?id=${CONVERSATION_ID}`
    ),
    builtBy: 'conversationInboxUrl / conversationInboxPath (features/shared)',
  },
  {
    name: 'digest recommendations link',
    path: '/dashboard/home',
    landsOn: /\/dashboard\/l\/[^/]+\/home/,
    builtBy: 'WeeklyDigestEmail',
  },
  {
    name: 'digest campaigns link',
    path: '/dashboard/marketing/advertising',
    landsOn: /\/dashboard\/l\/[^/]+\/marketing\/advertising/,
    builtBy: 'WeeklyDigestEmail',
  },
];

test.describe('server-emitted dashboard deep links', () => {
  for (const link of SERVER_LINKS) {
    test(`${link.name} resolves to a real surface`, async ({ org }) => {
      const { page } = org;

      await page.goto(link.path, { waitUntil: 'domcontentloaded' });

      // Wait for the branch to be resolved and the redirect to settle. The
      // resolver awaits the locations query, so the landing URL is not
      // available synchronously.
      await expect(
        page,
        `${link.path} did not reach a branch-scoped surface.\nBuilt by: ${link.builtBy}\nEither the emitter is building a shape the app no longer serves, or the route it targets has moved.`
      ).toHaveURL(link.landsOn, { timeout: 30_000 });

      // A redirect landing somewhere is not enough — `/dashboard/l/x/anything`
      // renders the 404 inside the app chrome, which still "navigated".
      await expect(
        page.getByText('Page not found', { exact: false }),
        `${link.path} redirected but landed on the in-app 404.`
      ).toHaveCount(0);
    });
  }

  test('legacy path link never lands on an empty inbox', async ({ org }) => {
    const { page } = org;

    // The exact shape the emitters used to build. Today it does not resolve,
    // which is why they were changed. The regression to guard against is a
    // future "fix" that makes it resolve by dropping the id — landing the user
    // on the inbox with nothing open is the same dead end in a nicer costume,
    // and it would look like a pass to any test that only checked the URL
    // changed.
    await page.goto(`/dashboard/conversations/${CONVERSATION_ID}`, {
      waitUntil: 'domcontentloaded',
    });

    // Wait for the app chrome, NOT for `networkidle`.
    //
    // The URL has to be allowed to settle before it is asserted on, because any
    // redirect this link triggers happens in a route `beforeLoad` that awaits
    // the locations query — assert too early and you are reading the URL the
    // browser was handed, not the one it ended up on. `networkidle` settled it
    // but is an indeterminate wait, which this suite bans for good reason.
    //
    // EITHER shell counts. This spec runs in `tabs` AND `tabs-mobile`, and the
    // two render different chrome: the sidebar is desktop-only, so waiting on it
    // alone passes on desktop and times out on a Pixel 7 — which is exactly how
    // this test broke on the mobile lane after the first attempt at removing
    // `networkidle`. Not skipped on mobile, because the thing under test is URL
    // resolution and that is identical on both.
    await page
      .locator('[data-sidebar="menu-button"], [data-mobile-bottom-tabs]')
      .first()
      .waitFor();

    // One regex rather than two checks combined with `&&`, because the suite's
    // ESLint bans conditionals in a test body — and rightly: branching is how a
    // test quietly stops asserting anything.
    //
    // Matches an inbox URL carrying no `id` search param: bare `/clients/inbox`,
    // or one whose query string has no `id=` in it.
    const INBOX_WITH_NOTHING_OPEN = /\/clients\/inbox(?:\?(?!.*\bid=)[^#]*)?$/;

    await expect(
      page,
      'The legacy path-segment link now reaches the inbox but has dropped the ' +
        'conversation id. Forward the id (see dashboard/conversations.tsx, ' +
        'which forwards `search`) or leave the link unresolved — an inbox with ' +
        'nothing selected is the bug this file exists for.'
    ).not.toHaveURL(INBOX_WITH_NOTHING_OPEN);
  });
});
