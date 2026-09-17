import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  MetaAdAccountInfo,
  MetaBusinessInfo,
  MetaPageInfoStored,
} from '@/features/integrations/types';
import { Briefcase, Building2, FileText, Info } from 'lucide-react';
import { useMemo } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { MetaAdsSetupFormData } from './meta-ads-setup-form';

interface Step4ConfirmProps {
  form: UseFormReturn<MetaAdsSetupFormData>;
  availableAdAccounts: MetaAdAccountInfo[];
  availablePages: MetaPageInfoStored[];
  selectedBusiness?: MetaBusinessInfo;
}

export function Step4Confirm({
  form,
  availableAdAccounts,
  availablePages,
  selectedBusiness,
}: Step4ConfirmProps) {
  const adAccountIds: string[] = form.watch('adAccountIds') ?? [];
  const pageIds: string[] = form.watch('pageIds') ?? [];

  const selectedAdAccounts = useMemo(
    () =>
      adAccountIds
        .map((id) =>
          availableAdAccounts.find((a) => a.accountId === id || a.id === id)
        )
        .filter((a): a is MetaAdAccountInfo => !!a),
    [adAccountIds, availableAdAccounts]
  );

  const selectedPages = useMemo(
    () =>
      pageIds
        .map((id) => availablePages.find((p) => p.id === id))
        .filter((p): p is MetaPageInfoStored => !!p),
    [pageIds, availablePages]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Confirm your setup</h1>
        <p className="text-sm text-muted-foreground">
          Review your selections before connecting Meta Ads.
        </p>
      </div>

      <div className="space-y-3">
        {/* Business Card (only shown when user selected from multiple) */}
        {selectedBusiness && (
          <Card className="gap-2 py-4">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Briefcase className="size-4" />
                Business
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Avatar className="size-8">
                  {selectedBusiness.profilePictureUri && (
                    <AvatarImage
                      src={selectedBusiness.profilePictureUri}
                      alt={selectedBusiness.name}
                    />
                  )}
                  <AvatarFallback>
                    <Building2 className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{selectedBusiness.name}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ad Accounts Card */}
        <Card className="gap-2 py-4">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="size-4" />
              Ad Account{selectedAdAccounts.length !== 1 ? 's' : ''}
              <Badge variant="secondary" className="text-xs">
                {selectedAdAccounts.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {selectedAdAccounts.map((account) => (
                <div key={account.id} className="flex items-center gap-2">
                  <span className="font-medium">{account.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {account.currency}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {account.accountId}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pages Card */}
        <Card className="gap-2 py-4">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="size-4" />
              Facebook Page{selectedPages.length !== 1 ? 's' : ''}
              <Badge variant="secondary" className="text-xs">
                {selectedPages.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {selectedPages.map((page) => (
                <div key={page.id} className="flex items-center gap-3">
                  <Avatar className="size-8">
                    {page.pictureUrl && (
                      <AvatarImage src={page.pictureUrl} alt={page.name} />
                    )}
                    <AvatarFallback>{page.name[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-medium">{page.name}</span>
                    {page.category && (
                      <span className="text-xs text-muted-foreground">
                        {page.category}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Borradh will subscribe your pages to lead webhooks and manage ads on
          your behalf. You can disconnect at any time from the integrations
          settings.
        </p>
      </div>
    </div>
  );
}
