# Request contracts

`src/requests/` is the **request twin** of `src/responses/`. Each file holds the
canonical Zod schema for one or more write endpoints' **body**, in pure Zod
(frontend-safe: `zod` + `@borradh-workspace/labels` only — no drizzle /
database in the runtime graph).

## Direction of derivation — wire → server

**These files are the SOURCE.** The backend feature schema in
`packages/features` derives from the contract by `.extend()`ing the fields the
server injects:

```ts
// packages/contracts/src/requests/leads.ts    ← canonical
export const createLeadRequestBase = z.object({ firstName: z.string().min(1), … });
export const createLeadRequestSchema = createLeadRequestBase.strict();

// packages/features/.../create-lead.schema.ts ← derived
export const createLeadSchema = createLeadRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});
```

Because the server schema literally **is** the wire schema plus fields, it can
never be laxer, and no drift is possible. There is one description, not two.

**Do not invert this.** Copying a contract *out of* a feature schema and leaving
both is exactly the drift this package exists to eliminate. Before this change,
`createLeadBodySchema` in `apps/app` had drifted from the server on four fields
— `firstName` and `email` laxer (a blank email passed the frontend's own
`.strict()` check and 400'd at the server), `source` and `consent*` stricter.

### Why not a generator?

Deriving wire *from* feature would need, per endpoint, an omit list
("`organizationId` is server-injected") and a date-transform list. **That config
is itself a hand-maintained second description** that can drift the same way. A
generator would relocate the mirror, not remove it. Deriving server *from* wire
needs only `.extend()`, which `tsc` checks.

(Response **atoms** are still generated from Drizzle tables by
`scripts/generate-contracts.ts` — those genuinely are table rows.)

## The Base / Schema pair

Every contract exports two things, because `.refine()` / `.superRefine()`
returns a `ZodEffects`, which has no `.extend()`:

| export | shape | used by |
|---|---|---|
| `<name>RequestBase` | plain `z.object({…})`, **not** strict | the feature schema, to `.extend()` |
| `<name>RequestSchema` | `Base.strict()` (+ any refinement) | DTOs and frontend builders, to **validate** |

`Base` must not be strict — `.strict()` would reject the very context fields
being extended onto it. Nested objects that nothing extends should use the
**strict** half.

## The recipe (per endpoint)

1. Find the feature input schema:
   `packages/features/src/<feature>/services/<action>-<entity>/*.schema.ts`.
2. Lift its fields into `src/requests/<domain>.ts` as a `Base`/`Schema` pair,
   **omitting** server-injected context: `organizationId` (active-org session),
   route-param ids (`id`), and session-derived owner fields (`actorId`,
   `inviterId`, `createdById`).
3. Keep every validator **exactly** — `.min(1)`, `.email()`, `.optional()`,
   `.default()`. Enums come from `@borradh-workspace/labels`.
4. Rewrite the feature schema to `.extend()` the Base. Keep all existing export
   names and inferred type names unchanged.
5. Point the API DTO at the contract: `createZodDto(<name>RequestSchema)`.
   If the Schema carries a refinement, `createZodDto` needs a `ZodObject` — use
   `Base.strict()` and let the refinement run in the service.
6. Make the `apps/app` `*BodySchema` re-export the canonical schema.
7. Add cases to `src/requests/<domain>.test.ts`: a valid body parses, an unknown
   field is rejected, a missing required field is rejected.

### Gotchas

- **`.default()` materialises.** Parsing emits defaulted keys, so the client
  starts sending values it did not before. Update exact-deep-equal form-contract
  tests; do **not** delete the default — the feature schema *is* the Base, so
  removing it changes **server** behaviour.
- **A contract can move a bug rather than fix it.** If a form's blank value is
  `''` and the contract has a format/min constraint, the builder's `.parse()`
  now throws client-side instead of the server 400-ing. Normalise `'' →
  undefined` in the payload builder for those fields only.
- **`z.infer` → `z.input`.** Where the server coerces (`z.coerce.date()`) and the
  DTO now passes ISO strings through, the exported Input type must be
  `z.input<…>`. This is correct, not a workaround.
- **Type-only imports from `database` still leak** into the emitted `.d.ts` and
  break `apps/app` resolution. Restate such types structurally.
- **Endpoints with no body** (most DELETEs, and routes whose every input is a
  route param or session value) get **no contract**. Do not invent an empty one.

## Coverage

**86 contracts. All 41 `apps/app` body-schema mirrors now source from here.**
78 feature schemas derive; 75 API DTOs point at a contract.

| file | covers |
|---|---|
| `appointments.ts` | create / update appointment, find-open-slots, service line |
| `scheduling.ts` | blocked-time (+types), time-off, weekly shifts, shift override, wage config |
| `leads.ts` | create / update lead |
| `deposits.ts` | create deposit request, refund deposit |
| `sales.ts` | create sale (+from appointment), add item, tip, client, payment, gift-card adjust, refund |
| `catalog.ts` | services, categories, offers (create / update) |
| `inventory.ts` | products, brands, categories, suppliers, stock orders, receive, stock takes, adjust |
| `team.ts` | practitioners, team member, invite / accept, service + location assignment, locations |
| `campaigns.ts` | campaigns, segments, campaign messages |
| `content.ts` | videos (+draft config), social posts, voice scripts, face groups, generation |
| `conversations.ts` | send / assign message |
| `organizations.ts` | org settings, business profile, user, Stripe account link |

## Open decisions

- **Date representation is not yet uniform.** `appointments.ts` uses
  `z.string().datetime()` with the feature schema re-typing to `z.coerce.date()`;
  `scheduling.ts` uses `z.coerce.date()` on the wire (its builders send `Date`
  objects). Both are correct for their callers. Worth one convention.
- **Should the wire carry server defaults?** Today it does, so `.default()`
  values are transmitted explicitly. The alternative — `.optional()` on the
  contract, `.default()` re-added in the feature `.extend()` — keeps
  server-owned decisions off the wire.

## Known gaps

- `PATCH videos/:id/draft-config` has **no DTO** — an untyped inline `@Body()`
  with no `ValidationPipe`. The contract is enforced one layer in, by the
  service. Adding a DTO would introduce request validation where none exists.
- `voice-cloning` admin routes take a raw inline `@Body()` type with no
  validation at all (admin-gated).
- `usageType` reaches `createVideo` but `synthesizeVideoInput` does not carry
  it, so **organic videos are still stored as ads**. A real behaviour fix,
  deliberately out of scope here.
- `invite-member.role` (`'member' | 'admin'`) has no `@borradh-workspace/labels`
  equivalent; the single declaration was moved, not duplicated. Adding
  `memberRoleValues` to labels is a follow-up.
- Three update-alias schemas (`updateProductBrand`, `updateProductCategory`,
  `updateSupplier`) are field-identical to their create counterparts and would
  inherit derivation for free.
