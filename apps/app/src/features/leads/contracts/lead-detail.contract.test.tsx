/**
 * Proof shape 3 — `leadDetail` PROJECTION (the lead atom extended with the
 * computed/joined `sourceLeadForm`).
 *
 * Proves the detail projection end-to-end: a `fixture(leadDetailSchema, …)`
 * flows through the REAL `useLead` hook — wired to `apiClient.get(path, { schema:
 * leadDetailSchema })` — into a rendered component that reads both an atom field
 * and the projection-only `sourceLeadForm` join.
 */
import { renderWithProviders, screen } from '@/test/render';
import {
  type LeadDetail,
  fixture,
  leadDetailSchema,
} from '@borradh-workspace/contracts';
import { describe, expect, it, vi } from 'vitest';
import { aLead } from './base-lead';

const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

import { useLead } from '@/features/leads/api/get-lead/get-lead.hook';

function LeadDetailHarness({ leadId }: { leadId: string }) {
  const { lead, isLoading } = useLead({ leadId });
  if (isLoading || !lead) return <div>loading…</div>;
  return (
    <div>
      <h3>{lead.firstName}</h3>
      <span>form: {lead.sourceLeadForm?.name ?? 'none'}</span>
    </div>
  );
}

function aLeadDetail(overrides?: Partial<LeadDetail>): LeadDetail {
  return fixture(leadDetailSchema, {
    ...aLead(),
    sourceLeadForm: { id: 'form_1', name: 'Instagram Promo' },
    ...overrides,
  });
}

describe('leadDetail projection contract', () => {
  it('renders atom + joined sourceLeadForm from a schema-validated fixture', async () => {
    get.mockResolvedValue(aLeadDetail({ firstName: 'Ada' }));

    renderWithProviders(<LeadDetailHarness leadId="lead_1" />);

    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(await screen.findByText(/Instagram Promo/)).toBeTruthy();
    // The hook requested the detail endpoint.
    expect(get).toHaveBeenCalledWith(
      'leads/lead_1',
      expect.objectContaining({ schema: leadDetailSchema })
    );
  });

  it('accepts a null sourceLeadForm (non-meta leads)', () => {
    expect(
      leadDetailSchema.safeParse({ ...aLead(), sourceLeadForm: null }).success
    ).toBe(true);
  });

  it('rejects a detail response missing the sourceLeadForm join', () => {
    // The atom alone is not a valid detail projection.
    expect(leadDetailSchema.safeParse(aLead()).success).toBe(false);
  });
});
