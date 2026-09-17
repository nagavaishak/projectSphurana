import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentImportItem } from '../api/types';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { ImportDocumentsDialog } from './import-documents-dialog';

const base: DocumentImportItem = {
  id: 'imp_1',
  organizationId: 'org_1',
  uploadedByUserId: 'user_1',
  fileName: 'consent.pdf',
  storageKey: 'document-imports/org_1/imp_1/1-abc.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 4096,
  status: 'matched',
  documentKind: 'consent_form',
  matchedLeadId: 'l_1',
  matchedLeadName: 'Jane Doe',
  matchSource: 'auto',
  patientDocumentId: 'doc_1',
  confidence: 0.97,
  extracted: null,
  candidates: null,
  matchReason: 'Email address on the document matches this client',
  failureReason: null,
  processedAt: '2026-08-20T10:00:00.000Z',
  createdAt: '2026-08-20T09:59:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  deletedAt: null,
};

const review: DocumentImportItem = {
  ...base,
  id: 'imp_2',
  fileName: 'IMG_0001.jpg',
  mimeType: 'image/jpeg',
  status: 'needs_review',
  documentKind: 'id_document',
  matchedLeadId: null,
  matchedLeadName: null,
  matchSource: null,
  patientDocumentId: null,
  confidence: 0.4,
  extracted: {
    personName: 'J. Smith',
    email: null,
    phone: null,
    dateOfBirth: '1990-01-02',
    dates: [],
    summary: 'Driving licence',
  },
  candidates: [
    { leadId: 'l_2', name: 'John Smith', matchedOn: ['name'], score: 0.4 },
  ],
  matchReason: 'Several clients named Smith',
};

function routeGet(url: string) {
  if (url.startsWith('document-imports')) {
    return Promise.resolve({ items: [base, review] });
  }
  // LeadPicker → useListLeads
  return Promise.resolve({ items: [], total: 0 });
}

describe('ImportDocumentsDialog', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => routeGet(url));
    post.mockReset();
    del.mockReset();
  });

  it('badges the trigger with the number of documents awaiting review', async () => {
    renderWithProviders(<ImportDocumentsDialog />);

    expect(
      await screen.findByLabelText('1 documents need review')
    ).toHaveTextContent('1');
  });

  it('renders a matched row with its client and a review row with the picker', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportDocumentsDialog />);

    await user.click(
      await screen.findByRole('button', { name: /import documents/i })
    );

    const list = await screen.findByRole('list', {
      name: 'Imported documents',
    });
    expect(list).toHaveTextContent('consent.pdf');
    expect(list).toHaveTextContent('Filed under');
    expect(list).toHaveTextContent('Jane Doe');
    expect(list).toHaveTextContent('97% match');

    expect(list).toHaveTextContent('IMG_0001.jpg');
    expect(list).toHaveTextContent(/needs a look/i);
    expect(list).toHaveTextContent('Several clients named Smith');
    expect(list).toHaveTextContent('Driving licence');
    expect(screen.getByRole('button', { name: /^attach$/i })).toBeEnabled(); // top candidate pre-selected
    expect(
      screen.getByRole('button', { name: 'Discard IMG_0001.jpg' })
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Discard consent.pdf' })
    ).toBeNull();
  });

  it('attaches the pre-selected candidate on click', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      ...review,
      status: 'matched',
      matchedLeadId: 'l_2',
    });
    renderWithProviders(<ImportDocumentsDialog />);

    await user.click(
      await screen.findByRole('button', { name: /import documents/i })
    );
    await user.click(await screen.findByRole('button', { name: /^attach$/i }));

    expect(post).toHaveBeenCalledWith('document-imports/imp_2/assign', {
      leadId: 'l_2',
    });
  });

  /**
   * Without this the list only grows: every document ever imported stays on
   * screen, so the few that still need a decision end up buried under months
   * of ones that do not. Only the finished rows go — the review row stays,
   * because it is somebody's outstanding work.
   */
  it('offers to clear only the documents already dealt with', async () => {
    const user = userEvent.setup();
    del.mockResolvedValue({ cleared: 1 });
    renderWithProviders(<ImportDocumentsDialog />);

    await user.click(
      await screen.findByRole('button', { name: /import documents/i })
    );

    // One matched + one needs_review in the fixture, so the count is 1.
    const clear = await screen.findByRole('button', { name: /clear 1 done/i });
    await user.click(clear);

    expect(del).toHaveBeenCalledWith('document-imports/settled');
  });

  it('hides the clear button when nothing is finished', async () => {
    const user = userEvent.setup();
    get.mockImplementation((url: string) =>
      url.startsWith('document-imports')
        ? Promise.resolve({ items: [review] })
        : Promise.resolve({ items: [], total: 0 })
    );
    renderWithProviders(<ImportDocumentsDialog />);

    await user.click(
      await screen.findByRole('button', { name: /import documents/i })
    );
    await screen.findByRole('list', { name: 'Imported documents' });

    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });
});
