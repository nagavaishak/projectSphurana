import { describe, expect, it } from 'vitest';
import { makeService } from './__fixtures__/index.js';
import { heuristicClassify } from './classify.js';
import { deriveClinicType } from './derive-clinic-type.js';
import { taxonomiseService } from './service-taxonomy.js';

const AXES = {
  retentionModel: 'course_based',
  commitmentLevel: 'planned',
  marketPosition: 'at',
} as const;

describe('taxonomiseService — non-surgical guard', () => {
  it('does NOT tag "Non-Surgical Facelift" as surgical', () => {
    const entry = taxonomiseService({ name: 'Non-Surgical Facelift' });
    expect(entry.isSurgical).toBe(false);
    expect(entry.canonical).toBe('non_surgical_lift');
    expect(entry.cadence).toBe('course_based');
  });

  it('handles the "non surgical" (no hyphen) and HIFU spellings', () => {
    expect(
      taxonomiseService({ name: 'Non Surgical Face Lift' }).isSurgical
    ).toBe(false);
    expect(taxonomiseService({ name: 'HIFU Lift' }).canonical).toBe(
      'non_surgical_lift'
    );
  });

  it('never tags any "non-surgical X" as surgical (general guard)', () => {
    expect(
      taxonomiseService({ name: 'Non-Surgical Rhinoplasty' }).isSurgical
    ).toBe(false);
    expect(
      taxonomiseService({ name: 'Non-Surgical Bum Lift' }).isSurgical
    ).toBe(false);
  });

  it('still tags genuine surgery as surgical', () => {
    expect(taxonomiseService({ name: 'Liposuction' }).isSurgical).toBe(true);
    expect(taxonomiseService({ name: 'Rhinoplasty' }).isSurgical).toBe(true);
    expect(taxonomiseService({ name: 'Facelift' }).isSurgical).toBe(true);
  });
});

describe('classifier robustness — a non-surgical facelift does not flip the clinic', () => {
  // Regression: this menu (modelled on a real nurse-led aesthetic clinic) used
  // to classify as consideration_sale/major because "Non-Surgical Facelift"
  // matched the surgical taxonomy — which then made the £450 facelift the only
  // service that scored, surfacing it as the top ad pick.
  const aestheticMenu = () => [
    makeService({ name: 'Non-Surgical Facelift', priceText: 'From £450' }),
    makeService({ name: 'Lip Filler Treatment', priceText: '£135' }),
    makeService({ name: 'Body Contouring', priceText: 'Per Session £85' }),
    makeService({ name: 'Chemical Peels', priceText: '£100' }),
    makeService({
      name: 'Derma Rollers and Derma Pen',
      priceText: 'Prices Vary',
    }),
  ];

  it('heuristicClassify no longer returns consideration_sale / major', () => {
    const result = heuristicClassify({
      organizationName: 'Test Clinic',
      services: aestheticMenu(),
      chatbotSettings: null,
    });
    expect(result.effective.retentionModel).not.toBe('consideration_sale');
    expect(result.effective.commitmentLevel).not.toBe('major');
    expect(result.verticalMetadata.hasSurgical).toBe(false);
  });

  it('deriveClinicType is not doctor_surgical for this menu', () => {
    expect(deriveClinicType(AXES, {}, aestheticMenu())).not.toBe(
      'doctor_surgical'
    );
  });
});
