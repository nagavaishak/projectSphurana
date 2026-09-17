import { db, lead } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
/**
 * TIER 3 — lead tools driven over a REAL socket against a REAL Postgres.
 *
 * Every lead tool now passes a contracts schema to `apiFetch`, so a shape the
 * endpoint does not actually return throws `ApiResponseContractError` here
 * rather than yielding `undefined` in production. The unit specs cannot show
 * that: their `apiFetch` is a `jest.fn` that never parses, so they agree with
 * whatever the author believed. These assert against rows that are really in
 * the database.
 *
 * Deliberately asserting VALUES, not just shapes. "The tool returned an
 * object" is the assertion that let a tool report null pricing for months.
 */
import { createLeadTool } from '../assistant/tools/leads/create-lead.tool.js';
import { getLeadStatsTool } from '../assistant/tools/leads/get-lead-stats.tool.js';
import { listLeadsTool } from '../assistant/tools/leads/list-leads.tool.js';
import { searchLeadsTool } from '../assistant/tools/leads/search-leads.tool.js';
import { summariseRecentLeadsTool } from '../assistant/tools/leads/summarise-recent-leads.tool.js';
import { LeadsController } from '../leads/leads.controller.js';
import { seedLead, seedOrgWithMember } from './harness.js';
import { type ToolIntegrationApp, buildToolApp } from './tool-harness.js';

describe('TIER 3 — lead tools (real HTTP, real Postgres)', () => {
  let harness: ToolIntegrationApp;

  afterEach(async () => {
    await harness?.close();
  });

  it('listLeads returns leads that exist and parses the list envelope', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    const leadId = await seedLead({ organizationId, firstName: 'Aoife' });

    harness = await buildToolApp([LeadsController], { userId, organizationId });

    const result = await listLeadsTool.execute(
      { limit: 25, offset: 0 },
      harness.contextFor(listLeadsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');

    const found = result.data.leads.find((l) => l.id === leadId);
    expect(found).toBeDefined();
    expect(found?.firstName).toBe('Aoife');
    // limit/offset are echoed by the controller; the schema requires them, and
    // the tool no longer falls back to its own input for these.
    expect(result.data.limit).toBe(25);
    expect(result.data.offset).toBe(0);
  });

  it('listLeads does not leak another organization’s leads', async () => {
    const orgA = await seedOrgWithMember('owner');
    const orgB = await seedOrgWithMember('owner');
    const orgBLead = await seedLead({
      organizationId: orgB.organizationId,
      firstName: 'Hidden',
    });

    harness = await buildToolApp([LeadsController], {
      userId: orgA.userId,
      organizationId: orgA.organizationId,
    });

    const result = await listLeadsTool.execute(
      { limit: 50, offset: 0 },
      harness.contextFor(listLeadsTool)
    );

    if (!result.ok) throw new Error(`tool failed: ${JSON.stringify(result)}`);
    if (!result.data) throw new Error('tool returned no data');
    expect(result.data.leads.some((l) => l.id === orgBLead)).toBe(false);
  });

  it('searchLeads finds a lead by name through the real query path', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    await seedLead({ organizationId, firstName: 'Siobhan' });
    await seedLead({ organizationId, firstName: 'Padraig' });

    harness = await buildToolApp([LeadsController], { userId, organizationId });

    const result = await searchLeadsTool.execute(
      { query: 'Siobhan', limit: 10 },
      harness.contextFor(searchLeadsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    expect(result.data.matchCount).toBeGreaterThanOrEqual(1);
    expect(result.data.matches.some((m) => m.firstName === 'Siobhan')).toBe(
      true
    );
    expect(result.data.matches.some((m) => m.firstName === 'Padraig')).toBe(
      false
    );
  });

  it('getLeadStats counts the leads that are really in the table', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    await seedLead({ organizationId, firstName: 'One' });
    await seedLead({ organizationId, firstName: 'Two' });

    harness = await buildToolApp([LeadsController], { userId, organizationId });

    const result = await getLeadStatsTool.execute(
      {},
      harness.contextFor(getLeadStatsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');
    // The value, not just the key. Every field on leadStatsSchema is required,
    // so a renamed/absent one is a parse failure rather than a silent zero.
    expect(result.data.totalLeads).toBe(2);
    expect(typeof result.data.conversionRate).toBe('number');
  });

  it('summariseRecentLeads parses the rollup, incl. its open-record aggregates', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');
    await seedLead({ organizationId, firstName: 'Recent' });

    harness = await buildToolApp([LeadsController], { userId, organizationId });

    const result = await summariseRecentLeadsTool.execute(
      { timeframe: 'month', limit: 5 },
      harness.contextFor(summariseRecentLeadsTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');

    // `GET /leads/summary` had NO response schema before this branch; this is
    // the first execution that proves the one now declared actually matches
    // what the service returns.
    expect(result.data.timeframe).toBe('month');
    expect(result.data.totalLeads).toBeGreaterThanOrEqual(1);
    expect(typeof result.data.byStatus).toBe('object');
    expect(typeof result.data.bySource).toBe('object');
    expect(Array.isArray(result.data.topLeads)).toBe(true);
  });

  it('createLead writes a row that is really in the table', async () => {
    const { organizationId, userId } = await seedOrgWithMember('owner');

    harness = await buildToolApp([LeadsController], { userId, organizationId });

    // `createLead` is destructive: the first call issues a confirmation token
    // and writes nothing, the second executes. The harness grants confirmation
    // (a human-in-the-loop gate, not part of the API contract under test), so
    // passing a token exercises the write path.
    const result = await createLeadTool.execute(
      {
        firstName: 'Niamh',
        lastName: 'Byrne',
        email: 'niamh.byrne@example.test',
        confirmationToken: 'int-token',
      },
      harness.contextFor(createLeadTool)
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error('tool returned no data');

    // Read back from Postgres. The tool reporting a created lead is not the
    // same claim as a lead existing, and only one of those is checkable here.
    const rows = await db
      .select()
      .from(lead)
      .where(eq(lead.id, result.data.leadId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstName).toBe('Niamh');
    expect(rows[0]?.organizationId).toBe(organizationId);
  });
});
