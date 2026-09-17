import { CheckCircle2, Eye } from 'lucide-react';

import type {
  CreatedActionButton,
  CreatedField,
  CreatedVariant,
} from './types';

interface CreatedCardProps {
  title: string;
  fields: CreatedField[];
  /**
   * Accepted for backwards compatibility with tool outputs that still emit an
   * `actions` array — intentionally not rendered. Claire asks the user what
   * to do next in chat instead of presenting clickable buttons.
   */
  actions?: CreatedActionButton[];
  /** 'created' (default, green check) or 'preview' (neutral eye icon). */
  variant?: CreatedVariant;
  /** Retained so callers don't need to change; no longer used. */
  onPrompt?: (text: string) => void;
}

/**
 * Success/preview result card: icon, title, definition-list-style fields.
 *
 * Tools opt in by returning `{ uiState: 'created', title, fields }` from their
 * server-side implementation. See `tool-renderer.tsx` for dispatch.
 */
export function CreatedCard({
  title,
  fields,
  variant = 'created',
}: CreatedCardProps) {
  const Icon = variant === 'preview' ? Eye : CheckCircle2;
  const iconClass =
    variant === 'preview'
      ? 'size-4 text-muted-foreground'
      : 'size-4 text-emerald-600 dark:text-emerald-500';

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className={iconClass} />
        {title}
      </div>

      {fields.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <dt className="text-muted-foreground shrink-0">{field.label}</dt>
              <dd className="truncate font-medium text-right">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
