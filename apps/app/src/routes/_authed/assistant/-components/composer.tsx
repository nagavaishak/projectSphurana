import type { FileUIPart } from 'ai';
import { AlertCircleIcon, Loader2Icon, XIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ASSISTANT_UPLOAD_MIME_TYPES,
  type AssistantUploadResult,
  useAssistantUpload,
  useAssistantUsage,
  useUploadClip,
  validateAssistantClipUploadFile,
  validateAssistantUploadFile,
} from '@/features/assistant';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ComposerProps {
  /**
   * Dispatch a message. May return `false` to signal the send was refused
   * (e.g. conversation creation failed) so the composer can restore the
   * cleared draft instead of silently losing it.
   */
  onSend: (
    text: string,
    files?: FileUIPart[]
  ) => Promise<boolean | undefined> | boolean | undefined;
  onStop: () => void;
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  /** True when the active conversation has been escalated and is read-only. */
  isEscalated?: boolean;
  /**
   * Lazy-creates a conversation if one isn't yet attached and returns its
   * ID. Required because `POST /assistant/uploads/sign` needs a conversation
   * (S3 key is namespaced by it) — see W-C11-infra.
   */
  ensureConversation: () => Promise<string>;
  /**
   * Optional starter text for the textarea (W-C01-C). Captured once on mount
   * — subsequent changes are ignored so the user's edits aren't overwritten.
   */
  initialDraft?: string;
  /**
   * Files handed off from the home-screen prompt. Staged + uploaded once on
   * mount via the same path as a manual file pick.
   */
  initialFiles?: File[];
  /**
   * Arrived from the home-screen prompt: submit the initial draft (+ files)
   * automatically once any handed-off uploads settle — the user lands
   * straight in a live conversation rather than the welcome screen.
   */
  autoSubmit?: boolean;
  /**
   * Active video draft ID (W-C10-clip-tray). When set, the composer mounts
   * `<ClipTray>` above the textarea and routes `video/*` drops to the
   * asset-library ingest path. Null/undefined leaves the composer in its
   * pre-W-C10 image-only shape.
   */
  activeVideoId?: string | null;
  /** "welcome" — card style centered in welcome screen. "default" — bottom bar. */
  variant?: 'default' | 'welcome';
}

interface StagedAttachment {
  id: string;
  file: File;
  status: 'uploading' | 'uploaded' | 'error';
  result?: AssistantUploadResult;
  error?: string;
  /** Local blob URL for thumbnail preview while/before upload completes. */
  previewUrl: string;
}

const IMAGE_ACCEPT = ASSISTANT_UPLOAD_MIME_TYPES.join(',');
const IMAGE_AND_VIDEO_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/quicktime,video/webm`;

/**
 * Composer with image attachment support (W-C11-frontend).
 *
 * Flow:
 *   - User picks/drops/pastes an image → stage it locally with a blob URL,
 *     ensure a conversation exists, kick off the signed-URL upload.
 *   - Submit is gated on no-uploads-in-flight and no-upload-errors so the
 *     model never sees a half-attached message.
 *   - On send, the staged attachments' resolved S3 download URLs become
 *     `file` UIMessage parts (`{ type: 'file', mediaType, url, filename }`)
 *     which `useChat` posts and `convert-to-anthropic-messages` maps to
 *     Anthropic vision content blocks.
 *   - In-session only: stored messages don't persist `attachments` jsonb
 *     yet (see Handoff). After page reload the image disappears from chat
 *     history but the user-message text is preserved.
 *
 * The PromptInput's built-in attachments path is bypassed (it stores blob
 * URLs and converts them to data URLs on submit — wrong for our S3 design;
 * 10 MB images as base64 would also blow past the 512 KB content cap).
 * We render via the AI Elements `<Attachments>` *display* components only.
 */
export function Composer({
  onSend,
  onStop,
  status,
  isEscalated,
  ensureConversation,
  initialDraft,
  initialFiles,
  autoSubmit,
  activeVideoId,
  variant = 'default',
}: ComposerProps) {
  const { hasAccess, isDailyLimitReached, usage } = useAssistantUsage();
  const { upload } = useAssistantUpload();
  const uploadClip = useUploadClip();

  const [draft, setDraft] = useState(initialDraft ?? '');
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-attachment cleanup needs current array on unmount; ref avoids a
  // closure capture issue in the cleanup effect.
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  // Revoke blob URLs on unmount.
  useEffect(
    () => () => {
      for (const att of stagedRef.current) {
        URL.revokeObjectURL(att.previewUrl);
      }
    },
    []
  );

  const isInputDisabled =
    !hasAccess || isDailyLimitReached || Boolean(isEscalated);

  const isAnyUploading = staged.some((a) => a.status === 'uploading');
  const hasUploadError = staged.some((a) => a.status === 'error');

  const updateAttachment = useCallback(
    (id: string, patch: Partial<StagedAttachment>) => {
      setStaged((prev) =>
        prev.map((att) => (att.id === id ? { ...att, ...patch } : att))
      );
    },
    []
  );

  const removeAttachment = useCallback((id: string) => {
    setStaged((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const startUpload = useCallback(
    async (file: File) => {
      const validationError = validateAssistantUploadFile(file);
      const id = nanoid();
      const previewUrl = URL.createObjectURL(file);

      if (validationError) {
        setStaged((prev) => [
          ...prev,
          {
            id,
            file,
            previewUrl,
            status: 'error',
            error: validationError,
          },
        ]);
        return;
      }

      setStaged((prev) => [
        ...prev,
        { id, file, previewUrl, status: 'uploading' },
      ]);

      try {
        const conversationId = await ensureConversation();
        const result = await upload({ file, conversationId });
        updateAttachment(id, { status: 'uploaded', result });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : 'Upload failed. Please try again.';
        updateAttachment(id, { status: 'error', error: message });
      }
    },
    [ensureConversation, upload, updateAttachment]
  );

  const startClipUpload = useCallback(
    async (file: File) => {
      if (!activeVideoId) {
        // No active video draft — silently drop. The tray isn't visible
        // either, so this only fires on a video MIME landing in a chat
        // without a draft.
        toast.error(
          'Start a video draft first, then drop clips here to add them to it.'
        );
        return;
      }
      const validationError = validateAssistantClipUploadFile(file);
      if (validationError) {
        toast.error(validationError);
        return;
      }
      try {
        await uploadClip.mutateAsync({ file, videoId: activeVideoId });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Clip upload failed.';
        toast.error(message);
      }
    },
    [activeVideoId, uploadClip]
  );

  /**
   * MIME switch (W-C10-clip-tray):
   *   - image/* → existing C-11 vision-attachment path (per-message attach)
   *   - video/* → asset-library ingest + tray (`source: 'uploaded'`)
   *   - other  → silent reject + brief toast
   */
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          void startUpload(file);
        } else if (file.type.startsWith('video/')) {
          void startClipUpload(file);
        } else {
          toast.error('Only images and videos are supported here.');
        }
      }
    },
    [startUpload, startClipUpload]
  );

  // One-shot: stage files handed off from the home-screen prompt. Runs the
  // same `addFiles` path as a manual pick (image → upload, video → clip tray).
  const initialFilesConsumedRef = useRef(false);
  useEffect(() => {
    if (initialFilesConsumedRef.current) return;
    if (!initialFiles || initialFiles.length === 0) return;
    initialFilesConsumedRef.current = true;
    addFiles(initialFiles);
  }, [initialFiles, addFiles]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      // Allow re-selecting the same file after removal.
      e.target.value = '';
    },
    [addFiles]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (isInputDisabled || !e.dataTransfer.types?.includes('Files')) {
        return;
      }
      e.preventDefault();
      setIsDragging(true);
    },
    [isInputDisabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the wrapper itself — child enter/leave
    // events bubble and would otherwise flicker the overlay.
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (isInputDisabled) return;
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [isInputDisabled, addFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      // Allow image-only sends (e.g., "what is this?" doesn't need text)
      // — but require at least one of text or attachment.
      const uploaded = staged.filter(
        (a) => a.status === 'uploaded' && a.result
      );
      if (!text && uploaded.length === 0) return;
      if (isAnyUploading || hasUploadError) return;
      // Mirror the in-flight guard in `handleSend`: it silently no-ops while
      // a turn is streaming, and clearing the box for a refused send would
      // eat the draft.
      if (status === 'submitted' || status === 'streaming') return;

      const fileParts: FileUIPart[] = uploaded.map((a) => ({
        type: 'file' as const,
        mediaType: a.result?.mimeType ?? a.file.type,
        url: a.result?.url ?? '',
        filename: a.result?.filename ?? a.file.name,
      }));

      // Clear the box at dispatch time — the send path awaits conversation
      // creation on the first turn, and holding the sent text in the
      // textarea for that beat reads as a glitch.
      const prevDraft = draft;
      const prevStaged = staged;
      setStaged([]);
      setDraft('');

      const ok = await onSend(
        text,
        fileParts.length > 0 ? fileParts : undefined
      );
      if (ok === false) {
        // Send refused (e.g. conversation creation failed) — restore the
        // user's message so it isn't lost.
        setStaged(prevStaged);
        setDraft(prevDraft);
        return;
      }
      // Release blob previews only after a successful dispatch.
      for (const a of prevStaged) URL.revokeObjectURL(a.previewUrl);
    },
    [staged, isAnyUploading, hasUploadError, status, draft, onSend]
  );

  // Auto-submit once when arriving from the home-screen prompt. Waits for any
  // handed-off files to finish staging + uploading, then fires the same
  // submit path as a manual send — so the user lands straight in a live
  // conversation instead of the deprecated welcome screen.
  const autoSubmitFiredRef = useRef(false);
  useEffect(() => {
    if (!autoSubmit || autoSubmitFiredRef.current) return;
    // Wait until every handed-off file has been staged...
    const expectedFiles = initialFiles?.length ?? 0;
    if (expectedFiles > 0 && staged.length < expectedFiles) return;
    // ...and finished uploading. A failed upload halts auto-send so the
    // user can resolve it rather than dispatching a partial message.
    if (isAnyUploading || hasUploadError) return;
    const hasUploadedFile = staged.some((a) => a.status === 'uploaded');
    if (draft.trim().length === 0 && !hasUploadedFile) return;
    autoSubmitFiredRef.current = true;
    void handleSubmit({ text: draft, files: [] });
  }, [
    autoSubmit,
    initialFiles,
    staged,
    isAnyUploading,
    hasUploadError,
    draft,
    handleSubmit,
  ]);

  const isWelcome = variant === 'welcome';

  const placeholder = isEscalated
    ? 'This conversation has been escalated to support'
    : isDailyLimitReached
      ? 'Daily message limit reached'
      : !hasAccess
        ? 'AI Assistant not available on your plan'
        : isWelcome
          ? 'Ask me what you want to do...'
          : 'Type a message...';

  const dailyRemaining = usage?.daily?.remaining ?? null;
  const dailyLimit = usage?.daily?.limit ?? null;
  const showCounter =
    dailyRemaining !== null &&
    dailyLimit !== null &&
    !isDailyLimitReached &&
    dailyRemaining <= 10;

  const submitDisabled =
    isInputDisabled ||
    isAnyUploading ||
    hasUploadError ||
    (status === 'ready' && draft.trim().length === 0 && staged.length === 0);

  const dropOverlayCopy = activeVideoId
    ? 'Drop image to attach, or drop a clip to add to this video'
    : 'Drop image to attach';

  const inputArea = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={activeVideoId ? IMAGE_AND_VIDEO_ACCEPT : IMAGE_ACCEPT}
        multiple
        className="hidden"
        aria-label={activeVideoId ? 'Add image or clip' : 'Add image'}
        onChange={handleFileInputChange}
      />

      {/* No clip tray above the input.
          It listed the clips of whatever draft was most recent, permanently,
          over every subsequent turn — a second, stale copy of a list the card
          in the transcript already owns, pinned to the one place on screen
          that should be about what you are typing next. Dropping video files
          on the composer still routes to the draft (see `activeVideoId`); it
          is only the standing display that is gone. */}
      <TooltipProvider>
        <div
          className={cn(
            'relative overflow-hidden rounded-3xl border border-border/70 bg-background shadow-[0_2px_10px_rgba(16,24,40,0.06)]',
            isDragging && 'ring-2 ring-primary ring-offset-2'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div
              className={cn(
                'pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm font-medium text-primary backdrop-blur-sm',
                isWelcome ? 'rounded-2xl' : 'rounded-lg'
              )}
            >
              {dropOverlayCopy}
            </div>
          )}

          {staged.length > 0 && (
            <Attachments className="mb-2" variant="grid">
              {staged.map((att) => (
                <Attachment
                  key={att.id}
                  data={{
                    type: 'file',
                    id: att.id,
                    mediaType: att.file.type,
                    url: att.result?.url ?? att.previewUrl,
                    filename: att.file.name,
                  }}
                  onRemove={() => removeAttachment(att.id)}
                >
                  <AttachmentPreview />
                  {att.status === 'uploading' && (
                    <div
                      aria-label="Uploading image"
                      className="absolute inset-0 flex items-center justify-center bg-background/60"
                    >
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {att.status === 'error' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="absolute inset-0 flex items-center justify-center bg-destructive/15">
                          <AlertCircleIcon className="size-5 text-destructive" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {att.error ?? 'Upload failed'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <AttachmentRemove>
                    <XIcon />
                  </AttachmentRemove>
                </Attachment>
              ))}
            </Attachments>
          )}

          <PromptInput
            onSubmit={handleSubmit}
            className={cn(
              'w-full',
              !isWelcome &&
                [
                  '[&>[data-slot=input-group]]:min-h-[120px]',
                  '[&>[data-slot=input-group]]:items-start',
                  '[&>[data-slot=input-group]]:rounded-none',
                  '[&>[data-slot=input-group]]:border-0',
                  '[&>[data-slot=input-group]]:bg-transparent',
                  '[&>[data-slot=input-group]]:shadow-none',
                ].join(' '),
              isWelcome &&
                [
                  'relative',
                  '[&>[data-slot=input-group]]:rounded-none',
                  '[&>[data-slot=input-group]]:border-0',
                  '[&>[data-slot=input-group]]:bg-transparent',
                  '[&>[data-slot=input-group]]:shadow-none',
                  '[&>[data-slot=input-group]]:h-[170px]',
                  '[&>[data-slot=input-group]]:items-start',
                ].join(' ')
            )}
          >
            <PromptInputBody>
              <PromptInputTextarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={handlePaste}
                placeholder={placeholder}
                disabled={isInputDisabled}
                className={cn(
                  isWelcome &&
                    'h-[138px] max-h-[138px] min-h-[138px] px-6 py-5 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground',
                  !isWelcome &&
                    'h-[92px] min-h-[92px] max-h-[240px] px-4 py-3 text-[15px] leading-6'
                )}
              />
            </PromptInputBody>
            <PromptInputTools
              className={cn(
                'absolute bottom-0 right-0 px-2 pb-2',
                isWelcome && 'absolute bottom-0 left-0 right-0 px-4 pb-4 pt-0'
              )}
            >
              <div className="ml-auto flex items-end gap-2">
                {showCounter && (
                  <span className="text-xs text-muted-foreground">
                    {dailyRemaining} / {dailyLimit} today
                  </span>
                )}
                <PromptInputSubmit
                  status={status}
                  onStop={onStop}
                  disabled={submitDisabled}
                  className={cn(
                    isWelcome &&
                      'size-10 rounded-2xl bg-[#2E65F3] text-white hover:bg-[#2356DA] disabled:bg-muted disabled:text-muted-foreground'
                  )}
                />
              </div>
            </PromptInputTools>
          </PromptInput>
        </div>
      </TooltipProvider>
    </>
  );

  if (isWelcome) {
    return <div className="w-full space-y-2">{inputArea}</div>;
  }

  return (
    // `bg-sidebar`, not `bg-background`: the assistant renders inside
    // SidebarInset, which is `bg-sidebar`. Painting `bg-background` here left a
    // white band behind the input. The band itself stays — it is what stops
    // messages showing through the sticky composer as they scroll under it.
    <div className="sticky bottom-0 z-20 bg-sidebar/95 px-4 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-sidebar/85">
      <div className="mx-auto mb-1 max-w-3xl space-y-2">{inputArea}</div>
    </div>
  );
}
