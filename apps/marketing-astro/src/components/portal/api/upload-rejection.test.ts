import { describe, expect, it } from 'vitest';

import { PATIENT_DOCUMENT_MAX_SIZE_BYTES } from './types';
import { describeUploadRejection, rejectFile } from './upload-rejection';

const file = (over: Partial<{ name: string; size: number; type: string }>) => ({
  name: 'scan.pdf',
  size: 1024,
  type: 'application/pdf',
  ...over,
});

describe('rejectFile', () => {
  it('accepts a PDF within the cap', () => {
    expect(rejectFile(file({}))).toBeNull();
  });

  it('accepts the photo types the clinic vault allows', () => {
    for (const type of [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp',
    ]) {
      expect(rejectFile(file({ type }))).toBeNull();
    }
  });

  it('rejects a file over 15MB', () => {
    expect(
      rejectFile(file({ size: PATIENT_DOCUMENT_MAX_SIZE_BYTES + 1 }))
    ).toEqual({ kind: 'too-large', fileName: 'scan.pdf' });
  });

  it('accepts a file exactly at the cap', () => {
    expect(
      rejectFile(file({ size: PATIENT_DOCUMENT_MAX_SIZE_BYTES }))
    ).toBeNull();
  });

  it('rejects a type outside the allowlist', () => {
    expect(
      rejectFile(file({ name: 'notes.docx', type: 'application/msword' }))
    ).toEqual({ kind: 'wrong-type', fileName: 'notes.docx' });
  });

  it('rejects a file the browser could not type at all', () => {
    expect(rejectFile(file({ type: '' }))?.kind).toBe('wrong-type');
  });

  it('explains each rejection in plain language', () => {
    expect(
      describeUploadRejection({ kind: 'too-large', fileName: 'big.pdf' })
    ).toBe('big.pdf is larger than 15MB');
    expect(
      describeUploadRejection({ kind: 'wrong-type', fileName: 'a.docx' })
    ).toBe("a.docx isn't a PDF or a photo");
  });
});
