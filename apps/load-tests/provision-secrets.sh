#!/usr/bin/env bash
#
# Provision the `borradh-api-loadtest` Fly app's env — step 3 of LOADTEST-TARGET.md,
# automated. Mirrors pr-preview.yml's secret composition (committed config +
# 1Password `borradh-ci-preview/preview-env` secrets + inline overrides), with
# load-test-specific overrides. The 1Password secret VALUES are resolved at run
# time via `op inject`/`op read`, so nothing secret is hardcoded here.
#
# Prereqs:
#   - flyctl authed (`flyctl auth login`), the loadtest app already created.
#   - op CLI authed to the 1Password account holding the `borradh-ci-preview`
#     vault (`op signin`), OR export the preview service-account token:
#         export OP_SERVICE_ACCOUNT_TOKEN=<OP_SERVICE_ACCOUNT_TOKEN_PREVIEW value>
#   - The POOLED loadtest Neon connection string from step 1, passed as env.
#
# Usage (from repo root):
#   DATABASE_URL_POOLED='postgresql://neondb_owner:***@ep-***-pooler.<region>.aws.neon.tech/neondb?sslmode=require' \
#     bash apps/load-tests/provision-secrets.sh
#
# Secrets are STAGED (--stage): they apply on the next deploy (step 5), so this
# never triggers a release on its own.
set -euo pipefail

APP="borradh-api-loadtest"
VAULT="borradh-ci-preview"
ITEM="preview-env"
REPO_ROOT="$(git rev-parse --show-toplevel)"

: "${DATABASE_URL_POOLED:?Set DATABASE_URL_POOLED to the POOLED loadtest Neon string (step 1)}"
command -v op >/dev/null     || { echo "ERROR: op CLI required (https://developer.1password.com/docs/cli/)"; exit 1; }
command -v flyctl >/dev/null  || { echo "ERROR: flyctl required"; exit 1; }

TPL="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$TPL" "$OUT"' EXIT

# The 1Password secret subset (same op:// refs pr-preview.yml's load-secrets step uses).
SECRET_KEYS=(
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BETTER_AUTH_SECRET
  BETTERSTACK_ERROR_DSN BETTERSTACK_HEARTBEAT_URL ELEVENLABS_API_KEY
  GOOGLE_CLIENT_SECRET INTEGRATION_ENCRYPTION_KEY INTERCOM_ACCESS_TOKEN
  LOGTAIL_TOKEN LOOPS_API_KEY META_APP_SECRET META_INSTAGRAM_APP_SECRET
  META_WEBHOOK_VERIFY_TOKEN OPENAI_API_KEY REDIS_URL RESEND_API_KEY
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_CONNECT_WEBHOOK_SECRET
  ANTHROPIC_API_KEY GOOGLE_GENAI_API_KEY OAUTH_PROXY_STATE_SECRET
)

{
  # 1) Committed non-secret config — keep its SENTRY_ENVIRONMENT (a strict
  #    development|staging|production enum; "staging" is correct for loadtest),
  #    override only WEB_URL for loadtest.
  grep -vE '^(WEB_URL)=' "$REPO_ROOT/.github/preview.env"

  # 2) 1Password secret refs (op inject resolves these).
  for k in "${SECRET_KEYS[@]}"; do
    printf '%s=op://%s/%s/%s\n' "$k" "$VAULT" "$ITEM" "$k"
  done
  # Remotion reuses the same AWS key pair as the main AWS vars.
  printf 'REMOTION_AWS_ACCESS_KEY_ID=op://%s/%s/AWS_ACCESS_KEY_ID\n' "$VAULT" "$ITEM"
  printf 'REMOTION_AWS_SECRET_ACCESS_KEY=op://%s/%s/AWS_SECRET_ACCESS_KEY\n' "$VAULT" "$ITEM"

  # 3) Load-test overrides (non-secret). E2E_SEED_TOKEN + E2E_DESTRUCTIVE_ALLOWED
  #    are DELIBERATELY omitted (real 600/min throttler; /testing stays closed).
  cat <<EOF
POSTHOG_API_KEY=phc_P1l2HUcvrdiuzxq1r9avlEYbJscwYX9r2lyosQ4Y2dD
OAUTH_PROXY_BASE_URL=https://borradh-webhooks.fly.dev
APP_ENV=loadtest
BETTER_AUTH_URL=https://borradh-api-loadtest.fly.dev
BULLMQ_KEY_PREFIX=loadtest
WEB_URL=https://www.borradh.io
COMMIT_SHA=$(git rev-parse origin/main)
DATABASE_URL=${DATABASE_URL_POOLED}
EOF
} > "$TPL"

echo "Resolving 1Password references..."
# --force: $OUT already exists (mktemp created it), so overwrite without prompting.
op inject --force -i "$TPL" -o "$OUT"

echo "Staging $(grep -c '=' "$OUT") secrets on $APP..."
flyctl secrets import --app "$APP" --stage < "$OUT"

# CLOUDFRONT_PRIVATE_KEY is a multiline PEM — `import` can't parse it; set it on its own.
echo "Setting the multiline CLOUDFRONT_PRIVATE_KEY..."
flyctl secrets set --app "$APP" --stage \
  CLOUDFRONT_PRIVATE_KEY="$(op read "op://${VAULT}/${ITEM}/CLOUDFRONT_PRIVATE_KEY")"

echo "✅ Secrets staged on ${APP}. They apply on the deploy in step 5."
echo "   Next: step 4 (migrate the loadtest branch) → step 5 (deploy the image)."
