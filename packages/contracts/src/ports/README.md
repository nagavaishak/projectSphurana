# Ports — capability contracts

Hand-written. **The atom generator never touches this directory** — it writes
only to `src/generated/` (see `scripts/generate-contracts.ts`), so ports are
safe from regeneration without any generator change.

A port is a typed description of a capability one context exposes to another.
It does two jobs at once:

1. **Decoupling (build graph).** A consuming context depends on `contracts`, not
   on the implementing context's package. See
   `docs/engineering/context-boundary-architecture.md`.
2. **Contract enforcement (compile time).** The composition root in `apps/api`
   builds a registry typed to the port, so a missing method is a build failure,
   and the return types make dishonest states unrepresentable. See
   `docs/engineering/ports-as-capability-contracts.md`.

## Rules for writing one

- **No booleans asserting a state the caller cannot verify.** `rendered: true`
  alongside `status: 'queued'` shipped 47 times in production and caused Claire
  to tell owners their video was rendering when it never would.
- **No optional field encoding failure.** A `hardBlock` inside an otherwise
  successful result was returned 6 times and silently ignored.
- **Model outcomes as a discriminated union** so every caller must branch.
- **Ports describe capability, not transport.** No `db`, no HTTP, no Nest.
- Types come from the existing DTO atoms in `../generated`, `../requests`,
  `../responses` — ports add behaviour, never new data shapes.
