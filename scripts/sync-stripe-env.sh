#!/usr/bin/env bash
# Push the Stripe values from .env into Vercel production, then redeploy.
#
# Vercel env vars cannot be edited in place, so each is removed and re-added.
# Values are piped straight from .env -- they are never printed and never touch
# a clipboard. Run this yourself; it needs your Stripe credentials.
#
#   npm run stripe:sync
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env found"; exit 1; }
val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }

SK=$(val STRIPE_SECRET_KEY); PID=$(val STRIPE_PRICE_ID); WH=$(val STRIPE_WEBHOOK_SECRET)

echo "Pre-flight"
fail=0
case "$SK" in
  sk_live_*|rk_live_*) echo "  secret key      LIVE" ;;
  sk_test_*)           echo "  secret key      TEST -- still sandbox, customers cannot be charged"; fail=1 ;;
  "")                  echo "  secret key      MISSING from .env"; fail=1 ;;
  *)                   echo "  secret key      unrecognised prefix"; fail=1 ;;
esac
case "$WH" in
  whsec_*) echo "  webhook secret  present" ;;
  "")      echo "  webhook secret  MISSING from .env"; fail=1 ;;
  *)       echo "  webhook secret  unrecognised prefix"; fail=1 ;;
esac

# A price id does not reveal its mode, so ask Stripe directly with the live key.
if [ -z "$PID" ]; then
  echo "  price           MISSING from .env"; fail=1
elif [ "${SK:0:8}" = "sk_live_" ] || [ "${SK:0:8}" = "rk_live_" ]; then
  resp=$(curl -s -u "$SK:" "https://api.stripe.com/v1/prices/$PID?expand[]=tiers" || true)
  if echo "$resp" | grep -q '"error"'; then
    echo "  price           NOT FOUND in live mode -- this is a test-mode price id"; fail=1
  else
    tiers=$(echo "$resp" | grep -c '"up_to"' || true)
    rec=$(echo "$resp" | grep -o '"interval": *"[a-z]*"' | head -1)
    echo "  price           found in live mode ($rec, $tiers tier(s))"
    [ "$tiers" -lt 2 ] && echo "      WARNING: checkout sends quantity=3, so a flat price bills 3x." \
                       && echo "      Expected graduated tiers: 1-3 = \$4 flat, 4+ = \$2/unit."
  fi
else
  echo "  price           cannot verify without a live key"
fi

[ "$fail" -eq 1 ] && { echo; echo "Fix the above, then re-run."; exit 1; }

echo
read -r -p "Push these to Vercel production and redeploy? [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted"; exit 0; }

for pair in "STRIPE_SECRET_KEY:$SK" "STRIPE_PRICE_ID:$PID" "STRIPE_WEBHOOK_SECRET:$WH"; do
  k="${pair%%:*}"; v="${pair#*:}"
  vercel env rm "$k" production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | vercel env add "$k" production >/dev/null 2>&1 && echo "  set $k"
done

echo
npm run build >/dev/null 2>&1 && vercel --prod
