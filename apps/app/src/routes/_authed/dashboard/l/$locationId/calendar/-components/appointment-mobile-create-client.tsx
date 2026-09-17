import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useBranchRoutes } from '@/lib/use-routes';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useCreateLead } from '@/features/leads';
import { CreateLeadFormFields } from '@/features/leads/components/create-lead-form-fields';
import {
  type CreateLeadFormValues,
  createLeadDefaultValues,
  createLeadSchema,
} from '@/features/leads/components/create-lead-schema';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';

import type { AppointmentCreateSearch } from './appointment-create-search';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';

interface AppointmentMobileCreateClientProps {
  search: AppointmentCreateSearch;
}

export function AppointmentMobileCreateClient({
  search,
}: AppointmentMobileCreateClientProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.calendarNew,
      search: {
        date: search.date,
        hour: search.hour,
        minute: search.minute,
        practitionerId: search.practitionerId,
      },
    });
  }, [
    navigate,
    search.date,
    search.hour,
    search.minute,
    search.practitionerId,
    routes,
  ]);

  useMobileDashboardHeaderContent({
    showBack: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const { createLead, isCreating } = useCreateLead({
    onSuccess: (lead) => {
      void navigate({
        to: routes.calendarNew,
        search: {
          date: search.date,
          hour: search.hour,
          minute: search.minute,
          practitionerId: search.practitionerId,
          leadId: lead.id,
        },
      });
    },
  });

  const form = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: createLeadDefaultValues,
  });

  const onSubmit = (data: CreateLeadFormValues) => {
    createLead(data);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-15">
        <AppointmentMobileCreatePageTitle
          title="Create New Client"
          subtitle="Add a new lead to your pipeline. Fill in the contact information below."
          className="pb-3"
        />

        <Form {...form}>
          <form
            id="appointment-create-client-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <CreateLeadFormFields form={form} variant="mobile" />
          </form>
        </Form>
      </div>

      <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-[#F2F2F7] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <Button
          type="submit"
          form="appointment-create-client-form"
          disabled={isCreating}
          className="h-[50px] w-full rounded-xl"
        >
          {isCreating ? 'Creating...' : 'Create Lead'}
        </Button>
      </div>
    </div>
  );
}
