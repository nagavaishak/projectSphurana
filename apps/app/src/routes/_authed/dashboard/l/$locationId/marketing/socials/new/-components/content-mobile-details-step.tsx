import { AiFieldWrapper } from '@/components/ui/ai-field-wrapper';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createSocialPostForm } from '@/features/social-posts/api';
import { useFormContext } from 'react-hook-form';

import type { ContentWizardFormData } from '../-schema';
import { useContentCaption } from './content-caption-context';

const L = createSocialPostForm.labels;

const MOBILE_INPUT_CLASS =
  'h-[44px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

export function ContentMobileDetailsStep() {
  const { control } = useFormContext<ContentWizardFormData>();
  const { isGeneratingCaption, hasGeneratedCaption } = useContentCaption();

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Post details
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          Add a title and caption for your post
        </p>
      </div>

      <FormField
        control={control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <label
              htmlFor="content-title"
              className="mb-1.5 block text-[13px] font-medium text-[#8E8E93]"
            >
              {L.title}
            </label>
            <FormControl>
              <Input
                {...field}
                id="content-title"
                placeholder="Enter post title"
                className={MOBILE_INPUT_CLASS}
              />
            </FormControl>
            <FormMessage className="text-[13px]" />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="caption"
        render={({ field }) => (
          <FormItem>
            <label
              htmlFor="content-caption"
              className="mb-1.5 block text-[13px] font-medium text-[#8E8E93]"
            >
              {L.caption}
            </label>
            <AiFieldWrapper
              isGenerating={isGeneratingCaption}
              hasGenerated={hasGeneratedCaption}
            >
              <FormControl>
                <Textarea
                  {...field}
                  id="content-caption"
                  placeholder="Write a caption, or pick media to generate one"
                  rows={5}
                  className="min-h-[120px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 py-2.5 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]"
                />
              </FormControl>
            </AiFieldWrapper>
            <FormMessage className="text-[13px]" />
          </FormItem>
        )}
      />
    </div>
  );
}
