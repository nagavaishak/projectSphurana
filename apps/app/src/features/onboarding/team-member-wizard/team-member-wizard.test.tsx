import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Component tests for the skippable public-profile wizard. Practitioner fetch,
 * update, and image upload are mocked. We prove:
 *  • Steps advance via Continue and via Skip (every step is optional).
 *  • Language chip selection updates state and persists on Continue.
 *  • Social handle entry updates state and persists on Finish → onComplete.
 */

const updatePractitionerAsync = vi.fn();
const uploadAsync = vi.fn();
const useGetPractitionerForUser = vi.fn();

vi.mock('@/features/practitioners/api', () => ({
  useGetPractitionerForUser: () => useGetPractitionerForUser(),
  useUpdatePractitioner: () => ({ updatePractitionerAsync }),
}));

vi.mock('@/features/upload/api/upload.hook', () => ({
  useUploadImage: () => ({ uploadAsync }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TeamMemberWizard } from './team-member-wizard';

describe('TeamMemberWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePractitionerAsync.mockResolvedValue({});
    useGetPractitionerForUser.mockReturnValue({
      practitioner: {
        id: 'p1',
        photo: null,
        headline: '',
        bio: '',
        languages: [],
        socialLinks: {},
      },
      isLoading: false,
    });
  });

  it('advances through steps with Continue', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamMemberWizard onComplete={vi.fn()} />);

    // Step 1: photo tips
    expect(screen.getByText(/Add a profile photo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: photo upload
    expect(await screen.findByText(/Upload your photo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3: headline + bio
    expect(await screen.findByText(/Create your profile/i)).toBeInTheDocument();
  });

  it('lets every step be skipped', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamMemberWizard onComplete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /skip/i })); // tips → upload
    expect(await screen.findByText(/Upload your photo/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /skip/i })); // upload → headline
    expect(await screen.findByText(/Create your profile/i)).toBeInTheDocument();

    // Skip does not persist anything.
    expect(updatePractitionerAsync).not.toHaveBeenCalled();
  });

  it('selects language chips and persists them on Continue', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamMemberWizard onComplete={vi.fn()} />);

    // Skip to the languages step (tips → upload → headline → languages).
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await user.click(screen.getByRole('button', { name: /skip/i }));

    expect(await screen.findByText(/Languages you speak/i)).toBeInTheDocument();

    // Select a suggested chip → it moves into the selected list.
    await user.click(screen.getByRole('button', { name: /^English$/i }));
    const selected = screen.getByTestId('selected-languages');
    expect(selected).toHaveTextContent('English');

    // Continue persists the languages array.
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => {
      expect(updatePractitionerAsync).toHaveBeenCalledWith({
        id: 'p1',
        languages: ['English'],
      });
    });
  });

  it('captures social handles and finishes', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderWithProviders(<TeamMemberWizard onComplete={onComplete} />);

    // Skip to the last (social) step.
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await user.click(screen.getByRole('button', { name: /skip/i }));
    await user.click(screen.getByRole('button', { name: /skip/i }));

    expect(
      await screen.findByText(/Add your social links/i)
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/instagram/i), '@ada.styles');

    // Finish persists social links and calls onComplete.
    await user.click(screen.getByRole('button', { name: /finish/i }));
    await waitFor(() => {
      expect(updatePractitionerAsync).toHaveBeenCalledWith({
        id: 'p1',
        socialLinks: { instagram: '@ada.styles' },
      });
    });
    expect(onComplete).toHaveBeenCalled();
  });
});
