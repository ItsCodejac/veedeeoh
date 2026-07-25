# Cloud auth branding (veedeeoh)

Two separate systems control what users see during sign-in and in auth emails:
Google (the consent screen) and Supabase (the emails + the auth callback domain).
Most of this is dashboard config; the email HTML is in `email-templates/`.

---

## 1. Google sign-in consent screen

Right now it reads "Sign in to fwlbmksxmfzgkazrulgt.supabase.co". There are two
parts to fix, and they come from two different places:

### a) The app name ("Sign in to veedeeoh")
Google Cloud Console → **APIs & Services → OAuth consent screen** (newer UI:
**Google Auth Platform → Branding**):
- **App name:** `veedeeoh`
- **User support email:** support@veedeeoh.com
- **App logo:** upload the veedeeoh mark (120x120+ PNG). A logo change may trigger
  Google verification review; the app name/email alone do not.
- **App domain / Application home page:** https://veedeeoh.com
- **Authorized domains:** `veedeeoh.com`
- **Developer contact:** your email

Setting the app name replaces the raw domain in the "Sign in to ___" heading.

### b) The "Google will allow ___ to access" domain
That domain is the host of the OAuth **redirect/callback URL**. With default
Supabase it is `https://fwlbmksxmfzgkazrulgt.supabase.co/auth/v1/callback`, so
Google shows the supabase.co host. The ONLY way to make it say `veedeeoh.com` is
to move the auth callback onto your own domain — see section 3 (Custom domain).
Until then, the app-name fix above is the main visible improvement.

---

## 2. Supabase auth emails

Two things to change: WHO the email is from (SMTP), and what it LOOKS like
(templates).

### a) Brand the sender — Custom SMTP  (required to send from veedeeoh.com)
By default Supabase sends from its own address and is rate-limited to a handful
of emails per hour — not production-safe. Set up custom SMTP:

Dashboard → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
- **Sender email:** support@veedeeoh.com  (or noreply@veedeeoh.com)
- **Sender name:** veedeeoh
- **Host / Port / Username / Password:** from an email provider. Recommended:
  **Resend** (resend.com) — free tier, simple. You must verify `veedeeoh.com`
  there (add the DKIM/SPF DNS records in Cloudflare). SendGrid/Postmark/Mailgun
  also work.

Without this, emails still send but from an unbranded Supabase address and can
hit the low default rate limit.

### b) Brand the look — Email templates
Dashboard → **Authentication → Emails → Templates**. For each template, paste the
matching file from `email-templates/` into the **Message body (HTML)** and set the
subject:

| Template        | File                          | Subject |
|-----------------|-------------------------------|---------|
| Confirm signup  | `confirm-signup.html`         | Confirm your veedeeoh account |
| Reset password  | `reset-password.html`         | Reset your veedeeoh password |
| Magic Link      | `magic-link.html`             | Your veedeeoh sign-in link |
| Invite user     | `invite.html`                 | You are invited to join a veedeeoh household |

Template variables used: `{{ .ConfirmationURL }}` (the action link). Others
available: `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`,
`{{ .RedirectTo }}`.

Note: Google sign-in does NOT send any Supabase email. These fire only for
email/password signup confirmation, password reset, magic link, and invites.

---

## 3. Custom domain (removes "supabase.co" everywhere)

This is what fully de-supabases the experience: the OAuth callback and the links
inside emails move to your domain (e.g. `auth.veedeeoh.com`).

Dashboard → **Project Settings → Custom Domains** (paid add-on, ~$10/mo):
1. Add `auth.veedeeoh.com` (a subdomain is typical), add the CNAME it gives you in
   Cloudflare (DNS only / grey cloud), and activate.
2. Then update:
   - **Google Cloud Console** → OAuth client → Authorized redirect URIs: change to
     `https://auth.veedeeoh.com/auth/v1/callback` (keep the supabase.co one until
     the switch is confirmed).
   - **Supabase → Authentication → URL Configuration:** Site URL
     `https://veedeeoh.com`, and Redirect URLs include `https://veedeeoh.com/**`.
   - Frontend: `signInWithGoogle` already uses `${window.location.origin}/index.html`
     as `redirectTo`, so no code change is needed.

After this, the consent screen reads "Google will allow auth.veedeeoh.com" (or
your chosen subdomain) and email links point at your domain.

---

### Priority order
1. Google app name + support email (free, instant, biggest visible win).
2. Custom SMTP + paste the branded templates (free with Resend; makes emails real).
3. Custom domain (paid) — do when you want to remove supabase.co entirely.
