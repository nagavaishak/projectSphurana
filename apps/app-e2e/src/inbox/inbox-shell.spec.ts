import { conversationList } from '../fixtures/app.js';
import { branchUrl } from '../fixtures/branch.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * The inbox shell.
 *
 * THE REGRESSION this exists for: the desktop conversation list is rendered by
 * `dashboard-layout-shell`, gated on a pathname check that read
 * `/dashboard/clients/inbox`. Every surface moved under
 * `/dashboard/l/<branch>/…`, so the check was permanently false and the list
 * silently vanished — the route only mounts the panel itself in its MOBILE arm,
 * so desktop users got an empty pane with no way to pick a conversation, and
 * every escalation email landed there.
 *
 * Viewport-agnostic: the two viewports render the list from different places,
 * and `conversationList()` owns that dispatch so this spec does not branch.
 */
test.describe('Inbox · shell', () => {
  test('a conversation list renders at both viewports', async ({ org }) => {
    const { page } = org;
    await page.goto(await branchUrl(page, '/dashboard/clients/inbox'), {
      waitUntil: 'domcontentloaded',
    });

    await expect(conversationList(page)).toBeVisible({ timeout: 30_000 });
  });
});
