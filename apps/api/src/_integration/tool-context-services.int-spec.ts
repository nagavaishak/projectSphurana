/**
 * TIER 3 — `context_listServices` / `context_getServiceDetails` driven over a
 * REAL socket against a REAL Postgres.
 *
 * These are the first two tool integration tests, and they exist because of a
 * specific defect: `listServices` mapped `pricingDescription`, which is not a
 * column on `organization_service` (the columns are `priceText`, `priceType`,
 * `priceCents`). It reported `null` pricing for every service on every call,
 * for months, with a fully green unit suite — because the unit test MOCKED
 * `apiFetch` and returned a `pricingDescription` field, encoding the same
 * misconception as the code it was testing.
 *
 * No mock can catch that. The only thing that can is a dependency nobody's
 * belief controls: a real HTTP round trip to a real controller reading a real
 * table. That is what `buildToolApp` provides, and what this spec asserts.
 *
 * The load-bearing assertion is not "the tool returns something" — it is that
 * the price the tool reports is the price that is IN THE DATABASE.
 */
import { db, organizationService } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import { getServiceDetailsTool } from '../assistant/tools/context/get-service-details.tool.js';
import { listServicesTool } from '../assistant/tools/context/list-services.tool.js';
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import { seedOrgWithMember, seedService } from './harness.js';
import { type ToolIntegrationApp, buildToolApp } from './tool-harness.js';

describe('TIER 3 — context service tools (real HTTP, real Postgres)', () => {
  let harness: ToolIntegrationApp;

  afterEach(async () => {
    await harness?.close();
  });

  it('listServices reports the price that is actually stored', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const serviceId = await seedService({
      organizationId,
      name: 'Lip Filler',
    });
    // Set a real, checkable price. `seedService` leaves pricing at defaults.
    await db
      .update(organizationService)
      .set({ priceType: 'from', priceCents: 25_000, priceText: 'From €250' })
      .where(eq(organizationService.id, serviceId));

    harness = await buildToolApp([OrganizationServicesController], {
      userId,
      organizationId,
    });

    const result = await listServicesTool.execute(
      {},
      harness.contextFor(listServicesTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');

    const service = result.data.services.find((s) => s.id === serviceId);
    expect(service).toBeDefined();

    // THE REGRESSION. Before the fix these were absent entirely and the tool
    // reported `pricingDescription: null` — a field the API never sent.
    expect(service?.priceType).toBe('from');
    expect(service?.priceCents).toBe(25_000);
    expect(service?.priceText).toBe('From €250');
    expect(service).not.toHaveProperty('pricingDescription');
  });

  it('listServices parses the response, so a contract break is loud', async () => {
    // The tool now passes `listServicesResponseSchema` to apiFetch. If the
    // endpoint ever stops returning `items`/`total`/`limit`/`offset`, or a
    // service row loses a declared column, this call throws
    // ApiResponseContractError instead of silently yielding undefined — which
    // is the behaviour the whole tier-2 change exists to buy.
    const { organizationId, userId } = await seedOrgWithMember('owner');
    await seedService({ organizationId, name: 'Consultation' });

    harness = await buildToolApp([OrganizationServicesController], {
      userId,
      organizationId,
    });

    const result = await listServicesTool.execute(
      {},
      harness.contextFor(listServicesTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    expect(result.data.total).toBeGreaterThanOrEqual(1);
    expect(result.data.services.every((s) => typeof s.name === 'string')).toBe(
      true
    );
  });

  it('getServiceDetails returns the stored row for a real service', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const serviceId = await seedService({
      organizationId,
      name: 'Skin Consult',
    });
    await db
      .update(organizationService)
      .set({ priceType: 'poa', priceCents: null })
      .where(eq(organizationService.id, serviceId));

    harness = await buildToolApp([OrganizationServicesController], {
      userId,
      organizationId,
    });

    const result = await getServiceDetailsTool.execute(
      { serviceId },
      harness.contextFor(getServiceDetailsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    expect(result.data.id).toBe(serviceId);
    expect(result.data.name).toBe('Skin Consult');
    expect(result.data.priceType).toBe('poa');
    expect(result.data.priceCents).toBeNull();
  });

  it('getServiceDetails does not reach across organizations', async () => {
    const orgA = await seedOrgWithMember('owner');
    const orgB = await seedOrgWithMember('owner');
    const orgBService = await seedService({
      organizationId: orgB.organizationId,
      name: 'Not Yours',
    });

    harness = await buildToolApp([OrganizationServicesController], {
      userId: orgA.userId,
      organizationId: orgA.organizationId,
    });

    const result = await getServiceDetailsTool.execute(
      { serviceId: orgBService },
      harness.contextFor(getServiceDetailsTool)
    );

    // The service WHERE clause is `id AND organizationId`, so this 404s and
    // the tool surfaces a failure rather than another org's row.
    expect(result.ok).toBe(false);
  });
});
