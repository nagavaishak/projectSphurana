/**
 * Proof shape 2 — `listLeads` PROJECTION (the `{ items, total, limit, offset }`
 * wrapper, hand-composed from the lead atom).
 *
 * Proves the list projection end-to-end: a `fixture(listLeadsResponseSchema, …)`
 * (whose `items` are validated by the lead atom) flows through the REAL
 * `useListLeads` hook — wired to `apiClient.get(path, { schema })` — into a
 * rendered component.
 */
import { renderWithProviders, screen } from '@/test/render';
import { fixture, listLeadsResponseSchema } from '@borradh-workspace/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aLeadListItem } from './base-lead';

// useListLeads → apiClient.get('leads?…'). Mock api-client so React Query
// resolves our schema-validated fixture exactly as production does.
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

import { useListLeads } from '@/features/leads/api/list-leads/list-leads.hook';

function LeadListHarness() {
  const { leads, total } = useListLeads();
  return (
    <div>
      <p>total: {total}</p>
      <ul>
        {leads.map((lead) => (
          <li key={lead.id}>
            {lead.firstName} {lead.lastName}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('listLeads projection contract', () => {
  beforeEach(() => get.mockReset());

  it('renders leads from a schema-validated list response', async () => {
    const response = fixture(listLeadsResponseSchema, {
      items: [
        aLeadListItem({ id: 'l1', firstName: 'Ada', lastName: 'Lovelace' }),
        aLeadListItem({ id: 'l2', firstName: 'Grace', lastName: 'Hopper' }),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    get.mockResolvedValue(response);

    renderWithProviders(<LeadListHarness />);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(await screen.findByText('Grace Hopper')).toBeTruthy();
    // The hook passed the list schema to apiClient.get.
    expect(get).toHaveBeenCalledWith(
      'leads',
      expect.objectContaining({ schema: listLeadsResponseSchema })
    );
  });

  it('the list wrapper requires items/total/limit/offset', () => {
    // A response missing `total` must not validate — the wrapper is the contract.
    expect(
      listLeadsResponseSchema.safeParse({ items: [], limit: 20, offset: 0 })
        .success
    ).toBe(false);
  });
});
