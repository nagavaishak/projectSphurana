import type {
  CountryCode,
  EmploymentType,
  PractitionerSocialLinks,
  UpdatePractitionerInput,
  UserColor,
  WorkingHours,
} from '@borradh-workspace/api-client/types';

/**
 * Typed INTENT for `PUT practitioners/:id`.
 *
 * Every surface that edits a practitioner (the profile dialog, the full
 * team-member editor, onboarding setup-profile, the self-onboarding wizard)
 * passes the SUBSET of these logical fields it actually edits — never a wire
 * body. `buildUpdatePractitionerPayload` is the single place that maps this
 * intent to the request body, so a field edited on two surfaces (e.g. `bio` on
 * the dialog and the wizard, `title` on the dialog / editor / setup-profile,
 * `photo` on the editor / setup-profile / wizard) is always assembled the same
 * way. PATCH semantics: only the keys present here are sent.
 *
 * Free-text values are the RAW form strings — the builder trims them and maps
 * empties to `null`. Enum-ish selectors may pass `''` for "unset" (mapped to
 * `null`). This keeps the surfaces dumb: they hand over what the form holds.
 */
export interface UpdatePractitionerIntent {
  /** Single display name (profile dialog only). */
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  phoneSecondary?: string;
  phoneCountry?: string;
  country?: CountryCode | '' | null;
  /** Resolved image URL (already uploaded) or a raw form string. */
  photo?: string | null;
  bio?: string;
  /** Job title / headline copy → `practitioner.title`. */
  title?: string;
  /** Public-profile headline (wizard). */
  headline?: string;
  dateOfBirth?: string;
  employmentStartDate?: string;
  employmentEndDate?: string;
  employmentType?: EmploymentType | '' | null;
  teamMemberRef?: string;
  notes?: string;
  acceptsBookings?: boolean;
  languages?: string[];
  /** Raw social handles — the builder drops empty entries. */
  socialLinks?: PractitionerSocialLinks;
  color?: UserColor | '' | null;
  workingHours?: WorkingHours;
}

/** The wire body is a partial of the derived update input (PATCH). */
export type UpdatePractitionerBody = Partial<UpdatePractitionerInput>;
