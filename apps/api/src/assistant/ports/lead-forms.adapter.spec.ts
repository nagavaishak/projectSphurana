import { readFileSync } from 'node:fs';
import path from 'node:path';
// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import {
  createLeadFormsPort,
  toSyncBlockedReason,
  toWriteBlockedReason,
} from './lead-forms.adapter.js';

const FORM_ID = 'lf-1';

/**
 * Read the sync service's `syncError` strings from SOURCE rather than
 * importing them — importing `@borradh-workspace/features/lead-forms` pulls the
 * integrations package and a Meta HTTP client into this spec, which is the very
 * fan-out the adapter avoids by copying the strings. A static read keeps the
 * pin without the dependency: reword a message in the service and the matching
 * `LeadFormSyncBlockedReason` would silently degrade to `meta_rejected`, so
 * fail here instead.
 */
function syncErrorStrings(): string[] {
  const source = readFileSync(
    path.resolve(
      __dirname,
      '../../../../../packages/features/src/lead-forms/services/sync-lead-form-to-meta/sync-lead-form-to-meta.service.ts'
    ),
    'utf8'
  );
  return [...source.matchAll(/syncError:\s*'([^']+)'/g)].map((m) => m[1]);
}

function portWith(apiFetch: jest.Mock) {
  return createLeadFormsPort({ apiFetch: apiFetch as unknown as ApiFetchFn });
}

const draftRow = {
  id: FORM_ID,
  name: 'Consult form',
  status: 'draft',
  metaFormId: null,
  followUpChannel: 'whatsapp',
  whatsappNumber: '+447700900000',
  questions: [{ type: 'EMAIL' }],
  syncError: null,
};

const syncedRow = {
  ...draftRow,
  status: 'synced',
  metaFormId: 'meta-1',
};

const createRequest = {
  name: 'Consult form',
  questions: [{ type: 'EMAIL' as const }],
  privacyPolicyUrl: 'https://clinic.example/privacy',
  followUpChannel: 'whatsapp' as const,
  whatsappNumber: '+447700900000',
};

describe('lead-forms port adapter', () => {
  describe('sync error constants', () => {
    // The adapter copies these rather than importing them, so that the tool
    // context does not drag the features/lead-forms barrel into every request.
    it('still match the service messages they were copied from', () => {
      const recorded = syncErrorStrings();
      // Every reason the service records must map to a NAMED kind. A new or
      // reworded message falls through to `meta_rejected` and fails here.
      const kinds = recorded.map((m) => toSyncBlockedReason(m).kind);
      expect(recorded.length).toBeGreaterThan(0);
      expect(kinds).not.toContain('meta_rejected');
      expect(new Set(kinds)).toEqual(
        new Set([
          'meta_not_connected',
          'no_meta_page',
          'meta_page_unusable',
          'no_ad_account',
        ])
      );
    });
  });

  describe('toSyncBlockedReason', () => {
    it("keeps Meta's own wording for a rejection", () => {
      expect(toSyncBlockedReason('(#100) Invalid privacy policy URL')).toEqual({
        kind: 'meta_rejected',
        message: '(#100) Invalid privacy policy URL',
      });
    });

    it('says sync_not_attempted rather than inventing a cause', () => {
      expect(toSyncBlockedReason(null)).toEqual({ kind: 'sync_not_attempted' });
    });

    it('maps an expired/invalid-token failure to meta_token_expired, not a form rejection', () => {
      // What `syncLeadFormToMeta` records verbatim when the Meta call throws an
      // OAuthException (code 190) on a token that expired while the integration
      // was still marked active. Reading this as `meta_rejected` sends the owner
      // to edit copy that is fine; the honest, actionable cause is reconnect.
      expect(
        toSyncBlockedReason(
          'Meta API Error: Error validating access token: Session has expired on Tuesday. (code: 190) (subcode: 463)'
        )
      ).toEqual({ kind: 'meta_token_expired' });
      expect(
        toSyncBlockedReason('Meta API Error: OAuthException (code: 190)')
      ).toEqual({ kind: 'meta_token_expired' });
      // A genuine content rejection is still a content rejection.
      expect(toSyncBlockedReason('(#100) Invalid privacy policy URL')).toEqual({
        kind: 'meta_rejected',
        message: '(#100) Invalid privacy policy URL',
      });
    });
  });

  describe('toWriteBlockedReason', () => {
    it('names the duplicate form', () => {
      expect(
        toWriteBlockedReason(
          new ApiFetchError(
            'Lead form with name "Consult form" already exists',
            409
          ),
          { name: 'Consult form' }
        )
      ).toEqual({ kind: 'duplicate_name', name: 'Consult form' });
    });

    it('recognises the privacy-policy refusal', () => {
      expect(
        toWriteBlockedReason(
          new ApiFetchError(
            'A privacy-policy link is required by Meta, and no website or Facebook Page is set to use instead.',
            400
          ),
          {}
        )
      ).toEqual({ kind: 'privacy_policy_missing' });
    });

    it('separates a server fault from a stated refusal', () => {
      // Callers alert on `server_error` and stay quiet on `other` — collapsing
      // the two is what made ordinary "no, because…" answers page someone
      // (API-9G / ENG-402).
      expect(
        toWriteBlockedReason(
          new ApiFetchError('Questions are invalid', 400),
          {}
        )
      ).toEqual({ kind: 'other', message: 'Questions are invalid' });
      expect(toWriteBlockedReason(new Error('socket hang up'), {})).toEqual({
        kind: 'server_error',
        message: 'socket hang up',
      });
    });
  });

  describe('create', () => {
    it('trusts a response that already says synced, without a second call', async () => {
      const apiFetch = jest.fn().mockResolvedValueOnce(syncedRow);
      const result = await portWith(apiFetch).create(createRequest);

      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.form.metaFormId).toBe('meta-1');
      }
      // The shape this replaces was `{ ready: false, status: 'draft' }`. No
      // boolean survives that a caller could copy across.
      expect(JSON.stringify(result)).not.toContain('ready');
    });

    it('reads the row back and surfaces the reason the response hid', async () => {
      // THE defect. `createLeadForm` swallows a failed sync and returns the row
      // it captured BEFORE syncing — status 'draft', syncError null — while the
      // sync service has already written status 'error' + the real reason.
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(draftRow)
        .mockResolvedValueOnce({
          ...draftRow,
          status: 'error',
          syncError: 'Meta Ads integration not configured or inactive',
        });

      const result = await portWith(apiFetch).create(createRequest);

      expect(apiFetch).toHaveBeenNthCalledWith(2, `lead-forms/${FORM_ID}`);
      expect(result.status).toBe('not_synced');
      if (result.status === 'not_synced') {
        expect(result.reason).toEqual({ kind: 'meta_not_connected' });
        expect(result.form.metaFormId).toBeNull();
      }
    });

    it('reads back an expired-token failure as not_synced with meta_token_expired', async () => {
      // The exact browser-tested case: a "lead-form campaign" flow with an
      // EXPIRED Meta token. The local write succeeds (draft), the Meta sync
      // throws code 190, and the row is read back as error carrying the raw
      // OAuth message. The result must NOT claim the form is live on Meta.
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(draftRow)
        .mockResolvedValueOnce({
          ...draftRow,
          status: 'error',
          syncError:
            'Meta API Error: Error validating access token: Session has expired. (code: 190)',
        });

      const result = await portWith(apiFetch).create(createRequest);

      expect(result.status).toBe('not_synced');
      if (result.status === 'not_synced') {
        expect(result.reason).toEqual({ kind: 'meta_token_expired' });
        expect(result.form.metaFormId).toBeNull();
      }
    });

    it('reports the read-back as synced when the sync did land', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(draftRow)
        .mockResolvedValueOnce(syncedRow);
      const result = await portWith(apiFetch).create(createRequest);
      expect(result.status).toBe('synced');
    });

    it('says sync_unconfirmed rather than guessing when the read-back fails', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(draftRow)
        .mockRejectedValueOnce(new Error('Read timed out'));

      const result = await portWith(apiFetch).create(createRequest);
      expect(result.status).toBe('sync_unconfirmed');
      if (result.status === 'sync_unconfirmed') {
        expect(result.form.leadFormId).toBe(FORM_ID);
      }
    });

    it('returns not_created — with no form — when the write is refused', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValueOnce(
          new ApiFetchError(
            'Lead form with name "Consult form" already exists',
            409
          )
        );
      expect(await portWith(apiFetch).create(createRequest)).toEqual({
        status: 'not_created',
        reason: { kind: 'duplicate_name', name: 'Consult form' },
      });
    });
  });

  describe('update', () => {
    const updateRequest = {
      leadFormId: FORM_ID,
      questions: [{ type: 'EMAIL' as const }, { type: 'PHONE' as const }],
    };

    it('carries the previous Meta form id through a successful re-sync', async () => {
      const apiFetch = jest
        .fn()
        // pre-read
        .mockResolvedValueOnce(syncedRow)
        // PUT — re-synced, so a NEW Meta form id
        .mockResolvedValueOnce({ ...syncedRow, metaFormId: 'meta-2' });

      const result = await portWith(apiFetch).update(updateRequest);
      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        // Both ids present: the caller can SEE that a live campaign is now
        // pointing at a form the owner no longer approved.
        expect(result.previousMetaFormId).toBe('meta-1');
        expect(result.form.metaFormId).toBe('meta-2');
      }
    });

    it('keeps the old Meta form id visible when the re-sync fails', async () => {
      // The stale PUT response still carries the OLD metaFormId, so comparing
      // ids off it concluded "nothing changed" while the row was in error.
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(syncedRow)
        .mockResolvedValueOnce({ ...syncedRow, status: 'draft' })
        .mockResolvedValueOnce({
          ...syncedRow,
          status: 'error',
          syncError: '(#100) Invalid parameter',
        });

      const result = await portWith(apiFetch).update(updateRequest);
      expect(result.status).toBe('not_synced');
      if (result.status === 'not_synced') {
        expect(result.previousMetaFormId).toBe('meta-1');
        expect(result.reason).toEqual({
          kind: 'meta_rejected',
          message: '(#100) Invalid parameter',
        });
      }
    });

    it('returns not_updated when the write itself is refused', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(syncedRow)
        .mockRejectedValueOnce(new ApiFetchError('Not found', 404));

      expect(await portWith(apiFetch).update(updateRequest)).toEqual({
        status: 'not_updated',
        reason: { kind: 'lead_form_not_found', leadFormId: FORM_ID },
      });
    });
  });

  describe('get', () => {
    it('distinguishes a missing form from a broken API', async () => {
      const missing = jest
        .fn()
        .mockRejectedValue(new ApiFetchError('Not found', 404));
      expect(await portWith(missing).get(FORM_ID)).toEqual({
        status: 'not_found',
        leadFormId: FORM_ID,
      });

      const broken = jest.fn().mockRejectedValue(new Error('boom'));
      const result = await portWith(broken).get(FORM_ID);
      expect(result.status).toBe('unavailable');
      if (result.status === 'unavailable') {
        expect(result.reason.kind).toBe('server_error');
      }
    });

    it('never reports a synced status without a Meta form id', async () => {
      // A row claiming `synced` with no `metaFormId` cannot receive leads. The
      // record carries the raw status, but `SyncedLeadForm` is unreachable for
      // it — create/update prove that below via `not_synced`.
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({ ...draftRow, status: 'synced' })
        .mockResolvedValueOnce({ ...draftRow, status: 'synced' })
        .mockResolvedValueOnce({ ...draftRow, status: 'synced' });

      const result = await portWith(apiFetch).create(createRequest);
      expect(result.status).toBe('not_synced');
    });
  });

  describe('messengerAutoStart', () => {
    // Meta only auto-opens a Messenger thread on submit when every field is
    // one it permits. Claire has to be able to say which way it went, so the
    // record reports it rather than leaving her to infer it from `questions`.
    const getRecord = async (questions: Array<{ type: string }>) => {
      const apiFetch = jest.fn().mockResolvedValue({ ...draftRow, questions });
      const result = await portWith(apiFetch).get(FORM_ID);
      if (result.status !== 'found') throw new Error('expected found');
      return result.form;
    };

    it('is true for the field set we ship by default', async () => {
      const form = await getRecord([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
        { type: 'CUSTOM' },
      ]);
      expect(form.messengerAutoStart).toBe(true);
    });

    it('is false once a disqualifying field is present', async () => {
      // The exact scenario the skill invites: "add a date of birth field".
      const form = await getRecord([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'DATE_OF_BIRTH' },
      ]);
      expect(form.messengerAutoStart).toBe(false);
    });

    it('is independent of followUpChannel', async () => {
      // followUpChannel is the tap-required button; auto-start is not. A form
      // with no button at all still auto-opens Messenger.
      const apiFetch = jest
        .fn()
        .mockResolvedValue({ ...draftRow, followUpChannel: 'none' });
      const result = await portWith(apiFetch).get(FORM_ID);
      if (result.status !== 'found') throw new Error('expected found');
      expect(result.form.followUpChannel).toBe('none');
      expect(result.form.messengerAutoStart).toBe(true);
    });
  });
});
