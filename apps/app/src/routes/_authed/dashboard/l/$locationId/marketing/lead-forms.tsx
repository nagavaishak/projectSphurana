import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { LeadFormList } from '@/features/lead-forms';
import type { LeadForm } from '@/features/lead-forms/api/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/lead-forms'
)({
  component: LeadFormsPage,
});

function LeadFormsPage() {
  const navigate = useNavigate();

  // Create and edit are the SHARED editor route now (`/create/lead-form`,
  // `/edit/lead-form/:id`) — the two dialogs this page used to own are gone.
  const openCreate = useCallback(
    () =>
      void navigate({ params: { entity: 'lead-form' }, to: '/create/$entity' }),
    [navigate]
  );
  const openEdit = useCallback(
    (leadForm: LeadForm) =>
      void navigate({
        params: { entity: 'lead-form', id: leadForm.id },
        to: '/edit/$entity/$id',
      }),
    [navigate]
  );

  return (
    <>
      <title>Lead Forms | Borradh</title>
      {/*
        The page chrome (title, primary action, empty/loading states, the phone
        list) all come from the shared `ListPage` inside `LeadFormList` — this
        route only owns navigation.
      */}
      <LeadFormList onCreateNew={openCreate} onEdit={openEdit} />
    </>
  );
}
