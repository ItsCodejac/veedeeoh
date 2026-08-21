import * as fs from 'fs';
import * as path from 'path';
import { sendEmail, getResendApiKey } from '../backend/email';

// Load .env manually if process.env isn't already populated
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  // Ignore .env read errors
}

async function main() {
  console.log('=== Resend API Verification ===');
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error('❌ Error: Neither RESEND_API_KEY nor RESENT_API_KEY found in .env');
    process.exit(1);
  }

  console.log('✅ Found API Key starting with:', apiKey.substring(0, 5) + '...');
  
  const recipient = process.argv[2] || 'support@veedeeoh.com';
  console.log(`Sending test email to ${recipient}...`);

  // First attempt with custom domain sender
  let res = await sendEmail({
    from: 'veedeeoh <support@veedeeoh.com>',
    to: recipient,
    subject: 'veedeeoh Resend Integration Test',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Resend Email Verification</h2>
        <p>If you are reading this, your Resend API setup for <strong>veedeeoh</strong> is working successfully!</p>
        <p><small>Sent at: ${new Date().toISOString()}</small></p>
      </div>
    `,
  });

  // If custom domain is not verified yet, test with Resend's free onboarding sandbox sender
  if (!res.success && res.error?.includes('not verified')) {
    console.log('\n⚠️  veedeeoh.com domain not verified in Resend dashboard yet.');
    console.log('🔄 Retrying test email using Resend Onboarding Sandbox (onboarding@resend.dev)...');
    res = await sendEmail({
      from: 'veedeeoh <onboarding@resend.dev>',
      to: recipient,
      subject: 'veedeeoh Resend Integration Test (Sandbox)',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Resend Email Verification (Sandbox)</h2>
          <p>Your Resend API key is <strong>working correctly</strong>!</p>
          <p>Once you verify <code>veedeeoh.com</code> at <a href="https://resend.com/domains">resend.com/domains</a>, emails will be sent directly from <code>support@veedeeoh.com</code>.</p>
        </div>
      `,
    });
  }

  if (res.success) {
    console.log(`\n🎉 Success! Email delivered via Resend with ID: ${res.id}`);
  } else {
    console.error(`\n❌ Send failed: ${res.error}`);
  }
}

main().catch(console.error);
