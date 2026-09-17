import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { MetaBusinessInfo } from '@/features/integrations/types';
import { Building2, RefreshCw } from 'lucide-react';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import type { MetaAdsSetupFormData } from './meta-ads-setup-form';

interface Step0SelectBusinessProps {
  form: UseFormReturn<MetaAdsSetupFormData>;
  businesses: MetaBusinessInfo[];
  onReconnect: () => void;
  onRefresh: () => void;
}

export function Step0SelectBusiness({
  form,
  businesses,
  onReconnect,
  onRefresh,
}: Step0SelectBusinessProps) {
  const selectedId: string =
    useWatch({ control: form.control, name: 'selectedBusinessId' }) ?? '';

  const selectBusiness = (businessId: string) => {
    form.setValue('selectedBusinessId', businessId);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Select your Business</h1>
        <p className="text-sm text-muted-foreground">
          Choose which Meta business to connect. Ad accounts and pages will be
          filtered to this business.
        </p>
      </div>

      {businesses.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <Building2 className="size-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No businesses found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make sure you have access to at least one Meta business.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={onReconnect}>
              Reconnect Meta Account
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="max-h-[360px] overflow-y-auto pr-4">
            <div className="space-y-2">
              {businesses.map((biz) => {
                const isSelected = selectedId === biz.id;
                return (
                  <div
                    key={biz.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectBusiness(biz.id)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        selectBusiness(biz.id);
                      }
                    }}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                  >
                    <Avatar className="size-10">
                      {biz.profilePictureUri && (
                        <AvatarImage
                          src={biz.profilePictureUri}
                          alt={biz.name}
                        />
                      )}
                      <AvatarFallback>
                        <Building2 className="size-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{biz.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ID: {biz.id}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="self-start"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
            Refresh Businesses
          </Button>
        </>
      )}
    </div>
  );
}
