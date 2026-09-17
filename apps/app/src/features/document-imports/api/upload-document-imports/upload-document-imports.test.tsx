import { act, createTestQueryClient, renderHook } from '@/test/render';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const del = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

const putFileWithProgress = vi.fn();
vi.mock('@/features/patient-documents/api/put-with-progress', () => ({
  putFileWithProgress: (...args: unknown[]) => putFileWithProgress(...args),
}));

import { useUploadDocumentImports } from './upload-document-imports.hook';

const pdf = () => new File(['x'], 'consent.pdf', { type: 'application/pdf' });

/** ky's `HTTPError` shape, as `apiClient` re-throws it. */
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status } });

const uploadOne = async () => {
  const queryClient = createTestQueryClient();
  const { result } = renderHook(() => useUploadDocumentImports(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await result.current.uploadFile(pdf());
  });
  expect(result.current.uploads).toHaveLength(1);
  return result;
};

describe('useUploadDocumentImports', () => {
  beforeEach(() => {
    post.mockReset();
    del.mockReset();
    putFileWithProgress.mockReset().mockResolvedValue(undefined);
    del.mockResolvedValue(undefined);
  });

  /**
   * The regression these exist for.
   *
   * `SanitizeErrorsFilter` strips every 5xx body to "An unexpected error
   * occurred", so a dead storage credential, a wedged bucket and a genuine
   * server bug all reached the file row as the same seven words — which read
   * to everyone as "the importer is broken" and sent people reading upload
   * code instead of the API log. Naming the STEP is safe and is what decides
   * whether a retry can help.
   */
  it('says the upload never started when presign 500s', async () => {
    post.mockRejectedValueOnce(httpError(500, 'An unexpected error occurred'));

    const result = await uploadOne();

    expect(result.current.uploads[0].status).toBe('error');
    expect(result.current.uploads[0].error).toMatch(/upload never started/i);
    expect(result.current.uploads[0].error).not.toMatch(/unexpected error/i);
  });

  it('says the bytes landed when only the recording step 500s', async () => {
    post
      .mockResolvedValueOnce({
        importId: 'imp_1',
        url: 'https://s3/put',
        key: 'k',
        expiresIn: 900,
      })
      .mockRejectedValueOnce(httpError(503, 'An unexpected error occurred'));

    const result = await uploadOne();

    expect(result.current.uploads[0].error).toMatch(
      /uploaded, but we couldn’t save it/i
    );
    // The staging row must not be left behind as a phantom "Uploading".
    expect(del).toHaveBeenCalledWith('document-imports/imp_1');
  });

  /** 4xx messages are the feature's own, written for a person. */
  it('passes a 4xx message through untouched', async () => {
    post.mockRejectedValueOnce(httpError(400, 'Only PDFs and photos, sorry.'));

    const result = await uploadOne();

    expect(result.current.uploads[0].error).toBe(
      'Only PDFs and photos, sorry.'
    );
  });

  it('distinguishes an unreachable server from a broken one', async () => {
    post.mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await uploadOne();

    expect(result.current.uploads[0].error).toMatch(
      /couldn’t reach the server/i
    );
  });
});
