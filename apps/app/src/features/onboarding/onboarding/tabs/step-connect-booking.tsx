import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useImportExternalTeamMembers,
  useListExternalTeamMembers,
} from '@/features/integrations/api';
import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { CheckCircle2, Loader2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

interface StepConnectBookingProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
  bookingAccountId: string;
  provider: 'calendly' | 'timely';
  onSaveFormState: () => void;
}

export function StepConnectBooking({
  form: _form,
  bookingAccountId,
  provider,
  onSaveFormState,
}: StepConnectBookingProps) {
  const isConnected = !!bookingAccountId;

  if (!isConnected) {
    return (
      <PreConnectionView
        provider={provider}
        onSaveFormState={onSaveFormState}
      />
    );
  }

  return (
    <PostConnectionView
      provider={provider}
      bookingAccountId={bookingAccountId}
    />
  );
}

function PreConnectionView({
  provider,
  onSaveFormState,
}: {
  provider: 'calendly' | 'timely';
  onSaveFormState: () => void;
}) {
  const providerName = provider === 'calendly' ? 'Calendly' : 'Timely';

  const handleConnect = () => {
    onSaveFormState();
    // Redirect to OAuth - the returnTo param will bring us back
    void openIntegrationOAuth(
      `integrations/booking/auth/${provider}?returnTo=${encodeURIComponent('/onboarding')}`
    );
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connect {providerName}</h1>
        <p className="text-muted-foreground">
          Link your {providerName} account to import team members and sync
          appointments.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4 py-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-8 w-8 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          You&apos;ll be redirected to {providerName} to authorize access, then
          brought back here to import your team.
        </p>
        <Button type="button" onClick={handleConnect}>
          Connect {providerName}
        </Button>
      </div>
    </FieldGroup>
  );
}

function PostConnectionView({
  provider,
  bookingAccountId,
}: {
  provider: 'calendly' | 'timely';
  bookingAccountId: string;
}) {
  const providerName = provider === 'calendly' ? 'Calendly' : 'Timely';
  const { members, isLoading, isError } =
    useListExternalTeamMembers(bookingAccountId);
  const { importMembers, isImporting, isSuccess } =
    useImportExternalTeamMembers(bookingAccountId);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Pre-select all members on load
  useEffect(() => {
    if (members.length > 0 && Object.keys(selected).length === 0) {
      const initial: Record<string, boolean> = {};
      for (const m of members) {
        initial[m.externalId] = true;
      }
      setSelected(initial);
    }
  }, [members, selected]);

  const toggleMember = (externalId: string) => {
    setSelected((prev) => ({ ...prev, [externalId]: !prev[externalId] }));
  };

  const toggleAll = () => {
    const allSelected = members.every((m) => selected[m.externalId]);
    const next: Record<string, boolean> = {};
    for (const m of members) {
      next[m.externalId] = !allSelected;
    }
    setSelected(next);
  };

  const handleImport = () => {
    const membersToImport = members.map((m) => ({
      externalId: m.externalId,
      name: m.name,
      email: m.email,
      selected: !!selected[m.externalId],
    }));
    importMembers(membersToImport);
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  if (isSuccess) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-xl font-semibold">Team imported</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Your {providerName} team members have been added as practitioners.
          </p>
        </div>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <h1 className="text-2xl font-semibold">{providerName} connected</h1>
        </div>
        {isLoading ? (
          <p className="text-muted-foreground">Loading team members...</p>
        ) : members.length > 0 ? (
          <p className="text-muted-foreground">
            We found {members.length} team member
            {members.length > 1 ? 's' : ''} in your {providerName} account.
            Select who to import as practitioners.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No team members found in your {providerName} account. You can add
            practitioners manually later.
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32 mb-1" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          Failed to load team members. You can skip this step and add them
          manually.
        </p>
      )}

      {!isLoading && members.length > 0 && (
        <>
          {/* Select all toggle */}
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox is rendered inside label */}
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              checked={members.every((m) => selected[m.externalId])}
              onCheckedChange={toggleAll}
            />
            Select all
          </label>

          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
            {members.map((member) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox is rendered inside label
              <label
                key={member.externalId}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selected[member.externalId]
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <Checkbox
                  checked={!!selected[member.externalId]}
                  onCheckedChange={() => toggleMember(member.externalId)}
                />
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {member.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {member.email}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <Button
            type="button"
            onClick={handleImport}
            disabled={isImporting || selectedCount === 0}
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Import {selectedCount} member{selectedCount !== 1 ? 's' : ''} &
                Continue
              </>
            )}
          </Button>
        </>
      )}
    </FieldGroup>
  );
}
