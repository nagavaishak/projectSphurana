import type { LeadFormFieldType } from '@borradh-workspace/labels';

/**
 * Lead-forms capability port.
 *
 * Third application of the pattern, after `videos.port.ts` and
 * `meta-ads.port.ts`. `lead_forms_createLeadForm` returned
 * `{ ready: false, status: 'draft' }` and Claire told owners the form was live.
 * A Meta instant form that never reached Meta cannot receive a single lead, so
 * the owner was told a form was collecting leads when nothing was.
 *
 * Reading the code turns that from a wording problem into a much sharper one.
 * `createLeadForm` (features) inserts the row, calls `syncLeadFormToMeta`, and
 * **when the sync fails it returns the row it captured BEFORE the sync** —
 * `status: 'draft'`, `metaFormId: null`, `syncError: null` — while the sync
 * service has meanwhile written `status: 'error'` plus the real `syncError` to
 * the database. So the API's 201 body is not merely optimistic, it is *stale*:
 *
 *   - `status: 'draft'` when the row is `error`
 *   - `syncError: null` when a reason exists
 *
 * That is why the old tool's `reason: form.syncError ?? undefined` was always
 * `undefined` on exactly the failure it was written for. `updateLeadForm` has
 * the same shape, and worse: on a failed re-sync its stale row still carries
 * the OLD `metaFormId`, so a caller comparing ids concludes nothing changed.
 *
 * Two rules follow, and they are what this file encodes:
 *
 *   1. **No `ready` boolean.** Sync outcome is a discriminated union, and only
 *      `synced` may be spoken of as live. It cannot be constructed without a
 *      `metaFormId`, so "live on Meta with no Meta form" is unrepresentable.
 *   2. **Never report a state the server did not confirm.** Because the create/
 *      update response is stale by construction, anything other than a
 *      response that already says `synced` must be read back. If the read-back
 *      fails, that is `sync_unconfirmed` — its own member — not licence to
 *      repeat the request body back as fact.
 */

/** Lead-form lifecycle, mirroring `leadFormStatusLabels` in `@borradh-workspace/labels`. */
export type LeadFormLifecycleStatus = 'draft' | 'synced' | 'error' | 'archived';

/** Post-submission chat CTA. Maps to Meta's `thank_you_page` button type. */
export type LeadFormFollowUpChannel = 'none' | 'messenger' | 'whatsapp';

/**
 * One field on the form. `label`/`key`/`options` are only meaningful for
 * `CUSTOM` questions (Meta rejects a label on a standard type) — they ride
 * through verbatim so the multiple-choice default question survives the port.
 */
export interface LeadFormQuestion {
  type: LeadFormFieldType;
  label?: string;
  key?: string;
  options?: Array<{ value: string; key?: string }>;
}

/** A lead form as the server holds it. `metaFormId` is nullable — most are. */
export interface LeadFormRecord {
  leadFormId: string;
  name: string;
  status: LeadFormLifecycleStatus;
  /** Null until Meta has minted a form. Null means: cannot receive leads. */
  metaFormId: string | null;
  followUpChannel: LeadFormFollowUpChannel;
  questions: LeadFormQuestion[];
  /**
   * Whether Meta opens a Messenger thread by itself the moment the lead
   * submits, carrying their details — no tap required.
   *
   * This is NOT `followUpChannel`. That is the thank-you-page button the lead
   * must press, and hardly any do. This is the automatic one, and it is what
   * actually gets a lead in front of us.
   *
   * Derived from `questions`: Meta only permits it when every field is one of
   * `messengerEligibleQuestionTypes`. Adding city, date of birth, gender, ZIP
   * or similar turns it OFF — silently, as far as Meta is concerned. Reported
   * here so a caller can say so out loud instead of guessing, per the rule at
   * the top of this file.
   */
  messengerAutoStart: boolean;
}

/**
 * A form Meta has confirmed. The narrowed `status` and non-nullable
 * `metaFormId` are the whole point: this type cannot be built for a form that
 * only exists in our database, which is precisely the claim the old `ready`
 * boolean made
 */
export interface SyncedLeadForm extends Omit<LeadFormRecord, 'metaFormId'> {
  status: 'synced';
  metaFormId: string;
}

/**
 * Why a form is not live on Meta.
 *
 * Every named case is one `syncLeadFormToMeta` actually writes to `syncError`
 * before flipping the row to `error`. Kept separate from
 * `LeadFormWriteBlockedReason` because the two are raised by different code
 * paths: a write blocker comes back as a 4xx from the controller and means
 * nothing was created; a sync blocker is recorded in the row and means the
 * form exists but Meta has no copy of it.
 */
export type LeadFormSyncBlockedReason =
  /** No Meta Ads integration, or it is inactive. */
  | { kind: 'meta_not_connected' }
  /** Integration exists but no page was chosen and there is no default. */
  | { kind: 'no_meta_page' }
  /** The chosen page is gone, or its stored access token is missing. */
  | { kind: 'meta_page_unusable' }
  /** The integration has no ad account configured. */
  | { kind: 'no_ad_account' }
  /**
   * The Meta connection is still marked active, but Meta rejected the token
   * at call time — it has expired / been invalidated (OAuthException, code
   * 190). This is NOT a fault in the form's content, and telling the owner
   * "Meta rejected the form" (the `meta_rejected` reading) sends them to edit
   * copy that is fine. The honest, actionable cause is: reconnect Meta. Kept a
   * distinct member so the card can say exactly that instead of quoting an
   * auth error as though it were a content rejection.
   */
  | { kind: 'meta_token_expired' }
  /** Meta itself rejected the form. Message is Meta's own, carried verbatim. */
  | { kind: 'meta_rejected'; message: string }
  /**
   * The row is confirmed not-synced, and carries no recorded reason. Truthful
   * and deliberately uninformative — better than inventing a cause.
   */
  | { kind: 'sync_not_attempted' }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

/** Why a form could not be created or updated AT ALL. Nothing was written. */
export type LeadFormWriteBlockedReason =
  /** Per-org unique name constraint (`ALREADY_EXISTS` → 409). */
  | { kind: 'duplicate_name'; name: string }
  /** Meta hard-requires a privacy-policy URL and the org has nothing usable. */
  | { kind: 'privacy_policy_missing' }
  /** The form to update/read is gone. */
  | { kind: 'lead_form_not_found'; leadFormId: string }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

/**
 * Either kind of blocker. Exists so one `describe…` helper can phrase them all;
 * the result members below stay narrowed to the one they can actually carry.
 */
export type LeadFormBlockedReason =
  | LeadFormSyncBlockedReason
  | LeadFormWriteBlockedReason;

export interface CreateLeadFormRequest {
  name: string;
  questions: LeadFormQuestion[];
  /** Meta requires this. The caller resolves it; the port does not guess. */
  privacyPolicyUrl: string;
  followUpChannel: LeadFormFollowUpChannel;
  /** Required by Meta for a WhatsApp CTA; null for every other channel. */
  whatsappNumber: string | null;
}

export interface UpdateLeadFormRequest {
  leadFormId: string;
  /** The COMPLETE field list, in order. The caller does the add/remove merge. */
  questions: LeadFormQuestion[];
  name?: string;
  followUpChannel?: LeadFormFollowUpChannel;
  /** `undefined` leaves it untouched; `null` clears it. */
  whatsappNumber?: string | null;
}

/**
 * Creation outcome.
 *
 * NOTE what is absent: no `ready`, and no member that reports a form as live
 * without a `metaFormId` to prove it. Compare the shape this replaces —
 * `{ ready: false, status: 'draft' }` with `reason` always `undefined`.
 */
export type CreateLeadFormResult =
  /** Created AND confirmed on Meta. The only state that may be called live. */
  | { status: 'synced'; form: SyncedLeadForm }
  /**
   * Created, and confirmed NOT on Meta. The form exists and is editable, but
   * it cannot receive a lead and must not be attached to a campaign.
   */
  | {
      status: 'not_synced';
      form: LeadFormRecord;
      reason: LeadFormSyncBlockedReason;
    }
  /**
   * Created; the sync outcome could not be read back. The create response is
   * stale by construction (see the header), so "no error" is not evidence of
   * success — this is the honest gap, and it is a state, not a default.
   */
  | { status: 'sync_unconfirmed'; form: LeadFormRecord; message: string }
  /** Nothing was created. There is no form to speak about. */
  | { status: 'not_created'; reason: LeadFormWriteBlockedReason };

/**
 * Update outcome.
 *
 * `previousMetaFormId` rides along on every member that has a form, because it
 * is the only way a caller can tell whether a live campaign now points at a
 * form that no longer matches what the owner just approved. Meta instant forms
 * are immutable, so a successful re-sync mints a NEW id and any attached
 * campaign keeps serving the OLD one until its ad is rebuilt. The caller
 * derives that from the two ids rather than being handed a boolean it cannot
 * check.
 */
export type UpdateLeadFormResult =
  | {
      status: 'synced';
      form: SyncedLeadForm;
      previousMetaFormId: string | null;
    }
  | {
      status: 'not_synced';
      form: LeadFormRecord;
      /** Still live on Meta with the OLD fields, if this is non-null. */
      previousMetaFormId: string | null;
      reason: LeadFormSyncBlockedReason;
    }
  | {
      status: 'sync_unconfirmed';
      form: LeadFormRecord;
      previousMetaFormId: string | null;
      message: string;
    }
  /** Nothing was written. The form is exactly as it was. */
  | { status: 'not_updated'; reason: LeadFormWriteBlockedReason };

/**
 * Read outcome. `not_found` is separated from `unavailable` because the tool
 * this replaces caught every error and told the owner "I couldn't find that
 * lead form" — including when the API had simply broken.
 */
export type GetLeadFormResult =
  | { status: 'found'; form: LeadFormRecord }
  | { status: 'not_found'; leadFormId: string }
  | {
      status: 'unavailable';
      leadFormId: string;
      reason: LeadFormWriteBlockedReason;
    };

/**
 * The lead-forms capability as an orchestrator (Claire) may use it.
 *
 * Deliberately three methods. Listing forms is already honest and unported;
 * deleting and re-syncing have no tool, and inventing capabilities here would
 * put reach into Claire's hands that nobody reviewed.
 */
export interface LeadFormsPort {
  /** Create a form and sync it to Meta. Syncing is not optional — a form that
   *  never reaches Meta has no purpose in a campaign flow. */
  create(req: CreateLeadFormRequest): Promise<CreateLeadFormResult>;
  /** Replace the form's fields/name/channel and re-sync it to Meta. */
  update(req: UpdateLeadFormRequest): Promise<UpdateLeadFormResult>;
  get(leadFormId: string): Promise<GetLeadFormResult>;
}
