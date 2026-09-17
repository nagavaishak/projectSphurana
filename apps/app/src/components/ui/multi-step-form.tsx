import { Button } from '@/components/ui/button';
import { StepDots } from '@/components/ui/step-dots';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  DefaultValues,
  FieldErrors,
  FieldValues,
  Resolver,
  UseFormReturn,
} from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

export interface StepConfig<TFormData extends FieldValues> {
  id: string;
  schema: z.ZodSchema<unknown>;
  component: (form: UseFormReturn<TFormData>) => ReactElement;
  onBeforeContinue?: (form: UseFormReturn<TFormData>) => Promise<boolean>;
  continueButtonText?: string;
  processingButtonText?: string;
}

interface MultiStepFormProps<TFormData extends FieldValues> {
  steps: StepConfig<TFormData>[];
  defaultValues: DefaultValues<TFormData>;
  fullSchema: z.ZodSchema<TFormData>;
  onSubmit: (data: TFormData) => Promise<void>;
  submitButtonText?: string;
  continueButtonText?: string;
  onStepChange?: (stepIndex: number, stepId: string) => void;
  canContinue?: boolean;
  initialStep?: number;
  onClose?: () => void;
  hideBackButton?: boolean;
  hideStepDots?: boolean;
  contentClassName?: string;
  /** Mobile: full-width layout with fixed bottom action bar (ad wizard style). */
  layout?: 'default' | 'mobile';
  /** Exposes goBack so an external header back button can act as Previous. */
  registerGoBack?: (goBack: (() => void) | null) => void;
}

export function MultiStepForm<TFormData extends FieldValues>({
  steps,
  defaultValues,
  fullSchema,
  onSubmit,
  submitButtonText = 'Complete',
  continueButtonText = 'Continue',
  onStepChange,
  canContinue = true,
  initialStep,
  onClose,
  hideBackButton: _hideBackButton,
  hideStepDots,
  contentClassName,
  layout = 'default',
  registerGoBack,
}: MultiStepFormProps<TFormData>) {
  const isMobileLayout = layout === 'mobile';
  const [currentStep, setCurrentStep] = useState(initialStep ?? 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStepProcessing, setIsStepProcessing] = useState(false);
  const currentStepRef = useRef(initialStep ?? 0);
  currentStepRef.current = currentStep;

  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const stepResolver: Resolver<TFormData> = useCallback(
    async (values: TFormData) => {
      const schema = stepsRef.current[currentStepRef.current]?.schema;
      if (!schema) {
        return { values, errors: {} } as {
          values: TFormData;
          errors: Record<string, never>;
        };
      }

      const result = await schema.safeParseAsync(values);
      if (result.success) {
        return { values, errors: {} } as {
          values: TFormData;
          errors: Record<string, never>;
        };
      }

      const errors: FieldErrors<TFormData> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (field && !(field in errors)) {
          (errors as Record<string, unknown>)[field] = {
            type: 'validation',
            message: issue.message,
          };
        }
      }
      return { values: {} as Record<string, never>, errors };
    },
    []
  );

  const form = useForm<TFormData>({
    mode: 'onBlur',
    defaultValues,
    resolver: stepResolver,
  });

  const validateCurrentStep = (): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      form.handleSubmit(
        () => resolve(true),
        () => resolve(false)
      )();
    });
  };

  const handleBack = useCallback(() => {
    if (currentStepRef.current > 0) {
      const newStep = currentStepRef.current - 1;
      setCurrentStep(newStep);
      onStepChange?.(newStep, stepsRef.current[newStep]?.id ?? '');
    }
  }, [onStepChange]);

  useEffect(() => {
    if (!registerGoBack) return;
    registerGoBack(handleBack);
    return () => registerGoBack(null);
  }, [registerGoBack, handleBack]);

  const handleContinue = async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;

    const stepConfig = steps[currentStep];

    if (stepConfig?.onBeforeContinue) {
      setIsStepProcessing(true);
      try {
        const shouldContinue = await stepConfig.onBeforeContinue(form);
        if (!shouldContinue) return;
      } finally {
        setIsStepProcessing(false);
      }
    }

    if (currentStep === steps.length - 1) {
      setIsSubmitting(true);
      try {
        const data = form.getValues();
        await fullSchema.parseAsync(data);
        await onSubmit(data);
      } catch (error) {
        // A full-schema failure here is invisible to the user: the field that
        // failed usually belongs to an EARLIER step (or one that is currently
        // disabled), so nothing on screen turns red and the button just does
        // nothing. Name the fields so the wizard cannot strand anyone silently.
        console.error('Submission error:', error);
        if (error instanceof z.ZodError) {
          const fields = [
            ...new Set(error.issues.map((i) => i.path.join('.') || 'form')),
          ];
          toast.error(
            `Could not finish setup — please check: ${fields.join(', ')}`
          );
        } else {
          toast.error('Could not finish setup. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    } else {
      const newStep = currentStep + 1;
      setCurrentStep(newStep);
      onStepChange?.(newStep, steps[newStep]?.id ?? '');
    }
  };

  const isLastStep = currentStep === steps.length - 1;
  const currentStepConfig = steps[currentStep];

  const continueButton = (
    <Button
      disabled={isSubmitting || isStepProcessing || !canContinue}
      className={cn(
        !isMobileLayout && currentStep === 0 && 'w-full',
        isMobileLayout && 'h-12 w-full rounded-xl text-[17px] font-semibold'
      )}
      data-claire-target={
        currentStepConfig?.id === 'service'
          ? 'create-video-service-continue-button'
          : currentStepConfig?.id === 'script'
            ? 'create-video-script-continue-button'
            : currentStepConfig?.id?.startsWith('media-')
              ? 'create-video-media-continue-button'
              : isLastStep
                ? 'create-video-submit-button'
                : undefined
      }
      size="lg"
      type="submit"
    >
      {isLastStep
        ? isSubmitting
          ? 'Submitting...'
          : submitButtonText
        : isStepProcessing
          ? (currentStepConfig?.processingButtonText ?? 'Processing...')
          : (currentStepConfig?.continueButtonText ?? continueButtonText)}
    </Button>
  );

  if (isMobileLayout) {
    return (
      <div className="relative flex w-full flex-col px-4 pb-32">
        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void handleContinue();
          }}
        >
          <div
            key={currentStep}
            className="transition-opacity duration-200 ease-out [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-black [&_.text-muted-foreground]:text-[15px] [&_.text-muted-foreground]:text-[#8E8E93]"
          >
            {currentStepConfig?.component?.(form)}
          </div>
        </form>

        {!hideStepDots ? (
          <div className="mt-6 flex justify-center pb-2">
            <StepDots totalSteps={steps.length} currentStep={currentStep} />
          </div>
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E5E5EA] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          {currentStep > 0 ? (
            <div className="mb-2 flex justify-start">
              <Button
                variant="ghost"
                type="button"
                className="h-10 px-2 text-[15px] font-medium text-[#007AFF]"
                onClick={handleBack}
              >
                Previous
              </Button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleContinue();
            }}
          >
            {continueButton}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex w-full flex-col items-center px-6 md:px-12">
      {onClose && (
        <div className="mb-6 flex w-full max-w-[640px] items-center justify-end pt-4">
          <Button
            aria-label="Close"
            variant="ghost"
            size="icon"
            type="button"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>
      )}

      <div
        className={cn(
          'flex w-full flex-col',
          contentClassName ?? 'max-w-[640px]'
        )}
      >
        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
        >
          <div
            key={currentStep}
            className="transition-opacity duration-200 ease-out"
          >
            {currentStepConfig?.component?.(form)}
          </div>

          <div className="mt-8 flex items-center justify-between">
            {currentStep > 0 ? (
              <Button
                variant="ghost"
                size="lg"
                type="button"
                onClick={handleBack}
              >
                Previous
              </Button>
            ) : (
              <span />
            )}
            <div className={cn(currentStep === 0 ? 'w-full' : 'ml-auto')}>
              <Button
                disabled={isSubmitting || isStepProcessing || !canContinue}
                className={cn(currentStep === 0 && 'w-full')}
                data-claire-target={
                  currentStepConfig?.id === 'service'
                    ? 'create-video-service-continue-button'
                    : currentStepConfig?.id === 'script'
                      ? 'create-video-script-continue-button'
                      : currentStepConfig?.id?.startsWith('media-')
                        ? 'create-video-media-continue-button'
                        : isLastStep
                          ? 'create-video-submit-button'
                          : undefined
                }
                size="lg"
                type="submit"
              >
                {isLastStep
                  ? isSubmitting
                    ? 'Submitting...'
                    : submitButtonText
                  : isStepProcessing
                    ? (currentStepConfig?.processingButtonText ??
                      'Processing...')
                    : (currentStepConfig?.continueButtonText ??
                      continueButtonText)}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {!hideStepDots && (
        <div className="pb-8 pt-4">
          <StepDots totalSteps={steps.length} currentStep={currentStep} />
        </div>
      )}
    </div>
  );
}
