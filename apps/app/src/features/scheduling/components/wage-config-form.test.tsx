import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WageConfigForm — form → payload behaviour, ported from the team wage-config
 * E2E. Mocks the get/update hooks so we assert the exact payload the form
 * submits when an hourly rate is entered (the amount is converted to cents and
 * threaded with the practitionerId).
 */

const updateWageConfig = vi.fn();
const wageConfig = {
  practitionerId: 'prac_1',
  compensationType: 'hourly',
  hourlyRateCents: 1500,
  overtimeEnabled: false,
  regularWorkHours: null,
  regularWorkHoursPer: 'week',
  overtimeType: null,
  overtimeMultiplier: null,
  overtimeHourlyRateCents: null,
  autoClockIn: 'workspace_default',
  autoClockOut: 'workspace_default',
  automatedBreaks: 'workspace_default',
};

vi.mock('../api', () => ({
  useGetWageConfig: () => ({
    wageConfig,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateWageConfig: () => ({ updateWageConfig, isSaving: false }),
}));

import { WageConfigForm } from './wage-config-form';

describe('WageConfigForm', () => {
  beforeEach(() => updateWageConfig.mockReset());

  it('submits the entered hourly rate as cents with the practitionerId', () => {
    renderWithProviders(<WageConfigForm practitionerId="prac_1" />);

    fireEvent.change(screen.getByLabelText('Hourly rate'), {
      target: { value: '20.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save wage settings' }));

    expect(updateWageConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        practitionerId: 'prac_1',
        compensationType: 'hourly',
        hourlyRateCents: 2000,
      })
    );
  });
});
