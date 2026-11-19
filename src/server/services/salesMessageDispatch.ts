/**
 * Provider-agnostic email/SMS dispatch service.
 *
 * Reads provider configuration from environment variables and dispatches
 * messages through the configured provider. Falls back to a no-op log
 * when no provider is configured so the UI flow still works in development.
 *
 * Email providers supported: smtp (via nodemailer), resend, sendgrid (stub)
 * SMS providers supported: twilio, africastalking (stub)
 */

export interface EmailDispatchResult {
  provider: string;
  messageId: string | null;
  delivered: number;
  failed: number;
}

export interface SMSDispatchResult {
  provider: string;
  messageId: string | null;
  delivered: number;
  failed: number;
}

/**
 * Dispatch an email campaign to a list of recipients.
 * In production, set these env vars:
 *   EMAIL_PROVIDER=smtp|resend|sendgrid
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (for smtp)
 *   RESEND_API_KEY  (for resend)
 *   SENDGRID_API_KEY (for sendgrid)
 */
export async function dispatchEmail(
  subject: string,
  body: string,
  recipients: string[],
): Promise<EmailDispatchResult> {
  const provider = process.env.EMAIL_PROVIDER || 'log';

  if (recipients.length === 0) {
    return { provider, messageId: null, delivered: 0, failed: 0 };
  }

  switch (provider) {
    case 'resend':
      return dispatchViaResend(subject, body, recipients);
    case 'sendgrid':
      return dispatchViaSendGrid(subject, body, recipients);
    case 'smtp':
      return dispatchViaSmtp(subject, body, recipients);
    default:
      // Log-only fallback for development
      console.log(`[EmailDispatch:log] subject="${subject}" recipients=${recipients.length}`);
      return { provider: 'log', messageId: `log-${Date.now()}`, delivered: recipients.length, failed: 0 };
  }
}

/**
 * Dispatch an SMS campaign to a list of phone numbers.
 * In production, set these env vars:
 *   SMS_PROVIDER=twilio|africastalking
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM  (for twilio)
 *   AFRICASTALKING_API_KEY, AFRICASTALKING_SENDER_ID  (for africastalking)
 */
export async function dispatchSMS(
  content: string,
  recipients: string[],
): Promise<SMSDispatchResult> {
  const provider = process.env.SMS_PROVIDER || 'log';

  if (recipients.length === 0) {
    return { provider, messageId: null, delivered: 0, failed: 0 };
  }

  switch (provider) {
    case 'twilio':
      return dispatchViaTwilio(content, recipients);
    case 'africastalking':
      return dispatchViaAfricasTalking(content, recipients);
    default:
      console.log(`[SMSDispatch:log] content="${content.substring(0, 50)}..." recipients=${recipients.length}`);
      return { provider: 'log', messageId: `log-${Date.now()}`, delivered: recipients.length, failed: 0 };
  }
}

// ── Email provider implementations ──────────────────────────

async function dispatchViaResend(subject: string, body: string, recipients: string[]): Promise<EmailDispatchResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[EmailDispatch:resend] RESEND_API_KEY not set, falling back to log');
    return { provider: 'log', messageId: null, delivered: recipients.length, failed: 0 };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'noreply@hotel.com',
        to: recipients,
        subject,
        html: body,
      }),
    });
    const data = await res.json();
    return { provider: 'resend', messageId: data.id || null, delivered: res.ok ? recipients.length : 0, failed: res.ok ? 0 : recipients.length };
  } catch (err) {
    console.error('[EmailDispatch:resend] error:', err);
    return { provider: 'resend', messageId: null, delivered: 0, failed: recipients.length };
  }
}

async function dispatchViaSendGrid(subject: string, body: string, recipients: string[]): Promise<EmailDispatchResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn('[EmailDispatch:sendgrid] SENDGRID_API_KEY not set, falling back to log');
    return { provider: 'log', messageId: null, delivered: recipients.length, failed: 0 };
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: recipients.map(r => ({ email: r })) }],
        from: { email: process.env.EMAIL_FROM || 'noreply@hotel.com' },
        subject,
        content: [{ type: 'text/html', value: body }],
      }),
    });
    return { provider: 'sendgrid', messageId: res.headers.get('x-message-id'), delivered: res.ok ? recipients.length : 0, failed: res.ok ? 0 : recipients.length };
  } catch (err) {
    console.error('[EmailDispatch:sendgrid] error:', err);
    return { provider: 'sendgrid', messageId: null, delivered: 0, failed: recipients.length };
  }
}

async function dispatchViaSmtp(subject: string, body: string, recipients: string[]): Promise<EmailDispatchResult> {
  // Dynamic import to avoid requiring nodemailer when not configured
  try {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      console.warn('[EmailDispatch:smtp] SMTP env vars not set, falling back to log');
      return { provider: 'log', messageId: null, delivered: recipients.length, failed: 0 };
    }
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || user,
      to: recipients.join(','),
      subject,
      html: body,
    });
    return { provider: 'smtp', messageId: info.messageId, delivered: recipients.length, failed: 0 };
  } catch (err) {
    console.error('[EmailDispatch:smtp] error:', err);
    return { provider: 'smtp', messageId: null, delivered: 0, failed: recipients.length };
  }
}

// ── SMS provider implementations ─────────────────────────────

async function dispatchViaTwilio(content: string, recipients: string[]): Promise<SMSDispatchResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.warn('[SMSDispatch:twilio] TWILIO env vars not set, falling back to log');
    return { provider: 'log', messageId: null, delivered: recipients.length, failed: 0 };
  }
  try {
    let delivered = 0, failed = 0;
    for (const to of recipients) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: to, Body: content }),
      });
      if (res.ok) delivered++; else failed++;
    }
    return { provider: 'twilio', messageId: `twilio-${Date.now()}`, delivered, failed };
  } catch (err) {
    console.error('[SMSDispatch:twilio] error:', err);
    return { provider: 'twilio', messageId: null, delivered: 0, failed: recipients.length };
  }
}

async function dispatchViaAfricasTalking(content: string, recipients: string[]): Promise<SMSDispatchResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const senderId = process.env.AFRICASTALKING_SENDER_ID;
  const username = process.env.AFRICASTALKING_USERNAME || 'sandbox';
  if (!apiKey) {
    console.warn('[SMSDispatch:africastalking] AFRICASTALKING_API_KEY not set, falling back to log');
    return { provider: 'log', messageId: null, delivered: recipients.length, failed: 0 };
  }
  try {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { 'apiKey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        username,
        message: content,
        to: recipients.join(','),
        from: senderId || '',
      }),
    });
    const data = await res.json();
    const delivered = data?.SMSMessageData?.Recipients?.filter((r: any) => r.status === 'Success')?.length || 0;
    const failed = recipients.length - delivered;
    return { provider: 'africastalking', messageId: `at-${Date.now()}`, delivered, failed };
  } catch (err) {
    console.error('[SMSDispatch:africastalking] error:', err);
    return { provider: 'africastalking', messageId: null, delivered: 0, failed: recipients.length };
  }
}
