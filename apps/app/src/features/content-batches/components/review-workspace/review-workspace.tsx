import { ArrowLeft, ImageIcon, VideoIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ArtifactPanel } from '@/features/assistant/_components/artifact-panel';
import {
  ArtifactPanelProvider,
  useArtifactPanel,
} from '@/features/assistant/_components/artifact-panel-context';
import { ChatContainer } from '@/routes/_authed/assistant/-components';

import { useGetCurrentBatch } from '../../api/get-current-batch';
import type { ContentItemWithAsset } from '../../types';
import { QueueRail } from './queue-rail';

/**
 * The bulk content review workspace.
 *
 * THREE COLUMNS: the queue, the ordinary assistant chat, and the content panel.
 *
 * The middle column used to be `ClaireThread` — a second chat, with its own
 * server turn handler, its own prompt, and its own idea of what an edit is.
 * Two chats meant every improvement had to be made twice and usually was not:
 * the clip editor, the artifact panel, the approval cards and the staged-edit
 * model all landed in one of them first, and the review page spent months
 * behind. Reviewing a post is not a different kind of conversation from asking
 * for one, so it is no longer a different conversation.
 *
 * The right-hand column is the same `ArtifactPanel` the assistant chat opens,
 * carrying the same Save / Schedule / Reject. The decision used to be a footer
 * under a mock-up of the post; it now sits with the thing it decides on, in one
 * component both surfaces share.
 *
 * The provider is mounted HERE rather than inside the chat, because the queue
 * opens artifacts too — selecting a post shows it. A provider nested in the
 * chat would be invisible to the rail beside it.
 */
export function ReviewWorkspace({
  onBack,
  onDone,
}: {
  onBack?: () => void;
  onDone?: () => void;
}) {
  return (
    <ArtifactPanelProvider>
      <ReviewWorkspaceBody onBack={onBack} onDone={onDone} />
    </ArtifactPanelProvider>
  );
}

function ReviewWorkspaceBody({
  onBack,
  onDone,
}: {
  onBack?: () => void;
  onDone?: () => void;
}) {
  const { batch, items, isLoading } = useGetCurrentBatch();
  const { artifact, openArtifact } = useArtifactPanel();

  const currentItems = items;
  const [activeItemId, setActiveItemId] = useState<string | undefined>();

  const activeItem: ContentItemWithAsset | undefined = useMemo(() => {
    const found = currentItems.find((i) => i.id === activeItemId);
    if (found) return found;
    // Land on the first thing that still needs a decision; fall back to the
    // first item so a fully-reviewed batch still renders something.
    return (
      currentItems.find((i) => i.reviewStatus === 'pending') ?? currentItems[0]
    );
  }, [currentItems, activeItemId]);

  // Selecting a post shows it. The panel is the only place the content appears
  // now, so leaving it closed would be a review page showing nothing to review.
  const assetId =
    activeItem?.kind === 'video'
      ? activeItem.video?.id
      : activeItem?.graphic?.id;
  useEffect(() => {
    if (!activeItem || !assetId) return;
    openArtifact({
      kind: activeItem.kind === 'video' ? 'video' : 'graphic',
      id: assetId,
      itemId: activeItem.id,
    });
  }, [activeItem, assetId, openArtifact]);

  const reviewedCount = currentItems.filter(
    (i) => i.reviewStatus !== 'pending'
  ).length;

  /** Move to the next undecided post, or report the queue finished. */
  const advance = () => {
    const next = currentItems.find(
      (i) => i.reviewStatus === 'pending' && i.id !== activeItem?.id
    );
    if (next) {
      setActiveItemId(next.id);
      return;
    }
    onDone?.();
  };

  if (isLoading) {
    return (
      <div className="flex h-dvh flex-col gap-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  if (!activeItem) {
    return (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-sm font-medium">Nothing to review</p>
          <p className="text-xs text-muted-foreground">
            This month&rsquo;s batch has no posts in it yet.
          </p>
          {onBack ? (
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Back to planner
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    // Full viewport: this route sits outside the dashboard shell, so there is
    // no sidebar or site header above it to subtract.
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to planner"
            className="size-8 shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">Review content</h1>
          <p className="truncate text-xs text-muted-foreground">
            {batch?.periodMonth
              ? `Generated for ${batch.periodMonth}`
              : 'Approve or change each piece'}
          </p>
        </div>
        <Badge variant="outline" className="gap-1 font-normal">
          {activeItem.kind === 'graphic' ? (
            <ImageIcon className="size-3" />
          ) : (
            <VideoIcon className="size-3" />
          )}
          {activeItem.kind === 'graphic' ? 'Graphic' : 'Video'}
        </Badge>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {reviewedCount}/{currentItems.length} reviewed
        </p>
      </header>

      {/* Mobile: the queue is progress segments across the top. */}
      <div className="border-b px-4 py-2 md:hidden">
        <QueueRail
          items={currentItems}
          activeItemId={activeItem.id}
          onSelect={setActiveItemId}
          variant="segments"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Rail: full at ≥1280, numbered strip between 768 and 1280, gone below. */}
        <aside className="hidden w-14 shrink-0 border-r md:block xl:w-64">
          <div className="hidden h-full xl:block">
            <QueueRail
              items={currentItems}
              activeItemId={activeItem.id}
              onSelect={setActiveItemId}
              variant="full"
            />
          </div>
          <div className="h-full xl:hidden">
            <QueueRail
              items={currentItems}
              activeItemId={activeItem.id}
              onSelect={setActiveItemId}
              variant="strip"
            />
          </div>
        </aside>

        {/* The ordinary assistant chat, told which post is under discussion.
            Keyed on the item so switching posts starts a fresh conversation
            rather than carrying post 2's instructions onto post 5 — the same
            scoping the per-item thread had, expressed as a remount. */}
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatContainer
            key={activeItem.id}
            greeting="Are there any changes that you would like to make?"
            // The page has its own header, and this conversation is one per
            // post — not something the owner names or keeps.
            showHeader={false}
            initialContext={{
              entityType: 'content_item',
              entityId: activeItem.id,
            }}
          />
        </main>

        {/* The content, and the decision about it.
            Half the remaining width: the post is the thing being reviewed, and
            giving it a narrow strip beside a wide chat inverts which of the two
            the screen is for. */}
        <aside className="hidden min-w-0 flex-1 shrink-0 border-l lg:block">
          {artifact ? (
            <ArtifactPanel
              artifact={artifact}
              onDecided={advance}
              // Permanent column here — see `closable`.
              closable={false}
            />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-xs text-muted-foreground">
              This post has nothing rendered yet.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
