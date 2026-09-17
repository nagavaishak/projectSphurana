import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentImportItem } from '../api/types';

const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

// The row links to the client through `useResolvedRoutes`, which reads the
// ACTIVE BRANCH off the router — and this suite deliberately renders without a
// `RouterProvider`, stubbing `Link`/`useNavigate` above instead. Without this
// the hook reaches real router internals and every case dies on
// "useRouter must be used inside a <RouterProvider>".
//
// Stubbed at OUR hook rather than by widening the router mock: the row reads
// exactly one thing off it, so this states the dependency instead of
// simulating the router.
vi.mock('@/lib/use-routes', () => ({
  useResolvedRoutes: () => ({
    customerDetail: (leadId: string) => `/dashboard/customers/${leadId}`,
  }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { DocumentImportRow } from './document-import-row';

/** As the row first lands: queued for the matcher, nothing read yet. */
const pending: DocumentImportItem = {
  id: 'imp_1',
  organizationId: 'org_1',
  uploadedByUserId: 'user_1',
  fileName: 'IMG_0001.jpg',
  storageKey: 'document-imports/org_1/imp_1/1-abc.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 4096,
  status: 'pending',
  documentKind: null,
  matchedLeadId: null,
  matchedLeadName: null,
  matchSource: null,
  patientDocumentId: null,
  confidence: null,
  extracted: null,
  candidates: null,
  matchReason: null,
  failureReason: null,
  processedAt: null,
  createdAt: '2026-08-20T09:59:00.000Z',
  updatedAt: '2026-08-20T09:59:00.000Z',
  deletedAt: null,
};

/** The same row after the poll picks up the matcher's verdict. */
const reviewed: DocumentImportItem = {
  ...pending,
  status: 'needs_review',
  documentKind: 'id_document',
  confidence: 0.4,
  candidates: [
    { leadId: 'l_2', name: 'John Smith', matchedOn: ['name'], score: 0.4 },
  ],
  matchReason: 'Several clients named Smith',
  processedAt: '2026-08-20T10:00:00.000Z',
};

const noop = () => undefined;

const renderRow = (item: DocumentImportItem) =>
  renderWithProviders(
    <ul>
      <DocumentImportRow
        item={item}
        onAssign={noop}
        isAssigning={false}
        onDiscard={noop}
        isDiscarding={false}
      />
    </ul>
  );

describe('DocumentImportRow', () => {
  beforeEach(() => {
    // LeadPicker → useListLeads
    get.mockResolvedValue({ items: [], total: 0 });
  });

  /**
   * The regression this file exists for.
   *
   * Every row is first painted as `pending` with `candidates: null` and only
   * gains candidates on a later 2s poll, on the SAME element — the list is
   * keyed by `item.id`, so it never remounts. Seeding the picker from a
   * `useState` initialiser therefore captured `undefined` forever, and the
   * reviewer was left searching for the client the matcher had already named
   * two lines above. The dialog test never caught it because it renders rows
   * with candidates already present.
   */
  it('pre-selects the matcher’s candidate when it arrives on a later poll', async () => {
    const { rerender } = renderRow(pending);

    // Nothing to attach to yet — the matcher has not reported.
    expect(screen.queryByRole('button', { name: /^attach$/i })).toBeNull();

    rerender(
      <ul>
        <DocumentImportRow
          item={reviewed}
          onAssign={noop}
          isAssigning={false}
          onDiscard={noop}
          isDiscarding={false}
        />
      </ul>
    );

    expect(
      await screen.findByRole('button', { name: /^attach$/i })
    ).toBeEnabled();
  });

  it('attaches the candidate the matcher suggested', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();

    const { rerender } = renderWithProviders(
      <ul>
        <DocumentImportRow
          item={pending}
          onAssign={onAssign}
          isAssigning={false}
          onDiscard={noop}
          isDiscarding={false}
        />
      </ul>
    );
    rerender(
      <ul>
        <DocumentImportRow
          item={reviewed}
          onAssign={onAssign}
          isAssigning={false}
          onDiscard={noop}
          isDiscarding={false}
        />
      </ul>
    );

    await user.click(await screen.findByRole('button', { name: /^attach$/i }));

    expect(onAssign).toHaveBeenCalledWith('l_2');
  });

  it('offers nothing to attach when the matcher found no candidate', async () => {
    renderRow({ ...reviewed, candidates: [] });

    expect(
      await screen.findByRole('button', { name: /^attach$/i })
    ).toBeDisabled();
  });
});
