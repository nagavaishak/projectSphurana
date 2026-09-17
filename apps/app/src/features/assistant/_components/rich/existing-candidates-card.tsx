import { CopyCheck } from 'lucide-react';

export interface ExistingCandidate {
  id: string;
  name: string;
  createdAt?: string;
  matchReasons?: string[];
}

export interface ExistingCandidatesCardProps {
  /** What kind of resource nearly duplicated. */
  kind: 'campaign' | 'lead_form';
  proposedName?: string;
  candidates: ExistingCandidate[];
  onPrompt?: (text: string) => void;
}

const KIND_LABEL: Record<ExistingCandidatesCardProps['kind'], string> = {
  campaign: 'campaign',
  lead_form: 'lead form',
};

function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * Duplicate-protection picker (Phase 4 #79 #151). Shown when the create tool
 * found a recent, similar {campaign,lead form} instead of creating one. The
 * owner either reuses an existing one or tells Claire to create a new one
 * anyway — no silent duplicate on the same budget.
 */
export function ExistingCandidatesCard({
  kind,
  proposedName,
  candidates,
  onPrompt,
}: ExistingCandidatesCardProps) {
  const kindLabel = KIND_LABEL[kind];
  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CopyCheck className="size-4 text-amber-600 dark:text-amber-500" />
        You may already have this {kindLabel}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {`I found ${candidates.length} similar ${kindLabel}${
          candidates.length === 1 ? '' : 's'
        } from the last few days. Reuse one, or create a new one anyway?`}
      </p>

      <ul className="mt-3 space-y-2">
        {candidates.map((candidate) => {
          const when = formatWhen(candidate.createdAt);
          return (
            <li
              key={candidate.id}
              className="rounded-md border bg-background p-2 text-xs"
            >
              <div className="font-medium">{candidate.name}</div>
              <div className="mt-0.5 text-muted-foreground">
                {[
                  when ? `created ${when}` : null,
                  candidate.matchReasons?.length
                    ? candidate.matchReasons.join(', ')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          );
        })}
      </ul>

      {onPrompt && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            onClick={() =>
              onPrompt(
                `Create a new ${kindLabel} anyway${
                  proposedName ? ` called "${proposedName}"` : ''
                }.`
              )
            }
          >
            Create new anyway
          </button>
        </div>
      )}
    </div>
  );
}
