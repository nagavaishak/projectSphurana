import { z } from 'zod';

export const ASSET_TRANSCODE_QUEUE = 'asset-transcode';

export const assetTranscodeJobPayloadSchema = z.object({
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
  blobUrl: z.string().min(1),
});

export type AssetTranscodeJobPayload = z.infer<
  typeof assetTranscodeJobPayloadSchema
>;

/**
 * Skip criteria — if all of these are true, the asset is already in an
 * acceptable format and can be fed straight to Remotion without transcoding.
 */
export interface ProbeDataForSkipDecision {
  codec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  duration: number | null;
}

export function shouldSkipTranscode(probe: ProbeDataForSkipDecision): boolean {
  // HEVC always needs transcode — Lambda's software decoder is 3-5x
  // more expensive than H.264 regardless of resolution or bitrate
  if (probe.codec !== 'h264') return false;

  // 10-bit color requires more memory per frame
  if (probe.pixFmt !== 'yuv420p') return false;

  // 4K (>1920 either dimension) — 4x the pixels of 1080p
  if (!probe.width || !probe.height) return false;
  if (probe.width > 1920 || probe.height > 1920) return false;

  // At 1080p h264, only transcode extreme bitrates (>30 Mbps).
  // Normal phone footage is 15-25 Mbps and decodes fine on Lambda.
  if (probe.bitrateKbps && probe.bitrateKbps > 30000) return false;

  // Sanity guard — clips longer than we ever use in a template
  if (probe.duration && probe.duration > 120) return false;

  return true;
}

export const backfillAssetTranscodesSchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export type BackfillAssetTranscodesInput = z.infer<
  typeof backfillAssetTranscodesSchema
>;
