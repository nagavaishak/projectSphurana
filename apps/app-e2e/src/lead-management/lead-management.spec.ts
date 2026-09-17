import {
  entityEditorSave,
  fillStable,
  listAction,
  listRow,
} from '../fixtures/app.js';
import { branchUrlPattern } from '../fixtures/branch.fixture.js';
import { branchUrl } from '../fixtures/index.js';
import { expect, test } from '../fixtures/org.fixture.js';

const TEST_RUN_ID = Date.now();

/**
 * Lead Management E2E Tests
 *
 * Real API tests — no mocking.
 *
 * Uses the PER-TEST `org` fixture rather than the shared bare-org storage
 * state. Every test here creates and deletes leads and then asserts on the
 * list, so sharing one org made them interfere: "can delete a lead" removed a
 * row a sibling was about to read, and which tests failed changed with the
 * order and the worker count. On the shared org the file passed only when run
 * alone. A fresh org per test makes each one deterministic and lets them run
 * in parallel again.
 *
 * Route: /dashboard/customers (the unified Clients surface — this suite used
 *        to target /dashboard/lead-management, which is now a redirect shim)
 *
 * Notes on apps/app surface:
 *   - The page has no visible "Clients" heading — only `<title>`
 *     sets the document title. We anchor on the Add Customer button.
 *   - The delete action in the row dropdown fires `deleteLead` immediately
 *     with no confirmation dialog; success surfaces as a sonner toast.
 *   - "Created" is also a column header, so any `/created/i` assertion must
 *     scope to `[data-sonner-toast]` to avoid a strict-mode violation.
 */

const gotoLeadManagement = async (page: import('@playwright/test').Page) => {
  // Vite dev served through the cloudflared tunnel can leave the `load`
  // event pending (HMR websocket keeps the page busy). Use
  // `domcontentloaded` so we don't hang waiting for `load`.
  await page.goto(await branchUrl(page, '/dashboard/customers'), {
    waitUntil: 'domcontentloaded',
  });
  // `listAction`: the ListPage header mounts a mobile and a desktop variant of
  // the same button, so the bare role query is a strict-mode violation.
  await listAction(page, /add customer/i).waitFor({ timeout: 30_000 });
};

/**
 * Find a seeded lead's row by searching for it.
 *
 * NOT by reloading and scanning page one. The Clients list defaults to the
 * "smart" sort, which ranks qualified → booked → unread-inbound → everyone
 * else, so a freshly-created lead lands in the LAST bucket and falls off page
 * one as soon as the org has a realistic number of leads. That passes on a
 * near-empty local database and fails in CI, where the bare org has
 * accumulated leads across runs. Searching narrows the query server-side, so
 * the row is found regardless of how many leads exist or how they rank.
 */
const findLeadRow = async (
  page: import('@playwright/test').Page,
  name: string
) => {
  await page.getByPlaceholder(/search clients/i).fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
};

test.describe('Lead Management', () => {
  test('page loads with create button', async ({ org }) => {
    const { page } = org;
    await gotoLeadManagement(page);
    await expect(listAction(page, /add customer/i)).toBeVisible();
  });

  test('lists a lead created through the API', async ({ org }) => {
    const { page, seed } = org;

    // Navigate first so the session cookie is attached to the API call.
    await gotoLeadManagement(page);

    // SEED the precondition. This asserted `locator('table')` with nothing
    // seeded, so it only passed when a NEIGHBOURING test happened to leave a
    // lead behind — green in a full run, red when run alone or reordered, and
    // asserting nothing about leads either way. Seeding it makes the test
    // deterministic and gives it a real subject.
    const firstName = `E2EList${TEST_RUN_ID}`;
    const result = (await seed.authenticatedApiCall('POST', '/leads', {
      firstName,
      lastName: 'Lead',
      email: `e2e.lead.list.${TEST_RUN_ID}@example.com`,
      source: 'manual',
    })) as { id?: string };
    expect(result?.id, 'POST /leads returned an id').toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(listRow(page, firstName)).toBeVisible({ timeout: 15_000 });
  });

  test('can create a new lead', async ({ org }) => {
    const { page, seed } = org;
    await gotoLeadManagement(page);

    // Creating a customer is a PAGE now (`/create/customer` on the unified
    // entity editor), not a dialog — so this drives the page and waits on its
    // heading rather than on `[role="dialog"]`.
    await test.step('open the create page', async () => {
      await listAction(page, /add customer/i).click();
      await page.waitForURL(/\/create\/customer/, { timeout: 10_000 });
      await expect(
        page.getByRole('heading', { level: 1, name: /add customer/i })
      ).toBeVisible();
    });

    const leadFirstName = `E2E Test ${TEST_RUN_ID}`;

    await test.step('fill form and submit', async () => {
      // `fillStable`, not `fill` — the entity editor re-renders after the first
      // field lands and a field filled inside that window comes back empty.
      // See the helper for the full diagnosis.
      await fillStable(
        page.getByRole('textbox', { name: /first name/i }),
        leadFirstName
      );
      await fillStable(
        page.getByRole('textbox', { name: /last name/i }),
        'Lead'
      );
      await fillStable(
        page.getByRole('textbox', { name: /^email$/i }),
        `e2e.test.lead.${TEST_RUN_ID}@example.com`
      );

      // `entityEditorSave`, not a name-based role query: BOTH save controls are
      // mounted (desktop chrome + mobile save bar), hidden from each other by
      // CSS rather than unmounted, and they carry DIFFERENT copy ("Save" vs
      // "Save Changes"). `/^save$/i` therefore matches only the desktop one and
      // clicks it even when the mobile bar is the one on screen — which is the
      // trap this hook exists to close.
      const submitBtn = entityEditorSave(page);
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.click();
    });

    // Success toast — scope to the sonner container so we don't collide with
    // the "Created" column header in the table.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /created/i })
    ).toBeVisible({ timeout: 15_000 });

    // Dialog closes via the hook's onSuccess.
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 10_000,
    });

    // Verify lead was persisted. The service title-cases names on write
    // ("E2E Test" → "E2e Test"), so match case-insensitively.
    const leads = (await seed.authenticatedApiCall('GET', '/leads')) as {
      items?: Array<{ id: string; firstName: string }>;
    };
    const created = (leads.items ?? []).find(
      (l) => l.firstName.toLowerCase() === leadFirstName.toLowerCase()
    );
    expect(created).toBeTruthy();
  });

  test('can view lead detail', async ({ org }) => {
    const { page, seed } = org;

    // Navigate first so the session cookie is attached to API calls.
    await gotoLeadManagement(page);

    const leadFirstName = `E2EDetail${TEST_RUN_ID}`;
    const result = (await seed.authenticatedApiCall('POST', '/leads', {
      firstName: leadFirstName,
      lastName: 'Lead',
      email: `e2e.lead.detail.${TEST_RUN_ID}@example.com`,
      source: 'manual',
    })) as { id?: string };

    // Seeding the precondition is part of the test: if POST /leads fails, the
    // lead API is broken and this test must fail, not skip.
    expect(result?.id, 'POST /leads returned an id').toBeTruthy();

    const row = await findLeadRow(page, leadFirstName);
    await row.click();

    // Row click navigates to the full client-profile page (the Leads → Clients
    // redesign replaced the old docked side panel). The identity header renders
    // the lead's name as the <h1>. Names are title-cased on write, so match
    // case-insensitively.
    await page.waitForURL(branchUrlPattern('customers/[^/]+$'), {
      timeout: 15_000,
    });
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: new RegExp(leadFirstName, 'i') })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('can update a lead from the detail sheet', async ({ org }) => {
    const { page, seed } = org;

    // Navigate first so the session cookie is attached to API calls.
    await gotoLeadManagement(page);

    const leadFirstName = `E2EUpd${TEST_RUN_ID}`;
    const result = (await seed.authenticatedApiCall('POST', '/leads', {
      firstName: leadFirstName,
      lastName: 'Lead',
      email: `e2e.lead.update.${TEST_RUN_ID}@example.com`,
      source: 'manual',
    })) as { id?: string };

    expect(result?.id, 'POST /leads returned an id').toBeTruthy();
    const leadId = result.id as string;

    const row = await findLeadRow(page, leadFirstName);
    await row.click();

    // Row click navigates to the client-profile page; the notes editor lives on
    // its "Details" tab (ported from the old lead sheet).
    await page.waitForURL(branchUrlPattern('customers/[^/]+$'), {
      timeout: 15_000,
    });
    await page.getByRole('tab', { name: /details/i }).click();

    const updatedNote = `Updated by E2E ${TEST_RUN_ID}`;

    await test.step('edit the notes field and save', async () => {
      const notes = page.getByRole('textbox', { name: /notes/i });
      await notes.scrollIntoViewIfNeeded();
      await notes.fill(updatedNote);
      await page.getByRole('button', { name: /save changes/i }).click();
    });

    // useUpdateLead surfaces a sonner success toast.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /updated/i })
    ).toBeVisible({ timeout: 15_000 });

    // Verify the change persisted via the API.
    const lead = (await seed.authenticatedApiCall(
      'GET',
      `/leads/${leadId}`
    )) as { notes?: string };
    expect(lead.notes).toBe(updatedNote);
  });

  test('can delete a lead', async ({ org }) => {
    const { page, seed } = org;

    // Navigate first so the session cookie is attached to API calls.
    await gotoLeadManagement(page);

    const leadFirstName = `E2EDel${TEST_RUN_ID}`;
    const result = (await seed.authenticatedApiCall('POST', '/leads', {
      firstName: leadFirstName,
      lastName: 'Lead',
      email: `e2e.lead.delete.${TEST_RUN_ID}@example.com`,
      source: 'manual',
    })) as { id?: string };

    expect(result?.id, 'POST /leads returned an id').toBeTruthy();

    const row = await findLeadRow(page, leadFirstName);

    await test.step('open actions menu and delete', async () => {
      await row.getByRole('button', { name: /open menu/i }).click();
      const deleteItem = page.getByRole('menuitem', { name: /delete/i });
      await deleteItem.waitFor({ state: 'visible', timeout: 5_000 });
      await deleteItem.click();
    });

    // useDeleteLead fires immediately — no confirm dialog. Wait for the
    // sonner success toast.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /deleted/i })
    ).toBeVisible({ timeout: 15_000 });
  });
});
