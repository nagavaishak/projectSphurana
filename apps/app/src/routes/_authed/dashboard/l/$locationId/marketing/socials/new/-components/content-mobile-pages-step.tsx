import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { useListMetaAdsPages } from '@/features/integrations';
import { cn } from '@/lib/utils';
import { Check, FacebookIcon, InstagramIcon, Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { useFormContext } from 'react-hook-form';

import type { ContentWizardFormData } from '../-schema';

export function ContentMobilePagesStep() {
  const { control, watch, setValue } = useFormContext<ContentWizardFormData>();
  const selectedPageIds = watch('pageIds');
  const { pages, isLoading } = useListMetaAdsPages();

  const togglePage = useCallback(
    (pageId: string) => {
      const current = watch('pageIds');
      const next = current.includes(pageId)
        ? current.filter((id) => id !== pageId)
        : [...current, pageId];
      setValue('pageIds', next, { shouldValidate: true });
    },
    [watch, setValue]
  );

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Where to post
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          Choose the pages this post goes to
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-[#8E8E93]" />
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E5E5EA] px-4 py-10 text-center">
          <p className="text-[15px] text-[#8E8E93]">
            No connected pages. Connect Meta or Instagram in Settings first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pages.map((page) => {
            const isSelected = selectedPageIds.includes(page.id);
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => togglePage(page.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left transition-colors',
                  isSelected
                    ? 'border-[#007AFF] ring-1 ring-[#007AFF]'
                    : 'border-[#E5E5EA]'
                )}
              >
                {page.pagePictureUrl ? (
                  <img
                    src={page.pagePictureUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#F2F2F7]">
                    {page.platform === 'instagram' ? (
                      <InstagramIcon className="size-5 text-pink-600" />
                    ) : (
                      <FacebookIcon className="size-5 text-blue-600" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-black">
                    {page.pageName || page.pageId}
                  </p>
                  <p className="flex items-center gap-1 text-[13px] text-[#8E8E93]">
                    {page.platform === 'instagram' ? (
                      <InstagramIcon className="size-3.5 text-pink-600" />
                    ) : (
                      <FacebookIcon className="size-3.5 text-blue-600" />
                    )}
                    {page.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                  </p>
                </div>
                <div
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border',
                    isSelected
                      ? 'border-[#007AFF] bg-[#007AFF] text-white'
                      : 'border-[#C7C7CC] text-transparent'
                  )}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FormField
        control={control}
        name="pageIds"
        render={() => (
          <FormItem className="sr-only">
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
