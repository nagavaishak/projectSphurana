import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';
import {
  type UpdatePractitionerIntent,
  useGetPractitionerForUser,
  useUpdatePractitioner,
} from '@/features/practitioners/api';
import { useUploadImage } from '@/features/upload/api/upload.hook';

import { cropToSquare } from './crop-to-square';
import { HeadlineBioStep } from './steps/headline-bio-step';
import { LanguagesStep } from './steps/languages-step';
import { PhotoTipsStep } from './steps/photo-tips-step';
import { PhotoUploadStep } from './steps/photo-upload-step';
import {
  type SocialLinksState,
  SocialLinksStep,
} from './steps/social-links-step';
import { WizardShell } from './wizard-shell';

type StepId =
  | 'photo-tips'
  | 'photo-upload'
  | 'headline-bio'
  | 'languages'
  | 'social';

const STEP_ORDER: StepId[] = [
  'photo-tips',
  'photo-upload',
  'headline-bio',
  'languages',
  'social',
];

interface WizardState {
  photo: string | null;
  headline: string;
  bio: string;
  languages: string[];
  social: SocialLinksState;
}

interface TeamMemberWizardProps {
  onComplete: () => void;
}

/**
 * Skippable public-profile self-onboarding wizard, shown right after an invited
 * member accepts. Builds the client-facing profile (photo, headline/bio,
 * languages, socials) on the linked `practitioner`. Every step is optional —
 * joining is never gated on finishing it — so Skip and Continue both advance,
 * and the whole thing can be walked past.
 */
export function TeamMemberWizard({ onComplete }: TeamMemberWizardProps) {
  const { practitioner, isLoading } = useGetPractitionerForUser();
  const { updatePractitionerAsync } = useUpdatePractitioner();
  const { uploadAsync: uploadImage } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [localPhotoFile, setLocalPhotoFile] = useState<File | null>(null);
  const [state, setState] = useState<WizardState>({
    photo: null,
    headline: '',
    bio: '',
    languages: [],
    social: {},
  });

  // Seed from any values the practitioner already has (e.g. resumed wizard).
  const practitionerId = practitioner?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the practitioner identity changes, not on every field mutation
  useEffect(() => {
    if (!practitioner) return;
    setState((prev) => ({
      photo: prev.photo ?? practitioner.photo ?? null,
      headline: prev.headline || practitioner.headline || '',
      bio: prev.bio || practitioner.bio || '',
      languages: prev.languages.length
        ? prev.languages
        : (practitioner.languages ?? []),
      social:
        Object.keys(prev.social).length > 0
          ? prev.social
          : ((practitioner.socialLinks as SocialLinksState) ?? {}),
    }));
    // Only re-seed when the practitioner identity changes.
  }, [practitionerId]);

  const localPhotoPreview = useMemo(
    () => (localPhotoFile ? URL.createObjectURL(localPhotoFile) : state.photo),
    [localPhotoFile, state.photo]
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-10">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const currentStep = STEP_ORDER[stepIndex];
  const isLastStep = stepIndex === STEP_ORDER.length - 1;

  const goNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  /** Persist the fields owned by the current step, then advance. */
  const persistAndContinue = async () => {
    if (!practitioner) {
      goNext();
      return;
    }
    setIsBusy(true);
    try {
      // Pass RAW intent for the fields this step owns; the shared builder trims
      // headline/bio and drops empty social handles for us.
      const intent: UpdatePractitionerIntent = {};

      if (currentStep === 'photo-upload' && localPhotoFile) {
        const cropped = await cropToSquare(localPhotoFile);
        const result = await uploadImage(cropped);
        intent.photo = result.url;
        setState((prev) => ({ ...prev, photo: result.url }));
        setLocalPhotoFile(null);
      } else if (currentStep === 'headline-bio') {
        intent.headline = state.headline;
        intent.bio = state.bio;
      } else if (currentStep === 'languages') {
        intent.languages = state.languages;
      } else if (currentStep === 'social') {
        intent.socialLinks = state.social;
      }

      if (Object.keys(intent).length > 0) {
        await updatePractitionerAsync({ id: practitioner.id, ...intent });
      }
      goNext();
    } catch {
      toast.error('Could not save. You can skip this step and add it later.');
    } finally {
      setIsBusy(false);
    }
  };

  const continueLabel = isLastStep ? 'Finish' : 'Continue';

  return (
    <WizardShell
      stepIndex={stepIndex}
      totalSteps={STEP_ORDER.length}
      isBusy={isBusy}
      continueLabel={continueLabel}
      onBack={goBack}
      onSkip={goNext}
      onContinue={persistAndContinue}
    >
      {currentStep === 'photo-tips' && <PhotoTipsStep />}
      {currentStep === 'photo-upload' && (
        <PhotoUploadStep
          previewUrl={localPhotoPreview}
          isUploading={isBusy}
          onFileSelected={setLocalPhotoFile}
        />
      )}
      {currentStep === 'headline-bio' && (
        <HeadlineBioStep
          headline={state.headline}
          bio={state.bio}
          onHeadlineChange={(headline) =>
            setState((prev) => ({ ...prev, headline }))
          }
          onBioChange={(bio) => setState((prev) => ({ ...prev, bio }))}
        />
      )}
      {currentStep === 'languages' && (
        <LanguagesStep
          languages={state.languages}
          onChange={(languages) => setState((prev) => ({ ...prev, languages }))}
        />
      )}
      {currentStep === 'social' && (
        <SocialLinksStep
          value={state.social}
          onChange={(social) => setState((prev) => ({ ...prev, social }))}
        />
      )}
    </WizardShell>
  );
}
