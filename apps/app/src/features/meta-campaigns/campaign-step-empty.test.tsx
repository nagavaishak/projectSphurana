import { renderWithProviders, screen } from '@/test/render';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

/**
 * `/ads/new` wizard — campaign step, disconnected/empty branch. Ported from the
 * ads-disconnected E2E's third case: for a bare org with no campaigns the wizard
 * step renders "Select a campaign" plus an inline stub telling the user to create
 * a campaign from the Advertising page first (the de-facto connect prompt). We
 * mock the campaign list to empty and the wizard context, then render the step
 * inside a react-hook-form provider (it reads form state via useFormContext).
 */

vi.mock('@/features/meta-campaigns', () => ({
  useListCampaigns: () => ({ campaigns: [], isLoading: false }),
  campaignHasBudget: () => true,
}));

vi.mock('@/features/integrations/api', () => ({
  useGetMetaIntegration: () => ({
    integration: null,
    availableAdAccounts: [],
  }),
}));

vi.mock('@/routes/_authed/ads/new/-context', () => ({
  useAdWizard: () => ({
    setSelectedCampaignFollowUpType: vi.fn(),
    setSelectedCampaignConfig: vi.fn(),
  }),
}));

import { CampaignStep } from '@/routes/_authed/ads/new/-components/steps/campaign-step';

function Wrapper({ children }: { children: ReactNode }) {
  const form = useForm({ defaultValues: { campaignId: '' } });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('CampaignStep — no campaigns (disconnected)', () => {
  it('prompts the user to create a campaign first', () => {
    renderWithProviders(
      <Wrapper>
        <CampaignStep />
      </Wrapper>
    );

    expect(
      screen.getByRole('heading', { name: /select a campaign/i, level: 2 })
    ).toBeVisible();
    expect(
      screen.getByText(
        /no campaigns created yet\. create a campaign from the advertising page first\./i
      )
    ).toBeVisible();
    // No campaign combobox to choose from when the list is empty.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
