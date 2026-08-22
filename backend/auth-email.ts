// Authentication emails, sent by us rather than by Supabase's SMTP client.
//
// WHY THIS EXISTS. Supabase's built-in sending never reached Resend -- not a
// rejected message, not a failed login, nothing: zero connection attempts on
// Resend's side across every combination of host, port and credential we tried.
// Email signup therefore returned a 500 and had to be switched off, which is a
// bad trade: it means anyone can register an address they do not own.
//
// The thing worth noticing is that Resend was never the broken part. Its HTTP
// API works, and every other email this product sends -- waitlist, trial
// reminders -- already goes through it successfully. Only SMTP was failing. So
// rather than keep debugging a protocol we do not need, Supabase's Send Email
// Hook hands the message to us and we send it the way that already works.
//
// With the hook enabled, Supabase stops using SMTP entirely. Confirmation can
// go back on.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sendEmail } from './email';
import { render, P, CODE } from './email-template';

/** What Supabase posts. Only the fields we actually use are typed. */
export interface AuthEmailPayload {
  user: { email?: string; new_email?: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

// Standard Webhooks allows five minutes either side. Beyond that a captured
// request is a replay, and the signature alone would happily accept it.
const TOLERANCE_MS = 5 * 60 * 1000;

/** Verify a Standard Webhooks signature.
 *
 *  The signed content is id.timestamp.body, so the body must be the RAW text.
 *  Re-serialising parsed JSON changes bytes -- key order, whitespace, unicode
 *  escapes -- and the signature stops matching for reasons that look like a
 *  wrong secret. */
export function verifyHook(
  raw: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing webhook headers' };

  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(Date.now() - ts) > TOLERANCE_MS) return { ok: false, reason: 'timestamp outside tolerance' };

  // Supabase presents the secret as v1,whsec_<base64>. The bytes after the
  // prefix are the key; using the printable string as the key is the other
  // common way to get a signature that never matches.
  const key = Buffer.from(secret.replace(/^v1,\s*/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64');

  // The header carries a space-separated list, each entry version-tagged, so a
  // secret can be rotated with both signatures present for a while.
  for (const part of signature.split(' ')) {
    const provided = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, reason: 'signature mismatch' };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Where a confirmation link goes: our own page, which completes the exchange
 *  with supabase-js.
 *
 *  The first version built /auth/v1/verify against site_url, which is our
 *  domain and does not have that endpoint. Pointing it at the Supabase project
 *  instead does work -- it is what their default template does -- but it puts
 *  another company's hostname and an apikey query parameter into an email that
 *  claims to be from us. That is the shape of a phishing link, to a filter and
 *  to anyone reading carefully, and the fallback line asking people to paste it
 *  by hand made it worse.
 *
 *  The key was never the issue: the anon key ships in the front-end bundle and
 *  authorises nothing alone. The link looking untrustworthy was the issue.
 *
 *  Found by clicking a real confirmation email, which returned
 *  {"message":"No API key found in request"}. Every automated check had passed,
 *  because all of them stopped at the point the message left the building. */
function verifyUrl(d: AuthEmailPayload['email_data'], type?: string): string {
  const site = (process.env.PUBLIC_SITE_URL || d.site_url || 'https://veedeeoh.com').replace(/\/$/, '');
  const qs = new URLSearchParams({
    token_hash: d.token_hash,
    type: type || d.email_action_type,
  });
  if (d.redirect_to) qs.set('redirect_to', d.redirect_to);
  return `${site}/auth/confirm?${qs.toString()}`;
}

interface Built { subject: string; html: string }

/** One template per action Supabase can ask for.
 *
 *  Unknown types still send something rather than throwing: a new action type
 *  appearing after a Supabase upgrade should not mean a user gets no email at
 *  all, which is the failure this whole module exists to end. */
export function buildAuthEmail(p: AuthEmailPayload): Built {
  const d = p.email_data;
  const link = verifyUrl(d);

  switch (d.email_action_type) {
    case 'signup':
      return {
        subject: 'Confirm your email',
        html: render({
          preheader: 'One tap and your seven-day trial starts. No card needed.',
          heading: 'Confirm your email',
          body: P('Tap below and your account is ready. Your seven-day trial starts as soon as you do, and no card is needed for it.')
            + P('If you did not sign up, you can ignore this and nothing happens.'),
          cta: 'Confirm my email', ctaUrl: link, rawLink: link,
        }),
      };

    case 'recovery':
      return {
        subject: 'Reset your password',
        html: render({
          preheader: 'The link works once and expires shortly.',
          heading: 'Reset your password',
          body: P('Tap below to choose a new one. The link works once and expires shortly.')
            + P('If you did not ask for this, ignore it. Your password has not changed.'),
          cta: 'Choose a new password', ctaUrl: link, rawLink: link,
        }),
      };

    case 'magiclink':
      return {
        subject: 'Your sign-in link',
        html: render({
          preheader: 'Tap to sign in. The link works once.',
          heading: 'Sign in',
          body: P('Tap below to sign in. The link works once and expires shortly.')
            + (d.token ? P('Or enter this code:') + CODE(d.token) : ''),
          cta: 'Sign me in', ctaUrl: link, rawLink: link,
        }),
      };

    case 'invite':
      return {
        subject: 'You have been invited',
        html: render({
          preheader: 'Someone has invited you to their household.',
          heading: 'You have been invited',
          body: P('Someone has invited you to their veedeeoh household. Tap below to set up your profile.'),
          cta: 'Accept the invite', ctaUrl: link, rawLink: link,
        }),
      };

    case 'email_change':
    case 'email_change_new': {
      const changeLink = verifyUrl(d, 'email_change');
      return {
        subject: 'Confirm your new email address',
        html: render({
          preheader: 'Until you confirm, your account keeps its current address.',
          heading: 'Confirm your new address',
          body: P(`Confirm the change to ${p.user.new_email || 'your new address'}. Until you do, your account keeps its current one.`),
          cta: 'Confirm the change', ctaUrl: changeLink, rawLink: changeLink,
        }),
      };
    }

    default:
      return {
        subject: 'A message about your account',
        html: render({
          preheader: 'Tap to continue. If you were not expecting this, ignore it.',
          heading: 'Confirm this request',
          body: P('Tap below to continue. If you were not expecting this, ignore it.'),
          cta: 'Continue', ctaUrl: link, rawLink: link,
        }),
      };
  }
}

/** Send the email Supabase asked for. Throws on failure so the caller can
 *  return a non-200 and let Supabase surface the error, rather than reporting
 *  success for a message that never left. */
export async function sendAuthEmail(p: AuthEmailPayload): Promise<void> {
  const to = p.user?.new_email && p.email_data.email_action_type.startsWith('email_change')
    ? p.user.new_email
    : p.user?.email;
  if (!to) throw new Error('no recipient on payload');

  const { subject, html } = buildAuthEmail(p);
  const res = await sendEmail({ to, subject, html });
  if (!res.success) throw new Error(res.error || 'send failed');
}
