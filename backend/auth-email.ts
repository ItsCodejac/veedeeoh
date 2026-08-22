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

const shell = (heading: string, body: string, cta: string, ctaUrl: string): string => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background-color:#0b0f19;color:#f3f4f6;border-radius:12px;border:1px solid #1f293d;">
    <div style="margin-bottom:24px;"><span style="font-size:24px;font-weight:800;color:#ffffff;">veedeeoh</span><span style="color:#c5f04e;font-size:24px;font-weight:800;">.</span></div>
    <h1 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#ffffff;">${heading}</h1>
    ${body}
    <p style="margin:26px 0;">
      <a href="${ctaUrl}" style="display:inline-block;background:#c5f04e;color:#06070a;font-weight:800;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:10px;">${cta}</a>
    </p>
    <p style="font-size:12px;color:#6b7280;line-height:1.6;">If the button does not work, paste this into your browser:<br>
      <span style="color:#9ca3af;word-break:break-all;">${ctaUrl}</span></p>
    <hr style="border:none;border-top:1px solid #1f293d;margin:24px 0;" />
    <p style="font-size:12px;color:#6b7280;text-align:center;">veedeeoh &bull; <a href="https://veedeeoh.com" style="color:#6b7280;text-decoration:underline;">veedeeoh.com</a></p>
  </div>`;

const P = (t: string) =>
  `<p style="font-size:15px;line-height:1.6;color:#9ca3af;margin-bottom:16px;">${t}</p>`;

const CODE = (t: string) =>
  `<p style="font-size:26px;letter-spacing:.22em;font-weight:800;color:#c5f04e;margin:8px 0 20px;">${t}</p>`;

/** The link Supabase would have built itself. Verification happens against
 *  token_hash on their side; we only carry it. */
function verifyUrl(d: AuthEmailPayload['email_data'], type?: string): string {
  const base = (d.site_url || 'https://veedeeoh.com').replace(/\/$/, '');
  const qs = new URLSearchParams({
    token_hash: d.token_hash,
    type: type || d.email_action_type,
  });
  if (d.redirect_to) qs.set('redirect_to', d.redirect_to);
  return `${base}/auth/v1/verify?${qs.toString()}`;
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
        subject: 'Confirm your veedeeoh account',
        html: shell('Confirm your email',
          P('Tap below and your account is ready. Your seven-day trial starts as soon as you do, and no card is needed for it.')
          + P('If you did not sign up for veedeeoh, you can ignore this and nothing happens.'),
          'Confirm my email', link),
      };

    case 'recovery':
      return {
        subject: 'Reset your veedeeoh password',
        html: shell('Reset your password',
          P('Tap below to choose a new one. The link works once and expires shortly.')
          + P('If you did not ask for this, ignore it -- your password has not changed.'),
          'Choose a new password', link),
      };

    case 'magiclink':
      return {
        subject: 'Your veedeeoh sign-in link',
        html: shell('Sign in to veedeeoh',
          P('Tap below to sign in. The link works once and expires shortly.')
          + (d.token ? P('Or enter this code:') + CODE(d.token) : ''),
          'Sign me in', link),
      };

    case 'invite':
      return {
        subject: 'You have been invited to veedeeoh',
        html: shell('You have been invited',
          P('Someone has invited you to their veedeeoh household. Tap below to set up your profile.'),
          'Accept the invite', link),
      };

    case 'email_change':
    case 'email_change_new':
      return {
        subject: 'Confirm your new veedeeoh email address',
        html: shell('Confirm your new address',
          P(`Confirm the change to ${p.user.new_email || 'your new address'}. Until you do, your account keeps its current one.`),
          'Confirm the change', verifyUrl(d, 'email_change')),
      };

    default:
      return {
        subject: 'A message about your veedeeoh account',
        html: shell('Confirm this request',
          P('Tap below to continue. If you were not expecting this, ignore it.'),
          'Continue', link),
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
