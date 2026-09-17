# Curated template inspiration images

Structural layout references the branded-graphic (nano-banana / Gemini) engine
reproduces, fully rebranded. The registry
(`packages/features/src/image-generation/carousel-templates/`) references these
by `(slug, index)` / `slug` only — no URLs or hashes are committed.

Layout:

```
_single/<single-slug>.jpg     → carousel-inspiration/_single/<slug>.jpg
<carousel-slug>/NN.jpg        → carousel-inspiration/<slug>/NN.jpg
```

All curated reference images are committed here (versioned, so the look is
reproducible across environments). The set covers every carousel slug
(`clearskin-blackwhite`, `clearskin-storytime`, `phoenix`, `phoenix-2`,
`therapie`) and the single templates that have a curated reference
(`offer-benefits-split`, `stat-serif-centered`, `concern-list-photo`,
`its-not-cheap-longform`). Single templates without an image fall back to
their text layout description by design.

> History: only `offer-benefits-split.jpg` used to be committed; the rest lived
> only in staging's `org-assets` bucket, so a fresh prod environment rendered
> generic, text-only graphics. They were recovered from staging S3 and
> committed so prod (and any new env) reproduces the curated look.

## Seeding to S3

The worker reads these from the per-env **org-assets** bucket under the
`carousel-inspiration/` prefix. The S3 keys mirror this directory exactly.

**Production is seeded automatically** by the `seed-inspiration` job in
`.github/workflows/deploy-production.yml` (an `aws s3 sync` of this directory
on every prod deploy).

To seed another environment manually (e.g. staging) point AWS at it and run:

```bash
aws s3 sync templates/carousel-inspiration/ \
  s3://<env>-org-assets/carousel-inspiration/ --exclude "*.md"
# or, slug-validated, via the script:
pnpm exec env-cmd tsx scripts/seed-carousel-inspiration.ts --dir templates/carousel-inspiration
```

A missing image is non-fatal — generation falls back to the template's text
layout description. Seed so the ad templates reproduce the curated look.

## Local dev / verify (no S3)

Point the loader at this dir to verify before seeding:

```bash
CAROUSEL_INSPIRATION_DIR=templates/carousel-inspiration
```
