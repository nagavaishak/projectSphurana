import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import {
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Graphic, GraphicStatus } from '../api/types';

export interface GraphicCardProps {
  graphic: Graphic;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onExport?: (id: string) => void;
}

const statusConfig: Record<
  GraphicStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  draft: { label: 'Draft', variant: 'secondary' },
  rendering: { label: 'Rendering', variant: 'outline' },
  ready: { label: 'Ready', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export function GraphicCard({
  graphic,
  onEdit,
  onDelete,
  onExport,
}: GraphicCardProps) {
  const status = statusConfig[graphic.status];

  // Thumbnail comes from the first rendered output (no per-slide thumbnails today)
  const firstOutput = graphic.outputs?.[0];
  const thumbnailUrl =
    firstOutput && typeof firstOutput === 'object' ? firstOutput.url : null;

  const displayTitle = graphic.title || 'Untitled';

  return (
    <Card className="group overflow-hidden">
      <CardHeader className="p-0">
        {/* Thumbnail */}
        <div className="relative aspect-square bg-muted">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={displayTitle}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <span className="text-sm">No preview</span>
            </div>
          )}

          {/* Status Overlay */}
          {graphic.status === 'rendering' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          )}

          {/* Actions Overlay */}
          <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.(graphic.id)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onExport?.(graphic.id)}
                  disabled={
                    graphic.status !== 'ready' && graphic.status !== 'draft'
                  }
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete?.(graphic.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        <div className="space-y-1">
          <h3 className="font-medium leading-none truncate">{displayTitle}</h3>
          {graphic.outputs && graphic.outputs.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {graphic.outputs.length} slide
              {graphic.outputs.length > 1 ? 's' : ''}
            </p>
          )}
          {graphic.status === 'failed' && graphic.errorMessage && (
            <p className="pt-1 text-xs text-muted-foreground">
              {graphic.errorMessage}
            </p>
          )}
          {graphic.status === 'failed' && graphic.errorCode && (
            <p className="text-xs font-medium">
              Error code:{' '}
              <span className="select-all font-mono">{graphic.errorCode}</span>
            </p>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between border-t p-4">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="text-xs text-muted-foreground">
          {format(new Date(graphic.createdAt), 'MMM d, yyyy')}
        </span>
      </CardFooter>
    </Card>
  );
}
