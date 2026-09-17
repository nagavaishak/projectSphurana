import { Loader2 } from 'lucide-react';

import { useSignOut } from '@/features/auth/use-sign-out';
import { useSession } from '@/lib/session';

export function SignedInIndicator() {
  const { data, isLoading } = useSession();
  const user = data?.user;
  const { signOut, isSigningOut } = useSignOut();

  if (isLoading || !user) return null;

  return (
    <p className="text-muted-foreground text-sm">
      Signed in as {user.email}.{' '}
      <button
        type="button"
        className="underline hover:text-foreground disabled:opacity-50"
        onClick={() => signOut()}
        disabled={isSigningOut}
      >
        {isSigningOut ? (
          <Loader2 className="inline h-3 w-3 animate-spin" />
        ) : (
          'Sign out'
        )}
      </button>
    </p>
  );
}
