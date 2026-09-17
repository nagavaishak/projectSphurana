import { defineCoverage } from '../coverage.types.js';

/**
 * UPLOAD — 9 endpoints, 0 tools. Every route here is one step of an S3
 * multipart or mobile-handoff choreography, and the reason none is a
 * capability is mechanical rather than a judgement call: THE BYTES NEVER PASS
 * THROUGH THE API.
 *
 * The API only ever mints and validates presigned URLs. The actual PUT goes
 * from the browser or phone straight to S3, and the completion step must echo
 * back the ETags S3 returned for each part. Claire holds no file, performs no
 * PUT, and therefore can never produce a valid ETag list — so the choreography
 * cannot be completed by her even in principle. An `exposed` here would name a
 * capability that physically does not exist for a caller without a file
 * handle.
 *
 * What she works with instead is the RESULT: once an upload lands, the asset
 * appears in the media library, and `content_listMedia` reads it.
 * That is the correct seam — assets, not bytes.
 *
 * The two presign endpoints deserve their own note. A presigned URL is a
 * bearer credential: anyone holding it can write to (or read from) that object
 * for its lifetime, with no further auth. Minting one into a model's context
 * puts a writable storage credential somewhere prompt-injectable.
 */
export const uploadCoverage = defineCoverage('upload', {
  // ---- presign: bearer credentials for object storage --------------------
  'POST /upload/presigned-url': {
    notExposed:
      'Mints a presigned S3 PUT URL — a bearer credential that lets whoever holds it write to that object with no further auth. Claire has no bytes to send, and a writable storage credential is the last thing that should sit in a prompt-injectable context.',
  },
  'POST /upload/presigned-download-url': {
    notExposed:
      'Mints a time-limited read URL for stored media. Claire references assets by id through the media library; a raw signed URL is also exactly the thing that must never be persisted, since it expires and rots wherever it was copied.',
  },

  // ---- multipart choreography --------------------------------------------
  'POST /upload/multipart/initiate': {
    notExposed:
      'Opens an S3 multipart upload and returns an upload id. Step one of a three-call handshake whose middle step happens entirely outside this API, so starting it without a file leaves a dangling incomplete upload.',
  },
  'POST /upload/multipart/sign-parts': {
    notExposed:
      'Signs a batch of part URLs for the client to PUT directly to S3. Only meaningful to a caller that has the file split into parts in memory.',
  },
  'POST /upload/multipart/complete': {
    notExposed:
      'Finalises the upload by echoing back the ETag S3 returned for every part. Claire never performed the PUTs, so she can never hold those ETags — the step is unsatisfiable rather than merely withheld.',
  },

  // ---- mobile handoff: phone-bound, single-use ---------------------------
  'POST /upload/mobile-token': {
    notExposed:
      'Issues a short-lived token encoded into a QR code so the owner can continue an upload on their phone. It is a device handoff credential, and its whole purpose is to reach a camera roll Claire cannot see.',
  },
  'GET /upload/mobile-verify/:token': {
    notExposed:
      'Validated by the phone when it opens the QR link, to confirm the handoff is still live. Answers the device, not a user, and returns nothing an owner would ask about.',
  },
  'POST /upload/mobile-complete/:token': {
    notExposed:
      'The phone reporting that its upload finished, against the single-use handoff token. Same unsatisfiable shape as the multipart completion: the caller must be the device that did the transfer.',
  },
  'GET /upload/mobile-status/:videoId': {
    notExposed:
      'Polled by the desktop page to watch the phone’s progress bar. It reports transfer state for a UI that is waiting; videos_getVideoStatus is the read that answers the question an owner actually asks.',
  },
});
