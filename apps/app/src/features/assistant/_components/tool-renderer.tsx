import {
  AdPreviewCard as ClaireAdPreviewCard,
  OfferPreviewCard,
  asPreviewCardPayload,
} from '@/features/claire/chat-preview';
import { ClipListEditor } from '@/features/content-batches/components/clip-list-editor';
import { AdPreviewCard, type AdPreviewProps } from './rich/ad-preview-card';
import {
  CampaignPreviewCard,
  type CampaignPreviewData,
} from './rich/campaign-preview-card';
import { ChatbotToggleCard } from './rich/chatbot-toggle-card';
import { ClipSelectionGrid } from './rich/clip-selection-grid';
import {
  ConfirmationRequiredCard,
  type ConfirmationRequiredPresentation,
} from './rich/confirmation-required-card';
import { CreatedCard } from './rich/created-card';
import { CreatingStatus } from './rich/creating-status';
import { DraftReplyCard } from './rich/draft-reply-card';
import {
  type ExistingCandidate,
  ExistingCandidatesCard,
} from './rich/existing-candidates-card';
import { GraphicDraftPreviewCard } from './rich/graphic-draft-preview';
import { GraphicStatusCard } from './rich/graphic-status-card';
import { ProcessingStatus } from './rich/processing-status';
import { QRCodeCard } from './rich/qr-code-card';
import { StopAndAskCard } from './rich/stop-and-ask-card';
import { SupportChatCard } from './rich/support-chat-card';
import { isCreatedState, isCreatingState } from './rich/types';
import { VideoDraftPreviewCard } from './rich/video-draft-preview';
import { VideoThumbnailCard } from './rich/video-thumbnail-card';
import { type ToolPartData, toolNameToLabel } from './tool-parts';

export interface ToolRendererProps {
  toolName: string;
  toolPart: ToolPartData;
  /**
   * How a card answers.
   *
   * There is no `onToolRespond` any more. Cards used to answer by writing a
   * tool output back with `addToolOutput({ output: 'approved' })`, which only
   * works while a tool is PAUSED awaiting the browser — and no tool here is.
   * Every one executes on the server and streams its result, so those cards
   * were comparing an object to the string 'approved' and rendering a refusal.
   * An answer is a message; the model reads it and calls the tool again with
   * the confirmation token it is holding.
   */
  onSendMessage: (text: string) => void;
}

/**
 * Maps a tool-part (name + state) to its rich-content renderer. Returns
 * null when no rich UI is appropriate (silent tools, errors handled by
 * the chain-of-thought trace, unknown tools).
 *
 * Rich-content renderer prop shapes are preserved verbatim from v2 — they
 * are exercised against the legacy backend until C-02 swaps it out.
 */
export function ToolRenderer({
  toolName,
  toolPart,
  onSendMessage,
}: ToolRendererProps) {
  const { state, input, output } = toolPart;
  // `toolName` here is the bare action — `getToolName` strips both the
  // `tool-` part-type prefix and the `{feature}_` namespace so every check
  // below can use the simple action name.

  // `previewCampaign` still opts out by peeking at its own input: the
  // create-campaign flow reads its signals silently and shows only the
  // createCampaign card. Content tools no longer need this — `createContent`
  // returns `{ type: 'none' }` when the card is suppressed, which is the tool
  // saying so rather than the renderer inferring it from the far side of the
  // wire.
  if (
    toolName === 'previewCampaign' &&
    (input as { suppressCard?: boolean } | undefined)?.suppressCard
  ) {
    return null;
  }

  // The clip list editor: the ordered list, with the approval that renders it
  // attached to the bottom of the same card.
  //
  // Dispatched on the CARD the tool asked for, not on its name. That is the
  // correction this branch needed: it used to require one of three tool names,
  // so `patchDraftVideo` fell through to a generic title-over-one-field card
  // and the owner was told "approve on the card" with no approval on screen —
  // and when those three tools became `patchContent`, a name-keyed branch would
  // have rendered nothing at all for the tool that replaced them.
  //
  // The card addresses a CONTENT ITEM, which is the correction five earlier
  // attempts needed. An approved edit forks the video, and the item is what
  // follows the fork — address the video instead and the fork's id ends up
  // somewhere only the browser can see, so "render it now" finds the cut the
  // owner already replaced and correctly reports nothing to do.
  {
    const card = (
      output as
        | {
            presentation?: {
              type?: string;
              itemId?: string;
              attemptId?: string;
              renderCount?: number;
              title?: string;
              serviceId?: string | null;
              minClipCount?: number;
            };
          }
        | undefined
    )?.presentation;

    // Rendering nothing, on purpose. An offer video created only as a creative
    // for a draft ad has its own combined card later in the turn; showing the
    // raw creative first asks the owner to approve a video twice.
    if (card?.type === 'none') return null;

    if (card?.type === 'content_clips' && card.itemId) {
      return (
        <ClipListEditor
          itemId={card.itemId}
          // The cut this card was emitted against. Without it every card for an
          // item is equally live, so an older one offers to approve an edit
          // staged long after it was written.
          attemptId={card.attemptId}
          renderCount={card.renderCount}
          title={card.title}
          serviceId={card.serviceId ?? null}
          minClipCount={card.minClipCount ?? 1}
        />
      );
    }
  }

  // Video cards, same envelope dispatch.
  //
  // `video_status` is a render already accepted — nothing left to approve, so
  // the self-polling card. `video_draft` is the DEGRADED path: the draft exists
  // but its content item could not be opened, so there is no item to address
  // and the older preview card stands in rather than the draft being lost.
  {
    const card = (
      output as
        | {
            presentation?: {
              type?: string;
              videoId?: string;
              status?: string;
              title?: string;
              fields?: { label: string; value: string }[];
              serviceId?: string | null;
              clipAssetIds?: string[];
              minClipCount?: number;
              textFrames?: Array<{
                id: string;
                text: string;
                style?:
                  | 'default'
                  | 'question'
                  | 'answer'
                  | 'disclaimer'
                  | 'cta';
              }>;
            };
          }
        | undefined
    )?.presentation;

    if (card?.type === 'video_status' && card.videoId) {
      return (
        <ProcessingStatus
          data={{
            videoId: card.videoId,
            status: card.status ?? 'queued',
            title: card.title,
          }}
          onPrompt={onSendMessage}
        />
      );
    }

    if (card?.type === 'video_draft' && card.videoId) {
      return (
        <VideoDraftPreviewCard
          videoId={card.videoId}
          title={card.title ?? 'Video draft'}
          fields={card.fields ?? []}
          serviceId={card.serviceId ?? null}
          initialClipAssetIds={card.clipAssetIds ?? []}
          minClipCount={card.minClipCount ?? 1}
          textFrames={card.textFrames}
        />
      );
    }
  }

  // Graphic cards, dispatched on the envelope the tool asked for.
  //
  // `graphic_draft` is a PROPOSAL — nothing has been generated yet, and the
  // card owns source-image selection so the owner picks before the render is
  // spent. `graphic_status` is a placeholder row already rendering; the card
  // polls and swaps to the image when the worker finishes.
  //
  // Keyed on tool names, this was three branches with a `prepared` flag read
  // out of the payload to tell them apart — and `createAdGraphic` fell through
  // to the plain CreatedCard, sitting forever on a static "Generating…" line
  // that never became an image.
  {
    const card = (
      output as
        | {
            presentation?: {
              type?: string;
              graphicId?: string;
              itemId?: string;
              attemptId?: string;
              serviceId?: string;
              category?: string;
              kind?: string;
              topicSummary?: string;
              status?: string;
              title?: string;
              fields?: Array<{ label: string; value: string }>;
            };
          }
        | undefined
    )?.presentation;

    if (card?.type === 'graphic_draft' && card.serviceId && card.category) {
      return (
        <GraphicDraftPreviewCard
          itemId={card.itemId}
          attemptId={card.attemptId}
          serviceId={card.serviceId}
          category={card.category}
          kind={card.kind}
          topicSummary={card.topicSummary}
          title={card.title}
          fields={card.fields}
        />
      );
    }

    if (card?.type === 'graphic_status' && card.graphicId) {
      return (
        <GraphicStatusCard
          itemId={card.itemId}
          data={{
            graphicId: card.graphicId,
            status: card.status,
            title: card.title,
          }}
        />
      );
    }
  }

  // The rich ad card — caption, headline, CTA, creative — rather than a
  // definition list.
  //
  // There were TWO of these blocks, name-keyed and identical apart from which
  // four tools each listed, sitting forty lines apart. That is the duplication
  // a discriminator makes unspellable: a tool now says `ad_preview` and the
  // renderer looks it up.
  {
    const card = (output as { presentation?: { type?: string } } | undefined)
      ?.presentation;
    if (
      card?.type === 'ad_preview' &&
      output &&
      typeof output === 'object' &&
      'preview' in output &&
      output.preview &&
      typeof output.preview === 'object'
    ) {
      const preview = output.preview as AdPreviewProps;
      // A 'launched' card carries `launchState` — the state read back from Meta
      // (ADR-005) — so the pill says Live / In review / Campaign paused rather
      // than what we hoped for.
      if (preview.variant === 'draft' || preview.variant === 'launched') {
        return <AdPreviewCard {...preview} />;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Generic dispatch — runs first so any tool can opt in to these
  // primitives by returning the matching `{ uiState: ... }` shape from its
  // server-side implementation. No new switch case needed here.
  // ──────────────────────────────────────────────────────────────────────
  if (output && isCreatingState(output)) {
    return <CreatingStatus label={output.label} detail={output.detail} />;
  }

  // Destructive confirmation, for ANY tool.
  //
  // The factory returns this envelope for every destructive tool — summary,
  // action, token — and the app rendered none of it, so confirming happened in
  // prose. Dispatching on the envelope rather than the tool name is the point:
  // the alternative is a branch per tool, which is exactly how `regenerateItem`
  // shipped with Claire announcing "confirm on the card above" over a card that
  // did not exist.
  //
  // Runs before the generic `isCreatedState` dispatch so a tool that returns
  // both shapes shows the confirmation rather than a summary of work it has not
  // done yet.
  {
    const presentation = (
      output as { presentation?: ConfirmationRequiredPresentation } | undefined
    )?.presentation;
    if (presentation?.type === 'confirmation_required') {
      return (
        <ConfirmationRequiredCard
          presentation={presentation}
          onConfirm={onSendMessage}
        />
      );
    }
  }

  if (output && isCreatedState(output)) {
    return (
      <CreatedCard
        title={output.title}
        fields={output.fields}
        actions={output.actions}
        variant={output.variant}
        onPrompt={onSendMessage}
      />
    );
  }

  // Window 7 — Claire chat preview cards. `show_ad_preview` /
  // `show_offer_preview` (and any future preview-emitting tool) carry
  // a `presentation: { type: 'preview_card', ... }` envelope on
  // `output`. The card is the source of truth for Publish / Save
  // Draft; the underlying tool just hands us the draft snapshot.
  if (state === 'output-available' && output) {
    const previewPayload = asPreviewCardPayload(output);
    if (previewPayload?.kind === 'ad') {
      return <ClaireAdPreviewCard draft={previewPayload.state} />;
    }
    if (previewPayload?.kind === 'offer') {
      return <OfferPreviewCard draft={previewPayload.state} />;
    }
  }

  // Both `getVideoStatus` and `executeVideoExport` mount the same status
  // card. `executeVideoExport` only returns `{ videoId, status }` after
  // queueing, but `ProcessingStatus` polls /videos/:id internally — the
  // missing fields (title, progress, thumbnail) populate on the first
  // poll tick. Wiring it here so the loading card appears immediately on
  // Approve, without relying on Claire to also call `getVideoStatus`.
  // Everything below dispatches on the card the tool named.
  {
    const card = (
      output as
        | {
            presentation?: {
              type?: string;
              videoId?: string;
              status?: string;
              progress?: number;
              processingStage?: string;
              title?: string;
              blobUrl?: string;
              thumbnailUrl?: string;
              durationMs?: number;
              recordingUrl?: string;
              instructions?: string;
              conversationId?: string;
              draft?: string;
              customerName?: string | null;
              platform?: string;
              reason?: string;
              created?: boolean;
              notConfigured?: boolean;
              assets?: Array<{
                id: string;
                name: string;
                type?: string;
                duration?: number | string | null;
                blobUrl?: string | null;
                thumbnailUrl?: string | null;
                tags?: string[] | null;
              }>;
            };
          }
        | undefined
    )?.presentation;

    // A finished render is the VIDEO, not a progress bar that reached the end.
    if (card?.type === 'video_status' && card.videoId) {
      if (card.status === 'ready') {
        return (
          <VideoThumbnailCard
            videoId={card.videoId}
            title={card.title ?? 'Video'}
            thumbnailUrl={card.thumbnailUrl}
            blobUrl={card.blobUrl}
            durationMs={card.durationMs}
            status="ready"
            mediaOnly
          />
        );
      }
      return (
        <ProcessingStatus
          data={{
            videoId: card.videoId,
            status: card.status ?? 'queued',
            progress: card.progress,
            processingStage: card.processingStage,
            title: card.title,
            blobUrl: card.blobUrl,
            thumbnailUrl: card.thumbnailUrl,
            durationMs: card.durationMs,
          }}
          onPrompt={onSendMessage}
        />
      );
    }

    if (card?.type === 'support_chat') {
      return (
        <SupportChatCard
          reason={card.reason ?? ''}
          created={!!card.created}
          notConfigured={card.notConfigured}
        />
      );
    }

    if (card?.type === 'qr_code' && card.recordingUrl) {
      return (
        <QRCodeCard
          recordingUrl={card.recordingUrl}
          instructions={card.instructions}
        />
      );
    }

    if (card?.type === 'asset_picker' && card.assets) {
      if (card.assets.length === 0) {
        return (
          <p className="italic text-muted-foreground text-xs">
            No assets found.
          </p>
        );
      }
      const assets = card.assets;
      return (
        <ClipSelectionGrid
          assets={assets}
          onConfirm={(ids) => {
            const assetMap = new Map(assets.map((a) => [a.id, a.name]));
            const lines = ids.map(
              (id) => `- ${assetMap.get(id) ?? 'Untitled'} (${id})`
            );
            onSendMessage(
              `I've selected these clips for the video. Update the draft with them:\n${lines.join('\n')}`
            );
          }}
        />
      );
    }

    // The drafted reply. Not a token confirmation — nothing is staged
    // server-side — but sending is still an outward action, so the operator
    // holds it and the outcome goes back as a message.
    if (card?.type === 'draft_reply' && card.draft && card.conversationId) {
      return (
        <DraftReplyCard
          conversationId={card.conversationId}
          draft={card.draft}
          customerName={card.customerName ?? null}
          platform={card.platform}
          onRespond={onSendMessage}
        />
      );
    }

    // `chatbots_setEnabled` — the chatbot kill switch (Phase 8 / #65). Keyed
    // on the tool name rather than a card type because the tool returns plain
    // `data`, not a `presentation` card. Shows the PERSISTED flag the endpoint
    // reported, not the requested one.
    if (toolName === 'setEnabled') {
      return <ChatbotToggleCard output={output} />;
    }

    if (card?.type === 'campaign_preview') {
      const data = output as unknown as CampaignPreviewData;
      if (!data.campaignId) return null;
      return <CampaignPreviewCard data={data} onSendMessage={onSendMessage} />;
    }
  }

  // Duplicate-protection picker (Phase 4 #79 #151) — `createCampaign` /
  // `createLeadForm` return `uiState: 'existing_candidates'` when a recent
  // near-duplicate exists (nothing was created).
  if (
    state === 'output-available' &&
    output &&
    (output as { uiState?: string }).uiState === 'existing_candidates'
  ) {
    const data = output as {
      existingCandidates?: ExistingCandidate[];
      proposedName?: string;
    };
    const kind =
      toolName === 'createLeadForm'
        ? ('lead_form' as const)
        : ('campaign' as const);
    return (
      <ExistingCandidatesCard
        kind={kind}
        proposedName={data.proposedName}
        candidates={data.existingCandidates ?? []}
        onPrompt={onSendMessage}
      />
    );
  }

  // Circuit breaker (Phase 4 #9 #37) — factory-attached `stop_and_ask`.
  {
    const presentation = (
      output as { presentation?: { type?: string } } | undefined
    )?.presentation;
    if (presentation?.type === 'stop_and_ask') {
      const p = presentation as { failureCount?: number; reason?: string };
      return (
        <StopAndAskCard
          label={toolNameToLabel(toolName)}
          failureCount={p.failureCount}
          reason={p.reason}
        />
      );
    }
  }

  if (state === 'output-error') {
    return (
      <p className="text-destructive text-xs">
        {toolNameToLabel(toolName)} failed:{' '}
        {toolPart.errorText ?? 'unknown error'}
      </p>
    );
  }

  // Anything else is folded into the chain-of-thought trace; render nothing.
  return null;
}
