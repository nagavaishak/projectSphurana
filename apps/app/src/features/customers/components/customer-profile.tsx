import { useState } from 'react';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { MailIcon, PhoneIcon, ShoppingBagIcon } from 'lucide-react';

import { EntityView, EntityViewAside } from '@/components/app/entity-view';
import { StateError } from '@/components/app/state-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientAppointmentsTab } from '@/features/clients/components/client-appointments-tab';
import { ClientDetailsTab } from '@/features/clients/components/client-details-tab';
import { ClientFormsTab } from '@/features/clients/components/client-forms-tab';
import { ClientMembershipsTab } from '@/features/clients/components/client-memberships-tab';
import { ClientPaymentMethodsTab } from '@/features/clients/components/client-payment-methods-tab';
import { ClientSalesTab } from '@/features/clients/components/client-sales-tab';
import { useLead } from '@/features/leads';
import { LeadHistoryTab } from '@/features/leads/components/lead-detail/lead-history-tab';
import { useLeadProfile } from '@/features/patient-profile/api';
import { PatientDocumentsTab } from '@/features/patient-profile/components/patient-documents-tab';
import { PatientFormsTab } from '@/features/patient-profile/components/patient-forms-tab';
import { PatientNotesTab } from '@/features/patient-profile/components/patient-notes-tab';
import { useCheckoutStore } from '@/features/sales';

import { ClinicalTab } from '@/features/wireframes/consultation/clinical-tab';

import { CustomerPortalLinkButton } from './customer-portal-link-button';

const TABS = [
  { value: 'appointments', label: 'Appointments' },
  // The one genuinely new tab. Photos, Face map, Skin and Treatments share a
  // subject — the patient's body over time — so they nest under one tab rather
  // than adding four to a strip that already wraps.
  { value: 'clinical', label: 'Clinical' },
  { value: 'sales', label: 'Sales' },
  { value: 'payments', label: 'Payment methods' },
  { value: 'memberships', label: 'Memberships' },
  { value: 'consent', label: 'Consent' },
  // Intake forms and the document vault merged: both are paperwork ON FILE
  // about the patient, and two tabs meant checking both to answer "what have
  // we got for her". Consent stays its own tab — it expires, it blocks
  // treatment, and it is the one a receptionist looks for by name.
  { value: 'paperwork', label: 'Forms & documents' },
  { value: 'notes', label: 'Notes' },
  { value: 'details', label: 'Details' },
  { value: 'activity', label: 'Activity' },
] as const;

/**
 * The unified client profile (unify-customers Phase 4): one page folding the
 * old clients profile (appointments, sales, payment methods, memberships,
 * intake forms, details, activity) into the ENG-647 patient profile (consent
 * forms, documents, and the "copy portal link" action). Two cached reads back
 * it: `useLead` for the commerce tabs and header, and the `useLeadProfile`
 * aggregate for the clinical tabs.
 */
export function CustomerProfile({ leadId }: { leadId: string }) {
  const routes = useResolvedRoutes();
  const navigate = useNavigate();
  const { lead, isLoading, isError, refetch } = useLead({ leadId });
  const { profile } = useLeadProfile(leadId);
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const [tab, setTab] = useState('appointments');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !lead) {
    return (
      <StateError
        message="Failed to load this client. Please try again."
        onRetry={() => refetch()}
      />
    );
  }

  const fullName = `${lead.firstName} ${lead.lastName || ''}`.trim();
  const initials =
    `${lead.firstName.charAt(0)}${lead.lastName?.charAt(0) || ''}`.toUpperCase();

  return (
    <EntityView
      config={{
        identity: { title: fullName, initials },
        back: {
          label: 'Back to clients',
          onClick: () => navigate({ to: routes.customers }),
        },
        actions: (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openCheckout({ leadId: lead.id })}
            >
              <ShoppingBagIcon className="size-4" />
              New sale
            </Button>
            <CustomerPortalLinkButton
              leadId={lead.id}
              firstName={lead.firstName}
            />
          </>
        ),
        tabs: TABS.map((t) => ({ id: t.value, label: t.label })),
        activeTab: tab,
        onTabChange: setTab,
        aside: (
          <EntityViewAside>
            <div className="space-y-3">
              {lead.email ? (
                <AsideFact icon={MailIcon} label="Email" value={lead.email} />
              ) : null}
              {lead.phone ? (
                <AsideFact icon={PhoneIcon} label="Mobile" value={lead.phone} />
              ) : null}
            </div>
          </EntityViewAside>
        ),
      }}
    >
      {tab === 'appointments' && <ClientAppointmentsTab leadId={lead.id} />}
      {tab === 'clinical' && <ClinicalTab />}
      {tab === 'sales' && <ClientSalesTab leadId={lead.id} />}
      {tab === 'payments' && <ClientPaymentMethodsTab leadId={lead.id} />}
      {tab === 'memberships' && <ClientMembershipsTab leadId={lead.id} />}
      {tab === 'paperwork' && (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Forms
            </h2>
            <ClientFormsTab leadId={lead.id} />
          </section>
          <section className="space-y-3">
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Documents
            </h2>
            {profile ? (
              <PatientDocumentsTab
                leadId={lead.id}
                documents={profile.documents}
              />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </section>
        </div>
      )}
      {tab === 'consent' &&
        (profile ? (
          <PatientFormsTab
            leadId={lead.id}
            submissions={profile.consentFormSubmissions}
            uploaded={profile.uploadedConsentForms}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        ))}
      {/*
        The two notes live HERE and only here. Each saves its own field on its
        own button, so publishing an aftercare note can never be undone by
        someone saving internal commentary a second later (ENG-791). The Details
        form deliberately no longer carries `portalNote` for the same reason.
      */}
      {tab === 'notes' &&
        (profile ? (
          <PatientNotesTab lead={profile.lead} />
        ) : (
          <Skeleton className="h-64 w-full" />
        ))}
      {tab === 'details' && <ClientDetailsTab lead={lead} />}
      {tab === 'activity' && <LeadHistoryTab leadId={lead.id} />}
    </EntityView>
  );
}

function AsideFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MailIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="break-words text-sm">{value}</p>
      </div>
    </div>
  );
}
