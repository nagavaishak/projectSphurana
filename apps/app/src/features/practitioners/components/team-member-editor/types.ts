import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import {
  countryCodeLabels,
  countryCodeValues,
  employmentTypeLabels,
  employmentTypeValues,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
  userColorLabels,
  userColorValues,
  wageAutomationSettingValues,
  wageCompensationTypeValues,
  wageOvertimeTypeValues,
  wageRegularHoursPerValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Left-nav section identifiers for the Add-team-member editor.
 */
export type SectionId =
  | 'profile'
  | 'services'
  | 'locations'
  | 'settings'
  | 'wages';

export interface NavItem {
  id: SectionId;
  label: string;
  /** Show a selected-count badge (services / locations). */
  countable?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
  {
    label: 'Workspace',
    items: [
      { id: 'services', label: 'Services', countable: true },
      { id: 'locations', label: 'Locations', countable: true },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    label: 'Pay',
    items: [{ id: 'wages', label: 'Wages and timesheets' }],
  },
];

/** The nested wage-config sub-form the Wages panel edits. */
const wageSchema = z.object({
  compensationType: z.enum(wageCompensationTypeValues),
  hourlyRate: z.string(),
  overtimeEnabled: z.boolean(),
  regularWorkHours: z.string(),
  regularWorkHoursPer: z.enum(wageRegularHoursPerValues),
  overtimeType: z.enum(wageOvertimeTypeValues),
  overtimeMultiplier: z.string(),
  overtimeHourlyRate: z.string(),
  autoClockIn: z.enum(wageAutomationSettingValues),
  autoClockOut: z.enum(wageAutomationSettingValues),
  automatedBreaks: z.enum(wageAutomationSettingValues),
  locationRestriction: z.enum(wageAutomationSettingValues),
});

export const DEFAULT_WAGE: z.infer<typeof wageSchema> = {
  compensationType: 'none',
  hourlyRate: '',
  overtimeEnabled: false,
  regularWorkHours: '',
  regularWorkHoursPer: 'week',
  overtimeType: 'multiplier',
  overtimeMultiplier: '1.5',
  overtimeHourlyRate: '',
  autoClockIn: 'workspace_default',
  autoClockOut: 'workspace_default',
  automatedBreaks: 'workspace_default',
  locationRestriction: 'workspace_default',
};

/** Enum-ish selector: the enum value, or `''` for "unset". */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.literal('')]);

/**
 * The team-member form, declared ONCE.
 *
 * Every key carries its schema, its label, its control and its default on one
 * line. `teamMemberFormSchema` (the zod resolver), `EMPTY_FORM` (the
 * `defaultValues`) and the labels the panels render are all derived from this —
 * so a field cannot exist in the schema and in `create-team-member.payload.ts`
 * while having no control on screen without the form contract catching it.
 * That is not hypothetical: the Phone / Country code / Additional phone inputs,
 * and the Birthday / Calendar color controls, were all deleted from
 * `profile-panel.tsx` in the mobile/form-parity sweep while the schema and the
 * payload builder kept mapping them, and every payload-level test stayed green.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const teamMemberForm = defineForm({
  fields: {
    photo: {
      // A hidden file input behind an avatar button — driven by a contract fill.
      schema: z.string(),
      label: 'Upload profile picture',
      control: 'custom',
      default: '',
      sample: 'https://cdn.example.com/team/grace.jpg',
    },
    firstName: {
      schema: z.string().trim().min(1, 'First name is required'),
      label: 'First name',
      control: 'text',
      default: '',
      sample: 'Grace',
    },
    lastName: {
      schema: z.string().trim().min(1, 'Last name is required'),
      label: 'Last name',
      control: 'text',
      default: '',
      sample: 'Hopper',
    },
    email: {
      schema: z
        .string()
        .trim()
        .min(1, 'Email is required')
        .email('Enter a valid email'),
      label: 'Email',
      control: 'email',
      default: '',
      sample: 'grace@example.com',
    },
    phoneCountry: {
      schema: z.string(),
      label: 'Country code',
      control: 'text',
      default: '',
      sample: '+353',
    },
    phone: {
      schema: z.string(),
      label: 'Phone',
      control: 'tel',
      default: '',
      sample: '851234567',
    },
    phoneSecondary: {
      schema: z.string(),
      label: 'Additional phone',
      control: 'tel',
      default: '',
      sample: '019876543',
    },
    country: {
      schema: optionalEnum(countryCodeValues),
      label: 'Country',
      control: 'select',
      default: '',
      sample: 'ie',
      sampleLabel: countryCodeLabels.ie,
    },
    dateOfBirth: {
      schema: z.string(),
      label: 'Birthday',
      control: 'date',
      default: '',
      sample: '1990-05-04',
    },
    color: {
      // A swatch grid of aria-labelled buttons — driven by a contract fill.
      schema: optionalEnum(userColorValues),
      label: 'Calendar color',
      control: 'custom',
      default: '',
      sample: 'blue',
      sampleLabel: userColorLabels.blue,
    },
    jobTitle: {
      schema: z.string(),
      label: 'Job title',
      control: 'text',
      default: '',
      sample: 'Senior Stylist',
    },
    employmentStartDate: {
      // Popover DatePicker (a button, not a textbox) — driven by a contract fill.
      schema: z.string(),
      label: 'Start date',
      control: 'custom',
      default: '',
      sample: '2026-03-02',
    },
    employmentEndDate: {
      schema: z.string(),
      label: 'End date',
      control: 'custom',
      default: '',
      sample: '2027-04-20',
    },
    employmentType: {
      schema: optionalEnum(employmentTypeValues),
      label: 'Employment type',
      control: 'select',
      default: '',
      sample: 'part_time',
      sampleLabel: employmentTypeLabels.part_time,
    },
    teamMemberRef: {
      schema: z.string(),
      label: 'Team member ID',
      control: 'text',
      default: '',
      sample: 'EMP-00123',
    },
    notes: {
      schema: z.string().max(1000, 'Notes must be 1000 characters or fewer'),
      label: 'Notes',
      control: 'textarea',
      default: '',
      sample: 'Prefers morning shifts.',
    },
    acceptsBookings: {
      schema: z.boolean(),
      // "Calendar bookings" was a misnomer: this flag is read ONLY by the
      // customer-facing paths (booking page, chatbot, voice). Turning it off
      // never removed anyone from the staff calendar, which is what the old
      // label and its "Appear on the calendar" description both promised.
      label: 'Online bookings',
      control: 'switch',
      default: true,
      sample: false,
    },
    permissionLevel: {
      schema: z.enum(teamPermissionLevelValues),
      label: 'Permission role',
      control: 'select',
      default: 'low',
      sample: 'medium',
      sampleLabel: teamPermissionLevelLabels.medium,
    },
    serviceIds: {
      // A searchable checkbox tree — driven by a contract fill.
      schema: z.array(z.string()),
      label: 'Services',
      control: 'custom',
      default: [],
      sample: ['svc_1'],
    },
    locationIds: {
      // A checkbox list — driven by a contract fill.
      schema: z.array(z.string()),
      label: 'Works at',
      control: 'custom',
      default: [],
      sample: ['loc_1'],
    },
    wage: {
      // A whole nested panel. `derived` because the wire carries `wageConfig`
      // (rates in cents, hours as numbers), not these raw form strings — the
      // contract's `expectedBody` spells that mapping out.
      schema: wageSchema,
      label: 'Wages and timesheets',
      control: 'custom',
      default: DEFAULT_WAGE,
      sample: {
        compensationType: 'hourly',
        hourlyRate: '15.50',
        overtimeEnabled: true,
        regularWorkHours: '40',
        regularWorkHoursPer: 'week',
        overtimeType: 'multiplier',
        overtimeMultiplier: '1.5',
        overtimeHourlyRate: '',
        autoClockIn: 'enabled',
        autoClockOut: 'disabled',
        automatedBreaks: 'enabled',
        locationRestriction: 'enabled',
      },
      derived: true,
    },
  },
});

/** The zod resolver schema — derived from the field declarations. */
export const teamMemberFormSchema = teamMemberForm.schema;
/** `useForm({ defaultValues })` — derived from the field declarations. */
export const EMPTY_FORM = teamMemberForm.defaults;

export type TeamMemberFormValues = InferFormValues<typeof teamMemberForm>;
export type WageFormValues = TeamMemberFormValues['wage'];

/** Fields that live on each nav section — drives validation-error highlighting. */
export const SECTION_FIELDS: Record<SectionId, (keyof TeamMemberFormValues)[]> =
  {
    profile: [
      'photo',
      'firstName',
      'lastName',
      'email',
      'phone',
      'phoneCountry',
      'phoneSecondary',
      'country',
      'dateOfBirth',
      'color',
      'jobTitle',
      'employmentStartDate',
      'employmentEndDate',
      'employmentType',
      'teamMemberRef',
      'notes',
    ],
    services: ['serviceIds'],
    locations: ['locationIds'],
    settings: ['acceptsBookings', 'permissionLevel'],
    wages: ['wage'],
  };

/** Build form defaults from an existing practitioner (edit mode). */
export function formValuesFromPractitioner(
  practitioner: PractitionerWithRelations
): TeamMemberFormValues {
  const nameParts = practitioner.name?.trim().split(/\s+/) ?? [];
  return {
    ...EMPTY_FORM,
    photo: practitioner.photo ?? '',
    firstName: practitioner.firstName ?? nameParts[0] ?? '',
    lastName: practitioner.lastName ?? nameParts.slice(1).join(' ') ?? '',
    email: practitioner.email ?? '',
    phone: practitioner.phone ?? '',
    phoneCountry: practitioner.phoneCountry ?? '',
    phoneSecondary: practitioner.phoneSecondary ?? '',
    country: (practitioner.country as TeamMemberFormValues['country']) ?? '',
    dateOfBirth: practitioner.dateOfBirth ?? '',
    color: (practitioner.color as TeamMemberFormValues['color']) ?? '',
    jobTitle: practitioner.title ?? '',
    employmentStartDate: practitioner.employmentStartDate ?? '',
    employmentEndDate: practitioner.employmentEndDate ?? '',
    employmentType:
      (practitioner.employmentType as TeamMemberFormValues['employmentType']) ??
      '',
    teamMemberRef: practitioner.teamMemberRef ?? '',
    notes: practitioner.notes ?? '',
    acceptsBookings: practitioner.acceptsBookings ?? true,
    serviceIds: practitioner.services?.map((s) => s.serviceId) ?? [],
    locationIds: practitioner.locations?.map((l) => l.locationId) ?? [],
  };
}
