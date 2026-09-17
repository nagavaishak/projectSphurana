import { DatePicker } from '@/components/ui/date-picker';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useListMetaAdsPages } from '@/features/integrations';
import { SocialPostPreview } from '@/features/social-posts';
import { createSocialPostForm } from '@/features/social-posts/api';
import type { SocialPostPlatform } from '@/features/social-posts/types';
import { format, parse } from 'date-fns';
import { useFormContext } from 'react-hook-form';

import type { ContentWizardFormData } from '../-schema';

const L = createSocialPostForm.labels;

const MOBILE_INPUT_CLASS =
  'h-[44px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

export function ContentMobileScheduleStep() {
  const { control, watch } = useFormContext<ContentWizardFormData>();
  const { pages } = useListMetaAdsPages();

  const selectedPageIds = watch('pageIds');
  const caption = watch('caption');
  const mediaUrl = watch('mediaUrl');
  const thumbnailUrl = watch('thumbnailUrl');

  // Derive the preview platform from the first selected page (mirrors web).
  const previewPage = pages.find((p) => selectedPageIds.includes(p.id));
  const previewPlatform: SocialPostPlatform =
    (previewPage?.platform as SocialPostPlatform) ?? 'facebook';
  const previewProfilePage = pages.find(
    (p) => p.platform === previewPlatform && p.isActive
  );

  return (
    <div className="flex flex-col gap-6 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Schedule
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          Choose when this post goes live
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <label
                htmlFor="content-date"
                className="mb-1.5 block text-[13px] font-medium text-[#8E8E93]"
              >
                {L.date}
              </label>
              <FormControl>
                <DatePicker
                  id="content-date"
                  placeholder="Select date"
                  value={
                    field.value
                      ? parse(field.value, 'yyyy-MM-dd', new Date())
                      : undefined
                  }
                  onChange={(date) =>
                    field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                  className={MOBILE_INPUT_CLASS}
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <label
                htmlFor="content-time"
                className="mb-1.5 block text-[13px] font-medium text-[#8E8E93]"
              >
                {L.time}
              </label>
              <FormControl>
                <Input
                  {...field}
                  id="content-time"
                  type="time"
                  className={MOBILE_INPUT_CLASS}
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="self-start text-[13px] font-medium text-[#8E8E93]">
          Preview
        </p>
        <SocialPostPreview
          platform={previewPlatform}
          imageUrl={thumbnailUrl || mediaUrl || ''}
          caption={caption || ''}
          profileImageUrl={previewProfilePage?.pagePictureUrl ?? undefined}
          profileName={
            previewProfilePage?.pageUsername ??
            previewProfilePage?.pageName ??
            undefined
          }
          className="w-64"
        />
      </div>
    </div>
  );
}
