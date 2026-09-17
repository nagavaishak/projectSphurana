'use client';

import { useNavigate } from '@tanstack/react-router';
import {
  Building2,
  Clock,
  MapPin,
  Package,
  Scissors,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import {
  AddressAutocomplete,
  type AddressResult,
} from '@/components/ui/address-autocomplete';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { InlineCreateSelect } from '@/features/inventory/components/inline-create-select';
import { ROUTES } from '@/lib/route-paths';
import type { LocationOpeningHours } from '@borradh-workspace/api-client/types';
import {
  countryCodeLabels,
  countryCodeValues,
} from '@borradh-workspace/api-client/types';

import { WeeklyOpeningHoursEditor } from '@/components/app/org-settings/tabs/opening-hours';
import { useUpdateStandingOpeningHours } from '@/features/location-opening-hours';
import { useListOffers } from '@/features/offers';
import { useListServices } from '@/features/organization-services';
import { useListPractitioners } from '@/features/practitioners/api';
import { useListMembershipPlans, useListProducts } from '@/features/sales/api';

import { useCreateLocation } from '../api/create-location';
import { useListLocations } from '../api/list-locations';
import {
  useApplyLocationCatalog,
  useGetLocationCatalog,
} from '../api/location-catalog';
import type { OrganizationLocation } from '../api/types';
import type { CountryCode, CreateLocationInput } from '../api/types';
import { useUpdateLocation } from '../api/update-location';
import { CatalogPicker, type CatalogPickerItem } from './catalog-picker';
import { createLocationForm } from './location-form';
import type { CreateLocationIntent } from './location-form.input';
import {
  buildCreateLocationPayload,
  buildUpdateLocationPayload,
} from './location-form.payload';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createLocationForm.labels;

const COUNTRY_OPTIONS = countryCodeValues.map((value) => ({
  value,
  label: countryCodeLabels[value],
}));

const blankForm: CreateLocationIntent = {
  copyFromLocationId: null,
  practitionerIds: [],
  serviceIds: [],
  productIds: [],
  membershipPlanIds: [],
  offerIds: [],
  name: '',
  isPrimary: false,
  addressLine1: '',
  addressLine2: '',
  city: '',
  county: '',
  postalCode: '',
  country: 'ie',
  latitude: null,
  longitude: null,
};

/**
 * Create-location editor — CONFIG AND STATE ONLY, no layout.
 *
 * Create-only, like stocktakes: editing a branch also edits its opening hours,
 * which is a different endpoint and a different control, and that surface
 * already exists on the locations page. `/edit/location/:id` therefore has
 * nothing to render and nothing links to it.
 *
 * The address search is deliberately NOT an either/or with manual entry, which
 * is what the dialog this replaces did. Picking a place fills the fields below
 * it and they stay visible — so what Google decided your address is is
 * something you can see and correct, rather than a summary line you either
 * accept or discard by switching modes.
 */
/** The record's own fields, as the form holds them. */
function formFromLocation(
  location: OrganizationLocation
): Omit<
  CreateLocationIntent,
  | 'copyFromLocationId'
  | 'practitionerIds'
  | 'serviceIds'
  | 'productIds'
  | 'membershipPlanIds'
  | 'offerIds'
> {
  return {
    name: location.name ?? '',
    isPrimary: location.isPrimary,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2 ?? '',
    city: location.city,
    county: location.county ?? '',
    postalCode: location.postalCode ?? '',
    country: location.country,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
  };
}

export function useLocationEditor({
  id,
}: { id?: string } = {}): EntityEditorState {
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const [values, setValues] = useState<CreateLocationIntent>(blankForm);

  const { createLocationAsync, isCreating } = useCreateLocation();
  const { updateLocationAsync, isUpdating } = useUpdateLocation();
  const { applyLocationCatalogAsync, isApplying } = useApplyLocationCatalog();
  const { updateStandingOpeningHoursAsync, isUpdating: isUpdatingHours } =
    useUpdateStandingOpeningHours();

  // Opening hours live on their own endpoint and are not part of the location
  // row, so they are held beside the form's values rather than in them.
  const [openingHours, setOpeningHours] = useState<LocationOpeningHours | null>(
    null
  );
  const [initialOpeningHours, setInitialOpeningHours] =
    useState<LocationOpeningHours | null>(null);
  const { catalog, isLoading: catalogLoading } = useGetLocationCatalog(
    id ?? ''
  );

  // The org's whole catalogue, so every tab can offer the full list. These are
  // cached list queries the rest of the app already runs.
  const { practitioners, isLoading: practitionersLoading } =
    useListPractitioners();
  const { services, isLoading: servicesLoading } = useListServices();
  const { products, isLoading: productsLoading } = useListProducts();
  const { plans, isLoading: plansLoading } = useListMembershipPlans();
  const { offers, isLoading: offersLoading } = useListOffers();
  const { locations, isLoading: locationsLoading } = useListLocations();

  // There is no get-by-id endpoint; the list is already cached everywhere the
  // switcher renders, so edit resolves from it rather than adding a fetch.
  const record = id ? (locations.find((l) => l.id === id) ?? null) : null;

  // Edit mode: the record and its catalogue arrive after the first render, and
  // the URL is reachable directly rather than only from a list row.
  useEffect(() => {
    if (!record) return;
    setValues((prev) => ({ ...prev, ...formFromLocation(record) }));
    const hours = (record.openingHours ?? null) as LocationOpeningHours | null;
    setOpeningHours(hours);
    setInitialOpeningHours(hours);
  }, [record]);

  useEffect(() => {
    if (!catalog) return;
    setValues((prev) => ({ ...prev, ...catalog }));
  }, [catalog]);

  const setValue = useCallback(
    (name: string, value: unknown) =>
      setValues((prev) => ({ ...prev, [name]: value })),
    []
  );

  // A picked place writes seven fields at once; setting them one at a time
  // would render six intermediate states with a half-written address.
  const applyPlace = useCallback(
    (place: AddressResult) =>
      setValues((prev) => ({
        ...prev,
        addressLine1: place.addressLine1,
        city: place.city,
        county: place.county,
        postalCode: place.postalCode,
        country: (place.country || prev.country) as CountryCode,
        latitude: place.latitude,
        longitude: place.longitude,
      })),
    []
  );

  /**
   * One catalogue tab. Every tab is the same control over a different list, so
   * they are generated rather than hand-written five times — a tab that drifted
   * from its siblings would be a tab whose additive-only warning had gone
   * missing.
   */
  const catalogSection = useCallback(
    (args: {
      id: string;
      label: string;
      icon: LucideIcon;
      field: keyof CreateLocationIntent;
      items: CatalogPickerItem[];
      isLoading: boolean;
      noun: string;
      emptyLabel: string;
    }) => ({
      id: args.id,
      label: args.label,
      icon: args.icon,
      blocks: [
        {
          title: args.label,
          rows: [
            [
              {
                kind: 'custom' as const,
                name: args.field,
                render: ({ disabled }: { disabled: boolean }) => (
                  <Field>
                    <FieldDescription>
                      Tick the {args.noun} to make available at this branch.
                      Anything not restricted to specific branches is already
                      available everywhere, including here — leaving this empty
                      does not take anything away.
                    </FieldDescription>
                    <CatalogPicker
                      disabled={disabled}
                      emptyLabel={args.emptyLabel}
                      isLoading={args.isLoading}
                      items={args.items}
                      onChange={(ids) => setValue(args.field, ids)}
                      searchPlaceholder={`Search ${args.noun}…`}
                      selectedIds={values[args.field] as string[]}
                    />
                  </Field>
                ),
              },
            ],
          ],
        },
      ],
    }),
    [values, setValue]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (editing: boolean) => (editing ? 'Edit Location' : 'Add Location'),
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: Building2,
          blocks: [
            {
              title: 'Location Details',
              rows: [
                [
                  {
                    kind: 'text',
                    name: 'name',
                    label: L.name,
                    placeholder: 'e.g. Bray Studio',
                    description:
                      'Optional. Falls back to the address wherever the branch is listed.',
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'copyFromLocationId',
                    // Create-only. On an existing branch the catalogue tabs
                    // already show what is assigned, and a bulk copy on top of
                    // them would be a second, conflicting way to say the same
                    // thing — with no obvious answer for what happens to the
                    // rows already there.
                    hidden: () => isEdit || locations.length === 0,
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="location-copy-from">
                          {L.copyFromLocationId}
                        </FieldLabel>
                        <InlineCreateSelect
                          clearLabel="Start empty"
                          disabled={disabled || locationsLoading}
                          emptyLabel="No other branches yet."
                          id="location-copy-from"
                          onChange={(id) => setValue('copyFromLocationId', id)}
                          options={locations.map((l) => ({
                            id: l.id,
                            name: l.name ?? l.addressLine1,
                          }))}
                          placeholder="Start empty"
                          searchPlaceholder="Search branches…"
                          value={values.copyFromLocationId}
                        />
                        <FieldDescription>
                          Copies that branch's explicit assignments onto this
                          one. Defaults to copying nothing.
                        </FieldDescription>
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'isPrimary',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="location-primary">
                          {L.isPrimary}
                        </FieldLabel>
                        <Switch
                          checked={values.isPrimary}
                          disabled={disabled}
                          id="location-primary"
                          onCheckedChange={(checked) =>
                            setValue('isPrimary', checked)
                          }
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'address',
          label: 'Address',
          icon: MapPin,
          blocks: [
            {
              title: 'Address',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'addressSearch',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="location-address-search">
                          Search for an address
                        </FieldLabel>
                        <AddressAutocomplete
                          disabled={disabled}
                          onPlaceSelect={applyPlace}
                          placeholder="Start typing an address…"
                        />
                        <FieldDescription>
                          Fills the fields below. Everything stays editable.
                        </FieldDescription>
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'addressLine1',
                    label: L.addressLine1,
                    placeholder: '12 Quinsboro Road',
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'addressLine2',
                    label: L.addressLine2,
                    placeholder: 'Unit, floor, building',
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'city',
                    label: L.city,
                    placeholder: 'Bray',
                  },
                  {
                    kind: 'text',
                    name: 'county',
                    label: L.county,
                    placeholder: 'Wicklow',
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'postalCode',
                    label: L.postalCode,
                    placeholder: 'A98 X264',
                  },
                  {
                    kind: 'select',
                    name: 'country',
                    label: L.country,
                    options: COUNTRY_OPTIONS,
                  },
                ],
              ],
            },
          ],
        },
        // Edit-only: the endpoint is keyed on a location id, so there is
        // nothing to write hours against until the branch exists.
        ...(isEdit
          ? [
              {
                id: 'hours',
                label: 'Opening hours',
                icon: Clock,
                blocks: [
                  {
                    title: 'Opening hours',
                    rows: [
                      [
                        {
                          kind: 'custom' as const,
                          name: 'openingHours',
                          render: () => (
                            <Field>
                              <FieldDescription>
                                Turn a day off to mark it closed. Clear all days
                                to use the organisation's default hours.
                              </FieldDescription>
                              <WeeklyOpeningHoursEditor
                                onChange={setOpeningHours}
                                value={openingHours}
                              />
                            </Field>
                          ),
                        },
                      ],
                    ],
                  },
                ],
              },
            ]
          : []),
        catalogSection({
          id: 'team',
          label: 'Team',
          icon: Users,
          field: 'practitionerIds',
          items: practitioners.map((p) => ({ id: p.id, name: p.name })),
          isLoading: practitionersLoading,
          noun: 'team members',
          emptyLabel: 'No team members yet.',
        }),
        catalogSection({
          id: 'services',
          label: 'Services',
          icon: Scissors,
          field: 'serviceIds',
          items: services.map((s) => ({ id: s.id, name: s.name })),
          isLoading: servicesLoading,
          noun: 'services',
          emptyLabel: 'No services yet.',
        }),
        catalogSection({
          id: 'products',
          label: 'Products',
          icon: Package,
          field: 'productIds',
          items: products.map((p) => ({ id: p.id, name: p.name })),
          isLoading: productsLoading,
          noun: 'products',
          emptyLabel: 'No products yet.',
        }),
        catalogSection({
          id: 'memberships',
          label: 'Memberships',
          icon: Sparkles,
          field: 'membershipPlanIds',
          items: plans.map((p) => ({ id: p.id, name: p.name })),
          isLoading: plansLoading,
          noun: 'membership plans',
          emptyLabel: 'No membership plans yet.',
        }),
        catalogSection({
          id: 'promotions',
          label: 'Promotions',
          icon: Ticket,
          field: 'offerIds',
          items: offers.map((o) => ({ id: o.id, name: o.name })),
          isLoading: offersLoading,
          noun: 'promotions',
          emptyLabel: 'No promotions yet.',
        }),
      ],
    }),
    [
      values.isPrimary,
      values.copyFromLocationId,
      setValue,
      applyPlace,
      catalogSection,
      isEdit,
      openingHours,
      locations,
      locationsLoading,
      practitioners,
      practitionersLoading,
      services,
      servicesLoading,
      products,
      productsLoading,
      plans,
      plansLoading,
      offers,
      offersLoading,
    ]
  );

  // A location without an address is not a location. Both fields are required
  // by the wire contract, so the button stays greyed until they are answered
  // rather than accepting a click and returning a toast.
  const saveDisabled =
    !values.addressLine1.trim() || !values.city.trim() || !values.country;

  const onSave = useCallback(async () => {
    // Belt and braces: `saveDisabled` greys the button, but onSave is also
    // reachable from the mobile bar's keyboard path.
    if (saveDisabled) return;

    try {
      if (id) {
        // Two calls, not one: the record and its catalogue are separate
        // endpoints on an EXISTING branch (create can fold them into one
        // transaction because the row does not exist yet). The record goes
        // first — if the catalogue write fails, the address edit is still
        // saved and the tabs can be retried, which is the better half to lose.
        await updateLocationAsync({
          id,
          ...buildUpdateLocationPayload(values),
        });

        await applyLocationCatalogAsync({
          locationId: id,
          practitionerIds: values.practitionerIds,
          serviceIds: values.serviceIds,
          productIds: values.productIds,
          membershipPlanIds: values.membershipPlanIds,
          offerIds: values.offerIds,
        });

        // Its own endpoint, and only when actually touched — an unchanged save
        // should not rewrite the branch's standing hours.
        if (
          JSON.stringify(openingHours ?? null) !==
          JSON.stringify(initialOpeningHours ?? null)
        ) {
          await updateStandingOpeningHoursAsync({
            locationId: id,
            openingHours,
          });
        }
      } else {
        await createLocationAsync(
          buildCreateLocationPayload(values) as CreateLocationInput
        );
      }
      await navigate({ to: ROUTES.locations });
    } catch {
      // The hooks already surface an error toast.
    }
  }, [
    id,
    values,
    saveDisabled,
    createLocationAsync,
    updateLocationAsync,
    applyLocationCatalogAsync,
    updateStandingOpeningHoursAsync,
    openingHours,
    initialOpeningHours,
    navigate,
  ]);

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving: isCreating || isUpdating || isApplying || isUpdatingHours,
    saveDisabled,
    isLoading: isEdit && (locationsLoading || catalogLoading),
    notFound: isEdit && !locationsLoading && !record,
    onSave: () => void onSave(),
    onCancel: () => void navigate({ to: ROUTES.locations }),
  };
}
