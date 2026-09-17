'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ListTree, MapPin, SettingsIcon, UserIcon, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import type {
  EntityFormConfig,
  EntityFormErrors,
  EntityFormValues,
} from '@/components/app/entity-editor';
import { Button } from '@/components/ui/button';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListLocations } from '@/features/organization-locations';
import { useListServices } from '@/features/organization-services';

import {
  buildCreateTeamMemberPayload,
  useAssignPractitionerLocations,
  useAssignPractitionerServices,
  useCreateTeamMember,
  useInvitePractitioner,
  useUpdatePractitioner,
} from '../../api';
import { LocationsPanel } from './locations-panel';
import { ProfilePanel } from './profile-panel';
import { ServicesPanel } from './services-panel';
import { SettingsPanel } from './settings-panel';
import {
  EMPTY_FORM,
  type TeamMemberFormValues,
  formValuesFromPractitioner,
  teamMemberFormSchema,
} from './types';
import { WagesPanel } from './wages-panel';

/**
 * The team-member editor — CONFIG AND STATE ONLY, no layout.
 *
 * This was a bespoke full-screen portal with its own header, its own left nav,
 * its own mobile tab strip and its own save bar. All of that is now the shared
 * `/create/team-member` and `/edit/team-member/$id` chrome; what survives is
 * the part that was actually team-member-specific: the react-hook-form
 * instance, the create-mode seeding, and the save sequence.
 *
 * Each of the five original panels becomes ONE section, brought in through
 * `kind: 'custom'` — the panels render themselves against the same
 * `UseFormReturn` they always did. Nothing about Profile, Services,
 * **Locations**, Settings or Wages is re-expressed as generic fields, so the
 * payloads (and the location assignment in particular) cannot drift.
 */
export function useTeamMemberEditor({
  practitioner,
  isEditing,
}: {
  /** Null → create mode, or edit mode still loading. */
  practitioner: PractitionerWithRelations | null;
  isEditing: boolean;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const form = useForm<TeamMemberFormValues>({
    resolver: zodResolver(teamMemberFormSchema) as never,
    defaultValues: EMPTY_FORM,
  });

  // Hydration runs once: in edit mode when the record lands, in create mode
  // immediately. A ref (rather than a values dependency) so a later user edit
  // is never clobbered by a background refetch.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    if (practitioner) {
      hydrated.current = true;
      form.reset(formValuesFromPractitioner(practitioner));
    } else if (!isEditing) {
      hydrated.current = true;
      // Create: prefill the start date with today.
      form.reset({
        ...EMPTY_FORM,
        employmentStartDate: format(new Date(), 'yyyy-MM-dd'),
      });
    }
  }, [practitioner, isEditing, form]);

  // On create, default to all services + all locations selected. Seeded once
  // (refs guard against clobbering the user's later edits).
  const { services } = useListServices();
  const { locations } = useListLocations();
  const servicesSeeded = useRef(false);
  const locationsSeeded = useRef(false);

  useEffect(() => {
    if (isEditing || servicesSeeded.current || services.length === 0) return;
    servicesSeeded.current = true;
    form.setValue(
      'serviceIds',
      services.map((s) => s.id)
    );
  }, [isEditing, services, form]);

  useEffect(() => {
    if (isEditing || locationsSeeded.current || locations.length === 0) return;
    locationsSeeded.current = true;
    form.setValue(
      'locationIds',
      locations.map((l) => l.id)
    );
  }, [isEditing, locations, form]);

  const goToList = useCallback(
    () => void navigate({ to: routes.teamMembers }),
    [navigate, routes.teamMembers]
  );

  const { createTeamMember, isCreating } = useCreateTeamMember({
    onSuccess: goToList,
  });
  const { invitePractitioner, isInviting } = useInvitePractitioner();
  const { updatePractitionerAsync, isUpdating } = useUpdatePractitioner();
  const { assignServicesAsync } = useAssignPractitionerServices();
  const { assignLocationsAsync } = useAssignPractitionerLocations();
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const isSaving = isCreating || isUpdating || isSavingEdit;

  const onValid = async (values: TeamMemberFormValues) => {
    if (isEditing && practitioner) {
      setIsSavingEdit(true);
      try {
        // Pass RAW form values as intent — the shared builder trims/normalises
        // (empty → null) exactly the way every other practitioner surface does.
        await updatePractitionerAsync({
          id: practitioner.id,
          photo: values.photo,
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          phone: values.phone,
          phoneSecondary: values.phoneSecondary,
          phoneCountry: values.phoneCountry,
          country: values.country,
          dateOfBirth: values.dateOfBirth,
          employmentStartDate: values.employmentStartDate,
          employmentEndDate: values.employmentEndDate,
          employmentType: values.employmentType,
          teamMemberRef: values.teamMemberRef,
          notes: values.notes,
          acceptsBookings: values.acceptsBookings,
          title: values.jobTitle,
          color: values.color,
        });
        await assignServicesAsync({
          practitionerId: practitioner.id,
          serviceIds: values.serviceIds,
        });
        await assignLocationsAsync({
          practitionerId: practitioner.id,
          locationIds: values.locationIds,
        });
        goToList();
      } finally {
        setIsSavingEdit(false);
      }
      return;
    }

    createTeamMember(buildCreateTeamMemberPayload(values));
  };

  const submit = form.handleSubmit(onValid);

  // An existing member with no linked account has not accepted — either the
  // invitation never arrived, or (for anyone added by the onboarding wizard)
  // one was never sent. The shared chrome owns Cancel/Save, so the action lives
  // in the Profile section rather than in the header it used to sit in.
  const canInvite = isEditing && practitioner && !practitioner.userId;
  const inviteId = practitioner?.id;

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit team member' : 'Add team member'),
      sections: [
        {
          id: 'profile',
          label: 'Profile',
          icon: UserIcon,
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'profile',
                    render: () => <ProfilePanel form={form} />,
                  },
                ],
              ],
            },
            ...(canInvite && inviteId
              ? [
                  {
                    title: 'Invitation',
                    rows: [
                      [
                        {
                          kind: 'custom' as const,
                          name: 'invite',
                          render: () => (
                            <Button
                              disabled={isInviting}
                              onClick={() =>
                                invitePractitioner({ id: inviteId })
                              }
                              type="button"
                              variant="outline"
                            >
                              {isInviting ? 'Sending...' : 'Send invitation'}
                            </Button>
                          ),
                        },
                      ],
                    ],
                  },
                ]
              : []),
          ],
        },
        {
          id: 'services',
          label: 'Services',
          icon: ListTree,
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'serviceIds',
                    render: () => <ServicesPanel form={form} />,
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'locations',
          label: 'Locations',
          icon: MapPin,
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'locationIds',
                    render: () => <LocationsPanel form={form} />,
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: SettingsIcon,
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'settings',
                    render: () => <SettingsPanel form={form} />,
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'wages',
          label: 'Wages and timesheets',
          icon: Wallet,
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'wage',
                    render: () => (
                      <WagesPanel form={form} practitionerId={inviteId} />
                    ),
                  },
                ],
              ],
            },
          ],
        },
      ],
    }),
    [form, canInvite, inviteId, isInviting, invitePractitioner]
  );

  // Every validated field lives on Profile, which is the section the shared
  // page returns to on save — so an invalid submit lands on the errors.
  const errors: EntityFormErrors = useMemo(() => {
    const out: EntityFormErrors = {};
    for (const [key, value] of Object.entries(form.formState.errors)) {
      out[key] = (value as { message?: string } | undefined)?.message;
    }
    return out;
  }, [form.formState.errors]);

  return {
    config,
    // The panels read and write through `form`, not through this snapshot; it
    // exists so the shared renderer's field context is populated.
    values: form.getValues() as unknown as EntityFormValues,
    errors,
    setValue: (name, value) =>
      form.setValue(name as keyof TeamMemberFormValues, value as never, {
        shouldDirty: true,
      }),
    isSaving,
    onSave: () => void submit(),
    onCancel: goToList,
  };
}
