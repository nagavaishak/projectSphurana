import { Pencil, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import type { MemoryListItem } from '../api/use-memories';

export interface MemoryRowProps {
  memory: MemoryListItem;
  onEdit: (memory: MemoryListItem) => void;
  onDelete: (memory: MemoryListItem) => void;
  isBusy?: boolean;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * One row in the memories list. Renders the memory's content with a
 * scope badge (Personal / Team) and inline edit/delete buttons.
 */
export function MemoryRow({
  memory,
  onEdit,
  onDelete,
  isBusy = false,
}: MemoryRowProps) {
  const isPersonal = memory.scope === 'personal';

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={isPersonal ? 'secondary' : 'outline'}>
              {isPersonal ? 'Personal' : 'Team'}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {formatDate(memory.createdAt)}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">
            {memory.content}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(memory)}
            disabled={isBusy}
            aria-label="Edit memory"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(memory)}
            disabled={isBusy}
            aria-label="Delete memory"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
