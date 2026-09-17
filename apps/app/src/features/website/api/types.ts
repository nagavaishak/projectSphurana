import type {
  Block,
  MicrositeDocument,
  MicrositePage,
  MicrositeTheme,
} from '@borradh-workspace/web-shared';

/**
 * Wire types for the microsite editor, transcribed from
 * `docs/plans/microsites-phase3-contract.md` §4.
 *
 * The document shapes themselves are NOT redeclared here — they come from
 * `@borradh-workspace/web-shared`, which is the coordination point the schema,
 * the renderer and the agent tools all key off. Only the HTTP envelopes and the
 * stream events live in this file.
 *
 * Where a field is not pinned down by §4 it is marked OPTIONAL and the UI
 * degrades without it, rather than the editor inventing a second shape the API
 * would then have to match. Those are called out inline.
 */

export type MicrositeStatus = 'draft' | 'published';
export type MicrositeRevisionAuthor = 'agent' | 'user' | 'system';

export interface MicrositeSummary {
  id: string;
  slug: string;
  status: MicrositeStatus;
  /** The revision the public is served. */
  publishedRevisionId: string | null;
  /** The revision the working draft corresponds to (contract §1). */
  draftRevisionId: string | null;
  /**
   * Revisions between `publishedRevisionId` and `draftRevisionId` (§1). The
   * Publish button renders this verbatim — the editor never counts revisions
   * itself, for the same reason it never re-derives the turn diff.
   */
  changesSincePublish: number;
  /**
   * Absolute URL of the DRAFT preview, for the canvas iframe.
   *
   * NOT specified in §4 — the contract defines the `preview()` tool but no URL
   * on `GET microsites/mine`. The canvas needs one, and building it in the
   * client from `slug` would hardcode the microsite apex the plan deliberately
   * keeps env-driven (`MICROSITE_BASE_DOMAIN`). So: the API sends it, and until
   * it does the canvas shows an explicit "preview unavailable" state rather
   * than a blank iframe.
   */
  previewUrl?: string | null;
}

/** `GET microsites/mine` — the caller's org microsite + draft doc. */
export interface MicrositeMineResponse {
  microsite: MicrositeSummary;
  document: MicrositeDocument;
}

/** `GET microsites/:id/revisions` — history (§4). */
export interface MicrositeRevisionSummary {
  id: string;
  label: string | null;
  createdBy: MicrositeRevisionAuthor;
  promptId: string | null;
  createdAt: string;
  /** The prompt that caused this revision, when the API can resolve it. */
  prompt?: string | null;
  /** This revision is what the public is served. */
  isPublished?: boolean;
  /** This revision is what the working draft currently corresponds to. */
  isDraft?: boolean;
}

/**
 * `listRevisions` is cursor-paginated. The history pane reads `items` and
 * `nextCursor`; a bare array is still accepted so the pane keeps working if it
 * is called before the paginated envelope is deployed everywhere.
 */
export interface MicrositeRevisionListResponse {
  items: MicrositeRevisionSummary[];
  nextCursor?: string | null;
}

/** The `done` event's diff. The sidebar renders this; it never recomputes it. */
export interface MicrositeTurnDiff {
  added: number;
  edited: number;
  removed: number;
  themeChanged: boolean;
}

/**
 * Refusal/failure classes the sidebar renders differently. `code` is optional
 * in the contract's `{ type: 'error', message }`; when it is absent the UI
 * falls back to a generic failure, which is still a visible, non-silent state.
 */
export type MicrositeStreamErrorCode =
  | 'tool_limit'
  | 'token_limit'
  | 'spend_cap'
  | 'guardrail'
  | 'tool_error'
  | 'internal';

/** Stream events the sidebar consumes (§4). */
export type MicrositeStreamEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'tool';
      name: string;
      summary: string;
      /**
       * §3: `delete_page` and `update_theme.brand` "require explicit UI
       * confirmation — a flag on the tool result the sidebar acts on". §4's
       * event shape does not carry the flag, so it is optional here AND the
       * sidebar independently treats the known-destructive tools as requiring
       * confirmation (`isDestructiveTool`). Never rely on the model, and never
       * rely on the flag being present either.
       */
      requiresConfirmation?: boolean;
      /**
       * Present when the tool did NOT run and is waiting on the user. Its
       * `action` is what goes into `confirmedActions` on the re-send.
       */
      confirmation?: MicrositeConfirmationRequest;
      /** Set when the tool itself failed but the turn continued. */
      error?: string;
    }
  | {
      type: 'done';
      revisionId: string;
      diff: MicrositeTurnDiff;
      /** Present on the first turn of a new thread, when the API mints one. */
      conversationId?: string;
    }
  | { type: 'error'; message: string; code?: MicrositeStreamErrorCode };

/**
 * A destructive action the API refused to run until the user says so.
 *
 * BLOCKING, not advisory: `delete_page` and a `brand` theme patch do not
 * execute at all. The tool result carries `requiresConfirmation: true` plus
 * this payload, and the action only runs when `action` is echoed back in
 * `confirmedActions` on the NEXT chat request. That field is deliberately
 * absent from every tool schema, so the model has no way to approve its own
 * destructive action — the user is the only one who can.
 */
export interface MicrositeConfirmationRequest {
  /** The key to send back in `confirmedActions`. */
  action: string;
  /** What the API wants us to ask the user, in their words. */
  prompt: string;
}

/** One tool invocation as rendered in the transcript (an "activity line"). */
export interface TranscriptActivity {
  id: string;
  name: string;
  summary: string;
  error?: string;
  requiresConfirmation: boolean;
  /** Set when this tool was BLOCKED pending confirmation. */
  confirmation?: MicrositeConfirmationRequest;
}

export type TranscriptStatus =
  | 'streaming'
  | 'complete'
  | 'error'
  | 'refused'
  | 'restored';

/** A single turn in the sidebar transcript. */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  activities: TranscriptActivity[];
  status: TranscriptStatus;
  /** Only on a mutating assistant turn — the `done` event's payload. */
  diff?: MicrositeTurnDiff;
  revisionId?: string;
  /** The revision the draft was on BEFORE this turn — what Undo restores. */
  previousRevisionId?: string | null;
  error?: { message: string; code?: MicrositeStreamErrorCode };
  /** Whether the user has acted on the diff card. */
  decision?: 'kept' | 'undone';
  /**
   * The user text that produced this turn, kept so a confirmation can re-send
   * the SAME prompt rather than asking the user to retype it.
   */
  prompt?: string;
  /** The block scope the turn was sent with, replayed on a confirm re-send. */
  selection?: BlockSelection | null;
  /** Destructive actions this turn stopped on. Empty/absent = nothing blocked. */
  pendingConfirmations?: MicrositeConfirmationRequest[];
  /**
   * `awaiting` — blocked, the user has not answered.
   * `confirmed` — re-sent with the action approved.
   * `declined`  — the user said no; NOTHING ran, and the UI must say so.
   */
  confirmationState?: 'awaiting' | 'confirmed' | 'declined';
}

/** `GET microsites/:id/conversations/:cid` — stored transcript. */
export interface MicrositeStoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }[];
  revisionId: string | null;
  createdAt: string;
}

export interface MicrositeConversationResponse {
  id: string;
  title: string | null;
  messages: MicrositeStoredMessage[];
}

/** A block plus where it lives — what the canvas selection and inspector pass. */
export interface BlockSelection {
  pageId: string;
  blockId: string;
}

export type { Block, MicrositeDocument, MicrositePage, MicrositeTheme };
