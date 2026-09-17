import { describe, expect, it } from '@borradh-workspace/testing';

import { suggestServiceForForm } from './suggest-service-for-form.js';

const services = [
  { id: 'svc-cool', name: 'CoolSculpting' },
  { id: 'svc-jhs', name: 'Japanese Head Spa' },
  { id: 'svc-botox', name: 'Botox' },
];

describe('suggestServiceForForm', () => {
  it('matches when the service name appears in the form name (verbatim)', () => {
    const result = suggestServiceForForm(
      'CoolSculpting Intro Offer — Lead Form',
      services
    );
    expect(result).toEqual({ serviceId: 'svc-cool', score: 1 });
  });

  it('matches a multi-word service from question text', () => {
    const result = suggestServiceForForm(
      'When would you like to come in for the Japanese Head Spa + skin analysis?',
      services
    );
    expect(result?.serviceId).toBe('svc-jhs');
  });

  it('returns null for a generic form with no service reference', () => {
    const result = suggestServiceForForm(
      'What is your main wellness goal? Are you ready to start within the next 30 days?',
      services
    );
    expect(result).toBeNull();
  });

  it('returns null when there are no services', () => {
    expect(suggestServiceForForm('CoolSculpting', [])).toBeNull();
  });

  it('does not match on a single weak shared token below threshold', () => {
    // "Skin" alone shouldn't confidently pick a multi-word service.
    const result = suggestServiceForForm('Skin consultation enquiry', [
      { id: 'svc-1', name: 'Advanced Skin Resurfacing Laser' },
    ]);
    expect(result).toBeNull();
  });
});
