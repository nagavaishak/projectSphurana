import { AlertCircle, Globe } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import type { BlockSelection, TranscriptEntry } from '../api/types';
import { useBlockMutation } from '../api/use-block-mutations';
import { useCreateMicrosite } from '../api/use-create-microsite';
import { useMicrosite } from '../api/use-microsite';
import { useMicrositeChat } from '../api/use-microsite-chat';
import { usePublishMicrosite } from '../api/use-publish-microsite';
import {
  useMicrositeRevisions,
  useRestoreRevision,
} from '../api/use-revisions';
import { blockTitle } from '../lib/block-fields';
import { useChangedBlocks } from '../lib/use-changed-blocks';
import { CanvasPane } from './canvas-pane';
import { InspectorPane } from './inspector-pane';
import { PromptSidebar } from './prompt-sidebar';
import { PublishButton } from './publish-button';
import { VersionHistory } from './version-history';

/**
 * `/dashboard/website` — the three-pane microsite editor.
 *
 * Prompt sidebar, canvas, inspector. The draft is what all three operate on;
 * publishing is a separate, explicit act that only the Publish button performs.
 */
export function WebsiteEditor() {
  const { microsite, document, isLoading, isMissing, isError, error, refetch } =
    useMicrosite();
  const { createMicrosite, isCreating } = useCreateMicrosite();

  const micrositeId = microsite?.id ?? null;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selection, setSelection] = useState<BlockSelection | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const pages = document?.pages ?? [];
  const activePage =
    pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;

  useEffect(() => {
    if (!activePageId && activePage) setActivePageId(activePage.id);
  }, [activePageId, activePage]);

  // Blocks the user just edited inline, held so the outline does not flash them
  // back at them (inline-edit contract §5) and so the commit does not reload the
  // iframe out from under the caret.
  const inlineEditedBlockIds = useRef<Set<string>>(new Set());
  const skipNextPreviewReload = useRef(false);

  const changedBlockIds = useChangedBlocks(document?.pages ?? null, {
    suppressedBlockIds: inlineEditedBlockIds,
  });

  // Reload the iframe whenever the draft document changes — from a turn, a
  // manual edit, a reorder or a restore. The theme is part of that signature
  // because restore rewrites the theme too (§1 amendment 2): a preview keyed
  // only on blocks would keep showing the brand colours of an undone turn.
  const documentSignature = useMemo(
    () =>
      document
        ? JSON.stringify({
            theme: document.theme,
            pages: document.pages.map((page) => ({
              id: page.id,
              blocks: page.blocks.map((block) => [
                block.id,
                block.variant,
                block.props,
              ]),
            })),
          })
        : null,
    [document]
  );

  useEffect(() => {
    if (!documentSignature) return;
    // An inline edit is already on screen — the user typed it into the preview
    // itself. Reloading the iframe would only throw away their caret (and, on
    // an Enter-commit, the field they are still in).
    if (skipNextPreviewReload.current) {
      skipNextPreviewReload.current = false;
      return;
    }
    setPreviewNonce((nonce) => nonce + 1);
  }, [documentSignature]);

  const {
    revisions,
    isLoading: revisionsLoading,
    isError: revisionsError,
  } = useMicrositeRevisions(micrositeId);
  const { restoreRevision, isRestoring, restoringId } =
    useRestoreRevision(micrositeId);
  const { publish, isPublishing } = usePublishMicrosite(micrositeId);
  const blocks = useBlockMutation(micrositeId);

  const chat = useMicrositeChat({
    micrositeId,
    draftRevisionId: microsite?.draftRevisionId ?? null,
    conversationId,
    onConversationId: setConversationId,
  });

  const selectedBlock =
    activePage?.blocks.find((block) => block.id === selection?.blockId) ?? null;

  // Inline canvas edits commit through the ONE block-mutation hook — the same
  // endpoint, the same `propsPatch` body, the same query invalidations as an
  // inspector edit, so history and "N changes since last publish" stay correct.
  const handleInlineEdit = useCallback(
    async ({
      pageId,
      blockId,
      field,
      value,
    }: {
      pageId: string;
      blockId: string;
      field: string;
      value: string;
    }) => {
      inlineEditedBlockIds.current.add(blockId);
      skipNextPreviewReload.current = true;
      try {
        return await blocks.updateBlockAsync(pageId, blockId, {
          [field]: value,
        });
      } catch (error) {
        // Nothing changed, so nothing to suppress — and the iframe is about to
        // restore the old text on `commit-failed`.
        inlineEditedBlockIds.current.delete(blockId);
        skipNextPreviewReload.current = false;
        throw error;
      }
    },
    [blocks.updateBlockAsync]
  );

  const handleUndo = (entry: TranscriptEntry) => {
    // Undo IS a restore (§1): step the draft back to the revision it was on
    // before this turn. Nothing is deleted, so redo is just restoring forward.
    const target = entry.previousRevisionId;
    if (!target) return;
    restoreRevision(target);
    chat.markDecision(entry.id, 'undone');
  };

  if (isLoading) {
    return (
      <div className="flex h-full gap-4 p-4">
        <Skeleton className="h-full w-[340px]" />
        <Skeleton className="h-full flex-1" />
        <Skeleton className="h-full w-[320px]" />
      </div>
    );
  }

  if (isMissing) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe />
            </EmptyMedia>
            <EmptyTitle>You do not have a website yet</EmptyTitle>
            <EmptyDescription>
              Your website is created from your business details — services,
              team, hours and photos. Once it exists you can edit it here by
              describing what you want.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {/*
              "Check again" was the only action here, and nothing provisions a
              microsite — so the button re-fetched the same 404 forever. The
              site is created on request instead.
            */}
            <Button
              type="button"
              disabled={isCreating}
              onClick={() => createMicrosite()}
            >
              {isCreating ? 'Building your website…' : 'Create my website'}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (isError || !microsite || !document) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          role="alert"
          className="max-w-md rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center"
        >
          <AlertCircle
            className="mx-auto size-6 text-destructive"
            aria-hidden
          />
          <p className="mt-3 font-medium">We could not load your website</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error
              ? error.message
              : 'The editor could not reach the server.'}{' '}
            Nothing has been lost — your draft is saved.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-2">
        <h1 className="text-sm font-semibold">Website</h1>
        <span className="text-xs text-muted-foreground">{microsite.slug}</span>
        <div className="ml-auto flex items-center gap-2">
          <VersionHistory
            revisions={revisions}
            isLoading={revisionsLoading}
            isError={revisionsError}
            onRestore={(revisionId) => restoreRevision(revisionId)}
            isRestoring={isRestoring}
            restoringId={restoringId}
          />
          <PublishButton
            changesSincePublish={microsite.changesSincePublish}
            hasEverPublished={microsite.publishedRevisionId !== null}
            isPublishing={isPublishing}
            onPublish={publish}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_340px]">
        <PromptSidebar
          entries={chat.entries}
          isStreaming={chat.isStreaming}
          selectionLabel={selectedBlock ? blockTitle(selectedBlock) : null}
          onClearSelection={() => setSelection(null)}
          onSend={(prompt) => void chat.sendTurn(prompt, { selection })}
          onStop={chat.stop}
          onUndo={handleUndo}
          onKeep={(entry) => chat.markDecision(entry.id, 'kept')}
          onConfirm={(entry) => void chat.confirmTurn(entry)}
          onDecline={(entry) => chat.declineConfirmation(entry.id)}
          isBusy={isRestoring}
        />

        <CanvasPane
          pages={pages}
          activePageId={activePage?.id ?? null}
          onActivePageChange={(pageId) => {
            setActivePageId(pageId);
            setSelection(null);
          }}
          previewUrl={microsite.previewUrl}
          selection={selection}
          onSelect={setSelection}
          onMoveBlock={blocks.moveBlock}
          changedBlockIds={changedBlockIds}
          previewNonce={previewNonce}
          onReloadPreview={() => setPreviewNonce((nonce) => nonce + 1)}
          onInlineEdit={handleInlineEdit}
        />

        <InspectorPane
          page={activePage}
          block={selectedBlock}
          isSaving={blocks.isSaving}
          onUpdateProps={(patch) => {
            if (!activePage || !selectedBlock) return;
            blocks.updateBlock(activePage.id, selectedBlock.id, patch);
          }}
          onUpdateVariant={(variant) => {
            if (!activePage || !selectedBlock) return;
            blocks.updateVariant(activePage.id, selectedBlock.id, variant);
          }}
        />
      </div>
    </div>
  );
}
