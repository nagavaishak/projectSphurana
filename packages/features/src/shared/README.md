# `features/shared`

This directory is being split into a small **stable core** and the **fat,
domain-flavored helpers** that historically piled up here. The goal is a future
package split where `shared/core/` is extracted verbatim as a leaf package
(`@borradh-workspace/features-shared-core`) and every domain helper moves into
its owning bounded context.

## `shared/core/` — the extractable stable core

Stable primitives with **zero domain dependencies**. Everything under `core/`
may import only:

- other files within `core/`
- external npm packages (`zod`, `drizzle-orm`, …)
- other leaf workspace packages: `@borradh-workspace/database`,
  `@borradh-workspace/labels`, `@borradh-workspace/observability`

It must **never** import a domain-flavored shared helper (currency, meta
targeting, notion, loops, flfb flags, sample-assets, …) or any feature domain.
This is statically enforced by
[`architecture/shared-core-isolation.test.ts`](../architecture/shared-core-isolation.test.ts),
which keeps the core extractable.

Core modules:

| File | Exports |
|------|---------|
| `core/errors.ts` | `Result<T>`, `ok`, `err`, `FeatureError`, `ErrorCodes`, `internalError`, `isExclusionViolation` |
| `core/types.ts` | `Database`, `Transaction`, `DbConnection`, `ServiceContext`, `PaginationParams`, `PaginatedResult`, `SortDirection`, `BaseEntity` |
| `core/branded.ts` | `Cents`/`Id` branded types + `cents`/`zId`/… helpers |
| `core/soft-delete.ts` | `notDeleted`, `softDeleteOrgChildren`, `softDeleteLeadChildren` |
| `core/audit.ts` | `logAuditEvent`, `logConversationEvent` + input types |
| `core/org-context.ts` | `getOrgCountry`, `getOrgContext`, `buildOrgContextBlock` + types |

`core/org-context.ts` used to import the domain-flavored currency helper via
`getOrgCurrency`. That function was moved into `currency-for-country.ts` (a
domain helper) to keep the core clean; the `org-context.ts` back-compat shim
re-exports it so no consumer changed.

## Domain-flavored helpers (still in `shared/`, pending relocation)

These stay in `shared/` for now (imported by the internal `index.ts` barrel or
directly) but are **not** part of the core and should relocate into their owning
context at package-split time:

| Helper file | Should move to |
|-------------|----------------|
| `build-meta-targeting.ts`, `eu-targeting.ts` | marketing / advertising context |
| `currency-for-country.ts` (incl. `getOrgCurrency`) | commerce / billing / org context |
| `notion-crm.ts` | crm / integrations context |
| `loops.ts` | crm / marketing (Loops integration) context |
| `instagram-flfb-flag.ts`, `is-flfb-integration.ts` | integrations (Meta/FLfB) context |
| `sample-assets.ts` | onboarding / content context |
| `undeliverable-email.ts` | email / notifications context |
| `native-calendar.ts` | calendar / booking context |
| `business-hours.ts`, `timezone.ts` | scheduling context (or a scheduling-utils leaf) |
| `labels.ts` | cross-domain label barrel — imports feature domains (`organizations/`, `api-keys/`), so it can NOT be core; keep as a shared barrel or split per-domain |
| `queue/` (`safe-job-id`, `dead-letter`) | a queue/reliability leaf (pulls `bullmq`/`redis`) |
| `services/get-exchange-rates/` | commerce / billing context |

## Back-compat

The 65+ domains that import `../../../shared/index.js` (or `./shared/public.js`)
are **unchanged** — the barrels re-export the core from its new `core/` home,
and `org-context.ts` is a thin re-export shim for its 26 direct importers. The
win of this change is the isolated, dependency-clean `shared/core/` barrel plus
enforcement, not churning every consumer.
