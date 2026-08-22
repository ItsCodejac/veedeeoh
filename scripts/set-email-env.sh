#!/usr/bin/env bash
#
# Push the two variables the auth-email hook needs into Vercel Production.
#
# WHY A SCRIPT RATHER THAN TWO COMMANDS. The last time these were set by hand
# the Resend key arrived with STRIPE_CREDIT_PRICE_ID glued to the end of it, and
# nothing noticed until mail silently stopped. That is a copy-paste failure, and
# the fix is to never copy: the key is read out of .env, stripped of quotes and
# line endings, validated against the shape a Resend key actually has, and piped
# straight in. It is checked BEFORE it is pushed, so a mangled value is refused
# rather than stored.
#
#   bash scripts/set-email-env.sh
#
# Nothing is printed. Values are shown only as a length and a three-character
# prefix, which is enough to tell a good key from a mangled one and not enough
# to leak anything into a terminal log.

set -euo pipefail
cd "$(dirname "$0")/.."

# --check validates everything and pushes nothing. Useful for confirming the
# key in .env is intact before committing it to the project, and it is the mode
# that can be run for you -- the real run has to be yours, because it is the
# one that puts a credential somewhere.
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

say()  { printf '  %s\n' "$*"; }
fail() { printf '\n  FAILED: %s\n\n' "$*" >&2; exit 1; }

command -v vercel >/dev/null 2>&1 || fail "the vercel CLI is not on PATH"
[ -f .env ] || fail "no .env in $(pwd)"

if [ "$CHECK" = "1" ]; then
  printf '\nCHECK ONLY -- nothing will be written\n\n'
else
  printf '\nSetting email environment variables on Vercel Production\n\n'
fi

# ---------------------------------------------------------------- RESEND ---
# Read, then strip: surrounding quotes, carriage returns and newlines. Those
# three are what turn a working key into a broken one when it travels through a
# clipboard or an editor that likes CRLF.
RESEND="$(grep -m1 '^RESEND_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'"'\r\n' || true)"

[ -n "$RESEND" ] || fail "RESEND_API_KEY not found in .env"

# The shape check is the whole point. A Resend key is re_ followed by ~30
# url-safe characters; anything longer means something got appended, which is
# exactly the failure this is here to prevent.
if ! printf '%s' "$RESEND" | grep -Eq '^re_[A-Za-z0-9_-]{20,60}$'; then
  say "value read from .env: ${#RESEND} chars, starts '${RESEND:0:3}'"
  fail "that does not look like a clean Resend key. Check .env for a stray
          second value appended to the line, then run this again."
fi
say "RESEND_API_KEY   looks clean: ${#RESEND} chars, starts '${RESEND:0:3}'"

# ------------------------------------------------------------ HOOK SECRET ---
# Prompted rather than read from a file, because Supabase generates it in the
# dashboard and it is not written down anywhere here. -s so it does not appear
# on screen or in shell history.
HOOK=""
if [ "$CHECK" = "0" ]; then
  printf '\n  Paste the Send Email Hook secret from Supabase (starts v1,whsec_)\n'
  printf '  Leave blank to skip and set only the Resend key.\n  > '
  read -rs HOOK
  printf '\n'
  HOOK="$(printf '%s' "$HOOK" | tr -d '"'"'"'\r\n')"
fi

if [ -n "$HOOK" ]; then
  if ! printf '%s' "$HOOK" | grep -Eq '^(v1,)?whsec_.+'; then
    say "value entered: ${#HOOK} chars, starts '${HOOK:0:3}'"
    fail "that does not look like a webhook secret. It should start v1,whsec_
          -- copy the whole string, including the v1, part."
  fi
  say "hook secret     looks clean: ${#HOOK} chars"
fi

# ------------------------------------------------------------------ push ---
# add refuses when the name already exists, so an existing one is removed
# first. This makes the script safe to run again after a bad value.
push() {
  local name="$1" value="$2"
  if [ "$CHECK" = "1" ]; then say "$name would be pushed (${#value} chars)"; return; fi
  if vercel env ls production 2>/dev/null | grep -q "^ $name "; then
    say "$name already set, replacing"
    vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  fi
  printf '%s' "$value" | vercel env add "$name" production >/dev/null 2>&1 \
    || fail "vercel refused $name. Are you logged in and linked to the right project?"
  say "$name pushed"
}

printf '\n'
push RESEND_API_KEY "$RESEND"
[ -n "$HOOK" ] && push SEND_EMAIL_HOOK_SECRET "$HOOK"

if [ "$CHECK" = "1" ]; then
  printf '\n  Check passed. Nothing was written. To do it for real:\n\n'
  printf '    bash scripts/set-email-env.sh\n\n'
  exit 0
fi

printf '\n  Done. Both take effect on the next deploy:\n\n    vercel --prod\n\n'
printf '  Then the hook endpoint should answer 401 to an unsigned request\n'
printf '  rather than 500, which is how you know the secret loaded.\n\n'
