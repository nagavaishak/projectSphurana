import { expect, test } from '@playwright/test';
import { API_URL, SeedHelper } from '../fixtures/index.js';

/**
 * ENG-629 — lead-form reliability, end to end against the real API.
 *
 * Two invariants that only hold if the controller, the service and the schema
 * all agree, which is exactly what the unit tests (each mocking the others)
 * cannot prove:
 *
 *  1. A Meta sync failure is REPORTED, not swallowed. This runs on the BARE
 *     org, which has no Meta integration — the deterministic failure path. The
 *     old code returned the stale pre-sync draft, so the UI showed a clean
 *     "created" for a form that never reached Meta.
 *  2. The WhatsApp pairing (channel=whatsapp ⇒ a number) survives a PARTIAL
 *     update. The stateless schema refine only sees the payload, so a PUT that
 *     blanks the number without resending the channel would otherwise write the
 *     exact forbidden state.
 *
 * Every request goes through the browser's session cookies, so these exercise
 * auth + org scoping + validation + persistence, not just the service.
 */

const TEST_RUN_ID = Date.now();

const baseForm = (name: string) => ({
  name,
  questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }, { type: 'PHONE' }],
  privacyPolicyUrl: 'https://example.com/privacy',
});

/** Remove a form this run created, so the bare org doesn't accumulate them. */
const deleteForm = async (
  page: import('@playwright/test').Page,
  id: string
) => {
  await page.request
    .fetch(`${API_URL}/lead-forms/${id}`, {
      method: 'DELETE',
      timeout: 60_000,
    })
    .catch(() => undefined);
};

test.describe('Lead forms — sync + WhatsApp reliability', () => {
  test('a failed Meta sync comes back as an error row, not a clean draft', async ({
    page,
    request,
  }) => {
    // Establish the session cookies the API calls ride on.
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard/marketing/lead-forms');

    const response = await page.request.fetch(`${API_URL}/lead-forms`, {
      method: 'POST',
      data: {
        ...baseForm(`E2E sync-fail ${TEST_RUN_ID}`),
        // The bare org has no Meta integration, so this sync cannot succeed.
        syncToMeta: true,
      },
      timeout: 60_000,
    });

    // The form IS created — the failure is the SYNC, not the write.
    expect(response.status()).toBe(201);
    const form = (await response.json()) as {
      id: string;
      status: string;
      syncError: string | null;
      metaFormId: string | null;
    };

    expect(form.status).toBe('error');
    expect(form.syncError).toBeTruthy();
    expect(form.metaFormId).toBeNull();

    // And the honest state is what was PERSISTED, not just what this one
    // response happened to say.
    const reread = await page.request.fetch(
      `${API_URL}/lead-forms/${form.id}`,
      { timeout: 60_000 }
    );
    const persisted = (await reread.json()) as {
      status: string;
      syncError: string | null;
    };
    expect(persisted.status).toBe('error');
    expect(persisted.syncError).toBe(form.syncError);

    await deleteForm(page, form.id);
  });

  test('rejects a WhatsApp follow-up channel with no number', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard/marketing/lead-forms');

    const response = await page.request.fetch(`${API_URL}/lead-forms`, {
      method: 'POST',
      data: {
        ...baseForm(`E2E wa-missing ${TEST_RUN_ID}`),
        followUpChannel: 'whatsapp',
      },
      timeout: 60_000,
    });

    expect(response.status()).toBe(400);

    // Nothing was created behind the rejection.
    const list = (await page.request
      .fetch(`${API_URL}/lead-forms?limit=100`, { timeout: 60_000 })
      .then((r) => r.json())) as { items: Array<{ name: string }> };
    expect(
      list.items.some((f) => f.name === `E2E wa-missing ${TEST_RUN_ID}`)
    ).toBe(false);
  });

  test('a partial update cannot blank the number on a WhatsApp form', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    await seed.gotoDashboardPage('/dashboard/marketing/lead-forms');

    const createResponse = await page.request.fetch(`${API_URL}/lead-forms`, {
      method: 'POST',
      data: {
        ...baseForm(`E2E wa-partial ${TEST_RUN_ID}`),
        followUpChannel: 'whatsapp',
        whatsappNumber: '+353851234567',
      },
      timeout: 60_000,
    });
    expect(createResponse.status()).toBe(201);
    const form = (await createResponse.json()) as {
      id: string;
      whatsappNumber: string;
    };
    expect(form.whatsappNumber).toBe('+353851234567');

    // The payload omits followUpChannel entirely — only the merged state shows
    // this would leave a WhatsApp form with no number.
    const update = await page.request.fetch(
      `${API_URL}/lead-forms/${form.id}`,
      { method: 'PUT', data: { whatsappNumber: '' }, timeout: 60_000 }
    );
    expect(update.status()).toBe(400);

    // The rejection must be a rejection: the stored number is untouched.
    const reread = (await page.request
      .fetch(`${API_URL}/lead-forms/${form.id}`, { timeout: 60_000 })
      .then((r) => r.json())) as {
      followUpChannel: string;
      whatsappNumber: string;
    };
    expect(reread.followUpChannel).toBe('whatsapp');
    expect(reread.whatsappNumber).toBe('+353851234567');

    await deleteForm(page, form.id);
  });

  test('the lead forms page lists a form created through the API', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);
    const name = `E2E listed ${TEST_RUN_ID}`;

    const response = await page.request.fetch(`${API_URL}/lead-forms`, {
      method: 'POST',
      data: baseForm(name),
      timeout: 60_000,
    });
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };

    await seed.gotoDashboardPage('/dashboard/marketing/lead-forms');

    await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });

    await deleteForm(page, id);
  });
});
