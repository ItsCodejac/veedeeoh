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

  const from = options.from || 'veedeeoh <support@veedeeoh.com>';
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
