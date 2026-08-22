#!/usr/bin/env bash
#
# Prove the Supabase -> our endpoint -> Resend chain end to end.
#
# Everything up to here is verified: the secret is loaded on Vercel (an
# unsigned POST answers 401, not 500) and a request signed with that secret
# returns 200. What is NOT proven is that Supabase signs with the same secret,
# because the management API returns it as a hash and it cannot be read back.
#
# The only thing that settles it is a real auth email. This asks Supabase for
# a password reset, which makes Supabase call the hook, which calls Resend.
#
#   bash scripts/probe-auth-email.sh you@example.com

set -euo pipefail
cd "$(dirname "$0")/.."

TO="${1:-}"
[ -n "$TO" ] || { echo "usage: bash scripts/probe-auth-email.sh <email>" >&2; exit 1; }

val() { grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '"'"'"'\r\n'; }
SB="$(val SUPABASE_URL)"
AK="$(val SUPABASE_ANON_KEY)"
[ -n "$SB" ] && [ -n "$AK" ] || { echo "SUPABASE_URL / SUPABASE_ANON_KEY missing from .env" >&2; exit 1; }

printf 'asking Supabase to send a password reset to %s\n' "$TO"
code=$(curl -s -o /tmp/recover.out -w '%{http_code}' -X POST "$SB/auth/v1/recover" \
  -H "apikey: $AK" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TO\"}")
printf '  HTTP %s\n' "$code"
head -c 400 /tmp/recover.out; printf '\n'

# Supabase answers 200 whether or not the address exists, so the status alone
# proves nothing about delivery. Resend's log is the real answer.
printf '\nwaiting for Resend to register it\n'
sleep 6

RK="$(val RESEND_API_KEY)"
curl -s -H "Authorization: Bearer $RK" 'https://api.resend.com/emails?limit=5' > /tmp/resend.json
python3 scripts/_resend_log.py /tmp/resend.json
