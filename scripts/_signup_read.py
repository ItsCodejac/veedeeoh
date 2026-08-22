"""Say what the signup response means, rather than dumping JSON.

The interesting bit is `confirmation_sent_at` versus `access_token`: a session
handed back immediately means confirmation is OFF and the account is already
live; a confirmation timestamp with no session means it is ON and working."""
import json
import sys

try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("  (unreadable response)")
    raise SystemExit

if d.get("code") or d.get("error_code"):
    print("  ERROR:", d.get("error_code") or d.get("code"), "-", d.get("msg") or d.get("error_description"))
    raise SystemExit

user = d.get("user") or d
if d.get("access_token"):
    print("  signed in immediately -> confirmation is OFF")
elif user.get("confirmation_sent_at"):
    print("  confirmation required, email dispatched at", user["confirmation_sent_at"])
    print("  confirmed_at:", user.get("confirmed_at") or "not yet (correct)")
else:
    print("  no session and no confirmation timestamp:", json.dumps(d)[:200])
