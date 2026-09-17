/**
 * Custom domains for microsites (plan §9, phase 4 contract §1–2).
 *
 * The provider is INJECTED into every service that talks to one
 * (`DomainServiceDeps`), and the only type this package knows about it is the
 * neutral `DomainProvider` port. Nothing here — and nothing that imports from
 * here — may name a provider.
 */

export {
  micrositeBaseDomains,
  domainPairFor,
  validateMicrositeDomain,
  type DomainRejectionReason,
  type DomainValidation,
  type NormalizedDomain,
} from './domain-name.js';

export {
  detectRegistrar,
  registrarDnsUrl,
  registrarFromNameservers,
  type NameserverResolver,
  type RegistrarInfo,
} from './registrar.js';

export {
  buildDomainInstructions,
  type DomainInstructions,
} from './dns-instructions.js';

export { toDomainFeatureError } from './provider-errors.js';

export * from './add-microsite-domain/index.js';
export * from './list-microsite-domains/index.js';
export * from './remove-microsite-domain/index.js';
export * from './set-primary-domain/index.js';
