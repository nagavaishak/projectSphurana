import type { Disagreement } from '@borradh-workspace/api-client/types';

import { Button } from '@/components/ui/button';

const AXIS_LABELS: Record<Disagreement['axes'][number], string> = {
  retentionModel: 'retention model',
  commitmentLevel: 'commitment level',
  marketPosition: 'market position',
};

interface ClaireDisagreementFooterProps {
  disagreement: Disagreement;
  isSaving?: boolean;
  onResolve: (resolution: 'owner_held' | 'owner_changed') => void;
}

/**
 * Renders inline beneath the advisor card when Claire's classifier disagrees
 * with the owner's override. One-time prompt per surfacing (the backend marks
 * `surfaced: true` on first read). Owner picks "Revisit" (clear overrides
 * and reclassify) or "No, I'm right" (lock the override in).
 */
export function ClaireDisagreementFooter({
  disagreement,
  isSaving,
  onResolve,
}: ClaireDisagreementFooterProps) {
  const axesPretty = disagreement.axes
    .map((axis) => AXIS_LABELS[axis])
    .join(', ');

  return (
    <div className="border-t pt-3 text-sm text-muted-foreground">
      <p>
        I noticed something — you set your <strong>{axesPretty}</strong>, but
        looking at your services I'd actually classify you differently. Want to
        revisit?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          onClick={() => onResolve('owner_changed')}
        >
          Revisit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isSaving}
          onClick={() => onResolve('owner_held')}
        >
          No, I'm right
        </Button>
      </div>
    </div>
  );
}
