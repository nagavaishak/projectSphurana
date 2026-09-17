import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  useContentRules,
  useDeleteContentRule,
} from '@/features/assistant/api/use-content-rules';

/**
 * The org's standing content rules, as removable chips.
 *
 * This strip is the only place the batch behaves like a batch rather than ten
 * sequential single-post reviews — and it is the honest answer to "why did post
 * 7 come out like that", because the rules were on screen the whole time.
 *
 * Removing a chip deletes the org-wide rule (admin-only, enforced server-side).
 * New rules apply forward only: nothing already accepted or scheduled is
 * rewritten behind the owner's back.
 */
export function RulesStrip() {
  const { rules, isLoading } = useContentRules();
  const { deleteContentRule, isDeleting } = useDeleteContentRule();

  if (isLoading || rules.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Claire always:</span>
      {rules.map((rule) => (
        <Tooltip key={rule.id}>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className="h-6 gap-1 pl-2 pr-1 font-normal"
            >
              {rule.title}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isDeleting}
                onClick={() => deleteContentRule(rule.id)}
                aria-label={`Remove rule: ${rule.title}`}
                className="size-4 rounded-full p-0 hover:bg-background/60"
              >
                <X className="size-2.5" />
              </Button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{rule.content}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
