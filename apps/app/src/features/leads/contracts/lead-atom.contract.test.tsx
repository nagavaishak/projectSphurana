/**
 * Proof shape 1 — `lead` ATOM (generated, 1:1 with the DB table).
 *
 * Proves:
 *  - the generated `leadSchema` validates a wire-shaped lead (fixture built via
 *    `defineFixture` fails to construct if it drifts from the contract);
 *  - a schema-validated fixture renders through the app's component-test harness;
 *  - the SAME schema, at runtime, reports on drift (report mode) and throws on
 *    it (strict mode) — the two behaviours `apiClient` gates behind the flags.
 */
import { renderWithProviders, screen } from '@/test/render';
import {
  ResponseParseError,
  parseResponse,
  setResponseParseConfig,
} from '@borradh-workspace/api-client';
import { type Lead, leadSchema } from '@borradh-workspace/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aLead } from './base-lead';

// A tiny presentational consumer — renders a couple of atom fields so the
// schema-validated fixture flows through the real render harness.
function LeadCard({ lead }: { lead: Lead }) {
  return (
    <div>
      <h3>
        {lead.firstName} {lead.lastName}
      </h3>
      <p>{lead.email}</p>
      <span>{lead.status}</span>
    </div>
  );
}

describe('lead atom contract', () => {
  afterEach(() => setResponseParseConfig({}));

  it('renders a schema-validated lead fixture', () => {
    const lead = aLead({ firstName: 'Grace', lastName: 'Hopper' });
    renderWithProviders(<LeadCard lead={lead} />);

    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
  });

  it('the fixture is exactly what the schema accepts', () => {
    expect(leadSchema.safeParse(aLead()).success).toBe(true);
  });

  it('rejects drift — a Date instead of an ISO string for createdAt', () => {
    const drifted = { ...aLead(), createdAt: new Date() };
    expect(leadSchema.safeParse(drifted).success).toBe(false);
  });

  it('report mode: passes raw data through and logs the failure (non-fatal)', () => {
    const onParseError = vi.fn();
    setResponseParseConfig({ isStrict: () => false, onParseError });

    const drifted = { ...aLead(), createdAt: new Date() } as unknown as Lead;
    const result = parseResponse('leads/lead_1', drifted, leadSchema);

    expect(result).toBe(drifted); // raw passthrough
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError.mock.calls[0][0].endpoint).toBe('leads/lead_1');
  });

  it('strict mode: throws a ResponseParseError on drift', () => {
    setResponseParseConfig({ isStrict: () => true });
    const drifted = { ...aLead(), createdAt: new Date() } as unknown as Lead;

    expect(() => parseResponse('leads/lead_1', drifted, leadSchema)).toThrow(
      ResponseParseError
    );
  });

  it('valid data parses cleanly in both modes', () => {
    setResponseParseConfig({ isStrict: () => true });
    const lead = aLead();
    expect(parseResponse('leads/lead_1', lead, leadSchema)).toEqual(lead);
  });
});
