/**
 * Build the host allowlist for image URLs the assistant chat is willing to
 * forward to Anthropic vision content blocks.
 *
 * The signed-upload pipeline (`uploads.controller.ts` → `signUploadUrl`)
 * generates URLs on `S3_ASSISTANT_UPLOADS_BUCKET` only. Optionally a
 * CloudFront/CDN host (`CDN_URL`) and a custom S3 endpoint (`S3_ENDPOINT`,
 * for MinIO in local dev) are also legitimate. Anything else means a
 * forged `UIMessage` — we don't want Anthropic fetching attacker URLs on
 * our behalf (cost abuse, external-request logging).
 *
 * Returns a lower-cased string array; pass to
 * `convertToAnthropicMessages(messages, { allowedImageHosts })`.
 *
 * When `bucket` is undefined the function returns an empty array, which the
 * converter treats as "no enforcement" — appropriate for test fixtures and
 * local dev where the bucket isn't wired up. The signed-upload service
 * itself fails loudly when the bucket is missing, so prod deployments will
 * always have it set.
 */
export interface BuildAllowedImageHostsInput {
  bucket: string | undefined;
  region: string;
  endpoint?: string;
  cdnUrl?: string;
}

export function buildAllowedImageHosts(
  input: BuildAllowedImageHostsInput
): string[] {
  const { bucket, region, endpoint, cdnUrl } = input;
  if (!bucket) return [];

  const hosts: string[] = [
    // Virtual-hosted style — what AWS SDK's `getSignedUrl` returns by default.
    `${bucket}.s3.${region}.amazonaws.com`,
    `${bucket}.s3.amazonaws.com`,
    // Path-style — emitted when `S3_FORCE_PATH_STYLE=true`.
    `s3.${region}.amazonaws.com`,
    's3.amazonaws.com',
  ];

  // CDN host (e.g. `cdn.app.example.com`) — if the upload pipeline rewrites
  // URLs through CloudFront, the resulting host is also legitimate.
  if (cdnUrl) {
    try {
      hosts.push(new URL(cdnUrl).host);
    } catch {
      // Misconfigured CDN_URL — skip rather than crash the chat path.
    }
  }

  // Custom S3 endpoint host (MinIO in local dev).
  if (endpoint) {
    try {
      hosts.push(new URL(endpoint).host);
    } catch {
      // Misconfigured S3_ENDPOINT — skip.
    }
  }

  return hosts.map((h) => h.toLowerCase());
}
