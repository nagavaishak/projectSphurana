import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LeadProfileConsentFormSubmission,
  LeadProfileUploadedConsentForm,
} from '../api';

const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PatientFormsTab } from './patient-forms-tab';

const signed: LeadProfileConsentFormSubmission = {
  id: 'sub_1',
  title: 'Laser Consent',
  status: 'completed',
  appointmentId: 'appt_1',
  signedByName: 'Niamh Gearalt',
  signedAt: '2026-08-20T09:00:00.000Z',
  sentAt: '2026-08-18T09:00:00.000Z',
};

/** Signed on a clipboard, scanned, and filed by the importer. */
const onPaper: LeadProfileUploadedConsentForm = {
  id: 'imp_1',
  documentId: 'doc_9',
  fileName: 'consent-signed.pdf',
  filedAt: '2026-08-27T10:00:00.000Z',
};

const renderTab = (
  submissions: LeadProfileConsentFormSubmission[],
  uploaded: LeadProfileUploadedConsentForm[]
) =>
  renderWithProviders(
    <PatientFormsTab
      leadId="lead_1"
      submissions={submissions}
      uploaded={uploaded}
    />
  );

describe('PatientFormsTab', () => {
  beforeEach(() => {
    get.mockReset();
  });

  /**
   * The point of the whole change: a nurse asking "has this client consented?"
   * gets one answer from one place, whether the form was signed in the portal
   * or on a clipboard. Two tables would mean asking twice — which is how a
   * clinic ends up treating someone on the strength of a form nobody found.
   */
  it('lists digital and paper consent forms together', () => {
    renderTab([signed], [onPaper]);

    expect(screen.getByText('Laser Consent')).toBeVisible();
    expect(screen.getByText('consent-signed.pdf')).toBeVisible();
  });

  it('marks a scanned form as on file rather than inventing a signatory', () => {
    renderTab([], [onPaper]);

    expect(screen.getByText('On file')).toBeVisible();
    // A scan carries no signed-by name or timestamp we captured; claiming one
    // from the filename would be worse than an em dash.
    expect(screen.queryByText(/signed by/i)).toBeNull();
    expect(screen.getByText('Uploaded 27 Aug 2026')).toBeVisible();
  });

  it('opens the filed copy from the row', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ url: 'https://example.com/signed.pdf' });
    renderTab([], [onPaper]);

    await user.click(
      screen.getByRole('button', { name: /open consent form/i })
    );

    expect(get).toHaveBeenCalledWith('leads/lead_1/documents/doc_9/download');
  });

  it('shows the empty state only when there is neither kind', () => {
    const { rerender } = renderTab([], []);
    expect(screen.getByText('No consent forms yet')).toBeVisible();

    rerender(
      <PatientFormsTab leadId="lead_1" submissions={[]} uploaded={[onPaper]} />
    );
    expect(screen.queryByText('No consent forms yet')).toBeNull();
  });
});
