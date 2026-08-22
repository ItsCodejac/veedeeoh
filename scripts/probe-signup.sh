#!/usr/bin/env bash
#
# Ground truth for "is email confirmation on, and does the email arrive".
#
# The config flag is not trustworthy on its own -- mailer_autoconfirm is
# inverted (true means SKIP confirmation) and the dashboard may write a
# different field. A real signup answers both questions at once: whether
# Supabase demands confirmation, and whether the mail actually lands.
#
#   bash scripts/probe-signup.sh you+test@example.com

set -euo pipefail
cd "$(dirname "$0")/.."
TO="${1:-}"; [ -n "$TO" ] || { echo "usage: probe-signup.sh <email>" >&2; exit 1; }

val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '"'"'"'\r\n'; }
SB="$(val SUPABASE_URL)"; AK="$(val SUPABASE_ANON_KEY)"

printf 'signing up %s\n' "$TO"
curl -s -o /tmp/signup.out -w '  HTTP %{http_code}\n' -X POST "$SB/auth/v1/signup" \
  -H "apikey: $AK" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TO\",\"password\":\"Testing12345!\"}"

python3 scripts/_signup_read.py /tmp/signup.out

printf '\nwaiting for Resend\n'
sleep 6
curl -s -H "Authorization: Bearer $(val RESEND_API_KEY)" \
  'https://api.resend.com/emails?limit=3' > /tmp/resend.json
python3 scripts/_resend_log.py /tmp/resend.json
