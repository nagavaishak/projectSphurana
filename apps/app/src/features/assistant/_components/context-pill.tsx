import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Separator } from '@/components/ui/separator';
import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import { useGetOrganizationBrand } from '@/features/organization/api/get-organization-brand/get-organization-brand.hook';
import { cn } from '@/lib/utils';
import { Brain, Palette, Sparkles } from 'lucide-react';

interface ContextPillProps {
  /** Skill IDs Claire has loaded for the active conversation. */
  loadedSkills?: string[];
  /** Knowledge entries currently in scope for the active turn. */
  memoryCount?: number;
  className?: string;
}

/**
 * Header pill summarising what Claire knows for the current turn:
 * brand kit, loaded skills, memory count.
 *
 * Note: The AI Elements `Context` component models *token usage*
 * (used / max tokens), which is a different concern. When C-02 emits
 * token-usage stream metadata, we can mount that component separately
 * alongside this pill — they're orthogonal.
 */
export function ContextPill({
  loadedSkills = [],
  memoryCount = 0,
  className,
}: ContextPillProps) {
  const { data: org } = useGetActiveOrganization();
  const { brand } = useGetOrganizationBrand(org?.id ?? '');

  const brandName = brand?.resolvedStyle?.name ?? null;
  // TODO(c-03): loadedSkills wired from skill registry / conversation metadata.
  // TODO(c-13): memoryCount wired from queryKnowledge result count.
  const skillSummary = loadedSkills.length > 0 ? loadedSkills[0] : null;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Conversation context"
          className={cn(
            'inline-flex items-center gap-2 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted',
            className
          )}
        >
          <Palette className="size-3" />
          <span className="max-w-[10ch] truncate">
            {brandName ?? 'Default brand'}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <Sparkles className="size-3" />
          <span>{skillSummary ?? 'no skill'}</span>
          <span className="text-muted-foreground/50">·</span>
          <Brain className="size-3" />
          <span>{memoryCount} mem</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 space-y-2 text-xs">
        <ContextPillRow
          icon={<Palette className="size-3.5 text-muted-foreground" />}
          label="Brand"
          value={brandName ?? '— (organisation default)'}
        />
        <Separator />
        <ContextPillRow
          icon={<Sparkles className="size-3.5 text-muted-foreground" />}
          label="Loaded skills"
          value={
            loadedSkills.length === 0
              ? 'None loaded yet'
              : loadedSkills.join(', ')
          }
        />
        <Separator />
        <ContextPillRow
          icon={<Brain className="size-3.5 text-muted-foreground" />}
          label="Memories in scope"
          value={
            memoryCount === 0
              ? 'No memories yet'
              : `${memoryCount} entr${memoryCount === 1 ? 'y' : 'ies'}`
          }
        />
      </HoverCardContent>
    </HoverCard>
  );
}

function ContextPillRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{label}</p>
        <p className="truncate text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}
