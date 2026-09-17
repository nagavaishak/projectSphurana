import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import type { MetaPageInfoStored } from '@/features/integrations/types';
import { ExternalLink, FileText, Info, RefreshCw } from 'lucide-react';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import type { MetaAdsSetupFormData } from './meta-ads-setup-form';

interface Step2SelectPageProps {
  form: UseFormReturn<MetaAdsSetupFormData>;
  pages: MetaPageInfoStored[];
  onReconnect: () => void;
  onRefresh: () => void;
}

export function Step2SelectPage({
  form,
  pages,
  onReconnect,
  onRefresh,
}: Step2SelectPageProps) {
  const selectedIds: string[] =
    useWatch({ control: form.control, name: 'pageIds' }) ?? [];

  const togglePage = (pageId: string) => {
    const current = form.getValues('pageIds') ?? [];
    const next = current.includes(pageId)
      ? current.filter((id) => id !== pageId)
      : [...current, pageId];
    form.setValue('pageIds', next);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Select your Facebook Pages</h1>
        <p className="text-sm text-muted-foreground">
          Choose one or more pages for your ad campaigns.
        </p>
      </div>

      {pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <FileText className="size-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No Facebook pages found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make sure you have admin access to at least one Facebook page.
            </p>
          </div>

          <Alert>
            <Info className="size-4" />
            <AlertTitle>Need a Facebook Page?</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                You need a Facebook Page to run ads. Create one in Facebook,
                then reconnect your Meta account.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://www.facebook.com/pages/create"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Create a Page
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
                <Button size="sm" onClick={onReconnect}>
                  Reconnect Meta Account
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <>
          {selectedIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.length} page{selectedIds.length !== 1 ? 's' : ''}{' '}
              selected
            </p>
          )}

          <div className="max-h-[360px] overflow-y-auto pr-4">
            <div className="space-y-2">
              {pages.map((page) => {
                const isSelected = selectedIds.includes(page.id);
                return (
                  <div
                    key={page.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => togglePage(page.id)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        togglePage(page.id);
                      }
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                  >
                    {/* Wrapper stops Radix CheckboxBubbleInput's synthetic click from bubbling to parent */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="mt-1"
                    >
                      <Checkbox
                        checked={isSelected}
                        tabIndex={-1}
                        aria-hidden
                      />
                    </div>
                    <div className="flex flex-1 items-center gap-3">
                      <Avatar className="size-10">
                        {page.pictureUrl && (
                          <AvatarImage src={page.pictureUrl} alt={page.name} />
                        )}
                        <AvatarFallback>{page.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{page.name}</span>
                        {page.category && (
                          <span className="text-xs text-muted-foreground">
                            {page.category}
                          </span>
                        )}
                      </div>
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
            Refresh Pages
          </Button>
        </>
      )}
    </div>
  );
}
