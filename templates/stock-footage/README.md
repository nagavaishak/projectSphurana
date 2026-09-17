# Stock Footage Seed Source

Put licensed curated stock footage and stills here before production deploy:

- `manifest.json`
- `<vertical>/<clip>.mp4`
- `<vertical>/<image>.jpg`

The production `seed-stock-footage` job reads this directory, uploads media to
the prod org-assets bucket under `stock-footage/`, and upserts `stock_clip`
catalog rows. Keep only redistribution-approved media in this directory.
