import {
  MultiStepForm,
  type StepConfig,
} from '@/components/ui/multi-step-form';
import { useGetSession } from '@/features/auth/api/get-session';
import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Step1Calendar } from './tabs/step-1-calendar';
import { Step2WhatsApp } from './tabs/step-2-whatsapp';
import { Step3VoiceScript } from './tabs/step-3-voice-script';
import { Step4Meta } from './tabs/step-4-meta';
import { Step5LeadForm } from './tabs/step-5-lead-form';

// Define the form schema (placeholder - integrations don't need form data)
const integrationsSchema = z.object({
  // Placeholder fields - integrations handle their own state
  _placeholder: z.string().optional(),
});

type IntegrationsFormData = z.infer<typeof integrationsSchema>;

// Step schemas (minimal - just to satisfy MultiStepForm)
const step1Schema = integrationsSchema.pick({});
const step2Schema = integrationsSchema.pick({});
const step3Schema = integrationsSchema.pick({});
const step4Schema = integrationsSchema.pick({});
const step5Schema = integrationsSchema.pick({});

export function IntegrationsForm() {
  const { user, isLoading: isSessionLoading } = useGetSession();
  const { data: organization, isLoading: isOrgLoading } =
    useGetActiveOrganization();
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!isSessionLoading && !user?.id) {
      void navigate({ to: '/sign-in' });
    }
  }, [isSessionLoading, user?.id, navigate]);

  // Redirect to onboarding if no organization
  useEffect(() => {
    if (!isOrgLoading && !organization?.id) {
      void navigate({ to: '/onboarding' });
    }
  }, [isOrgLoading, organization, navigate]);

  // Still loading or redirecting
  if (isSessionLoading || isOrgLoading || !user?.id) {
    return <div>Loading...</div>;
  }

  // If no organization, show nothing while redirecting
  if (!organization?.id) {
    return <div>Redirecting to onboarding...</div>;
  }

  const steps: StepConfig<IntegrationsFormData>[] = [
    {
      id: 'calendar',
      schema: step1Schema,
      component: (form) => (
        <Step1Calendar form={form} organizationId={organization.id} />
      ),
    },
    {
      id: 'whatsapp',
      schema: step2Schema,
      component: (form) => (
        <Step2WhatsApp form={form} organizationId={organization.id} />
      ),
    },
    {
      id: 'voice-script',
      schema: step3Schema,
      component: (form) => (
        <Step3VoiceScript form={form} organizationId={organization.id} />
      ),
    },
    {
      id: 'meta',
      schema: step4Schema,
      component: (form) => (
        <Step4Meta form={form} organizationId={organization.id} />
      ),
    },
    {
      id: 'lead-form',
      schema: step5Schema,
      component: (form) => (
        <Step5LeadForm form={form} organizationId={organization.id} />
      ),
    },
  ];

  const defaultValues: IntegrationsFormData = {
    _placeholder: '',
  };

  const handleSubmit = async (_data: IntegrationsFormData) => {
    toast.success('Integrations setup complete!');
    void navigate({ to: routes.home });
  };

  return (
    <MultiStepForm
      steps={steps}
      defaultValues={defaultValues}
      fullSchema={integrationsSchema}
      onSubmit={handleSubmit}
      submitButtonText="Complete Setup"
      continueButtonText="Continue"
    />
  );
}
