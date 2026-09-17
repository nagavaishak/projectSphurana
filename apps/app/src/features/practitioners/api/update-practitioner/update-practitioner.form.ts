import { teamMemberForm } from '@/features/practitioners/components/team-member-editor/types';
import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The fields a user can edit on a practitioner — ONE declaration, spanning every
 * surface of `PUT practitioners/:id`.
 *
 * This mirrors `UpdatePractitionerIntent` (the typed input to the one shared
 * payload builder), because that is exactly what it is: the set of things the
 * user can change about a practitioner. FOUR surfaces write it, and each owns a
 * different slice — the profile dialog owns name/email/phone/title/bio, the
 * team-member editor owns the whole employment record, onboarding setup-profile
 * owns the photo/title and the working hours, and the invited-member wizard owns
 * the public profile (photo, headline/bio, languages, socials). The builder emits
 * only the keys a surface actually provides (PATCH), which is why the contract
 * declares `owns` per surface rather than demanding every surface render
 * everything.
 *
 * THE SHARED FIELDS ARE SPREAD FROM `teamMemberForm.specs`, not restated. A field
 * both forms carry (`email`, `phone`, `notes`, …) therefore has ONE schema, ONE
 * label and ONE sample across both — so the editor's panel and this contract
 * cannot drift apart, and a label changed in one place changes in both.
 *
 * `title` is the one deliberate wrinkle: the wire key is `title`, and the editor
 * labels its control "Job title" while the dialog labels it "Title" and
 * setup-profile "Your title / role". One field cannot carry three labels, so the
 * canonical label is the editor's and the other two surfaces pin their own
 * control with a per-surface `fills.title`. Each still locates a REAL control and
 * still fails loudly when it is deleted.
 */

const S = teamMemberForm.specs;

export const updatePractitionerForm = defineForm({
  fields: {
    // --- identity (profile dialog) -----------------------------------------
    name: {
      schema: z.string().trim().min(1, 'Name is required'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Grace Hopper',
    },

    // --- identity (team-member editor) -------------------------------------
    firstName: S.firstName,
    lastName: S.lastName,
    email: S.email,
    phone: S.phone,
    phoneCountry: S.phoneCountry,
    phoneSecondary: S.phoneSecondary,
    country: S.country,
    dateOfBirth: S.dateOfBirth,
    color: S.color,
    photo: S.photo,

    // Wire key `title`; the editor's control is the one labelled "Job title".
    title: S.jobTitle,

    // --- employment (team-member editor) -----------------------------------
    employmentStartDate: S.employmentStartDate,
    employmentEndDate: S.employmentEndDate,
    employmentType: S.employmentType,
    teamMemberRef: S.teamMemberRef,
    notes: S.notes,
    acceptsBookings: S.acceptsBookings,

    // --- public profile (dialog + invited-member wizard) --------------------
    bio: {
      schema: z.string(),
      label: 'Bio',
      control: 'textarea',
      default: '',
      sample: 'Loves balayage and a good silent appointment.',
    },
    headline: {
      schema: z.string(),
      label: 'Headline',
      control: 'text',
      default: '',
      sample: 'Senior stylist & colour specialist',
    },
    languages: {
      // Suggestion chips + a free-text adder — driven by a contract fill.
      schema: z.array(z.string()),
      label: 'Languages you speak',
      control: 'custom',
      default: [],
      sample: ['English'],
    },
    socialLinks: {
      // One input per network — driven by a contract fill.
      schema: z.record(z.string(), z.string()),
      label: 'Add your social links',
      control: 'custom',
      default: {},
      sample: { instagram: '@ada' },
    },

    // --- availability (onboarding setup-profile) ---------------------------
    workingHours: {
      // A per-day switch + two time selects — driven by a contract fill.
      schema: z.record(
        z.string(),
        z.object({ from: z.number(), to: z.number() })
      ),
      label: 'Working hours',
      control: 'custom',
      default: {},
      // The onboarding default (Mon–Fri 9–5) with Friday switched off.
      sample: {
        '1': { from: 540, to: 1020 },
        '2': { from: 540, to: 1020 },
        '3': { from: 540, to: 1020 },
        '4': { from: 540, to: 1020 },
      },
    },
  },
});

export type UpdatePractitionerFormValues = InferFormValues<
  typeof updatePractitionerForm
>;
