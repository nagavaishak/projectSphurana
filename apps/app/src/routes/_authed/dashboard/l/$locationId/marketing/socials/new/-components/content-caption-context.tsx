import {
  type GenerateContentInput,
  type GeneratedContent,
  useGenerateContent,
} from '@/features/ai-content';
import { createContext, useContext, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';

import type { ContentWizardFormData } from '../-schema';

interface ContentCaptionContextValue {
  /** Kick off AI caption generation for a selected media item. */
  generateCaption: (input: GenerateContentInput) => void;
  isGeneratingCaption: boolean;
  hasGeneratedCaption: boolean;
}

const ContentCaptionContext = createContext<ContentCaptionContextValue | null>(
  null
);

/**
 * Wraps the wizard steps so the media step can trigger AI caption generation
 * and the details step can reflect the generating/generated state in its
 * `AiFieldWrapper`. Mirrors the inline `useGenerateContent` wiring in the web
 * `AddContentDialog`. Must live inside the form provider — it writes the
 * generated caption straight onto the form.
 */
export function ContentCaptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setValue } = useFormContext<ContentWizardFormData>();
  const [hasGeneratedCaption, setHasGeneratedCaption] = useState(false);

  const { generateContent, isGenerating } = useGenerateContent({
    onSuccess: (data: GeneratedContent) => {
      if (data.contentType !== 'social-post') return;
      const hashtags = data.content.hashtags
        .map((tag: string) => `#${tag}`)
        .join(' ');
      const fullCaption =
        data.content.caption + (hashtags ? `\n\n${hashtags}` : '');
      setValue('caption', fullCaption, { shouldDirty: true });
      setHasGeneratedCaption(true);
    },
  });

  const value = useMemo<ContentCaptionContextValue>(
    () => ({
      generateCaption: generateContent,
      isGeneratingCaption: isGenerating,
      hasGeneratedCaption,
    }),
    [generateContent, isGenerating, hasGeneratedCaption]
  );

  return (
    <ContentCaptionContext.Provider value={value}>
      {children}
    </ContentCaptionContext.Provider>
  );
}

export function useContentCaption(): ContentCaptionContextValue {
  const ctx = useContext(ContentCaptionContext);
  if (!ctx) {
    throw new Error(
      'useContentCaption must be used within a ContentCaptionProvider'
    );
  }
  return ctx;
}
