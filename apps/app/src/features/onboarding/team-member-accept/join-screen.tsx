import { Apple, Facebook, Chrome as Google } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface JoinScreenProps {
  organizationName: string;
  inviterName: string | null;
  email: string;
  /** Whether the visitor already has an authenticated session. */
  isAuthenticated: boolean;
  onContinue: () => void;
}

/**
 * First screen of the invited-member accept flow. Frames the invite ("Join
 * {Org}") and offers the account-creation entry points. The email is pre-filled
 * from the invite lookup and locked — the invite is bound to that address.
 *
 * Social sign-in buttons are placeholders for now: OAuth wiring (with native
 * deep-link return) is out of scope for this slice, so they are disabled. The
 * email path is the working path.
 */
export function JoinScreen({
  organizationName,
  inviterName,
  email,
  isAuthenticated,
  onContinue,
}: JoinScreenProps) {
  return (
    <FieldGroup className="gap-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-bold">Join {organizationName}</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {inviterName ? `${inviterName} invited you. ` : ''}
          {isAuthenticated
            ? 'Accept the invitation to join the team.'
            : 'Create an account or log in to accept the invite.'}
        </p>
      </div>

      {!isAuthenticated && (
        <div className="flex flex-col gap-2">
          {/* TODO(oauth): wire Facebook/Google/Apple sign-in with native
              deep-link return. Disabled placeholders for now — email path works. */}
          <Button type="button" variant="outline" disabled>
            <Facebook className="size-4" />
            Continue with Facebook
          </Button>
          <Button type="button" variant="outline" disabled>
            <Google className="size-4" />
            Continue with Google
          </Button>
          <Button type="button" variant="outline" disabled>
            <Apple className="size-4" />
            Continue with Apple
          </Button>
          <div className="flex items-center gap-3 py-1">
            <span className="bg-border h-px flex-1" />
            <span className="text-muted-foreground text-xs">or</span>
            <span className="bg-border h-px flex-1" />
          </div>
        </div>
      )}

      <Field data-invalid={false}>
        <FieldLabel htmlFor="invite-email">Email</FieldLabel>
        <Input
          id="invite-email"
          type="email"
          value={email}
          readOnly
          disabled
          aria-label="Email"
        />
        <FieldDescription>
          This invitation was sent to this address.
        </FieldDescription>
      </Field>

      <Button type="button" onClick={onContinue}>
        Continue
      </Button>
    </FieldGroup>
  );
}
