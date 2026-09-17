import { describe, expect, it } from 'vitest';
import {
  beautyTherapistServices,
  bodyContouringServices,
  makeService,
  nurseLedClinicServices,
  surgicalClinicServices,
} from './__fixtures__/index.js';
import { deriveClinicType } from './derive-clinic-type.js';

const AXES = {
  retentionModel: 'course_based',
  commitmentLevel: 'planned',
  marketPosition: 'at',
} as const;

describe('deriveClinicType', () => {
  it('returns doctor_surgical when the menu has a surgical procedure', () => {
    expect(deriveClinicType(AXES, {}, surgicalClinicServices())).toBe(
      'doctor_surgical'
    );
  });

  it('returns doctor_surgical when ownerQualification is surgeon (no surgical menu)', () => {
    const services = [
      makeService({ name: 'Microneedling', priceText: '€150' }),
    ];
    expect(
      deriveClinicType(AXES, { ownerQualification: 'surgeon' }, services)
    ).toBe('doctor_surgical');
  });

  it('returns beauty_therapist for impulse services with no injectables/surgical', () => {
    expect(deriveClinicType(AXES, {}, beautyTherapistServices())).toBe(
      'beauty_therapist'
    );
  });

  it('returns body_contouring for contouring-dominant menus with no injectables', () => {
    expect(deriveClinicType(AXES, {}, bodyContouringServices())).toBe(
      'body_contouring'
    );
  });

  it('returns nurse_injectable when the menu has injectables', () => {
    // nurseLedClinicServices includes Lip Filler → injectables.
    expect(deriveClinicType(AXES, {}, nurseLedClinicServices())).toBe(
      'nurse_injectable'
    );
  });

  it('returns mixed when nothing matches (e.g. course-based only, no injectables)', () => {
    const services = [
      makeService({ name: 'Microneedling', priceText: '€150' }),
      makeService({ name: 'Chemical Peel', priceText: '€120' }),
    ];
    expect(deriveClinicType(AXES, {}, services)).toBe('mixed');
  });

  it('prefers explicit verticalMetadata.hasSurgical over the taxonomy', () => {
    const services = [
      makeService({ name: 'Microneedling', priceText: '€150' }),
    ];
    expect(deriveClinicType(AXES, { hasSurgical: true }, services)).toBe(
      'doctor_surgical'
    );
  });

  it('prefers explicit verticalMetadata.hasInjectables to route away from beauty', () => {
    // Pure impulse menu, but metadata says injectables exist → not beauty.
    const services = beautyTherapistServices();
    expect(deriveClinicType(AXES, { hasInjectables: true }, services)).not.toBe(
      'beauty_therapist'
    );
  });
});
