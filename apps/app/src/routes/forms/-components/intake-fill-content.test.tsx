import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Component tests for the patient-facing intake fill-in page.
 *
 * This is the surface an anonymous patient sees after clicking the link in
 * their email/SMS, so the behaviour that matters is:
 *
 *  • Every snapshot question renders as its input.
 *  • A required field left blank blocks submit — nothing is posted.
 *  • A valid submit posts the EXACT answers map to the token path.
 *  • A completed submission shows the thank-you state, not the form.
 *  • A dead link is a calm explanation, not an error page.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { IntakeFillContent } = await import('./intake-fill-content');

const view = (overrides?: Record<string, unknown>) => ({
  submissionId: 'sub-1',
  formName: 'Medical history',
  formDescription: 'Please complete before your visit.',
  status: 'pending',
  answers: {},
  fields: [
    {
      id: 'reason',
      type: 'long_text',
      label: 'Reason for visit',
      required: true,
    },
    {
      id: 'allergies',
      type: 'short_text',
      label: 'Allergies',
      required: false,
    },
  ],
  organization: { name: 'Glow Aesthetics', slug: 'glow', logo: null },
  ...overrides,
});

const renderPage = () =>
  renderWithProviders(
    <IntakeFillContent organizationSlug="glow" token="tok-123" />
  );

describe('IntakeFillContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ submissionId: 'sub-1' });
  });

  it('renders each snapshot question from the API', async () => {
    get.mockResolvedValue(view());

    renderPage();

    expect(await screen.findByText('Medical history')).toBeInTheDocument();
    expect(screen.getByText('Reason for visit')).toBeInTheDocument();
    expect(screen.getByText('Allergies')).toBeInTheDocument();
    expect(screen.getByText(/Glow Aesthetics/)).toBeInTheDocument();
  });

  it('blocks submit and posts nothing while a required field is empty', async () => {
    get.mockResolvedValue(view());

    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: /submit/i })
    );

    expect(
      await screen.findByText(/please complete the required fields/i)
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts the exact answers map on a valid submit', async () => {
    get.mockResolvedValue(view());

    renderPage();

    const reason = await screen.findByLabelText(/reason for visit/i);
    await userEvent.type(reason, 'Skin consultation');
    const allergies = screen.getByLabelText(/allergies/i);
    await userEvent.type(allergies, 'None');

    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('public/intake/glow/tok-123/submit', {
        answers: { reason: 'Skin consultation', allergies: 'None' },
      });
    });
  });

  it('shows the thank-you state after a successful submit', async () => {
    get.mockResolvedValue(view());

    renderPage();

    await userEvent.type(
      await screen.findByLabelText(/reason for visit/i),
      'Skin consultation'
    );
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit/i })
    ).not.toBeInTheDocument();
  });

  it('shows the thank-you state for an already-completed submission', async () => {
    get.mockResolvedValue(view({ status: 'completed' }));

    renderPage();

    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit/i })
    ).not.toBeInTheDocument();
  });

  it('explains a dead link calmly instead of showing an error page', async () => {
    get.mockRejectedValue(new Error('Not found'));

    renderPage();

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /submit/i })
    ).not.toBeInTheDocument();
  });
});
