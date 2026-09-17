import { db, runWithRlsContext } from '@borradh-workspace/database';
import { getGraphic } from '@borradh-workspace/features/graphics';
import { getVideo } from '@borradh-workspace/features/videos';
import { signCdnUrl, signGraphicOutputs } from '../common/media/index.js';

/**
 * `GET /onboarding/candidates` read model.
 *
 * Lifted out of a 56-line handler. It is a projection: read the graphic/video
 * rows the session points at, drop anything that failed or belongs to another
 * org, and re-sign the private-CDN media so the picker grid can load it
 * directly in `<img>`/`<video>` (the browser carries no CloudFront cookies).
 *
 * The signing primitives come from `common/media/cdn-signing.ts` — the
 * controller had its OWN `extractCdnKey` / `signCdnUrl` / `signGraphicOutputs`,
 * a fourth copy of code that already existed in one place after graphics,
 * content-batches and v1-assets were consolidated onto it.
 */

interface CandidateSession {
  adCandidateGraphicIds?: string[] | null;
  videoCandidateIds?: string[] | null;
}

export async function buildCandidatesView(
  session: CandidateSession,
  organizationId: string,
  userId: string
) {
  // Bind the RLS context to the session's org explicitly — this endpoint
  // may be polled before the browser session has the active org attached.
  return runWithRlsContext({ organizationId, userId }, async () => {
    const adCandidates = (
      await Promise.all(
        (session.adCandidateGraphicIds ?? []).map(async (id) => {
          const r = await getGraphic(db, { id, organizationId });
          if (!r.success) return null;
          return {
            id,
            status: r.data.status,
            // `?? undefined` keeps the old shape: a graphic with no outputs
            // serialised the key as ABSENT, not as `null`.
            outputs:
              signGraphicOutputs({ outputs: r.data.outputs }).outputs ??
              undefined,
          };
        })
      )
    ).filter((c) => c !== null);

    const videoCandidates = (
      await Promise.all(
        (session.videoCandidateIds ?? []).map(async (id) => {
          const r = await getVideo(db, { id });
          if (
            !r.success ||
            !r.data ||
            r.data.organizationId !== organizationId
          ) {
            return null;
          }
          const previewUrl =
            signCdnUrl(r.data.blobUrl) ?? signCdnUrl(r.data.thumbnailUrl);
          return {
            id,
            status: r.data.status,
            previewUrl: previewUrl ?? undefined,
          };
        })
      )
    ).filter((c) => c !== null);

    return { adCandidates, videoCandidates };
  });
}
