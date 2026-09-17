import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, ChevronLeft, Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Drawer } from 'vaul';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { APPOINTMENT_NO_PRACTITIONER } from '@/features/appointments/create';
import { useCreateLead, useListLeads } from '@/features/leads';
import { CreateLeadFormFields } from '@/features/leads/components/create-lead-form-fields';
import {
  type CreateLeadFormValues,
  createLeadDefaultValues,
  createLeadSchema,
} from '@/features/leads/components/create-lead-schema';
import { MOBILE_PRIMARY_BUTTON_CLASS } from '@/features/mobile-ui';
import { useListPractitioners } from '@/features/practitioners';
import { MobileBlockedTimeForm } from '@/features/scheduling';
import { cn } from '@/lib/utils';

import type { Lead } from '@borradh-workspace/api-client/types';

import { AppointmentMobileCreateDetailsForm } from '../appointment-mobile-create-details-form';
import { AppointmentMobileServicePicker } from '../appointment-mobile-service-picker';

interface MobileAddBookingFlowProps {
  children?: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  practitionerId?: string;
}

type Step =
  | 'select-client'
  | 'new-client'
  | 'select-service'
  | 'select-practitioner'
  | 'create-appointment'
  | 'block-time-off'
  | 'confirmed';

/**
 * Mobile add-booking orchestrator (drawer funnel). Opened by tapping an empty
 * time slot on the calendar (conforms to ICalendarConfig.customAddDialog).
 *
 * Every step composes the SHARED cores — the appointment-create schema/fields/
 * payload builder, the lead-create schema/fields, and the blocked-time core —
 * so this funnel can't drift from the desktop dialog. Only the presentation
 * (full-screen steps) is mobile-specific.
 *
 * Flow:
 *   select-client ──┬── (existing lead)  → select-service → [select-practitioner]
 *                   │                       → create-appointment → confirmed
 *                   ├── "New client"     → new-client → select-service → …
 *                   └── "Block off time" → block-time-off → close
 *
 * The practitioner step is skipped when the tapped slot already fixes a column.
 */
export function MobileAddBookingFlow({
  children,
  startDate,
  startTime,
  practitionerId,
}: MobileAddBookingFlowProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('select-client');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  );
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<
    string | undefined
  >(practitionerId);

  const slotDate = startDate ? new Date(startDate) : new Date();

  const reset = () => {
    setStep('select-client');
    setSelectedLead(null);
    setSelectedServiceId(null);
    setSelectedPractitionerId(practitionerId);
  };

  const close = () => {
    setOpen(false);
    // Allow drawer to animate out before resetting
    setTimeout(reset, 250);
  };

  // The slot's column fixes the practitioner; only ask when it doesn't.
  const afterService = () =>
    setStep(practitionerId ? 'create-appointment' : 'select-practitioner');

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
    >
      {children && <Drawer.Trigger asChild>{children}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[100] flex h-[94dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-2.5 outline-none">
          <Drawer.Title className="sr-only">Add booking</Drawer.Title>
          <div className="flex shrink-0 flex-col items-center pt-0.5 pb-1">
            <div
              className="h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
          </div>

          {step === 'select-client' && (
            <SelectClientStep
              onClose={close}
              onPickLead={(lead) => {
                setSelectedLead(lead);
                setStep('select-service');
              }}
              onNewClient={() => setStep('new-client')}
              onBlockOff={() => setStep('block-time-off')}
            />
          )}

          {step === 'new-client' && (
            <NewClientStep
              onBack={() => setStep('select-client')}
              onCreated={(lead) => {
                setSelectedLead(lead);
                setStep('select-service');
              }}
            />
          )}

          {step === 'select-service' && selectedLead && (
            <SelectServiceStep
              lead={selectedLead}
              onBack={() => setStep('select-client')}
              onSelectService={(serviceId) => {
                setSelectedServiceId(serviceId);
                afterService();
              }}
            />
          )}

          {step === 'select-practitioner' && (
            <SelectPractitionerStep
              onBack={() => setStep('select-service')}
              onSelect={(id) => {
                setSelectedPractitionerId(id);
                setStep('create-appointment');
              }}
            />
          )}

          {step === 'create-appointment' &&
            selectedLead &&
            selectedServiceId && (
              <CreateAppointmentStep
                lead={selectedLead}
                serviceId={selectedServiceId}
                slotDate={slotDate}
                startTime={startTime}
                practitionerId={selectedPractitionerId}
                onBack={() =>
                  setStep(
                    practitionerId ? 'select-service' : 'select-practitioner'
                  )
                }
                onBooked={() => setStep('confirmed')}
              />
            )}

          {step === 'block-time-off' && (
            <BlockTimeOffStep
              slotDate={slotDate}
              startTime={startTime}
              practitionerId={practitionerId}
              onBack={() => setStep('select-client')}
              onSaved={close}
            />
          )}

          {step === 'confirmed' && <ConfirmedStep onDone={close} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// =============================================================================
// Step 1 — Select Client
// =============================================================================

interface SelectClientStepProps {
  onClose: () => void;
  onPickLead: (lead: Lead) => void;
  onNewClient: () => void;
  onBlockOff: () => void;
}

function SelectClientStep({
  onClose,
  onPickLead,
  onNewClient,
  onBlockOff,
}: SelectClientStepProps) {
  const [search, setSearch] = useState('');
  const { leads, isLoading } = useListLeads({
    filters: { search: search || undefined, limit: 50 },
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader title="Select Client" onBack={onClose} />

      <div className="px-5 pb-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your clients..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <button
          type="button"
          onClick={onBlockOff}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 active:bg-accent"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
            <Ban className="size-5" strokeWidth={2} />
          </div>
          <span className="text-base font-medium">Block off time</span>
        </button>

        <button
          type="button"
          onClick={onNewClient}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 active:bg-accent"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-blue-600 text-white">
            <UserPlus className="size-5" strokeWidth={2} />
          </div>
          <span className="text-base font-medium">New client</span>
        </button>

        <div className="my-3 border-t border-border" />

        {isLoading && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && leads.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            No clients found
          </p>
        )}
        {leads.map((lead) => {
          const name = [lead.firstName, lead.lastName]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={lead.id}
              type="button"
              onClick={() => onPickLead(lead)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 active:bg-accent"
            >
              <Avatar className="size-10">
                <AvatarFallback className="text-xs">
                  {(lead.firstName?.[0] ?? '?').toUpperCase()}
                  {(lead.lastName?.[0] ?? '').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-base font-medium">
                {name || lead.email || 'Unnamed'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Step 1a — New Client
// =============================================================================

interface NewClientStepProps {
  onBack: () => void;
  onCreated: (lead: Lead) => void;
}

/**
 * Uses the SHARED `createLeadSchema` + `CreateLeadFormFields` — the same pieces
 * the route funnel's "Create New Client" screen uses. The previous hand-rolled
 * form had no validation and hard-coded a `+353` dialling prefix onto the phone
 * number.
 */
function NewClientStep({ onBack, onCreated }: NewClientStepProps) {
  const { createLead, isCreating } = useCreateLead({
    onSuccess: (lead) => onCreated(lead),
  });

  const form = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: createLeadDefaultValues,
  });

  const onSubmit = (data: CreateLeadFormValues) => {
    createLead(data);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader
        title="Client Profile"
        subtitle="Fill out a client's details"
        onBack={onBack}
      />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <Form {...form}>
          <form
            id="mobile-drawer-create-lead"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            <CreateLeadFormFields form={form} variant="mobile" />
          </form>
        </Form>
      </div>

      <div className="border-t border-border px-5 pt-3 pb-2">
        <button
          type="submit"
          form="mobile-drawer-create-lead"
          disabled={isCreating}
          className={cn(
            MOBILE_PRIMARY_BUTTON_CLASS,
            isCreating && 'opacity-50'
          )}
        >
          {isCreating ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Step 2 — Select Service
// =============================================================================

interface SelectServiceStepProps {
  lead: Lead;
  onBack: () => void;
  onSelectService: (serviceId: string) => void;
}

function SelectServiceStep({
  lead,
  onBack,
  onSelectService,
}: SelectServiceStepProps) {
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader
        title="Select Service"
        subtitle={`For ${leadName}`}
        onBack={onBack}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-4">
        <AppointmentMobileServicePicker
          onSelect={onSelectService}
          className="min-h-0"
        />
      </div>
    </div>
  );
}

// =============================================================================
// Step 2a — Select Practitioner
// =============================================================================

/**
 * Only reached when the tapped slot has no practitioner column. We ASK instead
 * of silently assigning `practitioners[0]`, which is what the old drawer did.
 */
function SelectPractitionerStep({
  onBack,
  onSelect,
}: {
  onBack: () => void;
  onSelect: (practitionerId: string) => void;
}) {
  const { practitioners, isLoading } = useListPractitioners({
    params: { isActive: true, bookable: true },
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader
        title="Select Team Member"
        subtitle="Who is this appointment with?"
        onBack={onBack}
      />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <button
          type="button"
          onClick={() => onSelect(APPOINTMENT_NO_PRACTITIONER)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 active:bg-accent"
        >
          <Avatar className="size-10">
            <AvatarFallback className="text-xs">–</AvatarFallback>
          </Avatar>
          <span className="text-base font-medium">Any team member</span>
        </button>

        {isLoading && (
          <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
        )}

        {practitioners.map((practitioner) => (
          <button
            key={practitioner.id}
            type="button"
            onClick={() => onSelect(practitioner.id)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 active:bg-accent"
          >
            <Avatar className="size-10">
              <AvatarFallback className="text-xs">
                {practitioner.name
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-base font-medium">{practitioner.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Step 3 — Create Appointment
// =============================================================================

interface CreateAppointmentStepProps {
  lead: Lead;
  serviceId: string;
  slotDate: Date;
  startTime?: { hour: number; minute: number };
  practitionerId?: string;
  onBack: () => void;
  onBooked: () => void;
}

function CreateAppointmentStep({
  lead,
  serviceId,
  slotDate,
  startTime,
  practitionerId,
  onBack,
  onBooked,
}: CreateAppointmentStepProps) {
  const [isCreating, setIsCreating] = useState(false);
  const formId = 'mobile-drawer-create-appointment';
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader
        title="Create Appointment"
        subtitle={leadName}
        onBack={onBack}
      />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <AppointmentMobileCreateDetailsForm
          formId={formId}
          leadId={lead.id}
          serviceId={serviceId}
          slotDate={slotDate}
          defaultHour={startTime?.hour}
          defaultMinute={startTime?.minute}
          practitionerId={practitionerId}
          onPendingChange={setIsCreating}
          onSuccess={onBooked}
        />
      </div>

      <div className="border-t border-border px-5 pt-3 pb-2">
        <button
          type="submit"
          form={formId}
          disabled={isCreating}
          className={cn(
            MOBILE_PRIMARY_BUTTON_CLASS,
            isCreating && 'opacity-50'
          )}
        >
          {isCreating ? 'Creating…' : 'Create Appointment'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Step 4 — Block Time Off
// =============================================================================

interface BlockTimeOffStepProps {
  slotDate: Date;
  startTime?: { hour: number; minute: number };
  practitionerId?: string;
  onBack: () => void;
  onSaved: () => void;
}

/**
 * Thin shell around the SHARED blocked-time core. The old version was a second,
 * inconsistent block form: it hard-sent `blockedTimeTypeId: null` (so the `paid`
 * flag was unreachable), allowed only one practitioner, and offered 5 canned
 * RRULEs with no UNTIL/COUNT — i.e. infinite series.
 */
function BlockTimeOffStep({
  slotDate,
  startTime,
  practitionerId,
  onBack,
  onSaved,
}: BlockTimeOffStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  const formId = 'mobile-drawer-block-time';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <StepHeader
        title="Block Time Off"
        subtitle="Mark a time slot unavailable for customers to book"
        onBack={onBack}
      />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <MobileBlockedTimeForm
          formId={formId}
          initial={{
            startDate: slotDate,
            ...(startTime ? { startTime } : {}),
            practitionerId,
          }}
          onPendingChange={setIsSaving}
          onSaved={onSaved}
        />
      </div>

      <div className="border-t border-border px-5 pt-3 pb-2">
        <button
          type="submit"
          form={formId}
          disabled={isSaving}
          className={cn(MOBILE_PRIMARY_BUTTON_CLASS, isSaving && 'opacity-50')}
        >
          {isSaving ? 'Saving…' : 'Save Block'}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Step ✓ — Booking Confirmed
// =============================================================================

function ConfirmedStep({ onDone }: { onDone: () => void }) {
  // Auto-dismiss after a short celebratory beat
  useAutoTimeout(onDone, 1400);
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-card px-10 py-8 shadow-lg">
        <div className="flex size-14 items-center justify-center rounded-full border-2 border-foreground">
          <svg
            viewBox="0 0 24 24"
            className="size-8"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Booking confirmed"
          >
            <title>Booking confirmed</title>
            <polyline points="5 12 10 17 19 7" />
          </svg>
        </div>
        <div className="text-center text-lg font-semibold">
          Booking Confirmed!
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function StepHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <div className="px-5 pt-1 pb-3">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex size-9 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
        aria-label="Back"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
      </button>
      <h2 className="text-2xl font-bold leading-tight">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

function useAutoTimeout(cb: () => void, ms: number) {
  useEffect(() => {
    const t = setTimeout(cb, ms);
    return () => clearTimeout(t);
  }, [cb, ms]);
}
