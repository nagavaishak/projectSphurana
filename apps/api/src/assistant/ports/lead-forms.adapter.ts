import type {
  CreateLeadFormResult,
  GetLeadFormResult,
  LeadFormFollowUpChannel,
  LeadFormQuestion,
  LeadFormRecord,
  LeadFormSyncBlockedReason,
  LeadFormWriteBlockedReason,
  LeadFormsPort,
  SyncedLeadForm,
  UpdateLeadFormResult,
} from '@borradh-workspace/contracts/ports';
import type { LeadFormFieldType } from '@borradh-workspace/labels';
import { isMessengerEligible } from '@borradh-workspace/labels';
// Imported from the module, not the tool-factory barrel. The barrel reaches
// `tool-context.ts`, which builds these ports — importing it here would close a
// cycle, and would drag the database package into anything that touches a port.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

/**
 * Verbatim copies of the `syncError` strings `syncLeadFormToMeta` writes to the
 * row before flipping it to `error`
 * (`packages/features/src/lead-forms/services/sync-lead-form-to-meta`).
 *
 * Copied rather than imported for the same reason `videos.adapter.ts` copies
 * the b-roll messages: importing `@borradh-workspace/features/lead-forms`
 * pulls the integrations package (and a Meta HTTP client) into every module
 * that touches the tool context. `lead-forms.adapter.spec.ts` reads them back
 * out of the service source and asserts they still match, so a reworded
 * service message fails a test instead of silently degrading these cases to
 * `other`.
 */
const SYNC_ERROR_NO_INTEGRATION =
  'Meta Ads integration not configured or inactive';
const SYNC_ERROR_NO_PAGE = 'No Meta page selected for syncing';
const SYNC_ERROR_PAGE_UNUSABLE = 'Meta page not found or missing access token';
const SYNC_ERROR_NO_AD_ACCOUNT =
  'Meta Ads integration missing ad account configuration';

/**
 * The Meta call itself failing with an auth/expiry error (OAuthException,
 * code 190, "Error validating access token", "Session has expired") is NOT one
 * of the four pre-flight strings above — the sync service records the raw Meta
 * error message verbatim on that path. Without this pin it falls through to
 * `meta_rejected` and the owner is told "Meta rejected the form", i.e. sent to
 * edit copy that is fine, when the real, actionable cause is: the token
 * expired, reconnect Meta. Kept deliberately narrow so a genuine content
 * rejection (e.g. "(#100) Invalid privacy policy URL") still reads as one.
 */
const META_TOKEN_EXPIRED_SIGNATURE =
  /error validating access token|session has expired|access token (?:has )?expired|the access token could not be decrypted|\(code:\s*190\)|OAuthException/i;

/**
 * Concrete `LeadFormsPort`, built at the composition root.
 *
 * TRANSPORT NOTE, as for videos: this reaches the capability over the existing
 * authenticated loopback (`apiFetch`) rather than calling feature services with
 * a `db` handle, so org scoping, the AuthGuard and the controller's error
 * mapping all still apply. Callers cannot tell, and the transport can be
 * swapped underneath without touching a tool.
 *
 * READ-BACK NOTE, and this one is specific to lead forms. `createLeadForm` and
 * `updateLeadForm` swallow a failed Meta sync and return the row they captured
 * BEFORE the sync — `status: 'draft'`, `syncError: null` — while the sync
 * service has already written `status: 'error'` and the real reason to the
 * database. The response therefore cannot be trusted for anything except
 * "`synced` means synced". Every other case is re-read from
 * `GET /lead-forms/:id`, which is the authoritative row and the only place the
 * reason exists at all. That single extra GET is what turned the old
 * `reason: form.syncError ?? undefined` — permanently `undefined` — into an
 * actual sentence for the owner.
 */

interface LeadFormApiRow {
  id: string;
  name: string;
  status: string;
  metaFormId?: string | null;
  followUpChannel?: string | null;
  whatsappNumber?: string | null;
  questions?: Array<{
    type: string;
    label?: string | null;
    key?: string | null;
    options?: Array<{ value: string; key?: string }> | null;
  }> | null;
  syncError?: string | null;
}

const LIFECYCLE_STATUSES: readonly string[] = [
  'draft',
  'synced',
  'error',
  'archived',
];

const FOLLOW_UP_CHANNELS: readonly string[] = ['none', 'messenger', 'whatsapp'];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A 4xx is the API stating a reason (validation, duplicate, not-found) — an
 * ordinary outcome the owner can act on. Anything else is the server breaking.
 * Collapsing the two is what made ordinary "no, because…" answers page someone
 * (API-9G / ENG-402), so only the fault side may reach Sentry.
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

function toRecord(row: LeadFormApiRow): LeadFormRecord {
  const status = LIFECYCLE_STATUSES.includes(row.status)
    ? (row.status as LeadFormRecord['status'])
    : // An unrecognised status is not a success. `draft` is the conservative
      // reading: it claims nothing about Meta.
      'draft';
  const channel =
    row.followUpChannel && FOLLOW_UP_CHANNELS.includes(row.followUpChannel)
      ? (row.followUpChannel as LeadFormFollowUpChannel)
      : 'none';

  const questions: LeadFormQuestion[] = (row.questions ?? []).map((q) => ({
    type: q.type as LeadFormFieldType,
    ...(q.label ? { label: q.label } : {}),
    ...(q.key ? { key: q.key } : {}),
    ...(q.options ? { options: q.options } : {}),
  }));

  return {
    leadFormId: row.id,
    name: row.name,
    status,
    metaFormId: row.metaFormId ?? null,
    followUpChannel: channel,
    questions,
    // Derived, not stored: Meta grants auto-start purely on the field set, and
    // we send the flag on exactly that condition when the form is created.
    messengerAutoStart: isMessengerEligible(questions),
  };
}

/**
 * The one narrowing that matters: a form counts as live on Meta only when the
 * row says `synced` AND carries a Meta form id. Either half alone is a form
 * that cannot receive a lead.
 */
function asSynced(record: LeadFormRecord): SyncedLeadForm | null {
  return record.status === 'synced' && record.metaFormId
    ? { ...record, status: 'synced', metaFormId: record.metaFormId }
    : null;
}

/**
 * Map a confirmed not-synced row onto a reason, from the `syncError` the sync
 * service recorded. Unrecognised text keeps Meta's own words as
 * `meta_rejected` — the sync service's fallback path is precisely "Meta said
 * no and here is what it said", so that is not an unknown refusal, it is a
 * known one with an unbounded message.
 */
export function toSyncBlockedReason(
  syncError: string | null | undefined
): LeadFormSyncBlockedReason {
  if (!syncError) return { kind: 'sync_not_attempted' };
  if (syncError === SYNC_ERROR_NO_INTEGRATION) {
    return { kind: 'meta_not_connected' };
  }
  if (syncError === SYNC_ERROR_NO_PAGE) return { kind: 'no_meta_page' };
  if (syncError === SYNC_ERROR_PAGE_UNUSABLE) {
    return { kind: 'meta_page_unusable' };
  }
  if (syncError === SYNC_ERROR_NO_AD_ACCOUNT) return { kind: 'no_ad_account' };
  if (META_TOKEN_EXPIRED_SIGNATURE.test(syncError)) {
    return { kind: 'meta_token_expired' };
  }
  return { kind: 'meta_rejected', message: syncError };
}

/** Map a 4xx/fault from `POST|PUT|GET /lead-forms` onto a write reason. */
export function toWriteBlockedReason(
  error: unknown,
  ctx: { leadFormId?: string; name?: string }
): LeadFormWriteBlockedReason {
  const message = errorMessage(error, 'The lead form could not be saved');

  const duplicate = /^Lead form with name "(.+)" already exists$/.exec(message);
  if (duplicate) return { kind: 'duplicate_name', name: duplicate[1] };
  if (
    error instanceof ApiFetchError &&
    error.status === 409 &&
    ctx.name !== undefined
  ) {
    return { kind: 'duplicate_name', name: ctx.name };
  }
  if (/privacy-policy link is required/i.test(message)) {
    return { kind: 'privacy_policy_missing' };
  }
  if (error instanceof ApiFetchError && error.status === 404) {
    return { kind: 'lead_form_not_found', leadFormId: ctx.leadFormId ?? '' };
  }

  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

export interface LeadFormsPortDeps {
  apiFetch: ApiFetchFn;
}

export function createLeadFormsPort(deps: LeadFormsPortDeps): LeadFormsPort {
  const { apiFetch } = deps;

  /**
   * Resolve what actually happened to the sync, given the (stale) write
   * response. Returns the three sync-bearing shapes the create/update unions
   * share; the caller adds whatever else its own union carries.
   */
  async function confirmSync(written: LeadFormRecord): Promise<
    | { status: 'synced'; form: SyncedLeadForm }
    | {
        status: 'not_synced';
        form: LeadFormRecord;
        reason: LeadFormSyncBlockedReason;
      }
    | { status: 'sync_unconfirmed'; form: LeadFormRecord; message: string }
  > {
    // The write response is only believable when it already says synced — that
    // branch returns the post-sync row. Anything else is the pre-sync row.
    const alreadySynced = asSynced(written);
    if (alreadySynced) return { status: 'synced', form: alreadySynced };

    let row: LeadFormApiRow;
    try {
      row = await apiFetch<LeadFormApiRow>(`lead-forms/${written.leadFormId}`);
    } catch (error) {
      return {
        status: 'sync_unconfirmed',
        form: written,
        message: errorMessage(
          error,
          'The lead form was saved, but its Meta sync state could not be read back.'
        ),
      };
    }

    const record = toRecord(row);
    const synced = asSynced(record);
    if (synced) return { status: 'synced', form: synced };

    return {
      status: 'not_synced',
      form: record,
      reason: toSyncBlockedReason(row.syncError),
    };
  }

  return {
    async create(req): Promise<CreateLeadFormResult> {
      let written: LeadFormApiRow;
      try {
        written = await apiFetch<LeadFormApiRow>('lead-forms', {
          method: 'POST',
          body: {
            name: req.name,
            questions: req.questions,
            privacyPolicyUrl: req.privacyPolicyUrl,
            followUpChannel: req.followUpChannel,
            whatsappNumber: req.whatsappNumber,
            syncToMeta: true,
          },
        });
      } catch (error) {
        return {
          status: 'not_created',
          reason: toWriteBlockedReason(error, { name: req.name }),
        };
      }

      return confirmSync(toRecord(written));
    },

    async update(req): Promise<UpdateLeadFormResult> {
      // The previous Meta form id has to be read BEFORE the write: a
      // successful re-sync overwrites it, and it is the only evidence that a
      // live campaign is now pointing at a form the owner no longer approved.
      let previousMetaFormId: string | null = null;
      try {
        const before = await apiFetch<LeadFormApiRow>(
          `lead-forms/${req.leadFormId}`
        );
        previousMetaFormId = before.metaFormId ?? null;
      } catch {
        // Best-effort. A failed read here does not justify refusing the edit;
        // it only means we cannot say whether the Meta id changed.
      }

      const body: Record<string, unknown> = {
        questions: req.questions,
        syncToMeta: true,
      };
      if (req.name !== undefined) body.name = req.name;
      if (req.followUpChannel !== undefined) {
        body.followUpChannel = req.followUpChannel;
      }
      if (req.whatsappNumber !== undefined) {
        body.whatsappNumber = req.whatsappNumber;
      }

      let written: LeadFormApiRow;
      try {
        written = await apiFetch<LeadFormApiRow>(
          `lead-forms/${req.leadFormId}`,
          { method: 'PUT', body }
        );
      } catch (error) {
        return {
          status: 'not_updated',
          reason: toWriteBlockedReason(error, {
            leadFormId: req.leadFormId,
            name: req.name,
          }),
        };
      }

      const confirmed = await confirmSync(toRecord(written));
      return { ...confirmed, previousMetaFormId };
    },

    async get(leadFormId): Promise<GetLeadFormResult> {
      try {
        const row = await apiFetch<LeadFormApiRow>(`lead-forms/${leadFormId}`);
        return { status: 'found', form: toRecord(row) };
      } catch (error) {
        const reason = toWriteBlockedReason(error, { leadFormId });
        // A missing form and a broken API are different answers. The tool this
        // replaces caught both and said "I couldn't find that lead form".
        return reason.kind === 'lead_form_not_found'
          ? { status: 'not_found', leadFormId }
          : { status: 'unavailable', leadFormId, reason };
      }
    },
  };
}
