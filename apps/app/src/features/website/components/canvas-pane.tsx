import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { BlockSelection, MicrositePage } from '../api/types';
import { BLOCK_LABELS, blockTitle } from '../lib/block-fields';
import { useInlineEdit } from '../lib/use-inline-edit';

export interface InlineEditRequest {
  pageId: string;
  blockId: string;
  field: string;
  value: string;
}

interface CanvasPaneProps {
  pages: MicrositePage[];
  activePageId: string | null;
  onActivePageChange: (pageId: string) => void;
  previewUrl: string | null | undefined;
  selection: BlockSelection | null;
  onSelect: (selection: BlockSelection | null) => void;
  onMoveBlock: (pageId: string, blockId: string, toIndex: number) => void;
  changedBlockIds: Set<string>;
  /** Bumped after every applied change so the preview reloads. */
  previewNonce: number;
  onReloadPreview: () => void;
  /**
   * Commit text typed directly in the preview. Must resolve when the block was
   * saved and reject when it was not — the iframe restores the previous text on
   * a rejection (inline-edit contract §5). Omitted, inline editing is inert:
   * the canvas still refuses every message rather than half-committing.
   */
  onInlineEdit?: (input: InlineEditRequest) => Promise<unknown>;
}

/**
 * The canvas: an iframe of the DRAFT preview, plus the page's block outline.
 *
 * The outline is not decoration. Selection has to be keyboard-reachable and
 * drag-reorder has to work without a mouse, and neither is possible inside a
 * cross-origin iframe we do not control — the preview is the rendered site, not
 * an editable surface. So the outline is the interactive layer: every block is a
 * real button, reorder runs through dnd-kit's keyboard sensor, and the iframe
 * stays a faithful preview.
 *
 * Reorder calls `onMoveBlock`, which is the same hook the inspector uses and the
 * same endpoint the agent's `move_block` tool goes through (§5).
 */
export function CanvasPane({
  pages,
  activePageId,
  onActivePageChange,
  previewUrl,
  selection,
  onSelect,
  onMoveBlock,
  changedBlockIds,
  previewNonce,
  onReloadPreview,
  onInlineEdit,
}: CanvasPaneProps) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const page = pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const pageRef = useRef(page);
  pageRef.current = page;

  // Inline editing in the preview (§4). Selection and the commit both land on
  // the paths the outline and the inspector already use — clicking text in the
  // preview scopes the next prompt exactly like clicking the outline row does.
  useInlineEdit({
    iframeRef,
    previewUrl,
    onSelectBlock: (blockId) => {
      const current = pageRef.current;
      if (!current || !current.blocks.some((b) => b.id === blockId)) return;
      onSelect({ pageId: current.id, blockId });
    },
    getFieldValue: useCallback((blockId: string, field: string) => {
      const block = pageRef.current?.blocks.find((b) => b.id === blockId);
      const value = (block?.props as Record<string, unknown> | undefined)?.[
        field
      ];
      return typeof value === 'string' ? value : undefined;
    }, []),
    commit: useCallback(
      ({
        blockId,
        field,
        value,
      }: {
        blockId: string;
        field: string;
        value: string;
      }) => {
        const current = pageRef.current;
        if (!current || !onInlineEdit) {
          return Promise.reject(
            new Error('This page is not editable right now')
          );
        }
        return onInlineEdit({ pageId: current.id, blockId, field, value });
      },
      [onInlineEdit]
    ),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!page || !over || active.id === over.id) return;
    const toIndex = page.blocks.findIndex((b) => b.id === over.id);
    if (toIndex < 0) return;
    onMoveBlock(page.id, String(active.id), toIndex);
  };

  const src =
    previewUrl && page
      ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}path=${encodeURIComponent(
          page.path
        )}&v=${previewNonce}`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
        <Select value={page?.id ?? ''} onValueChange={onActivePageChange}>
          <SelectTrigger className="h-8 w-[200px]" aria-label="Page">
            <SelectValue placeholder="Page" />
          </SelectTrigger>
          <SelectContent>
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}{' '}
                <span className="text-muted-foreground">{p.path}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge variant="outline" className="gap-1">
          Draft
        </Badge>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setViewport(viewport === 'desktop' ? 'mobile' : 'desktop')
            }
            aria-label={`Switch to ${viewport === 'desktop' ? 'mobile' : 'desktop'} preview`}
          >
            <MonitorSmartphone className="size-4" />
            {viewport === 'desktop' ? 'Desktop' : 'Mobile'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onReloadPreview}
            aria-label="Reload preview"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Page sections"
          className="w-64 shrink-0 overflow-y-auto border-r bg-background p-2"
        >
          {page && page.blocks.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={page.blocks.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1">
                  {page.blocks.map((block) => (
                    <SortableBlockRow
                      key={block.id}
                      id={block.id}
                      label={blockTitle(block)}
                      typeLabel={BLOCK_LABELS[block.type]}
                      selected={selection?.blockId === block.id}
                      flashing={changedBlockIds.has(block.id)}
                      onSelect={() =>
                        onSelect(
                          selection?.blockId === block.id
                            ? null
                            : { pageId: page.id, blockId: block.id }
                        )
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              This page has no sections yet. Ask for one in the prompt panel.
            </p>
          )}
        </nav>

        <div className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-4">
          {src ? (
            <iframe
              key={`${src}`}
              ref={iframeRef}
              title="Website draft preview"
              src={src}
              className={cn(
                'h-full rounded-lg border bg-background shadow-sm',
                viewport === 'desktop' ? 'w-full' : 'w-[390px]'
              )}
            />
          ) : (
            <div className="mt-16 max-w-sm rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">Preview unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The API did not return a preview URL for this draft. Your
                sections are listed on the left and are still editable.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableBlockRow({
  id,
  label,
  typeLabel,
  selected,
  flashing,
  onSelect,
}: {
  id: string;
  label: string;
  typeLabel: string;
  selected: boolean;
  flashing: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1 rounded-md border transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-transparent',
        flashing && 'animate-pulse border-primary/60 bg-primary/10',
        isDragging && 'opacity-70'
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        className="cursor-grab px-1 py-2 text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex-1 truncate px-1 py-2 text-left text-sm"
      >
        <span className="block truncate">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {typeLabel}
        </span>
      </button>
    </li>
  );
}
