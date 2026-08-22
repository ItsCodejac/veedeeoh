import { MAIL_FROM, render, P } from './email-template';
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY || process.env.RESENT_API_KEY || null;
}

/**
 * Sends a transactional email using Resend HTTP API.
 * Uses native fetch, making it compatible with Node, Vercel edge/serverless, and Hono.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.warn('[Email] Skipping email delivery: RESEND_API_KEY (or RESENT_API_KEY) is not set in environment variables.');
    return { success: false, error: 'RESEND_API_KEY is not configured.' };
  }

  // The brand's full stop belongs in the sender name, where it sits at the end
  // of a phrase rather than in the middle of a subject line.
  const from = options.from || MAIL_FROM;
  const payload = {
    from,
    to: Array.isArray(options.to) ? options.to : [options.to],
    subject: options.subject,
    html: options.html,
    text: options.text,
  };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Email] Resend API error response:', data);
      return { success: false, error: data?.message || 'Resend API request failed.' };
    }

    return { success: true, id: data.id };
  } catch (err: any) {
    console.error('[Email] Network/unexpected error during email send:', err);
    return { success: false, error: err?.message || 'Failed to connect to Resend API.' };
  }
}

/**
 * Sends a welcome email when a user joins the waitlist.
 */
export async function sendWaitlistConfirmationEmail(email: string): Promise<void> {
  const subject = 'Welcome to the veedeeoh waitlist!';
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background-color: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #1f293d;">
      <div style="margin-bottom: 24px;">
        <span style="font-size: 24px; font-weight: 800; tracking: -0.02em; color: #ffffff;">veedeeoh</span>
      </div>
      <h1 style="font-size: 22px; font-weight: 700; margin-bottom: 16px; color: #ffffff;">You're on the waitlist!</h1>
      <p style="font-size: 15px; line-height: 1.6; color: #9ca3af; margin-bottom: 20px;">
        Thanks for joining the veedeeoh cloud waitlist. We are rolling out cloud access in batches to ensure maximum stream quality and performance.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #9ca3af; margin-bottom: 28px;">
        We will send you an invite code as soon as a spot opens up for your region.
      </p>
      <hr style="border: none; border-top: 1px solid #1f293d; margin: 24px 0;" />
      <p style="font-size: 12px; color: #6b7280; text-align: center;">
        veedeeoh &bull; <a href="https://veedeeoh.com" style="color: #6b7280; text-decoration: underline;">veedeeoh.com</a>
      </p>
    </div>
  `;

  const result = await sendEmail({ to: email, subject, html });
  if (result.success) {
    console.log(`[Waitlist] Confirmation email sent to ${email} (id: ${result.id})`);
  } else {
    console.warn(`[Waitlist] Could not send confirmation email to ${email}: ${result.error}`);
  }
}


// ---------------------------------------------------------- trial reminders ---

/** Branded shell shared by the trial emails, so a change to the frame does not
 *  have to be made twice and drift. */
/** Sent while the trial is still running. Deliberately not a hard sell -- the
 *  job is to make the clock visible, because six trials expired with no warning
 *  at all and none of them converted. */
export async function sendTrialEndingEmail(email: string, daysLeft: number): Promise<void> {
  const r = await sendEmail({
    to: email,
    subject: daysLeft <= 1 ? "Your trial ends tomorrow" : `${daysLeft} days left on your trial`,
    html: render({
      preheader: "Your profiles, lists and watch history stay exactly as they are.",
      heading: daysLeft <= 1 ? "Your trial ends tomorrow" : `${daysLeft} days left`,
      body: P("Your profiles, lists and watch history stay exactly as they are if you subscribe.")
        + P("$4 a month for the whole household: three profiles, parental controls, and watch parties."),
      cta: "Keep watching", ctaUrl: "https://veedeeoh.com/#settings/account",
    }),
  });
  // THROW on failure. sendEmail swallows errors and returns success:false, so
  // a caller that ignores the result treats a dead API key as a delivered
  // message. The trial cron marked people as reminded on exactly that basis.
  if (!r.success) throw new Error(r.error || "email send failed");
}

/** Sent after it lapses. Leads with what they KEEP rather than what they lost:
 *  a lapsed account can still follow watch party links, which is the whole
 *  point of the free tier and the most likely path back. */
export async function sendTrialEndedEmail(email: string): Promise<void> {
  const r = await sendEmail({
    to: email,
    subject: "Your trial has ended",
    html: render({
      preheader: "Your account is still open, and watch party links still work.",
      heading: "Your trial has ended",
      body: P("Your account is still open. Any watch party link you are sent will still work. You just cannot browse the catalogue on your own until you subscribe.")
        + P("Everything you had is waiting: profiles, lists, and where you left off."),
      cta: "Subscribe for $4 a month", ctaUrl: "https://veedeeoh.com/#settings/account",
    }),
  });
  if (!r.success) throw new Error(r.error || "email send failed");
}
