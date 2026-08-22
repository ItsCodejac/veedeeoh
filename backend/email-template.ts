// The one email template.
//
// There were two, identical by copy-paste: one in email.ts for waitlist and
// trial mail, one in auth-email.ts for confirmations and resets. Two copies of
// a brand is one brand that drifts, and the drift always shows up in the place
// nobody looks at often -- which for us is every email a new user ever gets
// before they see the product.
//
// THE FULL STOP LIVES IN THE SENDER NAME, NOT THE SUBJECT LINE. The brand is
// "veedeeoh." and the period is part of it, but "Confirm your veedeeoh.
// account" reads as a typo: sentence-ending punctuation in the middle of a
// sentence. Putting it in the From name solves both halves -- the period sits
// at the end where it belongs, the inbox shows the brand correctly, and
// subjects stop repeating a word the sender column already says:
//
//     veedeeoh.        Confirm your email
//     veedeeoh.        Reset your password
//
// Built as tables with inline styles because email clients are twenty years
// behind browsers: no flexbox, no grid, no external stylesheets, and Outlook
// ignores most of what remains.

/** From name and address. The period belongs here. */
export const MAIL_FROM = 'veedeeoh. <support@veedeeoh.com>';

const BG = '#06070a';
const CARD = '#0d1017';
const LINE = '#1e2533';
const TEXT = '#f3f4f6';
const DIM = '#9aa3b2';
const FAINT = '#6b7280';
const ACCENT = '#c5f04e';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface Mail {
  /** Short line under the heading in the inbox list. Without one, clients pull
   *  the first body text, which for us was the "if the button does not work"
   *  fallback -- the least useful sentence in the message. */
  preheader: string;
  heading: string;
  /** Paragraphs, already wrapped by P(). */
  body: string;
  cta?: string;
  ctaUrl?: string;
  /** Shown small under the button, for the "paste this if the button fails"
   *  case. Only auth mail needs it. */
  rawLink?: string;
}

export const P = (t: string): string =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${DIM};">${t}</p>`;

export const CODE = (t: string): string =>
  `<p style="margin:4px 0 20px;font-size:28px;letter-spacing:.22em;font-weight:800;color:${ACCENT};">${t}</p>`;

export function render(m: Mail): string {
  const button = m.cta && m.ctaUrl ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
          <tr><td style="border-radius:10px;background:${ACCENT};">
            <a href="${m.ctaUrl}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:800;color:#06070a;text-decoration:none;border-radius:10px;">${m.cta}</a>
          </td></tr>
        </table>` : '';

  const fallback = m.rawLink ? `
        <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:${FAINT};">
          Button not working? Paste this into your browser:<br>
          <span style="color:${DIM};word-break:break-all;">${m.rawLink}</span>
        </p>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background:${BG};">
  <!-- Preheader. Hidden in the message, shown by the inbox next to the subject.
       The trailing whitespace stops clients dragging body text in after it. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">
    ${m.preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
    <tr><td align="center" style="padding:36px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:${CARD};border:1px solid ${LINE};border-radius:16px;">
        <tr><td style="padding:34px 34px 30px;font-family:${FONT};">

          <div style="margin:0 0 26px;font-size:27px;font-weight:800;letter-spacing:-.02em;color:#ffffff;line-height:1;">veedeeoh<span style="color:${ACCENT};">.</span></div>

          <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;font-weight:800;color:${TEXT};">${m.heading}</h1>
          ${m.body}
          ${button}
          ${fallback}

        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td style="padding:18px 34px 0;font-family:${FONT};font-size:11.5px;line-height:1.7;color:${FAINT};text-align:center;">
          <a href="https://veedeeoh.com" style="color:${FAINT};text-decoration:none;">veedeeoh.com</a>
          &nbsp;&middot;&nbsp;
          <a href="https://veedeeoh.com/terms.html" style="color:${FAINT};text-decoration:none;">Terms</a>
          &nbsp;&middot;&nbsp;
          <a href="https://veedeeoh.com/privacy.html" style="color:${FAINT};text-decoration:none;">Privacy</a>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body></html>`;
}
