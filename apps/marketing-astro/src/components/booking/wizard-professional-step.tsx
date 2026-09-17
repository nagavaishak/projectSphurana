'use client';

import { UserIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import type { WizardPractitioner } from './booking-cart';

interface WizardProfessionalStepProps {
  practitioners: WizardPractitioner[];
  /** null = "Any professional". */
  selectedPractitionerId: string | null;
  onSelect: (id: string | null) => void;
}

function initials(name: string): string {
  return (
    name
      .split(' ')
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

/**
 * The (optional) Professional step. Shown only when the org exposes
 * practitioners. "Any professional" is always offered and is the default —
 * choosing it leaves assignment to the clinic / first availability.
 */
export function WizardProfessionalStep({
  practitioners,
  selectedPractitionerId,
  onSelect,
}: WizardProfessionalStepProps) {
  return (
    <div>
      <h1 className="font-bold text-3xl md:text-4xl">Select professional</h1>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <ProfessionalCard
          name="Any professional"
          subtitle="for maximum availability"
          active={selectedPractitionerId === null}
          onClick={() => onSelect(null)}
          icon={<UsersIcon className="size-6 text-muted-foreground" />}
        />
        {practitioners.map((p) => (
          <ProfessionalCard
            key={p.id}
            name={p.name}
            subtitle={p.title}
            active={selectedPractitionerId === p.id}
            onClick={() => onSelect(p.id)}
            photo={p.photo}
            icon={<UserIcon className="size-6 text-muted-foreground" />}
          />
        ))}
      </div>
    </div>
  );
}

function ProfessionalCard({
  name,
  subtitle,
  active,
  onClick,
  photo,
  icon,
}: {
  name: string;
  subtitle?: string | null;
  active: boolean;
  onClick: () => void;
  photo?: string | null;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary ring-1 ring-primary'
          : 'border-border hover:bg-accent'
      )}
    >
      <Avatar className="size-14">
        {photo && <AvatarImage src={photo} alt={name} />}
        <AvatarFallback>
          {name === 'Any professional' ? icon : initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {subtitle && (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </button>
  );
}
