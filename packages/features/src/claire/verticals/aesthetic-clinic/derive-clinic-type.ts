import type { OrganizationService } from '@borradh-workspace/database';
import type { Axes } from '../types.js';
import { taxonomiseService } from './service-taxonomy.js';

// The five first-class clinic types the spec reasons about. The engine has no
// persisted `clinicType` column — this is a *derived* label only, mirroring the
// branch logic in `classify.ts` `heuristicClassify`. (Persisting it is a
// separate later ticket, WI-0.7.)
export type ClinicType =
  | 'nurse_injectable'
  | 'beauty_therapist'
  | 'body_contouring'
  | 'mixed'
  | 'doctor_surgical';

type DerivedServiceFlags = {
  hasSurgical: boolean;
  hasInjectables: boolean;
  hasBodyContouring: boolean;
  courseBasedCount: number;
  hasBeautyTherapistServices: boolean;
};

const BODY_CONTOURING_CANONICALS = [
  'fat_dissolving',
  'cavitation',
  'rf_skin_tightening',
  'cryolipolysis',
  'ems_body',
];

// Summarise a menu into the boolean/count flags the type branches need. This is
// the taxonomy-derived fallback used when `verticalMetadata` doesn't carry the
// flag explicitly. Mirrors `classify.ts:summariseServices`.
const summariseServices = (
  services: OrganizationService[]
): DerivedServiceFlags => {
  let hasSurgical = false;
  let hasInjectables = false;
  let hasBodyContouring = false;
  let courseBasedCount = 0;
  let hasBeautyTherapistServices = false;

  for (const service of services) {
    const entry = taxonomiseService(service);
    if (entry.isSurgical) hasSurgical = true;
    if (entry.canonical === 'filler' || entry.canonical === 'anti_wrinkle')
      hasInjectables = true;
    if (BODY_CONTOURING_CANONICALS.includes(entry.canonical))
      hasBodyContouring = true;
    if (entry.cadence === 'course_based') courseBasedCount += 1;
    if (entry.cadence === 'impulse') hasBeautyTherapistServices = true;
  }

  return {
    hasSurgical,
    hasInjectables,
    hasBodyContouring,
    courseBasedCount,
    hasBeautyTherapistServices,
  };
};

// Read a boolean flag from verticalMetadata, returning undefined when absent so
// the caller can fall back to the taxonomy.
const metaBool = (
  meta: Record<string, unknown>,
  key: string
): boolean | undefined =>
  typeof meta[key] === 'boolean' ? (meta[key] as boolean) : undefined;

const metaString = (
  meta: Record<string, unknown>,
  key: string
): string | undefined =>
  typeof meta[key] === 'string' ? (meta[key] as string) : undefined;

/**
 * Derive the first-class clinic type from the classifier axes, the
 * classifier's `verticalMetadata`, and the service menu.
 *
 * Pure & deterministic — prefers explicit `verticalMetadata` signals
 * (`ownerQualification`, `hasSurgical`, `hasInjectables`, `hasBodyContouring`)
 * and falls back to a taxonomy summary of `services` when a signal is absent.
 *
 * Branch order mirrors `classify.ts` `heuristicClassify`:
 *   surgeon/hasSurgical              → doctor_surgical
 *   beauty services & !inject & !surg → beauty_therapist
 *   bodyContouring & !injectables    → body_contouring
 *   injectables                      → nurse_injectable
 *   else                             → mixed
 */
export const deriveClinicType = (
  _axes: Axes,
  verticalMetadata: Record<string, unknown>,
  services: OrganizationService[]
): ClinicType => {
  const flags = summariseServices(services);
  const ownerQualification = metaString(verticalMetadata, 'ownerQualification');

  const hasSurgical =
    metaBool(verticalMetadata, 'hasSurgical') ?? flags.hasSurgical;
  const hasInjectables =
    metaBool(verticalMetadata, 'hasInjectables') ?? flags.hasInjectables;
  const hasBodyContouring =
    metaBool(verticalMetadata, 'hasBodyContouring') ?? flags.hasBodyContouring;

  if (hasSurgical || ownerQualification === 'surgeon') {
    return 'doctor_surgical';
  }
  if (flags.hasBeautyTherapistServices && !hasInjectables && !hasSurgical) {
    return 'beauty_therapist';
  }
  if (hasBodyContouring && !hasInjectables) {
    return 'body_contouring';
  }
  if (hasInjectables) {
    return 'nurse_injectable';
  }
  return 'mixed';
};
