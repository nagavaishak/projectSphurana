import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetSession } from '@/features/auth/api/get-session';
import {
  useAssignPractitionerServices,
  useCompletePractitionerProfileSetup,
  useGetPractitionerForUser,
  useLinkPractitionerToUser,
  useUpdatePractitioner,
} from '@/features/practitioners/api';
import { useUploadImage } from '@/features/upload/api/upload.hook';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { StepCalendarConnect } from './tabs/step-calendar-connect';
import { StepPhotoTitle } from './tabs/step-photo-title';
import { StepSelectServices } from './tabs/step-select-services';
import { StepWorkingHours } from './tabs/step-working-hours';

const SETUP_PROFILE_STATE_KEY = 'setup-profile-form-state';

const setupProfileSchema = z.object({
  photo: z.any().optional().nullable(),
  title: z.string().min(1, 'Title is required'),
  serviceIds: z.array(z.string()).min(1, 'Select at least one service'),
  workingHours: z.record(
    z.string(),
    z.object({ from: z.number(), to: z.number() })
  ),
});

type SetupProfileFormData = z.infer<typeof setupProfileSchema>;

const step1Schema = z.object({
  title: z.string().min(1, 'Title is required'),
});

const step2Schema = z.object({
  serviceIds: z.array(z.string()).min(1, 'Select at least one service'),
});

const step3Schema = z.object({});

const step4Schema = z.object({
  workingHours: z.record(
    z.string(),
    z.object({ from: z.number(), to: z.number() })
  ),
});

const DEFAULT_WORKING_HOURS: Record<string, { from: number; to: number }> = {
  '1': { from: 540, to: 1020 },
  '2': { from: 540, to: 1020 },
  '3': { from: 540, to: 1020 },
  '4': { from: 540, to: 1020 },
  '5': { from: 540, to: 1020 },
};

export function SetupProfileForm() {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { user, isLoading: sessionLoading } = useGetSession();
  const {
    practitioner,
    isLoading: practitionerLoading,
    isError,
  } = useGetPractitionerForUser();
  const { linkMe } = useLinkPractitionerToUser();
  const { updatePractitionerAsync } = useUpdatePractitioner();
  const { assignServicesAsync } = useAssignPractitionerServices();
  const { completeProfileSetupAsync } = useCompletePractitionerProfileSetup();
  const { uploadAsync: uploadImage } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });

  const hasLinkedRef = useRef(false);

  // Detect OAuth return from Google Calendar
  const [initialStep] = useState<number | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    const isCalendarReturn = params.get('integration') === 'calendar';
    if (isCalendarReturn) {
      window.history.replaceState({}, '', '/setup-profile');
      return 2; // Calendar step index
    }
    return undefined;
  });

  // Try to link practitioner if not already linked (e.g. org creator)
  useEffect(() => {
    if (
      !practitionerLoading &&
      !practitioner &&
      isError &&
      user &&
      !hasLinkedRef.current
    ) {
      hasLinkedRef.current = true;
      linkMe();
    }
  }, [practitionerLoading, practitioner, isError, user, linkMe]);

  // Redirect if profile setup is already completed
  useEffect(() => {
    if (practitioner?.profileSetupCompleted) {
      navigate({ to: routes.home, replace: true });
    }
  }, [practitioner?.profileSetupCompleted, navigate, routes.home]);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!sessionLoading && !user) {
      navigate({ to: '/sign-in', replace: true });
    }
  }, [sessionLoading, user, navigate]);

  const saveFormState = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        SETUP_PROFILE_STATE_KEY,
        JSON.stringify({ timestamp: Date.now() })
      );
    }
  }, []);

  if (sessionLoading || practitionerLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-48 w-full max-w-[640px]" />
      </div>
    );
  }

  if (!user) return null;

  if (isError && !practitioner) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">
          No practitioner profile found
        </h1>
        <p className="text-center text-muted-foreground">
          Your account isn&apos;t linked to a practitioner profile. Contact your
          organization admin for an invitation.
        </p>
        <button
          type="button"
          className="text-primary underline"
          onClick={() => navigate({ to: routes.home })}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  // Parse working hours from API (may be serialized as string)
  const parsedWorkingHours = (() => {
    const wh = practitioner?.workingHours;
    if (!wh) return DEFAULT_WORKING_HOURS;
    if (typeof wh === 'string') {
      try {
        return JSON.parse(wh) as Record<string, { from: number; to: number }>;
      } catch {
        return DEFAULT_WORKING_HOURS;
      }
    }
    return wh as Record<string, { from: number; to: number }>;
  })();

  const defaultValues: SetupProfileFormData = {
    photo: null,
    title: practitioner?.title ?? '',
    serviceIds: practitioner?.services?.map((s) => s.service.id) ?? [],
    workingHours: parsedWorkingHours,
  };

  const steps: StepConfig<SetupProfileFormData>[] = [
    {
      id: 'photo-title',
      schema: step1Schema,
      component: (form) => (
        <StepPhotoTitle form={form} existingPhoto={practitioner?.photo} />
      ),
      onBeforeContinue: async (form) => {
        if (!practitioner) return false;
        try {
          const data = form.getValues();
          let photoUrl = practitioner.photo;

          if (data.photo instanceof File) {
            const result = await uploadImage(data.photo);
            photoUrl = result.url;
          }

          await updatePractitionerAsync({
            id: practitioner.id,
            ...(photoUrl ? { photo: photoUrl } : {}),
            title: data.title,
          });
          return true;
        } catch {
          toast.error('Failed to save profile. Please try again.');
          return false;
        }
      },
      processingButtonText: 'Saving...',
    },
    {
      id: 'services',
      schema: step2Schema,
      component: (form) => <StepSelectServices form={form} />,
      onBeforeContinue: async (form) => {
        if (!practitioner) return false;
        try {
          const data = form.getValues();
          await assignServicesAsync({
            practitionerId: practitioner.id,
            serviceIds: data.serviceIds,
          });
          return true;
        } catch {
          toast.error('Failed to save services. Please try again.');
          return false;
        }
      },
      processingButtonText: 'Saving...',
    },
    {
      id: 'calendar-connect',
      schema: step3Schema,
      component: () => <StepCalendarConnect onSaveFormState={saveFormState} />,
    },
    {
      id: 'working-hours',
      schema: step4Schema,
      component: (form) => <StepWorkingHours form={form} />,
    },
  ];

  const handleSubmit = async (data: SetupProfileFormData) => {
    if (!practitioner) return;
    try {
      await updatePractitionerAsync({
        id: practitioner.id,
        workingHours: data.workingHours,
      });
      await completeProfileSetupAsync(practitioner.id);
      toast.success('Profile setup complete!');
      navigate({ to: routes.home });
    } catch {
      toast.error('Failed to complete setup. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center py-12">
      <MultiStepForm
        steps={steps}
        defaultValues={defaultValues}
        fullSchema={setupProfileSchema}
        onSubmit={handleSubmit}
        submitButtonText="Complete Setup"
        initialStep={initialStep}
      />
    </div>
  );
}
