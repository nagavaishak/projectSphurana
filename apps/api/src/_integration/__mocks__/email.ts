/**
 * Email stub for the real-auth integration suite.
 *
 * Sign-up (`autoSignIn`) fires `sendVerificationEmail`, whose handler re-throws
 * on failure — so a failed send fails the SIGN-UP, not just the email. The real
 * package renders React Email templates through a dynamic import that Jest
 * cannot service without --experimental-vm-modules, which would make every
 * sign-up in this suite fail for a reason that has nothing to do with auth.
 *
 * Sends are recorded so a spec can assert one was attempted.
 */
export interface RecordedEmail {
  to: string;
  subject: string;
}

export const sentEmails: RecordedEmail[] = [];

export const sendEmail = async (input: {
  to: string;
  subject: string;
}): Promise<{ id: string }> => {
  sentEmails.push({ to: input.to, subject: input.subject });
  return { id: `stub-${sentEmails.length}` };
};

// Templates are only ever passed through to `sendEmail`, never rendered here.
export const VerificationEmail = () => null;
export const PasswordResetEmail = () => null;
