import { createFileRoute } from '@tanstack/react-router';

import { AnnotateWireframe } from '@/features/wireframes/consultation/annotate';

/**
 * Wireframe: Annotation canvas — a FULL-SCREEN surface.
 *
 * Deliberately a sibling of `/dashboard`, not a child. `_authed.tsx` gives the
 * app sidebar to `/dashboard/*` only; everything else renders bare and owns its
 * own chrome. §8 requires the consultation to own the viewport — it takes over
 * an iPad in a treatment room and owns the camera — and a sidebar beside a
 * clinical canvas is both visual noise and a one-tap route out mid-procedure.
 *
 * Static review page. Delete when the surface ships for real.
 */
export const Route = createFileRoute('/_authed/wireframe-fullscreen/annotate')({
  component: AnnotateWireframe,
});
