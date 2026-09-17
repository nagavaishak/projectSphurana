'use client';

import { UsersIcon } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface PractitionerOption {
  id: string;
  name: string;
  photo: string | null;
  title: string | null;
}

interface PractitionerPickerProps {
  practitioners: PractitionerOption[];
  selectedPractitionerId: string | null;
  onSelect: (id: string | null) => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function PractitionerPicker({
  practitioners,
  selectedPractitionerId,
  onSelect,
}: PractitionerPickerProps) {
  if (practitioners.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Choose a practitioner</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {/* "Any available" option */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
            'hover:bg-accent hover:border-accent-foreground/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            selectedPractitionerId === null
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border'
          )}
        >
          <Avatar className="size-12">
            <AvatarFallback className="bg-muted">
              <UsersIcon className="size-5 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">Any available</p>
            <p className="text-xs text-muted-foreground truncate">
              First available
            </p>
          </div>
        </button>

        {/* Individual practitioners */}
        {practitioners.map((practitioner) => {
          const isSelected = selectedPractitionerId === practitioner.id;

          return (
            <button
              key={practitioner.id}
              type="button"
              onClick={() => onSelect(practitioner.id)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors',
                'hover:bg-accent hover:border-accent-foreground/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border'
              )}
            >
              <Avatar className="size-12">
                {practitioner.photo && (
                  <AvatarImage
                    src={practitioner.photo}
                    alt={practitioner.name}
                  />
                )}
                <AvatarFallback className="text-sm">
                  {getInitials(practitioner.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 w-full">
                <p className="text-sm font-medium truncate">
                  {practitioner.name}
                </p>
                {practitioner.title && (
                  <p className="text-xs text-muted-foreground truncate">
                    {practitioner.title}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
