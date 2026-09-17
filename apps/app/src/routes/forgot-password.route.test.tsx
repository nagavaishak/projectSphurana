import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ForgotPasswordPage — the confirmation screen.
 *
 * REGRESSION: the confirmation used to read "If an account exists with that
 * email…", never naming the address. It is deliberately vague about WHETHER
 * an account exists (naming one would leak which addresses are registered),
 * but it was also vague about WHICH address we acted on — and that second
 * ambiguity is what actually hurt. A customer requested a reset three times
 * over a month using a business alias that had no account; each time the
 * screen said a link had been sent, and each time nothing arrived. Echoing
 * the submitted address back makes that mistake visible without revealing
 * anything about account existence.
 */

const forgotPassword = vi.fn();
const reset = vi.fn();
let isSuccess = false;

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (opts: { component: ComponentType }) => ({
    options: opts,
  }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/features/auth/use-forgot-password', () => ({
  useForgotPassword: () => ({
    forgotPassword: (input: { email: string }) => {
      forgotPassword(input);
      isSuccess = true;
    },
    isSubmitting: false,
    isSuccess,
    reset: () => {
      reset();
      isSuccess = false;
    },
  }),
}));

import { Route } from './forgot-password';

const ForgotPasswordPage = (
  Route as unknown as { options: { component: ComponentType } }
).options.component;

/** Fill the form and submit, landing on the confirmation screen. */
const requestResetFor = async (email: string) => {
  renderWithProviders(<ForgotPasswordPage />);

  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: /check your email/i })
    ).toBeInTheDocument()
  );
};

describe('ForgotPasswordPage · confirmation screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSuccess = false;
  });

  it('names the exact address the request was made for', async () => {
    await requestResetFor('admin@chasehealth.shop');

    // The whole point: a customer who typed the wrong address can SEE it.
    expect(screen.getByText('admin@chasehealth.shop')).toBeInTheDocument();
  });

  it('stays vague about whether that address has an account', async () => {
    await requestResetFor('admin@chasehealth.shop');

    // Enumeration safety — this must remain conditional. Asserting the exact
    // hedge so that "we've sent you a link" can't creep back in.
    expect(screen.getByText(/if an account exists for/i)).toBeInTheDocument();
  });

  it('tells the user the link expires', async () => {
    await requestResetFor('someone@example.com');

    // Reset tokens live 1 hour; a customer coming back the next morning needs
    // to know the link is dead rather than assume the flow is broken.
    expect(screen.getByText(/expires in 1 hour/i)).toBeInTheDocument();
  });

  it('offers a way back to correct a mistyped address', async () => {
    await requestResetFor('admin@chasehealth.shop');

    fireEvent.click(
      screen.getByRole('button', { name: /not the right email/i })
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toBeInTheDocument()
    );
    expect(reset).toHaveBeenCalled();
  });

  it('pre-fills the previous address so it can be edited, not retyped', async () => {
    await requestResetFor('admin@chasehealth.shop');

    fireEvent.click(
      screen.getByRole('button', { name: /not the right email/i })
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toHaveValue(
        'admin@chasehealth.shop'
      )
    );
  });

  it('submits the address the user typed', async () => {
    await requestResetFor('dureshehwar@example.com');

    expect(forgotPassword).toHaveBeenCalledWith({
      email: 'dureshehwar@example.com',
    });
  });
});
