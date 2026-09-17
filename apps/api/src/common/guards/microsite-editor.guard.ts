import {
  type CanActivate,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * The microsite EDITOR production switch.
 *
 * The editor (agent chat, block edits, revisions, publish, domain
 * provisioning) is built but not being exposed yet. Hiding the dashboard tab
 * alone would not be a lock: the routes stay reachable by anyone who types the
 * URL or replays a request, and the agent turn spends model budget. So the
 * server refuses too, and the UI hide is cosmetic on top of this.
 *
 * SCOPE — deliberately NOT the whole feature. Every org still gets its
 * auto-provisioned site, and `public/microsites/*` (which renders it) is NOT
 * guarded. Turning the editor off must not take tenants' live sites down.
 *
 * 404 rather than 403: a disabled feature should look absent, not forbidden.
 * The message is explicit anyway, because the reader of that 404 is far more
 * likely to be us wondering why an endpoint vanished than anyone probing it.
 *
 * OFF unless `MICROSITE_EDITOR_ENABLED` is set, and pr-preview.yml sets it on
 * every per-PR app — the same shape as `E2E_DESTRUCTIVE_ALLOWED` and
 * `STRIPE_E2E_STUB` beside it.
 *
 * This deliberately does NOT key on `NODE_ENV`. Preview Fly apps inherit
 * `NODE_ENV=production` from fly.toml, so an environment check there refuses
 * on exactly the deployments that are supposed to have the editor — which is
 * how the first version of this guard 404'd the preview it was written to
 * enable. `E2E_DESTRUCTIVE_ALLOWED` carries the same warning for the same
 * reason.
 *
 * Default-off rather than default-on-outside-prod: a new environment should
 * have to ask for an unlaunched feature, not inherit it.
 */
@Injectable()
export class MicrositeEditorGuard implements CanActivate {
  canActivate(): boolean {
    if (!process.env.MICROSITE_EDITOR_ENABLED) {
      throw new NotFoundException(
        'The website editor is not enabled here (set MICROSITE_EDITOR_ENABLED ' +
          'to expose it). Previews get it from pr-preview.yml.'
      );
    }
    return true;
  }
}
