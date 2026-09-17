#!/usr/bin/env bash
#
# Seed ONE load-test user + verified org (+ subscription for assistant quota) on
# the loadtest API, via the /testing endpoints — step 6 of LOADTEST-TARGET.md.
#
# The /testing endpoints are CLOSED on loadtest by default, so wrap this:
#   1. ENABLE:  flyctl secrets set --app borradh-api-loadtest \
#                 E2E_SEED_TOKEN="<any-random-string>" E2E_DESTRUCTIVE_ALLOWED=true
#      (wait for the redeploy to come up: flyctl status --app borradh-api-loadtest)
#   2. RUN:     E2E_SEED_TOKEN="<same string>" bash apps/load-tests/seed-loadtest-user.sh
#   3. DISABLE: flyctl secrets unset --app borradh-api-loadtest \
#                 E2E_SEED_TOKEN E2E_DESTRUCTIVE_ALLOWED
#      (re-arms the real 600/min throttler + re-closes /testing for the load runs)
#
# Then set the GitHub secrets it prints at the end (step 7).
set -euo pipefail

API="${API:-https://borradh-api-loadtest.fly.dev}"
TOKEN="${E2E_SEED_TOKEN:?Set E2E_SEED_TOKEN to the value you just set on the app}"
EMAIL="${LOADTEST_EMAIL:-loadtest@borradh.io}"
PASSWORD="${LOADTEST_PASSWORD:-LoadTest1234!}"
NAME="Load Test"

command -v jq >/dev/null || { echo "ERROR: jq required"; exit 1; }
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

echo "1/6  sign up ${EMAIL}"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/auth/sign-up" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" || true)
echo "     http $code  (200/201 = created, 409 = already exists — both fine)"

echo "2/6  force-verify email"
curl -fsS -X POST "$API/testing/force-verify" "${AUTH[@]}" \
  -d "{\"email\":\"$EMAIL\"}" >/dev/null; echo "     ok"

echo "3/6  create session -> userId"
session=$(curl -fsS -X POST "$API/testing/create-session" "${AUTH[@]}" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
user_id=$(echo "$session" | jq -r '.user.id')
[ -n "$user_id" ] && [ "$user_id" != "null" ] || { echo "FAILED — response: $session"; exit 1; }
echo "     userId=$user_id"

echo "4/6  create org -> orgId"
org=$(curl -fsS -X POST "$API/testing/create-org" "${AUTH[@]}" \
  -d "{\"userId\":\"$user_id\",\"name\":\"Load Test Org\"}")
org_id=$(echo "$org" | jq -r '.data.organizationId')
[ -n "$org_id" ] && [ "$org_id" != "null" ] || { echo "FAILED — response: $org"; exit 1; }
echo "     orgId=$org_id"

echo "5/6  force-verify org"
curl -fsS -X POST "$API/testing/force-verify-org" "${AUTH[@]}" \
  -d "{\"organizationId\":\"$org_id\"}" >/dev/null; echo "     ok"

echo "6/6  force subscription (assistant quota)"
curl -fsS -X POST "$API/testing/force-subscription" "${AUTH[@]}" \
  -d "{\"organizationId\":\"$org_id\"}" >/dev/null; echo "     ok"

cat <<DONE

✅ Seeded user=${EMAIL} org=${org_id}

Now DISABLE the testing endpoints (re-arms the throttler):
  flyctl secrets unset --app borradh-api-loadtest E2E_SEED_TOKEN E2E_DESTRUCTIVE_ALLOWED

Then set the GitHub secrets (step 7 — the switch that turns the heavy-load
workflow + daily cron on):
  gh secret set LOADTEST_API_URL  --repo Borradh-Media/borradh-workspace --body "${API}"
  gh secret set LOAD_TEST_EMAIL   --repo Borradh-Media/borradh-workspace --body "${EMAIL}"
  gh secret set LOAD_TEST_PASSWORD --repo Borradh-Media/borradh-workspace --body "${PASSWORD}"
DONE
