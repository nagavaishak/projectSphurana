import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  RESOURCE_COLOR_HEX,
  type ResourceColor,
  resourceColorLabels,
  resourceColorValues,
} from './resource-colors';

interface ResourceColorPickerProps {
  /** '' means "no colour" — the calendar falls back to a neutral tint. */
  value: ResourceColor | '';
  onChange: (value: ResourceColor | '') => void;
  /** Id of the first swatch, so a `FieldLabel htmlFor` lands somewhere real. */
  id?: string;
}

/**
 * The same swatch grid the practitioner editor uses, over the same
 * `user_color` enum — clicking the selected colour clears it.
 */
export function ResourceColorPicker({
  value,
  onChange,
  id,
}: ResourceColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {resourceColorValues.map((colour, index) => {
        const selected = value === colour;
        return (
          <button
            key={colour}
            id={index === 0 ? id : undefined}
            type="button"
            aria-label={resourceColorLabels[colour]}
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : colour)}
            className={cn(
              'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'ring-2 ring-ring'
            )}
            style={{ backgroundColor: RESOURCE_COLOR_HEX[colour] }}
          >
            {selected && <CheckIcon className="size-4 text-white" />}
          </button>
        );
      })}
    </div>
  );
}

/** The small tint dot shown beside a resource name in the settings table. */
export function ResourceColorDot({ color }: { color: string | null }) {
  const hex =
    color && color in RESOURCE_COLOR_HEX
      ? RESOURCE_COLOR_HEX[color as ResourceColor]
      : undefined;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        !hex && 'bg-muted-foreground/40'
      )}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  );
}
