import { renderWithProviders, screen } from '@/test/render';
import type { ListLeadsResponse } from '@borradh-workspace/api-client/types';
import {
  defineFixture,
  fixture,
  leadListItemSchema,
  listLeadsResponseSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The dialog reads its data through useListLeads → apiClient.get('leads?…').
// Mock the api-client so React Query resolves our fixtures exactly as prod.
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

import { ClientPickerDialog } from './client-picker-dialog';

// A full, schema-valid list item; tests override only the display-relevant
// fields. Built on the LIST projection (atom + derived `stage`) because that is
// what `GET /leads` returns.
const aLead = defineFixture(leadListItemSchema, {
  stage: 'new',
  id: 'lead-base',
  organizationId: 'org-1',
  // A lead's home branch (location-focused redesign, Phase 1). Nullable.
  primaryLocationId: null,
  firstName: 'Base',
  lastName: null,
  email: null,
  phone: null,
  whatsapp: null,
  source: 'manual',
  status: 'new',
  facebookLeadId: null,
  psid: null,
  formData: null,
  sequenceId: null,
  sequenceStatus: null,
  currentStepId: null,
  sequenceStartedAt: null,
  nextActionAt: null,
  assignedToId: null,
  tags: null,
  notes: null,
  portalNote: null,
  metadata: null,
  humanTakeoverRequested: null,
  humanTakeoverReason: null,
  humanTakeoverAt: null,
  consentEmail: false,
  consentSms: false,
  consentVoice: false,
  consentSource: null,
  consentedAt: null,
  lastContactedAt: null,
  convertedAt: null,
  lastVisitAt: null,
  lifetimeSpendCents: 0,
  listRank: 0,
  // Microsite attribution columns — nullable but not optional, so a fixture
  // has to carry them.
  micrositeId: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null,
});

function leadsResponse(
  items: Array<{
    id: string;
    firstName?: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }>
): ListLeadsResponse {
  // Each item is validated against the lead contract via the fixture factory,
  // then wrapped in the schema-validated list response.
  return fixture(listLeadsResponseSchema, {
    items: items.map((item) => aLead(item)),
    total: items.length,
    limit: items.length,
    offset: 0,
  });
}

describe('ClientPickerDialog', () => {
  beforeEach(() => {
    get.mockResolvedValue(leadsResponse([]));
  });

  it('renders seeded clients by display name', async () => {
    get.mockResolvedValue(
      leadsResponse([
        { id: 'l1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.io' },
        // No display name (firstName is empty, not null — the atom requires a
        // string) so the row falls back to the email.
        { id: 'l2', firstName: '', lastName: null, email: 'walk@x.io' },
      ])
    );

    renderWithProviders(
      <ClientPickerDialog open onOpenChange={() => {}} onSelect={() => {}} />
    );

    // Named lead: name as the heading, email as the muted subline.
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
    expect(await screen.findByText('ada@x.io')).toBeVisible();
    // No-name lead falls back to the email — rendered as both heading and
    // subline, so there are two matches.
    expect((await screen.findAllByText('walk@x.io')).length).toBe(2);
  });

  it('shows the walk-in remove option only when a client is attached', async () => {
    const { rerender } = renderWithProviders(
      <ClientPickerDialog
        open
        hasClient={false}
        onOpenChange={() => {}}
        onSelect={() => {}}
      />
    );
    expect(screen.queryByText(/remove client/i)).not.toBeInTheDocument();

    rerender(
      <ClientPickerDialog
        open
        hasClient
        onOpenChange={() => {}}
        onSelect={() => {}}
      />
    );
    expect(await screen.findByText(/remove client \(walk-in\)/i)).toBeVisible();
  });

  it('fires onSelect(null) when choosing walk-in and closes the dialog', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ClientPickerDialog
        open
        hasClient
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    );

    await user.click(await screen.findByText(/remove client \(walk-in\)/i));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fires onSelect(leadId) when picking a client', async () => {
    get.mockResolvedValue(
      leadsResponse([{ id: 'l9', firstName: 'Grace', lastName: 'Hopper' }])
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ClientPickerDialog open onOpenChange={() => {}} onSelect={onSelect} />
    );

    await user.click(await screen.findByText('Grace Hopper'));
    expect(onSelect).toHaveBeenCalledWith('l9');
  });
});
