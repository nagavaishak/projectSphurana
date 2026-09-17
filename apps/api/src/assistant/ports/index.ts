import type {
  AvailabilityPort,
  CatalogPort,
  LeadFormsPort,
  MetaAdsPort,
  PractitionersPort,
  ResourcesPort,
  SalesPort,
  VideosPort,
} from '@borradh-workspace/contracts/ports';
import type { ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createAvailabilityPort } from './availability.adapter.js';
import { createCatalogPort } from './catalog.adapter.js';
import { createLeadFormsPort } from './lead-forms.adapter.js';
import { createMetaAdsPort } from './meta-ads.adapter.js';
import { createPractitionersPort } from './practitioners.adapter.js';
import { createResourcesPort } from './resources.adapter.js';
import { createSalesPort } from './sales.adapter.js';
import { createVideosPort } from './videos.adapter.js';

/**
 * THE composition root for capability ports — GATE 2.
 *
 * Every port an orchestrator (Claire) can reach is assembled here, in one
 * object literal annotated with its interface. That annotation is the gate:
 * add a method to `VideosPort` and this file stops compiling until an
 * implementation exists, so a capability cannot drift out of reach silently.
 * Deleting a method is caught from the other side by Gate 1
 * (`apps/api/src/architecture/endpoint-coverage.spec.ts`), which fails when
 * `PORT_COVERAGE` names a method the interface no longer declares.
 *
 * Plain function-argument injection: no global registry, no service locator,
 * no Nest in the features layer. `buildAssistantToolsContext` calls this once
 * per chat request and hands the result to every tool.
 *
 * KNOWN LIMITATION, and the reason several tools do NOT read `ctx.ports`.
 * This function receives the BASE `apiFetch` (see `tool-context.ts`), whose
 * path whitelist is deliberately narrow. A tool widens its own reach with
 * `additionalAllowedPaths`, and the factory applies that to `ctx.apiFetch`
 * ONLY, inside the wrapped execute. So a port whose endpoints are not on the
 * BASE whitelist fails the path check on every call if reached via
 * `ctx.ports` — silently, because the adapter reports it as an unread source.
 *
 * `availability`, `catalog`, `practitioners` and `sales` are all in that
 * position, as is `metaAds.updateAd`. Those tools compose their port over
 * `ctx.apiFetch` instead. They stay listed here because this object IS Gate 2:
 * a port declared and never implemented must fail the build.
 *
 * The durable fix is to thread a path-extended fetch into this function so
 * `ctx.ports` is always as capable as the tool reaching it. Not done here
 * because it changes how EVERY port is built and the existing whitelists want
 * re-verifying first.
 *
 * `explain-availability.spec.ts` pins the trap: it asserts none of that tool's
 * paths is on the base whitelist, so widening the base (or threading the fetch
 * through) fails that test and the workaround gets removed deliberately rather
 * than left as cargo.
 */
export interface AssistantPorts {
  videos: VideosPort;
  metaAds: MetaAdsPort;
  leadForms: LeadFormsPort;
  /** Answers "why can't customers book?" — the first port added because a
   *  capability was MISSING rather than dishonest. See Gate 6. */
  availability: AvailabilityPort;
  /** Everything the business sells, in one comparable shape. */
  catalog: CatalogPort;
  /** Who works here, and who performs a given service. */
  practitioners: PractitionersPort;
  /** What the business took, by tender. */
  sales: SalesPort;
  /**
   * Rooms & equipment — the SECOND availability source. Gate 1's rationale
   * ("shifts are the sole availability source, so Claire structurally could
   * not fix an unbookable service") applies verbatim once a service requires a
   * room, which is why every mutating `/resources` endpoint is ported.
   */
  resources: ResourcesPort;
}

export interface BuildAssistantPortsInput {
  apiFetch: ApiFetchFn;
  /** Org scope for ports whose implementation calls a use case directly and so
   *  no longer inherits `@ActiveOrganization()` from the loopback request. */
  organizationId: string;
  channel?: 'web' | 'whatsapp';
  conversationId: string;
}

export function buildAssistantPorts(
  input: BuildAssistantPortsInput
): AssistantPorts {
  // The annotation on this literal is what makes a missing capability a build
  // failure rather than a support email. Do not widen it to `Record<…>`.
  const ports: AssistantPorts = {
    videos: createVideosPort({
      apiFetch: input.apiFetch,
      channel: input.channel,
      conversationId: input.conversationId,
    }),
    metaAds: createMetaAdsPort({
      apiFetch: input.apiFetch,
      organizationId: input.organizationId,
    }),
    leadForms: createLeadFormsPort({ apiFetch: input.apiFetch }),
    availability: createAvailabilityPort({ apiFetch: input.apiFetch }),
    catalog: createCatalogPort({ apiFetch: input.apiFetch }),
    practitioners: createPractitionersPort({ apiFetch: input.apiFetch }),
    sales: createSalesPort({ apiFetch: input.apiFetch }),
    resources: createResourcesPort({ apiFetch: input.apiFetch }),
  };
  return ports;
}

export { createAvailabilityPort } from './availability.adapter.js';
export type { AvailabilityPortDeps } from './availability.adapter.js';
export { createLeadFormsPort } from './lead-forms.adapter.js';
export type { LeadFormsPortDeps } from './lead-forms.adapter.js';
export { createMetaAdsPort } from './meta-ads.adapter.js';
export type { MetaAdsPortDeps } from './meta-ads.adapter.js';
export { createResourcesPort } from './resources.adapter.js';
export type { ResourcesPortDeps } from './resources.adapter.js';
export { createVideosPort } from './videos.adapter.js';
export type { VideosPortDeps } from './videos.adapter.js';
