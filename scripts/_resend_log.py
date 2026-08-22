"""Print the last few Resend messages. Split out of probe-auth-email.sh because
inline python inside a shell heredoc is a quoting minefield -- the previous
version died on its own escaped quotes."""
import json
import sys

try:
    rows = (json.load(open(sys.argv[1])) or {}).get("data") or []
except Exception as e:                                    # noqa: BLE001
    print("  could not read Resend log:", e)
    raise SystemExit

if not rows:
    print("  Resend reports no recent messages")
for r in rows[:5]:
    to = ",".join(r.get("to") or [])
    print("  {}  {:10}  {}  {}".format(
        r.get("created_at", "?"), r.get("last_event", "?"), to, r.get("subject", "")))
