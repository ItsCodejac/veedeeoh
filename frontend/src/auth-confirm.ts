// Completes an emailed confirmation, reset or invite on our own domain.
//
// The alternative was linking straight to GoTrue's /auth/v1/verify with the
// anon key in the query string. That works, and it is what Supabase's default
// template does, but it puts somebody else's hostname and an apikey parameter
// into an email claiming to be from us -- which is what a phishing link looks
// like to a filter and to a careful reader. Doing the exchange here keeps the
// link short, legible and ours.
//
// verifyOtp takes the same token_hash the email carried, so nothing about the
// security of it changes: the token is single-use, short-lived, and validated
// by Supabase either way.

import { getSupabase } from "./auth";

type OtpType = "signup" | "recovery" | "invite" | "magiclink" | "email_change";

const show = (id: string) => document.getElementById(id)?.classList.remove("hide");
const hide = (id: string) => document.getElementById(id)?.classList.add("hide");
const setText = (id: string, text: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

/** Only same-origin destinations. An open redirect on a link we send by email
 *  is worth more to an attacker than most bugs in the app. */
function safeRedirect(raw: string | null): string {
  if (!raw) return "/index.html";
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/index.html";
  } catch {
    return "/index.html";
  }
}

/** What to say once it worked. A password reset that says "you're all set" and
 *  drops someone on the home page has not finished the job they started. */
const OUTCOME: Record<string, { title: string; body: string; cta: string; href: string }> = {
  recovery: {
    title: "Choose a new password",
    body: "Your link checked out. Set a new password to finish.",
    cta: "Set a new password",
    href: "/change-password.html",
  },
  invite: {
    title: "You're in",
    body: "Your account is ready.",
    cta: "Start watching",
    href: "/index.html",
  },
  email_change: {
    title: "Address updated",
    body: "Your account now uses the new email address.",
    cta: "Back to veedeeoh",
    href: "/index.html",
  },
};

async function run(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const tokenHash = q.get("token_hash") || q.get("token");
  const type = (q.get("type") || "signup") as OtpType;
  const dest = safeRedirect(q.get("redirect_to"));

  if (!tokenHash) {
    hide("working");
    setText("failTitle", "Something is missing from that link");
    setText("failBody", "It looks like it was cut short on the way here. Sign in and we will send a fresh one.");
    show("failed");
    return;
  }

  const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type });

  hide("working");
  if (error) {
    // Deliberately vague about WHY. Distinguishing "already used" from "never
    // existed" tells someone holding a stolen link which it is.
    setText("failTitle", "That link has expired");
    show("failed");
    return;
  }

  const outcome = OUTCOME[type];
  if (outcome) {
    setText("doneTitle", outcome.title);
    setText("doneBody", outcome.body);
    const cta = document.getElementById("doneCta") as HTMLAnchorElement | null;
    if (cta) { cta.textContent = outcome.cta; cta.href = outcome.href; }
    show("done");
    return;
  }

  // Signup and anything else: straight in. The session is live at this point,
  // so the button is only there for a browser that blocks the redirect.
  const cta = document.getElementById("doneCta") as HTMLAnchorElement | null;
  if (cta) cta.href = dest;
  show("done");
  window.setTimeout(() => { window.location.replace(dest); }, 900);
}

void run().catch(() => {
  hide("working");
  show("failed");
});
