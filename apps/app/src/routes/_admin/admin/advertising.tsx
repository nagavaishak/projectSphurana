import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AdminOrgScope,
  OrgCombobox,
  type SelectedOrg,
} from '@/features/admin-terminal';
import { AdsTable } from '@/features/meta-campaigns/components/ads-table';
import { CampaignList } from '@/features/meta-campaigns/components/campaign-list';

export const Route = createFileRoute('/_admin/admin/advertising')({
  component: AdminAdvertisingPage,
});

/**
 * Campaigns for the selected org (read-only), rendered under `AdminOrgScope`.
 * Clicking a campaign shows its ads table; cross-org writes are hidden because
 * org-membership guards would reject them.
 */
function AdminAdvertising() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null
  );

  if (selectedCampaignId) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setSelectedCampaignId(null)}
        >
          <ArrowLeft className="size-4" />
          Back to campaigns
        </Button>
        <AdsTable campaignId={selectedCampaignId} readOnly />
      </div>
    );
  }

  return <CampaignList readOnly onCampaignSelect={setSelectedCampaignId} />;
}

function AdminAdvertisingPage() {
  const [org, setOrg] = useState<SelectedOrg | null>(null);

  return (
    <div className="container max-w-7xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Advertising</h1>
        <p className="text-muted-foreground">
          Inspect any organization&apos;s campaigns.
        </p>
      </div>

      <div className="mb-6">
        <OrgCombobox value={org} onChange={setOrg} />
      </div>

      {org ? (
        <AdminOrgScope organizationId={org.id}>
          <AdminAdvertising />
        </AdminOrgScope>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization to view its campaigns.
        </p>
      )}
    </div>
  );
}
